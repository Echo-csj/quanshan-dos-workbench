#!/usr/bin/env bash
# ============================================================
# 自托管 Supabase 一键安装脚本（基于官方 docker 仓库）
# 适用：Ubuntu 22.04+，已装好 Docker（1Panel 会自动装）
# 用法（在服务器终端直接粘贴整段执行）：
#   bash install-supabase.sh
# 自定义：
#   SB_IP=1.2.3.4 SB_DASH_USER=admin SB_DASH_PW=你的密码 bash install-supabase.sh
# ============================================================
set -uo pipefail

# ===== 可自定义变量（不带则使用默认值）=====
SB_IP="${SB_IP:-106.54.242.128}"            # 你的服务器公网 IP
SB_DASH_USER="${SB_DASH_USER:-supabase}"     # Studio 登录用户名
if [ -z "${SB_DASH_PW:-}" ]; then
  SB_DASH_PW="$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
fi
export SB_IP SB_DASH_USER SB_DASH_PW

echo "==> [1/6] 检查依赖：git / docker / python3"
command -v git >/dev/null 2>&1     || { echo "请先安装 git：apt-get install -y git"; exit 1; }
command -v docker >/dev/null 2>&1  || { echo "未检测到 docker，请先装 1Panel（会自动装 Docker）"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "需要 python3 来生成密钥"; exit 1; }

# docker compose 探测（v2 插件优先，退回 v1，都没有则装插件）
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "==> 安装 docker compose 插件"
  apt-get update -qq >/dev/null 2>&1 && apt-get install -y docker-compose-plugin >/dev/null 2>&1
  DC="docker compose"
fi
echo "    使用：$DC"

echo "==> [2/6] 克隆 supabase（若已存在则跳过）"
if [ ! -d supabase ]; then
  if ! git clone --depth 1 https://github.com/supabase/supabase 2>/dev/null; then
    echo "    github 克隆失败，尝试 gitee 镜像..."
    git clone --depth 1 https://gitee.com/mirrors/supabase.git supabase
  fi
else
  echo "    supabase 目录已存在，跳过克隆"
fi
cd supabase/docker

echo "==> [3/6] 生成 .env（含全部 18 项密钥）"
if [ -f .env ]; then
  echo "    .env 已存在，跳过生成（如需重置请删除 .env 后重跑）"
