# 课程表自动抓取 · 部署与配置指南

## 架构

```
内部排课系统 zyg.91paike.com（ASP.NET WebForms，登录无验证码）
        │  (Edge Function 服务端登录抓取，绕开浏览器 CORS)
        ▼
Supabase Edge Function: fetch-schedule
  1. GET login.aspx → 取 __VIEWSTATE / __EVENTVALIDATION 等隐藏字段 + 会话 cookie
  2. POST 登录（账号/密码 + btn_submit=登 录）
  3. GET schedules.aspx?module=400002 → 解析为 teacher×week 结构
  4. upsert 到 shared_link(kind='schedule_fetch')
        │
        ▼
前端 课程表页 (/schedule)
  - 进入页面即拉取 shared_link → 显示「应用抓取结果」横幅
  - 「同步抓取」按钮 → 立即触发函数
  - 订阅 shared_link 实时更新 → 抓取落地近实时提示
  - 点「应用」→ 写入本地课程表(source='fetch')
```

> 源站为登录墙 + 无 CORS，纯静态前端无法直接抓，因此必须有这个后端中转。

## 源站 specifics（已逆向并验证）

| 项 | 值 |
|---|---|
| 根地址 | `http://zyg.91paike.com`（**仅 HTTP，无 HTTPS**） |
| 登录页 | `/login.aspx?return=schedules.aspx%3fmodule%3d400002` |
| 课表页 | `/schedules.aspx?module=400002`（默认显示当前周） |
| 登录字段 | `tb_account`（账号）、`tb_password`（密码）、`btn_submit`（值 `登 录`，含全角空格） |
| 隐藏字段 | `__VIEWSTATE`、`__EVENTVALIDATION`、`__VIEWSTATEGENERATOR`、`HIDDENFIELDACCESSID` 等（函数自动回传） |
| 课表结构 | 每位教师一个块：侧栏 `course-nav` 含 姓名/工号/学科/统计；`.arrange` 为 7 天日级标签（如 `A班 [13:00-20:00]` / `休息`），`.calendar` 含 `tchid` 绑定；`day-nav` 给出周范围 |

解析逻辑已用真实登录后的 HTML 样张在本地验证：26 位教师、周 `2026-08-31 → 2026-09-06`、节次自动合并排序，全部通过。

## 一、需在 Supabase 设置的 Secrets

函数内通过 `Deno.env.get` 读取。当前代码实际用到的：

| Secret | 必填 | 说明 | 示例 |
|---|---|---|---|
| `SOURCE_BASE_URL` | ✅ | 源站根地址（**用 http:// 不是 https://**） | `http://zyg.91paike.com` |
| `SOURCE_MODULE` | ✅ | 课表 module 参数 | `400002` |
| `SOURCE_USER` | ✅ | 源站登录账号 | `<你的源站账号>` |
| `SOURCE_PASS` | ✅ | 源站登录密码 | `<你的源站密码>` |
| `SOURCE_PARSE_MODE` | ⬜ | `html`（默认）或 `json` | `html` |
| `SOURCE_API_URL` | ⬜ | 仅当源站有 JSON 接口时填（设后改 `SOURCE_PARSE_MODE=json`） | `` |
| `OWNER_USER_ID` | ✅ | 课程表归属者(DOS)的 `auth.users.id`，定时写入用 | `a1b2c3...` |
| `CRON_SECRET` | ⬜ | 手动 cron 调用共享密钥（可选） | `随机串` |

> ⚠️ 不要把真实账号/密码/密钥写进仓库文件。Secrets 只在 Supabase 后台设置。
> ℹ️ **`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 不要手动设**——
> `supabase functions deploy` / `invoke` 时 CLI 会自动注入。手动设会被 CLI 拒绝（提示 `Env name cannot start with SUPABASE_, skipping`）。
> ⚠️ **HTTP-only 风险**：源站无 HTTPS。Supabase Edge Function(Deno) 对明文 `http://` 出站抓取可能受限；
> 若部署后报网络错误（如 `error sending request` / `403` from Deno），请改用下方「备选方案」。

获取 `OWNER_USER_ID`：前端登录后，浏览器控制台执行
`await (await window.App.sync.getClient().auth.getUser()).data.user.id`；或 SQL `select id from auth.users where email = '你的登录邮箱';`

## 二、部署命令（macOS）

```bash
# 1) 安装 CLI（Apple Silicon；Intel 把 arm64 换 x86_64）
curl -L https://github.com/supabase/cli/releases/download/v2.116.0/supabase_darwin_arm64.tar.gz -o /tmp/sb.tar.gz
tar -xzf /tmp/sb.tar.gz -C /tmp
sudo mkdir -p /usr/local/bin
sudo mv /tmp/supabase /tmp/supabase-go /usr/local/bin/
supabase --version

# 2) 登录并关联项目（浏览器授权）
supabase login
supabase link --project-ref zxemcyngesgxpbevdxsu

# 3) 设置自定义 Secrets（SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY 由 CLI 自动注入，无需手动设）
supabase secrets set SOURCE_BASE_URL="http://zyg.91paike.com"
supabase secrets set SOURCE_MODULE="400002"
supabase secrets set SOURCE_USER="<你的源站账号>"
supabase secrets set SOURCE_PASS="<你的源站密码>"
supabase secrets set OWNER_USER_ID="a1b2c3..."
supabase secrets set CRON_SECRET="daily-fetch-2026"

# 验证（应看到上面 6 条，且不应有任何 SUPABASE_ 开头的项）
supabase secrets list

# 4) 部署函数
supabase functions deploy fetch-schedule
```

## 三、每日定时

**推荐**：Supabase Dashboard → Edge Functions → `fetch-schedule` → Add cron schedule → 每天 06:00。
Dashboard 以 service-role 调用，函数按 `OWNER_USER_ID` 写入，无需额外密钥。

（高级替代：执行 `supabase/schedule_fetch_cron.sql`，见文件内说明。）

## 四、手动触发 / 调试

- 前端「课程表」页的「同步抓取」按钮：以当前用户身份立即触发一次（结果落地后弹「应用抓取结果」横幅）。
- 命令行直接触发（需已 `supabase link`）：
  ```bash
  supabase functions invoke fetch-schedule --no-verify-jwt
  ```
  返回 `{"ok":true,"teachers":26,"fetchedAt":"..."}` 即成功。

## 五、HTTP-only 备选方案（若 Deno 拦截明文 HTTP）

若部署后 `fetch` 报网络错误，二选一：

1. **Cloudflare Worker 抓取**：把 `fetch-schedule` 的抓取逻辑迁到 CF Worker（Worker 出站支持 `http://`），
   结果仍写 Supabase `shared_link`（用 service-role + anon 客户端）。前端无需改。
2. **HTTPS 反代**：用任意支持 HTTPS 的反向代理（如 Cloudflare Tunnel / nginx）把源站暴露为 `https://`，
   再设 `SOURCE_BASE_URL=https://你的反代域名`，其余不变。

## 六、前端使用

1. 部署并设置 Secrets 后，前端登录 → 打开「课程表」。
2. 顶部出现「同步抓取」按钮 → 点一下立即触发一次抓取（结果落地后弹「应用抓取结果」横幅）。
3. 每日定时任务在后台抓取；下次打开课程表页即提示「应用」。
4. 点「应用抓取结果」→ 写入本地课程表（标记 source='fetch'、记录 sourceUrl/fetchedAt）。
