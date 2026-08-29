-- ============================================================
-- 权限角色系统（子工作台三级权限）
-- 用途：在 org_member 上增加 role（角色）与 project_tags（项目组标签），
--       支撑「学科组长 / 教学校长实习生 / 项目组负责人」三级权限与项目组同步。
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全部 → Run。
-- 幂等：重复执行不报错；已存在的列会被跳过。
-- 角色取值：subject_lead（学科组长，默认）/ principal_intern（教学校长实习生）/ project_lead（项目组负责人）
-- ============================================================

-- 7.13 角色与项目组标签字段
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
end $$;

-- 默认值兜底：历史已纳管的子工作台统一归为「学科组长」（满足「默认归属学科组长」规则）
update org_member set role = 'subject_lead' where role is null or role = '';
update org_member set project_tags = '[]'::jsonb where project_tags is null;
