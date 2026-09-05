// supabase/functions/fetch-schedule/index.ts
// 课程表自动抓取 Edge Function
// 流程：登录源站(内部系统) → 抓取课表 → 归一为 teacher×week 结构 → upsert 到 shared_link(kind='schedule_fetch')
// 前端按 App.sync.readShared() 读取该共享行，提示「应用抓取结果」。
//
// 两种调用上下文：
//   1) 用户在前端点「同步抓取」：携带用户 JWT → 以该用户身份写入(RLS 作用域)
//   2) 每日定时(pg_cron / Dashboard)：无 JWT → 用 service_role + OWNER_USER_ID 写入(仅 cron secret 可触发)
//
// ⚠️ 站点特定部分（登录字段、CSRF、HTML 解析选择器）需按真实源站补全，见下方 loginAndFetch / parseHtmlSchedule。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------- 配置（来自 Supabase Secrets） ----------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OWNER_USER_ID = Deno.env.get('OWNER_USER_ID') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

// 源站（内部排课系统）配置
const SOURCE_BASE = Deno.env.get('SOURCE_BASE_URL') || '';
const SOURCE_LOGIN_URL = Deno.env.get('SOURCE_LOGIN_URL') || '';
const SOURCE_TABLE_URL = Deno.env.get('SOURCE_TABLE_URL') || '';
const SOURCE_API_URL = Deno.env.get('SOURCE_API_URL') || ''; // 若源站提供 JSON 接口，优先走 JSON 模式
const SOURCE_USER = Deno.env.get('SOURCE_USER') || '';
const SOURCE_PASS = Deno.env.get('SOURCE_PASS') || '';
const SOURCE_USER_FIELD = Deno.env.get('SOURCE_USER_FIELD') || 'username';
const SOURCE_PASS_FIELD = Deno.env.get('SOURCE_PASS_FIELD') || 'password';
const SOURCE_CSRF_FIELD = Deno.env.get('SOURCE_CSRF_FIELD') || ''; // 留空表示源站无 CSRF
const SOURCE_PARSE_MODE = (Deno.env.get('SOURCE_PARSE_MODE') || 'html').toLowerCase();

const KIND = 'schedule_fetch';

// ---------- 类型 ----------
interface TeacherRow {
  name: string;
  code: string;
  subject: string;
  summary: string;
  classes: Record<string, string>; // "周一-08:00-10:00": "A班[13:00-20:00]"
}
interface ScheduleData {
  weekStartDate: string | null;
  weekEndDate: string | null;
  periods: string[];
  teachers: TeacherRow[];
  sourceUrl: string;
  fetchedAt: string;
}

// ---------- 工具 ----------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

