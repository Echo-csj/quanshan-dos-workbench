-- ============================================================
-- 权限角色系统（子工作台三级权限）
-- 用途：在 org_member 上增加 role（角色）、project_tags（项目组标签）与 email（登录邮箱），
--       支撑「学科组长 / 教学校长实习生 / 项目组负责人」三级权限与项目组同步，
--       并保证总台在子台尚未登录/无 profile 时也能显示其真实登录邮箱。
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全部 → Run。
-- 幂等：重复执行不报错；已存在的列会被跳过。
-- 角色取值：subject_lead（学科组长，默认）/ principal_intern（教学校长实习生）/ project_lead（项目组负责人）
-- ============================================================

-- 7.13 角色、项目组标签与登录邮箱字段
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
