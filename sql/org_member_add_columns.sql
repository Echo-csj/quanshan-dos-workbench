-- ============================================================
-- org_member 拆分「成员真名」与「学科组」
-- 适用：自建 Supabase（supabase.dosworkbench.top）的 dos_workbench 库
-- 执行位置：Supabase Studio → SQL Editor → 粘贴运行（或在 1Panel/psql 执行）
-- 说明：
--   旧版 org_member.name 被复用作「学科组」名称，导致子台任务负责人误显为学科组名。
--   本次新增 display_name（成员真名）与 subject_group（学科组）两个独立字段。
--   - 新纳管成员：前端会正确写入 display_name / subject_group，name 同步为真实姓名。
--   - 存量成员：旧 name 字段仍承载学科组，本脚本把 name 复制到 subject_group，
--     保证教师/里程碑按学科组过滤不中断；name 仍以学科组显示，直至在
--     「子工作台管理 → 编辑」中重新填入真实姓名与学科组。
-- ============================================================

-- 1) 增加列（IF NOT EXISTS 避免重复执行报错）
ALTER TABLE org_member ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE org_member ADD COLUMN IF NOT EXISTS subject_group text;

-- 2) 存量兼容：把旧 name（学科组）回填到 subject_group
UPDATE org_member
   SET subject_group = name
 WHERE subject_group IS NULL
   AND name IS NOT NULL
   AND name <> '';

-- 3) 验证
-- SELECT id, name, display_name, subject_group, role, status FROM org_member ORDER BY created_at;