function makeCookieJar() {
  const cookies = new Map<string, string>();
  return {
    store(res: Response) {
      const sc = res.headers.get('set-cookie');
      if (!sc) return;
      sc.split(',').forEach((part) => {
        const [kv] = part.split(';');
        const idx = kv.indexOf('=');
        if (idx > 0) cookies.set(kv.slice(0, idx).trim(), kv.slice(idx + 1).trim());
      });
    },
    header(): string {
      return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function fetchC(url: string, init: RequestInit = {}, jar = makeCookieJar()) {
  const headers = new Headers(init.headers || {});
  const c = jar.header();
  if (c) headers.set('cookie', c);
  const res = await fetch(url, { ...init, headers });
  jar.store(res);
  return res;
}

const DAY_ALIAS: Record<string, string> = {
  '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四',
  '星期五': '周五', '星期六': '周六', '星期日': '周日', '周天': '周日', '礼拜一': '周一',
};
function normDay(d: string): string { return DAY_ALIAS[d] || d; }

function thisMonday(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function thisSunday(): string {
  const d = new Date(thisMonday());
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

// 把任意解析结果归一为标准结构（与前端 normalizeImport 保持一致）
function normalizeSchedule(parsed: any): ScheduleData {
  const periods: string[] = (parsed.periods && parsed.periods.length)
    ? parsed.periods.map((p: any) => String(p).trim())
    : ['08:00-10:00', '10:10-12:10', '12:50-14:50', '15:00-17:00', '17:30-19:30', '19:40-21:40'];

  const teachers: TeacherRow[] = (parsed.teachers || []).map((t: any) => {
    const classes: Record<string, string> = {};
    const src = t.classes || {};
    Object.keys(src).forEach((k) => {
      const idx = k.indexOf('-'); // 星期名无连字符，按首个 '-' 切分（节次含 08:00-10:00）
      const ad = idx >= 0 ? k.slice(0, idx) : k;
      const ap = idx >= 0 ? k.slice(idx + 1) : '';
      const v = String(src[k] == null ? '' : src[k]).trim();
      if (v) classes[normDay(ad) + '-' + ap] = v;
    });
    return {
      name: String(t.name || '').trim(),
      code: String(t.code || '').trim(),
      subject: String(t.subject || '').trim(),
      summary: String(t.summary || '').trim(),
      classes,
    };
  });

  const ws = /^\d{4}-\d{2}-\d{2}$/.test(parsed.weekStartDate) ? parsed.weekStartDate : thisMonday();
  const we = /^\d{4}-\d{2}-\d{2}$/.test(parsed.weekEndDate) ? parsed.weekEndDate : thisSunday();

  return {
    weekStartDate: ws,
    weekEndDate: we,
    periods,
    teachers,
    sourceUrl: parsed.sourceUrl || SOURCE_BASE || '',
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- 解析：JSON 模式 ----------
function parseJsonSchedule(raw: string): ScheduleData {
  const data = JSON.parse(raw);
  // 支持直接是 {teachers:[...]} / {data:{teachers:[...]}} / 数组 等常见形态
  const parsed = data.teachers ? data : (data.data && data.data.teachers) ? data.data : { teachers: [] };
  if (!parsed.teachers || !parsed.teachers.length) {
    throw new Error('JSON 解析：未找到 teachers 数组，请确认 SOURCE_API_URL 返回结构，或在 COURSE_FETCH_SETUP.md 调整解析');
  }
  return normalizeSchedule(parsed);
}

// ---------- 解析：HTML 模式（通用启发式，站点特定选择器需按真实页面补全） ----------
function extractTables(html: string): string[] {
  const tables: string[] = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) tables.push(m[0]);
  return tables;
}
function cellText(cellHtml: string): string {
  return cellHtml
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractCsrf(html: string): string {
  const m = html.match(/name="(_csrf|csrf|authenticity_token|__RequestVerificationToken)"[^>]*value="([^"]*)"/i);
  return m ? m[2] : '';
}

// 通用 HTML 解析：寻找「表头含星期名」的表格，按 (时间行 × 星期列) 提取；
// 若源站是「按教师分块」布局（每个教师一个子表），此通用逻辑可能需按真实页面微调，见 COURSE_FETCH_SETUP.md。
function parseHtmlSchedule(html: string): ScheduleData {
  const tables = extractTables(html);
  const dayCols = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const dayColSet = new Set(dayCols);

  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    if (rows.length < 2) continue;

    // 找表头行（含最多星期名）
    let headerRow = -1;
    let best = -1;
    rows.forEach((r, i) => {
      const txt = cellText(r);
      let cnt = 0;
      dayCols.forEach((d) => { if (txt.includes(d)) cnt++; });
      if (cnt > best) { best = cnt; headerRow = i; }
    });
    if (headerRow < 0 || best < 3) continue; // 不是课表主表

    // 解析表头：列索引 → 星期
    const headerCells = rows[headerRow].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
    const colDay: Record<number, string> = {};
    headerCells.forEach((c, i) => {
      const t = cellText(c);
      const hit = dayCols.find((d) => t.includes(d));
      if (hit) colDay[i] = hit;
    });

    // 剩余行：首格=时间节次，其余列=星期内容
    const teachers: TeacherRow[] = [];
    const classes: Record<string, string> = {};
    rows.slice(headerRow + 1).forEach((r) => {
      const cells = r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
      if (!cells.length) return;
      const period = cellText(cells[0]);
      if (!period) return;
      cells.forEach((c, i) => {
        if (!colDay[i]) return;
        const v = cellText(c);
        if (v && v !== '—' && v !== '-') classes[colDay[i] + '-' + period] = v;
      });
    });
    if (Object.keys(classes).length) {
      teachers.push({ name: '', code: '', subject: '', summary: '（自动抓取·待核对教师姓名）', classes });
    }
    if (teachers.length) {
      return normalizeSchedule({ teachers, periods: [], weekStartDate: null, weekEndDate: null });
    }
  }
  throw new Error('HTML 解析：未在页面中找到含星期表头的课表表格。请将登录后的课表页面 HTML 样张提供给开发者，以补全站点特定解析（见 COURSE_FETCH_SETUP.md）。');
}

// ---------- 登录并抓取 ----------
async function loginAndFetch(): Promise<ScheduleData> {
  const base = (SOURCE_BASE || '').replace(/\/$/, '');
  const loginUrl = SOURCE_LOGIN_URL || `${base}/login`;
  const tableUrl = SOURCE_TABLE_URL || `${base}/schedule`;
  const jar = makeCookieJar();

  // 1) 取登录页（可能含 CSRF）
  const loginPageRes = await fetchC(loginUrl, {}, jar);
  const loginPageHtml = await loginPageRes.text();
  const csrf = extractCsrf(loginPageHtml);

  // 2) 提交登录
  const form = new URLSearchParams();
  form.set(SOURCE_USER_FIELD, SOURCE_USER);
  form.set(SOURCE_PASS_FIELD, SOURCE_PASS);
  if (csrf && SOURCE_CSRF_FIELD) form.set(SOURCE_CSRF_FIELD, csrf);

  const loginRes = await fetchC(loginUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'referer': loginUrl },
    body: form.toString(),
  }, jar);
  if (!loginRes.ok) throw new Error(`源站登录失败：HTTP ${loginRes.status}`);

  // 3) 抓取课表
  const target = SOURCE_API_URL || tableUrl;
  const tableRes = await fetchC(target, {}, jar);
  if (!tableRes.ok) throw new Error(`抓取课表失败：HTTP ${tableRes.status}`);
  const raw = await tableRes.text();

  // 4) 解析
  return SOURCE_PARSE_MODE === 'json' ? parseJsonSchedule(raw) : parseHtmlSchedule(raw);
}

// ---------- 主入口 ----------
Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return json({}, 204);

    const authRaw = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const cronSecret = req.headers.get('x-cron-secret') || '';

    let userId: string | null = null;
    let client: any;

    if (authRaw && SERVICE_ROLE && authRaw === SERVICE_ROLE) {
      // 由 Supabase 调度（Dashboard Cron 以 service-role 调用）→ 写入指定 owner
      client = createClient(SUPABASE_URL, SERVICE_ROLE);
      userId = OWNER_USER_ID || null;
    } else if (authRaw) {
      // 按需触发：以调用用户身份写入（受 RLS 作用域约束）
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${authRaw}` } },
      });
      const { data } = await client.auth.getUser();
      userId = data.user?.id ?? null;
    } else if (cronSecret && CRON_SECRET && cronSecret === CRON_SECRET && SERVICE_ROLE && OWNER_USER_ID) {
      // 手动 cron 调用（带 x-cron-secret）→ 写入指定 owner
      client = createClient(SUPABASE_URL, SERVICE_ROLE);
      userId = OWNER_USER_ID;
    } else {
      return json({ error: 'unauthorized' }, 401);
    }
    if (!userId) return json({ error: 'no user' }, 401);

    const schedule = await loginAndFetch();
    const payload = { schedule, fetchedAt: schedule.fetchedAt, source: 'fetch' };

    const { error } = await client
      .from('shared_link')
      .upsert({ user_id: userId, kind: KIND, payload }, { onConflict: 'user_id,kind' });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, teachers: schedule.teachers.length, fetchedAt: schedule.fetchedAt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
