-- ============================================================
-- 云端同步数据库结构（Supabase / PostgreSQL）
-- 用途：两个工作台（数据分析台 + 个人台）共用本项目，
--       通过「每用户整文档」模型同步，并用 shared_link 做联动桥。
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全部 → Run。
-- ============================================================

-- 1) 数据分析台：整份记录数组（jsonb）
create table if not exists campus_analytics (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) 个人台：整份大对象（jsonb）
create table if not exists dos_workbench (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) 共享桥表：分析台 → 个人台 推送的字段（每种 kind 每用户一条）
create table if not exists shared_link (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create index if not exists idx_shared_link_user on shared_link(user_id);

-- 4) 行级安全（RLS）：每条数据只能被其主人读写
alter table campus_analytics enable row level security;
alter table dos_workbench    enable row level security;
alter table shared_link      enable row level security;

drop policy if exists "own_row" on campus_analytics;
create policy "own_row" on campus_analytics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_row" on dos_workbench;
create policy "own_row" on dos_workbench
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_rows" on shared_link;
create policy "own_rows" on shared_link
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5) updated_at 自动刷新
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ca on campus_analytics;
create trigger trg_ca before update on campus_analytics
  for each row execute function touch_updated_at();

drop trigger if exists trg_dw on dos_workbench;
create trigger trg_dw before update on dos_workbench
  for each row execute function touch_updated_at();

drop trigger if exists trg_sl on shared_link;
create trigger trg_sl before update on shared_link
  for each row execute function touch_updated_at();

-- ============================================================
-- 6) 任务收发表（双向）：A ↔ B 互发任务，按邮箱路由
--    执行方式：Supabase 控制台 → SQL Editor → 粘贴本节 → Run。
-- ============================================================
create table if not exists task_share (
  id          uuid primary key default gen_random_uuid(),
  from_email  text not null,
  to_email    text not null,
  task        jsonb not null default '{}'::jsonb,   -- 任务快照 {title, priority, dueDate, note, assignee}
  status      text not null default 'sent',         -- sent | accepted | done | declined
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_task_share_to   on task_share(to_email);
create index if not exists idx_task_share_from on task_share(from_email);

alter table task_share enable row level security;

-- 收件人 / 发件人都能读
create policy "ts_read" on task_share
  for select using (auth.jwt() ->> 'email' in (lower(from_email), lower(to_email)));
-- 只能以自己身份插入
create policy "ts_insert" on task_share
  for insert with check (auth.jwt() ->> 'email' = lower(from_email));
-- 收件人 / 发件人都能更新（接收 / 完成 / 拒绝）
create policy "ts_update" on task_share
  for update using (auth.jwt() ->> 'email' in (lower(from_email), lower(to_email)));

drop trigger if exists trg_ts on task_share;
create trigger trg_ts before update on task_share
  for each row execute function touch_updated_at();

-- 开启实时推送（需在项目已启用 Realtime 的前提下）
alter publication supabase_realtime add table task_share;

-- ============================================================
-- 7) 多层级工作台（总工作台 → 子工作台）
--    org 组织 / org_member 子工作台 / profile 账号档案
--    share_grant 共享规则 / shared_item 共享数据 / share_log 审计日志
--    执行方式：Supabase 控制台 → SQL Editor → 粘贴本节 → Run。
--    注意建表顺序：org / org_member 必须先于 profile（profile 策略引用它们）。
-- ============================================================

