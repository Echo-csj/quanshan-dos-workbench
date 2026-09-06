// supabase/functions/fetch-schedule/index.ts
// 课程表自动抓取 Edge Function —— 站点特定实现：zyg.91paike.com（ASP.NET WebForms）
//
// 流程：登录源站(账号/密码 + __VIEWSTATE 等隐藏字段) → 抓取 schedules.aspx?module=400002
//      → 解析为 teacher×week 结构 → upsert 到 shared_link(kind='schedule_fetch')
// 前端按 App.sync.readShared() 读取该共享行，提示「应用抓取结果」。
//
// 两种调用上下文：
//   1) 用户在前端点「同步抓取」：携带用户 JWT → 以该用户身份写入(RLS 作用域)
//   2) 每日定时(pg_cron / Dashboard)：无 JWT → 用 service_role + OWNER_USER_ID 写入(仅 cron secret 可触发)
//
// ⚠️ 源站为 HTTP-only（无 HTTPS）。Supabase Edge Function(Deno) 对明文 http:// 出站抓取
//    可能受限；若部署后报网络错误，改用 Cloudflare Worker 抓取或加 HTTPS 反代（见 COURSE_FETCH_SETUP.md）。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------- 配置（来自 Supabase Secrets） ----------
// 注意：SUPABASE_URL / SUPABASE_ANON_KEY 由 CLI 部署时自动注入，无需手动设；
// 但 service-role key 不会自动注入且不能用 SUPABASE_ 前缀的 Secret 设置，
// 故用自定义名 SERVICE_ROLE_KEY（普通 Secret 允许）承载。
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OWNER_USER_ID = Deno.env.get('OWNER_USER_ID') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

// 源站（内部排课系统 91paike）配置
const SOURCE_BASE_URL = (Deno.env.get('SOURCE_BASE_URL') || 'http://zyg.91paike.com').replace(/\/$/, '');
const SOURCE_MODULE = Deno.env.get('SOURCE_MODULE') || '400002';
const SOURCE_USER = Deno.env.get('SOURCE_USER') || '';
const SOURCE_PASS = Deno.env.get('SOURCE_PASS') || '';
const SOURCE_PARSE_MODE = (Deno.env.get('SOURCE_PARSE_MODE') || 'html').toLowerCase();
const SOURCE_API_URL = Deno.env.get('SOURCE_API_URL') || ''; // 若源站提供 JSON 接口，设此项并 SOURCE_PARSE_MODE=json

