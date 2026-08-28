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
