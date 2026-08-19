# GitHub Pages 部署指南（Echo-csj 账号）

> 适用场景：纯静态前端（HTML/CSS/JS，无后端、无构建步骤），需要**免费公网访问 + 可分享链接**。
> 本文以「状元港·泉山校区 DOS 个人工作台」为例（仓库 `Echo-csj/quanshan-dos-workbench`），步骤可复用到任意同类纯静态项目。

---

## 一、前置条件（一次性准备）

1. **工具**：本机已装 `git` 与 GitHub CLI（`gh`）。
   - 本项目使用的 gh 装在 `/Users/nirvana/.workbuddy/binaries/gh/`（v2.96.0）。
2. **账号登录**：已用 `gh auth login` 登录 **Echo-csj** 账号。
   - 验证：`gh auth status` 应显示已登录 Echo-csj。
3. **仓库已建**：`Echo-csj/quanshan-dos-workbench`
   - 地址：`https://github.com/Echo-csj/quanshan-dos-workbench.git`
4. **开启 GitHub Pages**（仓库里一次性设置）：
   - 仓库 → **Settings → Pages → Source** 选 `main` 分支、`/ (root)` 目录 → Save。
   - 开启后线上地址固定为：`https://echo-csj.github.io/quanshan-dos-workbench/`
5. **本地项目目录**（示例，替换为你的实际路径）：
   - `/Users/nirvana/WorkBuddy/2026-07-30-15-40-26/`

---

## 二、每次更新的部署步骤

以本项目为例，目录路径和版本号按实际情况替换。

### 1. 进入项目目录
```bash
cd /Users/nirvana/WorkBuddy/2026-07-30-15-40-26
```

### 2. 升级"缓存破坏参数"（关键，不可省）
本项目已**彻底禁用 Service Worker**（此前为修缓存顽疾），改用 URL 查询参数 `?v=YYYYMMDDx` 来强制浏览器忽略旧缓存。
**每次部署必须把 `index.html` 里的 `?v=` 升一版**，否则用户浏览器可能一直加载旧版。

```bash
# 把上一版号替换成本次新号（示例：e -> f）
sed -i '' 's/?v=20260731e/?v=20260731f/g' index.html

# 确认替换成功（应为 14 处左右）
grep -c '?v=20260731f' index.html
```
> 版本号约定：用日期 + 一位小字母，如 `20260731a`、`20260731b`…… 每次在上一版基础上 +1。

### 3. 提交改动
```bash
git add -A
git commit -m "feat: 本次改动一句话说明"
```

### 4. 推送（带重试，应对代理波动）
本环境代理偶发 `HTTP2 framing layer` / `502` 错误，用 for 循环重试即可，通常 1~2 次成功：
```bash
for i in 1 2 3 4 5; do
  echo "=== 尝试推送 $i ==="
  git push origin main && break || sleep 3
done
```

### 5. 等待自动构建
GitHub Pages 在 push 到 `main` 后**自动构建**，无需手动触发。通常 **30 秒 ~ 2 分钟**生效。

---

## 三、验证上线

浏览器打开线上地址，并**强制刷新一次**（清掉旧缓存）：

```
https://echo-csj.github.io/quanshan-dos-workbench/
```

- Windows / Linux：`Ctrl + Shift + R`
- macOS：`Cmd + Shift + R`

强制刷新后确认页面与本次改动一致、且地址栏网络请求里 JS/CSS 带的是新 `?v=` 参数。

---

## 四、关键注意事项

| 事项 | 说明 |
|------|------|
| **必须升 `?v=`** | 不升版本号，用户浏览器可能一直用旧缓存，看不到更新。 |
| **推送失败别慌** | `HTTP2 framing layer` / `502` 是代理波动，`for` 循环重试即可。 |
| **不要用 `git push -f`** | 会覆盖历史，且可能让 Pages 构建异常。 |
| **先本地校验语法** | 改了 JS 后，先 `node --check js/xxx.js` 确认无语法错误再提交推送，避免线上白屏。 |
| **数据在 localStorage** | 所有业务数据（时间轴节点、事项看板、报表、人事数据）只存浏览器本地。换设备 / 清缓存 / 隐私模式会丢失。设置页有「导出备份 JSON」，重要数据请定期导出。 |
| **gh 登录态** | 若推送报权限错误，先 `gh auth login` 并确认 `gh auth status` 显示 Echo-csj。 |

---

## 五、常见排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 线上页面无变化 | 未升 `?v=` 或浏览器缓存 | 升参数 + 强刷 |
| `push` 报 `HTTP2 framing layer` / `502` | 代理波动 | 重试 `for` 循环 |
| 页面空白 / 某 JS 报错 | 改动有语法错误 | 本地 `node --check 文件.js` 校验后重推 |
| 某 JS 返回 404 | 文件名或路径改了 | 确认 `index.html` 里的 `<script src>` 与实际文件名一致 |
| 数据"不见了" | 换了浏览器 / 清了缓存 | 用设置页「导入备份」恢复 JSON |

---

## 六、最简模板（可直接复制改路径）

```bash
cd /你的/项目/目录

# 1) 升级缓存参数（改版本号）
sed -i '' 's/?v=上一版/?v=这一版/g' index.html

# 2) 提交
git add -A
git commit -m "feat: 说明本次改动"

# 3) 带重试推送
for i in 1 2 3 4 5; do
  echo "=== 尝试推送 $i ==="
  git push origin main && break || sleep 3
done
```

推送成功后，等约 1 分钟，强刷线上地址即可。
