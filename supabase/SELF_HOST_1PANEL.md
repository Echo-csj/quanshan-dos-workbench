# 自托管 Supabase（1Panel 路线）部署清单

> 适用场景：团队教学工作台需要「多设备 / 多人共享」且数据必须留在自己服务器。
> 路线优势：1Panel 把 Docker、反代、证书、备份都做成可视化，非程序员也能点几下完成。
> 容量账：Supabase Storage 默认写本机磁盘卷，数据库=Postgres，**容量 = 你服务器硬盘大小**。

---

## 0. 你最后会拿到什么

- 一套你自己掌控的 Supabase：Postgres 库 + 登录认证(GoTrue) + 文件存储 + REST/实时 API
- 工作台数据存在你自己服务器硬盘，不再依赖任何云厂商
- 文件走 Storage 桶（默认本机磁盘，可改 MinIO/S3），DB 只存结构化文本

---

## 1. 准备一台 Linux 服务器

- 系统：Ubuntu 22.04 / 24.04（推荐），或 Debian / CentOS；x86_64 架构
- 配置：**2GB 内存最低，建议 4GB+**；磁盘越大存储越多
- 网络：公网 IP（内网用 IP 也行，但登录回调建议配域名）；可访问互联网
- 云服务器需在「安全组」放行：1Panel 面板端口、Supabase Studio(8000)、Auth(9999)、REST(3000)、Realtime(4000) 等

---

## 2. 安装 1Panel（复制即跑）

```bash
bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"
```

- 以 root 运行，按提示完成；装完脚本会**打印访问地址（含安全入口）+ 初始账号密码**
- 云服务器记得在安全组放行面板端口
- 忘记信息随时用：`1pctl user-info`

浏览器打开 `http://服务器IP:面板端口/安全入口` 登录。

---

## 3. 应用商店一键装 Supabase

1. 左侧菜单点「**应用商店**」，搜索框输入 `Supabase`
   - **官方源有** → 直接点安装
   - **官方源没有** → 添加社区应用商店源 [`okxlin/appstore`](https://github.com/okxlin/appstore)（已收录 Supabase），刷新后即可搜到
2. 安装参数（按需填）：
   - 应用名：默认 `supabase` 即可
   - 端口：外部访问按需开启（Studio 默认 8000）
   - **存储卷路径**：指向数据盘/挂载目录，决定文件存在哪块硬盘
3. 装完在「应用」列表里能看到 Supabase，点详情页有 **Studio 访问地址**

> ⚠️ 你这台上已确认应用商店搜不到 Supabase（社区源 `okxlin/appstore` 也未必有）。**直接走第 9 节的命令行一键脚本最稳**，不要在这里耗时间。

---

## 4. 拿连接信息（接前端要用）

在 1Panel 的 Supabase 应用详情页 / 容器内 `.env` 里找：

- **Studio 地址**：如 `http://服务器IP:8000`
- **API 地址**：同上 `:8000`（或你绑定的域名）
- **anon key**：前端公开用的密钥
- **service_role key**：后端/管理员用，**绝不下发到前端、绝不进仓库**

---

## 5. 跑你的 schema（顺序很重要，全部幂等可重复执行）

进入 Studio → **SQL Editor**，依次粘贴执行本项目内文件：

1. `supabase/schema.sql` —— 基础表 + 每用户整份 jsonb 同步层（campus_analytics / dos_workbench / shared_link）
2. `supabase/permission_schema.sql` —— 角色/项目组标签/登录邮箱列
3. `supabase/kezu_permission_sync.sql` —— 科组联动授权 + realtime
4. `supabase/schedule_fetch_cron.sql` —— 课程表每日抓取定时（可选）

---

## 6. 工作台前端接入

- 前端把 `supabaseUrl` 指向第 4 步的 API 地址，用 **anon key**
- 关掉云端 key，改用本地生成的
- 具体改 `js/config.js`（或 Supabase 初始化处）——**等你确认前端接入口后我再帮你改**，避免现在改错地方

---

## 7. 存储容量 = 硬盘，怎么扩

- Supabase Storage 默认把文件写在本机磁盘卷 → 容量 = 服务器剩余空间
- **扩容方式 A（最常用）**：给服务器挂更大云盘，在 1Panel 应用设置里把 Supabase 存储卷指向新盘
- **扩容方式 B**：配置 MinIO / S3 兼容后端做对象存储（适合要几十 GB 以上文件）
- 数据库(Postgres)容量同样 = 磁盘剩余空间，远超免费档 500MB

---

## 8. 备份（强烈建议第一时间配）

- **可视化**：1Panel 左侧「计划任务 → 备份」可定时备份 Postgres 数据卷，支持恢复到本地/云存储
- **手动 pg_dump**（容器名/库名以你实际为准）：
  ```bash
  docker exec supabase-db pg_dump -U postgres -d postgres > backup_$(date +%F).sql
  ```
- **文件存储**：直接打包 storage 卷目录（和数据库分开备）

---

## 9. 命令行一键装 Supabase（应用商店搜不到时的主路线）

项目已附脚本 `supabase/install-supabase.sh`，自动完成：克隆官方仓库 → 用 python3 生成全部 18 项密钥 → 拉镜像 → 启动。

**在服务器终端（就是你登录 1Panel 的那个 web 终端）执行：**

> 把本机 `supabase/install-supabase.sh` 的内容全选复制，在服务器终端 `cat > install-supabase.sh` 粘贴后按 `Ctrl+D` 保存，再运行：

```bash
bash install-supabase.sh
```
> 自定义 dashboard 账号：
> `SB_IP=106.54.242.128 SB_DASH_USER=admin SB_DASH_PW=你的密码 bash install-supabase.sh`

脚本会打印 **Studio 地址（http://服务器IP:8000）+ 登录用户名/密码**，并自动等 Studio 就绪。

**手动等价步骤（脚本出问题时参考）：**

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
# 用 utils/generate-keys.sh 生成 JWT/keys，或手动填 JWT_SECRET=openssl rand -hex 32
# 改 SUPABASE_PUBLIC_URL=http://服务器IP:8000、API_EXTERNAL_URL=http://服务器IP:8000/auth/v1、SITE_URL=同上
docker compose pull && docker compose up -d
```

起好后浏览器开 `http://服务器IP:8000` 即 Studio，再走第 5、6 步。

> 注意：自托管 Supabase 默认用 **legacy HS256** 模式（`JWT_SECRET` + `ANON_KEY`/`SERVICE_ROLE_KEY`），空的 `JWT_KEYS`/`JWT_JWKS` 会自动回退到 `JWT_SECRET`，无需配置非对称密钥，最简单。

---

## 10. 运维提醒

- **升级**：1Panel 应用商店一键升级 Supabase 镜像（手动 Compose 则需拉新镜像 + 跑迁移）
- **HTTPS**：前端若部署在 GitHub Pages（HTTPS），Supabase 也必须走 HTTPS，否则浏览器会拦截「混合内容」。建议注册一个真实域名（如 `.top`/`.cn`，约 ¥10–30/年），A 记录指向服务器 IP，再用 1Panel「网站」做反代 + Let's Encrypt 免费证书。**慎用 `sslip.io`/`nip.io` 等免费 IP 子域**：腾讯云 DNSPod 会拦截这类域名，导致 Let's Encrypt HTTP-01 验证失败。
- **安全**：service_role key 绝不外泄；面板建议开两步验证；定期看备份是否成功
- **容量监控**：1Panel 仪表盘实时看磁盘，快满时按第 7 节扩容
