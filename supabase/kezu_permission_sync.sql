-- ============================================================
-- 7.14 科组联动快照授权：子工作台读总工作台的 shared_link 快照
-- 用途：把「最佳科组排名 / 科组生产预测」两个模块开放给
--       教学校长实习生(DOST / principal_intern) 与 学科组长(科组组长 / subject_lead)，
--       让子工作台能读取总工作台(DOS)通过「推送分析到个人台」下发的 analytics_snapshot。
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全部 → Run。幂等，可重复执行。
-- 前置：schema.sql 7.12 节的 security definer 函数 is_my_org_owner 已创建。
-- 信任边界：与 7.12「子台读总台整档数据」一致——数据层授权子台读总台快照；
--           模块可见性（project_lead 隐藏数据看板）由前端 canView 展示层过滤，非数据库隔离。
-- ============================================================

-- 读：组织成员（子工作台）可读本组织 owner（总工作台）推送的 shared_link 快照
drop policy if exists "org_member_read_owner_shared" on shared_link;
create policy "org_member_read_owner_shared" on shared_link
  for select using (public.is_my_org_owner(shared_link.user_id));

-- 实时：把 shared_link 加入 realtime（总台推送后子台可近实时刷新）
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_link') then
    alter publication supabase_realtime add table shared_link;
  end if;
end $$;
