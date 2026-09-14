// config.js — 云端同步配置
// 在 Supabase 控制台 → Project Settings → API 中复制下面两项，替换占位符即可。
// 说明：publishable key（旧称 anon key）本就是公开的设计（数据安全靠 RLS 行级权限，不靠藏密钥），
//       所以把本文件提交到 GitHub 仓库也不泄露隐私。切勿填写 secret / service_role 密钥。
window.APP_CONFIG = {
  SUPABASE_URL: 'https://supabase.dosworkbench.top',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5MTk1Mzk5LCJleHAiOjQxMDI0NDQ4MDB9.Yejt5D7n9lzPzORBa9nUYJrzccPgxk3i5-sihrn-AV4',
  APP_NAME: 'dos-workbench',
  // 同级互发任务（task_share）：当前关闭——团队/下属场景由「多层级工作台」承担。
  // 若以后要和同级同事互派任务：改为 true，并在 Supabase 执行 schema.sql 第 6 节建表即可恢复。
  TASK_SHARE: false,
  // 课程表自动抓取（腾讯云服务器本地 Node 服务，替代已失效的自建 Edge Function fetch-schedule）
  // 走已可用证书 supabase.dosworkbench.top 的路径反代：HTTPS 入口 = https://supabase.dosworkbench.top/fetch-schedule
  // （fetch.dosworkbench.top 子域名被腾讯 webblock 拦截、HTTP-01 无法签发证书，故改用此路径方案）
  // 鉴权：定时抓取走服务端 cron secret（仅服务端持有）；手动「同步抓取」走当前登录用户的 Supabase 会话 JWT，前端不再下发任何密钥
  COURSE_FETCH_WORKER_URL: 'https://supabase.dosworkbench.top/fetch-schedule'
};
