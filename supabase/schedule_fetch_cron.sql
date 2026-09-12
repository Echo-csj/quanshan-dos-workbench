-- ============================================================
-- 课程表每日自动抓取 · 定时任务
-- 推荐做法：在 Supabase Dashboard → Edge Functions → fetch-schedule →
--           「Add cron schedule」选 每天 06:00。Dashboard 会以 service-role
--           调用本函数，无需额外密钥（函数内按 service-role 识别并写入 OWNER_USER_ID）。
-- ============================================================
-- 下列 SQL 为「高级替代方案」：用 pg_cron + pg_net 自行触发，
-- 需要先在 Database → Extensions 启用 pg_cron、pg_net；且需把 CRON_SECRET
-- 换成你在 Secrets 中设置的同名值（请勿把真实密钥提交进仓库）。

-- 1) 启用扩展（仅需一次）
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) 删除同名旧任务（若存在；不存在时 pg_cron 会报错，故先查后删）
select cron.unschedule(jobname) from cron.job where jobname = 'daily-fetch-schedule';

-- 3) 新建每日 06:00（服务器时区，默认 UTC；如需东八区可改为 '0 22 * * *'）调用
select cron.schedule(
  'daily-fetch-schedule',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://zxemcyngesgxpbevdxsu.supabase.co/functions/v1/fetch-schedule',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- 4) 设置 cron 调用所用密钥（将 '<你的CRON_SECRET>' 替换为 Secrets 中的真实值；也可在 Dashboard 用 Vault 管理）
-- alter database postgres set app.settings.cron_secret = '<你的CRON_SECRET>';