const KIND = 'schedule_fetch';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- 类型 ----------
interface TeacherRow {
  name: string;
  code: string;
  subject: string;
  summary: string;
  classes: Record<string, string>; // "周一-08:00-10:00": "A班"
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

// Deno 的 Headers.get('set-cookie') 对多值头部返回 null，必须用 getSetCookie()
function makeCookieJar() {
  const cookies = new Map<string, string>();
  const store = (res: Response) => {
    let list: string[] = [];
    const h = res.headers as unknown as { getSetCookie?: () => string[] };
    if (typeof h.getSetCookie === 'function') list = h.getSetCookie();
    else if (res.headers.get('set-cookie')) list = [res.headers.get('set-cookie') as string];
    list.forEach((sc) => {
      const [kv] = sc.split(';');
      const idx = kv.indexOf('=');
      if (idx > 0) cookies.set(kv.slice(0, idx).trim(), kv.slice(idx + 1).trim());
    });
  };
  const header = () => Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  return { store, header, has: () => cookies.size > 0 };
}

async function fetchC(url: string, init: RequestInit = {}, jar = makeCookieJar()) {
  const headers = new Headers(init.headers || {});
  const c = jar.header();
  if (c) headers.set('cookie', c);
  if (!headers.has('user-agent')) headers.set('user-agent', UA);
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

// 把解析结果归一为标准结构（与前端 normalizeImport 保持一致）
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
    sourceUrl: parsed.sourceUrl || SOURCE_BASE_URL,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- 解析：JSON 模式（若源站提供 JSON 接口） ----------
async function parseJsonSchedule(fetchJson: () => Promise<string>): Promise<ScheduleData> {
  const raw = await fetchJson();
  const data = JSON.parse(raw);
  const parsed = data.teachers ? data : (data.data && data.data.teachers) ? data.data : { teachers: [] };
  if (!parsed.teachers || !parsed.teachers.length) {
    throw new Error('JSON 解析：未找到 teachers 数组，请确认 SOURCE_API_URL 返回结构');
  }
  return normalizeSchedule(parsed);
}

// ---------- 解析：91paike HTML（已用真实抓取样张验证） ----------
function cellText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 提取页面所有 <input name value>（ASP.NET WebForms 登录需回传隐藏字段）
function extractInputFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /<input\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const nameM = tag.match(/\bname=(["'])([^"']+)\1/i);
    if (!nameM) continue;
    const name = nameM[2];
    const valM = tag.match(/\bvalue=(["'])([^"']*)\1/i);
    fields[name] = valM ? valM[2] : '';
  }
  return fields;
}

// 解析课表页 HTML → teacher×week 结构
function parse91paikeSchedule(html: string): ScheduleData {
  // 1) 教师元数据（course-nav 侧栏：id / 姓名 / 工号 / 学科 / 统计）
  const teacherMeta = new Map<string, { name: string; code: string; subject: string; summary: string }>();
  const navRe = /<li id='(\d+)'[^>]*>([\s\S]*?)<\/li>/g;
  let nm: RegExpExecArray | null;
  while ((nm = navRe.exec(html)) !== null) {
    const tid = nm[1];
    const blk = nm[2];
    if (!/class='name'/.test(blk)) continue;
    const nameM = blk.match(/class='name'[^>]*>([\s\S]*?)<\/div>/);
    const name = nameM ? cellText(nameM[1]).replace(/^\d+[、.]\s*/, '') : '';
    const codeM = blk.match(/class='code'[^>]*>([\s\S]*?)<\/div>/);
    const code = codeM ? cellText(codeM[1]) : '';
    const addM = blk.match(/class='addup'[^>]*>([\s\S]*?)<\/div>/);
    const lines = addM ? addM[1].split(/<br\s*\/?>/i).map(cellText).filter(Boolean) : [];
    const summary = lines.slice(0, 2).join(' / ');
    const subject = lines.slice(2).join(' / ');
    teacherMeta.set(tid, { name, code, subject, summary });
  }

  // 2) 每位教师的 .arrange（日级标签）与 .calendar（时间格，含 tchid 绑定）
  const arrBlocks = [...html.matchAll(/<div class='arrange'><ul class='cnt'>([\s\S]*?)<\/ul>/g)].map((x) => x[1]);
  const calBlocks = [...html.matchAll(/<div class='calendar'><ul class='cnt'>([\s\S]*?)<\/ul>/g)].map((x) => x[1]);
  const dayMap: Record<string, string> = {
    Monday: '周一', Tuesday: '周二', Wednesday: '周三', Thursday: '周四',
    Friday: '周五', Saturday: '周六', Sunday: '周日',
  };

  const teachers: TeacherRow[] = [];
  const allPeriods = new Set<string>();
  arrBlocks.forEach((ablock, idx) => {
    const cal = calBlocks[idx] || '';
    const tidM = cal.match(/tchid=(\d+)/);
    const tid = tidM ? tidM[1] : '';
    const meta = teacherMeta.get(tid) || { name: '教师' + (idx + 1), code: '', subject: '', summary: '' };
    const classes: Record<string, string> = {};
    const liRe = /<li class='([A-Za-z]+)[^']*'>([\s\S]*?)<\/li>/g;
    let lm: RegExpExecArray | null;
    while ((lm = liRe.exec(ablock)) !== null) {
      const day = dayMap[lm[1]];
      if (!day) continue;
      const label = cellText(lm[2]);
      let period = '全天';
      let value = label;
      const rm = label.match(/^(.*?)\s*\[(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\]\s*$/);
      if (rm) { value = rm[1].trim(); period = rm[2] + '-' + rm[3]; }
      else if (label === '休息') { period = '全天'; value = '休息'; }
      else { period = '全天'; value = label; }
      if (value) { classes[day + '-' + period] = value; allPeriods.add(period); }
    }
    teachers.push({ name: meta.name, code: meta.code, subject: meta.subject, summary: meta.summary, classes, } as TeacherRow);
  });

  if (!teachers.length) {
    throw new Error('HTML 解析：未找到任何教师课表块（.arrange / .calendar）。可能登录失效或页面结构变化。');
  }

  // 3) 周范围（day-nav 中 7 个日期链接，取首尾）
  const navIdx = html.indexOf('day-nav');
  const navEnd = html.indexOf('</ul>', navIdx);
  const navHtml = navIdx >= 0 ? html.slice(navIdx, navEnd >= 0 ? navEnd : navIdx + 4000) : '';
  const dateRe = /y=(\d+)&m=(\d+)&d=(\d+)/g;
  const dates: string[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(navHtml)) !== null) {
    dates.push(`${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`);
  }
  const ws = dates[0] || null;
  const we = dates[dates.length - 1] || null;

  // 4) 节次排序：全天优先，其余按开始时间
  const periods = [...allPeriods].sort((a, b) => {
    if (a === '全天') return -1;
    if (b === '全天') return 1;
    return a.split('-')[0].localeCompare(b.split('-')[0]);
  });

  const sourceUrl = `${SOURCE_BASE_URL}/schedules.aspx?module=${SOURCE_MODULE}`;
  return normalizeSchedule({ teachers, periods, weekStartDate: ws, weekEndDate: we, sourceUrl });
}

// ---------- 登录并抓取（ASP.NET WebForms） ----------
async function loginAndFetch(): Promise<ScheduleData> {
  const loginUrl = `${SOURCE_BASE_URL}/login.aspx?return=schedules.aspx%3fmodule%3d${SOURCE_MODULE}`;
  const schedUrl = `${SOURCE_BASE_URL}/schedules.aspx?module=${SOURCE_MODULE}`;
  const jar = makeCookieJar();

  // 1) GET 登录页（拿到 __VIEWSTATE / __EVENTVALIDATION 等隐藏字段 + 会话 cookie）
  const loginPageRes = await fetchC(loginUrl, { headers: { referer: loginUrl } }, jar);
  if (!loginPageRes.ok) throw new Error(`源站登录页访问失败：HTTP ${loginPageRes.status}`);
  const loginPageHtml = await loginPageRes.text();
  const fields = extractInputFields(loginPageHtml);

  // 2) 填账号密码 + 提交按钮（值含全角空格「登 录」）
  fields['tb_account'] = SOURCE_USER;
  fields['tb_password'] = SOURCE_PASS;
  fields['btn_submit'] = '登 录';
  const body = Object.keys(fields)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k] ?? '')}`)
    .join('&');

  // 3) POST 登录（手动处理重定向以保留认证 cookie）
  const loginRes = await fetchC(loginUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', referer: loginUrl },
    body,
    redirect: 'manual',
  }, jar);

  let schedHtml = '';
  if (loginRes.status >= 300 && loginRes.status < 400) {
    const loc = loginRes.headers.get('location');
    const target = loc ? (loc.startsWith('http') ? loc : `${SOURCE_BASE_URL}/${loc.replace(/^\//, '')}`) : schedUrl;
    const schedRes = await fetchC(target, { headers: { referer: loginUrl } }, jar);
    if (!schedRes.ok) throw new Error(`抓取课表失败：HTTP ${schedRes.status}`);
    schedHtml = await schedRes.text();
  } else {
    schedHtml = await loginRes.text();
  }
  if (!schedHtml || schedHtml.length < 1000) {
    throw new Error('登录后未取到课表页面（可能账号/密码错误、需要验证码，或会话已失效）');
  }

  // 4) 解析
  if (SOURCE_PARSE_MODE === 'json') {
    return parseJsonSchedule(async () => {
      const r = await fetchC(SOURCE_API_URL || schedUrl, { headers: { referer: loginUrl } }, jar);
      return r.text();
    });
  }
  return parse91paikeSchedule(schedHtml);
}

// ---------- 主入口 ----------
Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return json({}, 204);

    const authRaw = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const cronSecret = req.headers.get('x-cron-secret') || '';

    let userId: string | null = null;
    let client: any;

    if (cronSecret && CRON_SECRET && cronSecret === CRON_SECRET && SERVICE_ROLE && OWNER_USER_ID) {
      // 每日定时 / 手动 cron：带 x-cron-secret → 以 service-role 写入指定 owner
      client = createClient(SUPABASE_URL, SERVICE_ROLE);
      userId = OWNER_USER_ID;
    } else if (authRaw) {
      // 前端「同步抓取」按钮：携带用户 JWT → 以该用户身份写入（受 RLS 作用域约束）
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${authRaw}` } },
      });
      const { data, error } = await client.auth.getUser();
      if (!error && data.user) userId = data.user.id;
    } else {
      return json({ error: 'unauthorized' }, 401);
    }
    if (!userId || !client) return json({ error: 'no user' }, 401);

    if (!SOURCE_USER || !SOURCE_PASS) {
      return json({ error: '源站账号未配置（SOURCE_USER / SOURCE_PASS）' }, 500);
    }

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
