# 课程表自动抓取 · 部署与配置指南

## 架构

```
内部排课系统(登录无验证码)
        │  (服务端抓取，绕开浏览器 CORS)
        ▼
Supabase Edge Function: fetch-schedule
  1. 用源站账号登录
  2. 抓取课表页面 / JSON 接口
  3. 归一为 teacher×week 结构
  4. upsert 到 shared_link(kind='schedule_fetch')
        │
        ▼
前端 课程表页 (/schedule)
  - 进入页面即拉取 shared_link → 显示「应用抓取结果」横幅
  - 「同步抓取」按钮 → 立即触发函数
  - 订阅 shared_link 实时更新 → 抓取落地近实时提示
  - 点「应用」→ 写入本地课程表(source='fetch')
```

源站是登录墙 + 无 CORS，纯静态前端无法直接抓，因此必须有这个后端中转。

## 一、需在 Supabase 设置的 Secrets

在 Supabase Dashboard → Project Settings → Edge Functions / Secrets 设置（函数内部通过 `Deno.env.get` 读取）：

| Secret | 说明 | 示例 |
|---|---|---|
| `SUPABASE_URL` | 项目 URL | `https://zxemcyngesgxpbevdxsu.supabase.co` |
| `SUPABASE_ANON_KEY` | 项目 anon key（与前端 config.js 同值） | `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key（用于定时任务写入） | `eyJ...` |
| `SOURCE_BASE_URL` | 源站根地址 | `https://keshi.example.com` |
| `SOURCE_LOGIN_URL` | 登录接口/页面（缺省 = BASE/login） | `https://keshi.example.com/login` |
| `SOURCE_TABLE_URL` | 课表页面地址（缺省 = BASE/schedule） | `https://keshi.example.com/schedule` |
| `SOURCE_API_URL` | 如源站有 JSON 接口则填（优先走 JSON 模式） | `https://keshi.example.com/api/schedule` |
| `SOURCE_USER` | 源站登录账号 | `xxxx` |
| `SOURCE_PASS` | 源站登录密码 | `xxxx` |
| `SOURCE_USER_FIELD` | 登录表单「账号」字段名（缺省 username） | `username` |
| `SOURCE_PASS_FIELD` | 登录表单「密码」字段名（缺省 password） | `password` |
| `SOURCE_CSRF_FIELD` | 如源站有 CSRF，填其字段名；否则留空 | ` _csrf` |
| `SOURCE_PARSE_MODE` | `json` 或 `html`（缺省 html） | `html` |
| `OWNER_USER_ID` | 课程表归属者（DOS）的 auth.users.id，用于定时任务写入 | `a1b2c3...` |
| `CRON_SECRET` | 手动 cron 调用的共享密钥（可选） | `随机串` |

> ⚠️ 不要把真实账号/密码/密钥写进仓库文件。Secrets 只在 Supabase 后台设置。

获取 `OWNER_USER_ID`：前端登录后，浏览器控制台执行
`await (await window.App.sync.getClient().auth.getUser()).data.user.id`，或在 SQL 里
`select id from auth.users where email = '你的登录邮箱';`

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

# 3) 设置 Secrets（请替换为你自己的值；可一次设多个）
supabase secrets set SUPABASE_URL="https://zxemcyngesgxpbevdxsu.supabase.co" SUPABASE_ANON_KEY="sb_publishable_..." SUPABASE_SERVICE_ROLE_KEY="eyJ..."
supabase secrets set SOURCE_BASE_URL="https://keshi.example.com" SOURCE_USER="xxxx" SOURCE_PASS="xxxx" OWNER_USER_ID="a1b2c3..." CRON_SECRET="随机串"

# 4) 部署函数
supabase functions deploy fetch-schedule
```

## 三、每日定时

**推荐**：Supabase Dashboard → Edge Functions → `fetch-schedule` → Add cron schedule → 每天 06:00。
Dashboard 会以 service-role 调用，函数自动按 `OWNER_USER_ID` 写入，无需额外密钥。

（高级替代：执行 `supabase/schedule_fetch_cron.sql`，见文件内说明。）

## 四、前端如何使用

1. 部署后，前端登录 → 打开「课程表」。
2. 顶部出现「同步抓取」按钮 → 点一下立即触发一次抓取（结果落地后弹「应用抓取结果」横幅）。
3. 每日定时任务会在后台抓取；下次打开课程表页即提示「应用」。
4. 点「应用抓取结果」→ 写入本地课程表（标记 source='fetch'、记录 sourceUrl/fetchedAt）。

## 五、还需补完的事项（需你提供源站信息）

`fetch-schedule/index.ts` 的**登录字段、CSRF、HTML 解析选择器**是站点特定的，目前是通用启发式：

- 若源站提供 **JSON 接口**：把 `SOURCE_API_URL` 指向它、设 `SOURCE_PARSE_MODE=json`，解析即生效（最稳）。
- 若为 **HTML 页面**：当前 `parseHtmlSchedule` 能处理「表头含星期、首列为时间节次」的扁平表格。若你的源站是「按教师分块」布局（每位教师一个子表），需要按真实页面微调选择器。

**请帮我提供以下任一，我即可补全 HTML 解析：**
1. 登录后课表页面的 **HTML 另存**（浏览器右键「另存为」网页，或 DevTools 复制 `<table>` 片段）；或
2. 一张登录后课表页面的**截图**（像之前那张浮引截屏）；并说明
3. 登录页的**账号/密码字段名**（或登录页截图）。

拿到样张后，我把 `parseHtmlSchedule` 精确化，自动抓取即可端到端跑通。