-- 7.1 org：组织（总工作台）
create table if not exists org (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table org enable row level security;

drop policy if exists "org_owner_all" on org;
create policy "org_owner_all" on org
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- 7.2 org_member：子工作台成员
create table if not exists org_member (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references org(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text,
  email      text,                               -- 子台登录邮箱（独立于 profile，保证总台始终可展示）
  status     text not null default 'active',   -- active | suspended
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
alter table org_member enable row level security;

drop policy if exists "member_owner_all" on org_member;
create policy "member_owner_all" on org_member
  for all using (public.is_org_owner(org_member.org_id));

drop policy if exists "member_self_read" on org_member;
create policy "member_self_read" on org_member
  for select using (user_id = auth.uid());

-- 注意：org 的「成员可读」策略引用 org_member，必须在 org_member 建好之后再建
drop policy if exists "org_member_read" on org;
create policy "org_member_read" on org
  for select using (public.is_org_member(org.id));

-- 7.3 profile：账号档案（邮箱 ↔ user_id 解析、显示名）
create table if not exists profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profile enable row level security;

drop policy if exists "profile_self" on profile;
create policy "profile_self" on profile
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 组织 owner 可读本组织成员档案；子工作台之间仍互不可见
drop policy if exists "profile_org_owner_read" on profile;
create policy "profile_org_owner_read" on profile
  for select using (public.is_my_org_member(profile.user_id));

-- 7.4 share_grant：共享规则（核心）
create table if not exists share_grant (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references org(id) on delete cascade,
  from_user_id  uuid not null references auth.users(id) on delete cascade,
  to_user_id    uuid not null references auth.users(id) on delete cascade,
  data_type     text not null,                 -- tasks | reports | teachers | timeline | projects | hr | *
  item_id       text,                          -- 具体条目 id（null = 该类型全部）
  item_filter   jsonb,                         -- 更细筛选，如 {"status":["todo","doing"]}
  permission    text not null default 'read',  -- summary | read | edit
  allow_reverse boolean not null default false,
  reverse_mode  text,                          -- status（仅状态） | full（完整编辑）
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_share_grant_to   on share_grant(to_user_id, active);
create index if not exists idx_share_grant_from on share_grant(from_user_id);

alter table share_grant enable row level security;

drop policy if exists "grant_owner_all" on share_grant;
create policy "grant_owner_all" on share_grant
  for all using (public.is_org_owner(share_grant.org_id));

drop policy if exists "grant_sub_read" on share_grant;
create policy "grant_sub_read" on share_grant
  for select using (to_user_id = auth.uid());

-- 7.5 shared_item：共享数据（物化快照）
create table if not exists shared_item (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references org(id) on delete cascade,
  grant_id      uuid references share_grant(id) on delete cascade,
  from_user_id  uuid not null references auth.users(id) on delete cascade,
  to_user_id    uuid not null references auth.users(id) on delete cascade,
  data_type     text not null,
  item_id       text not null,                 -- 原条目 id
  permission    text not null,                 -- 冗余自 grant，便于快速判断
  direction     text not null default 'down',  -- down 总→子 | up 子回传
  reply_to_id   uuid,                          -- 回传时指向原 shared_item.id
  payload       jsonb not null default '{}'::jsonb,
  version       int not null default 1,
  status        text not null default 'active',-- active | revoked | superseded
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_shared_item_to    on shared_item(to_user_id, status);
create index if not exists idx_shared_item_from  on shared_item(from_user_id, direction);
create index if not exists idx_shared_item_grant on shared_item(grant_id);

alter table shared_item enable row level security;

drop policy if exists "item_owner_all" on shared_item;
create policy "item_owner_all" on shared_item
  for all using (public.is_org_owner(shared_item.org_id));

drop policy if exists "item_sub_read" on shared_item;
create policy "item_sub_read" on shared_item
  for select using (to_user_id = auth.uid());

-- 子工作台回传（direction='up'）：需存在「发给我的、allow_reverse、data_type 匹配」的有效规则
drop policy if exists "item_sub_reverse" on shared_item;
create policy "item_sub_reverse" on shared_item
  for insert with check (
    from_user_id = auth.uid() and direction = 'up'
    and exists (select 1 from share_grant g
                where g.to_user_id = auth.uid()
                  and g.from_user_id = shared_item.to_user_id
                  and g.data_type = shared_item.data_type
                  and g.allow_reverse = true and g.active = true)
  );

-- 7.6 share_log：审计日志
create table if not exists share_log (
  id             bigint generated always as identity primary key,
  org_id         uuid,
  actor_user_id  uuid references auth.users(id) on delete set null,
  action         text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  data_type      text,
  item_id        text,
  detail         jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_share_log_org   on share_log(org_id, created_at);
create index if not exists idx_share_log_actor on share_log(actor_user_id, created_at);

alter table share_log enable row level security;

drop policy if exists "log_insert_auth" on share_log;
create policy "log_insert_auth" on share_log
  for insert with check (actor_user_id = auth.uid());

drop policy if exists "log_owner_read" on share_log;
create policy "log_owner_read" on share_log
  for select using (public.is_org_owner(share_log.org_id));

drop policy if exists "log_self_read" on share_log;
create policy "log_self_read" on share_log
  for select using (target_user_id = auth.uid() or actor_user_id = auth.uid());

-- 7.6b 辅助函数：打破 RLS 递归（security definer 以创建者权限运行，不触发目标表的 RLS）
--     否则 org ↔ org_member 的策略会互相查对方表，造成 infinite recursion
create or replace function public.is_org_owner(p_org_id uuid)
returns boolean language sql security definer set search_path = public
as $$
  select exists (select 1 from org where id = p_org_id and owner_user_id = auth.uid());
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql security definer set search_path = public
as $$
  select exists (select 1 from org_member where org_id = p_org_id and user_id = auth.uid());
$$;

create or replace function public.is_my_org_member(p_user_id uuid)
returns boolean language sql security definer set search_path = public
as $$
  select exists (
    select 1 from org o join org_member m on m.org_id = o.id
    where o.owner_user_id = auth.uid() and m.user_id = p_user_id
  );
$$;

-- 7.7 updated_at 自动刷新（复用第 5 节的 touch_updated_at）
drop trigger if exists trg_org on org;
create trigger trg_org before update on org
  for each row execute function touch_updated_at();

drop trigger if exists trg_profile on profile;
create trigger trg_profile before update on profile
  for each row execute function touch_updated_at();

drop trigger if exists trg_grant on share_grant;
create trigger trg_grant before update on share_grant
  for each row execute function touch_updated_at();

drop trigger if exists trg_item on shared_item;
create trigger trg_item before update on shared_item
  for each row execute function touch_updated_at();

-- 7.8 实时推送（子台即时收到共享、总台即时收到回传）——幂等判断，重复执行不报错
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_item') then
    alter publication supabase_realtime add table shared_item;
  end if;
end $$;

-- 7.9（可选）按邮箱查 user_id——让「子工作台尚未首次登录」时也能被纳管
--     安全：调用者必须已登录（auth.uid() 非 null），禁止匿名枚举
create or replace function public.lookup_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select case when auth.uid() is null then null
              else (select id from auth.users where lower(email) = lower(p_email) limit 1) end;
$$;

-- ============================================================
-- 7.10 总工作台查看子工作台数据（团队汇总 · 只读）
--      允许组织 owner 读取本组织成员（子工作台）的 dos_workbench 整档数据，
--      用于「总台汇总查看子台教师转正/工龄提醒」。
--      总台对子台数据仅「只读 + 标注」：标注通过 shared_item(direction=down, data_type='annotation') 下发，
--      不直接修改子台数据 —— 故此处只授 SELECT，不授 insert/update。
--      复用 7.6b 的 security definer 函数 is_my_org_member，不会触发 RLS 递归。
-- ============================================================

-- 读：总台可查看本组织成员的整档数据
drop policy if exists "org_owner_select_member_dw" on dos_workbench;
create policy "org_owner_select_member_dw" on dos_workbench
  for select using (public.is_my_org_member(dos_workbench.user_id));

-- 撤销：总台不再直接写子台数据（改为标注提示，见 7.11）
drop policy if exists "org_owner_insert_member_dw" on dos_workbench;
drop policy if exists "org_owner_update_member_dw" on dos_workbench;

-- 实时：把 dos_workbench 加入 realtime（子台数据变化时总台汇总可近实时刷新）
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dos_workbench') then
    alter publication supabase_realtime add table dos_workbench;
  end if;
end $$;

-- ============================================================
-- 7.11 总台 → 子台标注提示（总台只读，不改子台数据）
--      标注即一条 shared_item(direction=down, data_type='annotation')，
--      总台(org owner) 可插入（item_owner_all 策略），子台(item_sub_read) 只读。
--      子台在对应条目展示标注，看到后自行处理（完成/修改）。
-- ============================================================

-- ============================================================
-- 7.12 子工作台读总工作台数据（数据源于总台）
--      允许组织成员（子工作台）读取本组织 owner（总工作台）的 dos_workbench 整档数据，
--      支撑「子台数据源于总台」：子台实时读总台数据，再按模块规则在本地做过滤视图。
--      各模块可见性（今日/看板过滤、时间轴/数据/项目组全量、教师全量）在子台前端呈现。
--      复用 security definer 函数 is_my_org_owner，不触发 RLS 递归。
--      信任边界：子台可读总台整档数据（授权设计），过滤属展示层规则，非数据库隔离。
-- ============================================================

create or replace function public.is_my_org_owner(p_user_id uuid)
returns boolean language sql security definer set search_path = public
as $$
  select exists (
    select 1 from org o join org_member m on m.org_id = o.id
    where m.user_id = auth.uid() and o.owner_user_id = p_user_id
  );
$$;

-- 读：子工作台可读本组织 owner（总工作台）的整档数据
drop policy if exists "org_member_read_owner_dw" on dos_workbench;
create policy "org_member_read_owner_dw" on dos_workbench
  for select using (public.is_my_org_owner(dos_workbench.user_id));

-- ============================================================
-- 7.13 权限角色系统（子工作台三级权限）
--     在 org_member 上增加 role（角色）、project_tags（项目组标签）与 email（登录邮箱），
--     支撑「学科组长 / 教学校长实习生 / 项目组负责人」三级权限与项目组同步，
--     并保证子台登录邮箱在 profile 缺失时仍可显示。
--     角色取值：subject_lead（学科组长，默认）/ principal_intern（教学校长实习生）/ project_lead（项目组负责人）
--     注意：本段幂等，且必须在 org_member 表已存在之后执行。
-- ============================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'org_member' and column_name = 'role') then
    alter table org_member add column role text not null default 'subject_lead';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'org_member' and column_name = 'project_tags') then
    alter table org_member add column project_tags jsonb not null default '[]'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'org_member' and column_name = 'email') then
    alter table org_member add column email text;
  end if;
end $$;

-- 默认值兜底：历史已纳管的子工作台统一归为「学科组长」（满足「默认归属学科组长」规则）
update org_member set role = 'subject_lead' where role is null or role = '';
update org_member set project_tags = '[]'::jsonb where project_tags is null;

-- 邮箱回填：从 auth.users 把真实登录邮箱补回 org_member（解决已纳管子台只显示 UUID 的问题）
update org_member m
set email = u.email
from auth.users u
where m.user_id = u.id
  and (m.email is null or m.email = '');