else
python3 - <<'PYEOF'
import secrets, hmac, hashlib, base64, json, time, os

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def rand(n): return secrets.token_hex(n)
def jwt(role, secret, exp):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    p = b64(json.dumps({"role":role,"iss":"supabase","iat":int(time.time()),"exp":int(exp)},separators=(',',':')).encode())
    s = f"{h}.{p}".encode()
    sig = b64(hmac.new(secret.encode(), s, hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"

ip = os.environ.get("SB_IP","106.54.242.128")
PUBLIC = f"http://{ip}:8000"

postgres_pw    = rand(16)
jwt_secret     = rand(32)
anon           = jwt("anon", jwt_secret, 4102444800)
svc            = jwt("service_role", jwt_secret, 4102444800)
secret_key_base= base64.b64encode(secrets.token_bytes(48)).decode()
realtime_enc   = rand(8)
vault_enc      = rand(16)
pg_meta        = base64.b64encode(secrets.token_bytes(24)).decode()
logflare_pub   = base64.b64encode(secrets.token_bytes(24)).decode()
logflare_priv  = base64.b64encode(secrets.token_bytes(24)).decode()
s3_id          = rand(16)
s3_secret      = rand(32)
minio_pw       = rand(8)
pooler_tenant  = "supabase"

dash_user = os.environ.get("SB_DASH_USER","supabase")
dash_pw   = os.environ.get("SB_DASH_PW","") or rand(8)

env = f'''COMPOSE_FILE=docker-compose.yml

POSTGRES_PASSWORD={postgres_pw}

JWT_SECRET={jwt_secret}
ANON_KEY={anon}
SERVICE_ROLE_KEY={svc}

SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
JWT_KEYS=
JWT_JWKS=

DASHBOARD_USERNAME={dash_user}
DASHBOARD_PASSWORD={dash_pw}

SECRET_KEY_BASE={secret_key_base}
REALTIME_DB_ENC_KEY={realtime_enc}
VAULT_ENC_KEY={vault_enc}
PG_META_CRYPTO_KEY={pg_meta}
LOGFLARE_PUBLIC_ACCESS_TOKEN={logflare_pub}
LOGFLARE_PRIVATE_ACCESS_TOKEN={logflare_priv}
S3_PROTOCOL_ACCESS_KEY_ID={s3_id}
S3_PROTOCOL_ACCESS_KEY_SECRET={s3_secret}

SUPABASE_PUBLIC_URL={PUBLIC}
API_EXTERNAL_URL={PUBLIC}/auth/v1

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432

POOLER_PROXY_PORT_TRANSACTION=6543
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_TENANT_ID={pooler_tenant}
POOLER_DB_POOL_SIZE=5

STUDIO_DEFAULT_ORGANIZATION=Default Organization
STUDIO_DEFAULT_PROJECT=Default Project
OPENAI_API_KEY=sk-proj-xxxxxxxx

SITE_URL={PUBLIC}
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false

MAILER_URLPATHS_CONFIRMATION="/auth/v1/verify"
MAILER_URLPATHS_INVITE="/auth/v1/verify"
MAILER_URLPATHS_RECOVERY="/auth/v1/verify"
MAILER_URLPATHS_EMAIL_CHANGE="/auth/v1/verify"
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
SMTP_ADMIN_EMAIL=admin@example.com
SMTP_HOST=supabase-mail
SMTP_PORT=2500
SMTP_USER=fake_mail_user
SMTP_PASS=fake_mail_password
SMTP_SENDER_NAME=fake_sender
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=true
ENABLE_PHONE_AUTOCONFIRM=true

GLOBAL_S3_BUCKET=stub
REGION=stub
MINIO_ROOT_USER=supa-storage
MINIO_ROOT_PASSWORD={minio_pw}
STORAGE_TENANT_ID=stub

FUNCTIONS_VERIFY_JWT=false

PGRST_DB_SCHEMAS=public,graphql_public
PGRST_DB_MAX_ROWS=1000
PGRST_DB_EXTRA_SEARCH_PATH=public

DOCKER_SOCKET_LOCATION=/var/run/docker.sock
GOOGLE_PROJECT_ID=GOOGLE_PROJECT_ID
GOOGLE_PROJECT_NUMBER=GOOGLE_PROJECT_NUMBER

API_GW_HTTP_PORT=8000
KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443
ANON_KEY_ASYMMETRIC=
SERVICE_ROLE_KEY_ASYMMETRIC=

IMGPROXY_AUTO_WEBP=true

PROXY_DOMAIN=your-domain.example.com
CERTBOT_EMAIL=admin@example.com
'''
with open(".env","w") as f: f.write(env)
print("    .env 已生成")
PYEOF
fi

echo "==> [4/6] 拉取镜像（首次较慢，约 2-3GB）"
$DC pull

echo "==> [5/6] 启动全部服务"
$DC up -d

echo "==> [6/6] 等待 Studio 就绪（最多 150 秒）"
READY=0
for i in $(seq 1 30); do
  if curl -sf -o /dev/null http://localhost:8000; then
    echo "    Studio 已就绪"
    READY=1
    break
  fi
  sleep 5
done
[ "$READY" -eq 0 ] && echo "    等待超时，可稍后手动访问；用 'docker ps' 看容器状态"

echo ""
echo "==================================================="
echo " Supabase 已启动"
echo " Studio 地址 : http://${SB_IP}:8000"
echo " 登录用户名 : ${SB_DASH_USER}"
echo " 登录密码   : ${SB_DASH_PW}"
echo "---------------------------------------------------"
echo " 下一步："
echo "  1) 腾讯云轻量控制台 → 防火墙 → 放行 TCP 8000"
echo "  2) 浏览器打开 http://${SB_IP}:8000 用上面账号登录"
echo "  3) SQL Editor 依次跑 schema.sql / permission_schema.sql"
echo "     / kezu_permission_sync.sql / schedule_fetch_cron.sql"
echo "  4) 把前端 supabaseUrl 指向 http://${SB_IP}:8000，用 anon key"
echo "==================================================="
