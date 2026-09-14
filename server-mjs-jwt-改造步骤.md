# 腾讯云 server.mjs 增加 JWT 鉴权分支 — 具体操作步骤

> 目标：让 `https://supabase.dosworkbench.top/fetch-schedule` 同时接受两种调用：
> ① 定时抓取（pg_cron）带 `x-cron-secret`（服务端 secret，保持不变）
> ② 手动「同步抓取」带用户会话 `Authorization: Bearer <jwt>`（前端改好后发送）
> 部署后告诉我，我把前端两文件推上去，按钮无缝恢复、密钥不再暴露。

## 步骤 1：登录服务器
- 方式 A（1Panel）：打开 1Panel → 终端 / 文件，进入项目目录。
- 方式 B（SSH）：`ssh root@106.54.242.128`（用你自己的 Lighthouse IP 与密钥）。

## 步骤 2：定位 server.mjs（你已完成 ✅）
文件在 `/opt/schedule-fetch/server.mjs`，由 systemd 以 `node --env-file=/opt/schedule-fetch/.env /opt/schedule-fetch/server.mjs` 常驻。

## 步骤 3：无需手动改文件 —— 仓库已更新
agent 已在本仓库 `server-fetch-schedule/server.mjs` 加入 JWT 鉴权分支（保留 cron secret 路径，新增「拿用户会话 JWT 去 Supabase `/auth/v1/user` 验真」路径，零新依赖、零新密钥）。你只要重新下载这一份覆盖服务器上的旧文件即可。

具体改动（仅供参考）：
- 请求处理：cron secret 通过 **或** 合法 JWT 通过，任一即放行；两者都不行才 401。
- 新增 `verifyUserJWT(jwt, C)`：用已有的 `SUPABASE_URL` + `SERVICE_ROLE` 调 `/auth/v1/user` 验真，拿到合法 user 即放行（匿名 anon key 不会通过）。
- 自动定时抓取逻辑、写回逻辑完全不变 → 零回归。

## 步骤 4：重新下载并重启（核心步骤）
在服务器上执行（和当初部署时一模一样）：
```bash
curl -fsSL https://raw.githubusercontent.com/Echo-csj/quanshan-dos-workbench/main/server-fetch-schedule/server.mjs -o /opt/schedule-fetch/server.mjs
systemctl restart schedule-fetch
ss -ltnp | grep 28888
```
`ss -ltnp | grep 28888` 能列出监听端口即说明重启成功。
（若 curl 似曾被代理缓存，可在 URL 后加 `?v=2` 时间戳强制拉最新。）

## 步骤 5：服务端自测（不需要我参与）
在服务器上新建 `test-jwt.mjs`（与 server.mjs 同目录），用你自己的登录邮箱/密码换出 JWT 并打端点，确认返回 200。本脚本零依赖（只用 node 内置 fetch）：
```js
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5MTk1Mzk5LCJleHAiOjQxMDI0NDQ4MDB9.Yejt5D7n9lzPzORBa9nUYJrzccPgxk3i5-sihrn-AV4';
const SB = 'https://supabase.dosworkbench.top';
const email = '你的登录邮箱';
const password = '你的密码';
const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email, password }),
});
const j = await r.json();
if (!j.access_token) { console.log('登录失败', j); process.exit(1); }
const jwt = j.access_token;
const fr = await fetch('http://127.0.0.1:28888/fetch', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt }, body: '{}',
});
console.log('STATUS', fr.status, await fr.text());
```
运行 `node test-jwt.mjs`：
- 看到 `STATUS 200 ...` → JWT 鉴权生效 ✅
- 看到 `STATUS 401` → 检查步骤 4 是否真的重新下载并重启了（curl 可能被代理缓存，加 `?v=2` 重试）

> 内部路径：1Panel 反代把 `/fetch-schedule` 映射到 `/fetch`，所以自测用 `http://127.0.0.1:28888/fetch`。

## 步骤 6：告诉我
服务端自测 200 后，回复我「server.mjs 已部署」，我立即把前端 `js/config.js` + `js/views/schedule.js` 推送上线 —— 按钮无缝恢复、「同步抓取」改走用户 JWT、`daily-fetch-2026` 不再出现在任何前端代码里。
