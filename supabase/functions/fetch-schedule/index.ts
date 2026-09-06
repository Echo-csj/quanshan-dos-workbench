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
// cleanSecret: 剔除不可见/非 ASCII 字符与首尾空白，防止从后台复制 key 时带入换行/零宽字符，
// 否则 Deno 在设置 Authorization 等请求头时会抛 "not a valid ByteString"。
function cleanSecret(v: string): string {
  return v.replace(/[^\x20-\x7e]/g, '').trim();
}
const SUPABASE_URL = cleanSecret(Deno.env.get('SUPABASE_URL') || '');
const SUPABASE_ANON_KEY = cleanSecret(Deno.env.get('SUPABASE_ANON_KEY') || '');
const SERVICE_ROLE = cleanSecret(Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
const OWNER_USER_ID = cleanSecret(Deno.env.get('OWNER_USER_ID') || '');
const CRON_SECRET = cleanSecret(Deno.env.get('CRON_SECRET') || '');

// 源站（内部排课系统 91paike）配置
const SOURCE_BASE_URL = (Deno.env.get('SOURCE_BASE_URL') || 'http://zyg.91paike.com').replace(/\/$/, '').trim();
const SOURCE_MODULE = (Deno.env.get('SOURCE_MODULE') || '400002').trim();
const SOURCE_USER = (Deno.env.get('SOURCE_USER') || '').trim();
const SOURCE_PASS = (Deno.env.get('SOURCE_PASS') || '').trim();
const SOURCE_PARSE_MODE = (Deno.env.get('SOURCE_PARSE_MODE') || 'html').toLowerCase().trim();
const SOURCE_API_URL = (Deno.env.get('SOURCE_API_URL') || '').trim(); // 若源站提供 JSON 接口，设此项并 SOURCE_PARSE_MODE=json

const KIND = 'schedule_fetch';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- 类型 ----------
interface TeacherRow {
  name: string;
  code: string;
  subject: string;
  summary: string;
  classes: Record<string, string>; // "周一-08:00-10:00": "泉山八年级英语2班 · 初二 英语"
  dayArrange: Record<string, string>; // "周二": "A班 [13:00-20:00]"  当天班制（来自 .arrange），与时间段正交
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

// CORS：supabase-js invoke 会带 Authorization / apikey / x-client-info 这些头，
// 浏览器预检要求服务器显式 Allow-Headers；带 Authorization 时 Allow-Origin 不能为 *，
// 故回显请求方的 Origin。
function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '*';
  const reqHeaders = req.headers.get('access-control-request-headers') || '';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': reqHeaders || 'authorization, x-cron-secret, content-type, x-client-info, apikey',
    'access-control-max-age': '86400',
    'vary': 'Origin, Access-Control-Request-Headers',
  };
}

function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

// Deno 的 Headers.get('set-cookie') 对多值头部返回 null，必须用 getSetCookie()
function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return false;
  return true;
}
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
  // 仅保留纯 ASCII 的 cookie：源站可能下发含中文的 cookie，直接塞进 Cookie 头会触发
  // Deno 的 "not a valid ByteString" 报错；会话/认证 cookie(ASP.NET_SessionId/.ASPXAUTH)均为 ASCII，丢弃非 ASCII 不影响登录。
  const header = () =>
    Array.from(cookies.entries())
      .filter(([k, v]) => isAscii(k) && isAscii(v))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
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
    const dayArrange: Record<string, string> = {};
    const da = t.dayArrange || {};
    Object.keys(da).forEach((k) => {
      const v = String(da[k] == null ? '' : da[k]).trim();
      if (v) dayArrange[normDay(k)] = v;
    });
    return {
      name: String(t.name || '').trim(),
      code: String(t.code || '').trim(),
      subject: String(t.subject || '').trim(),
      summary: String(t.summary || '').trim(),
      classes,
      dayArrange,
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
  // 固定 6 时段（按 .calendar 里 time_period1/2/3 各含 2 个 span 推导）
  const FIXED_PERIODS = ['08:00-10:00', '10:10-12:10', '12:50-14:50', '15:00-17:00', '17:30-19:30', '19:40-21:40'];
  FIXED_PERIODS.forEach((p) => allPeriods.add(p));

  arrBlocks.forEach((ablock, idx) => {
    const cal = calBlocks[idx] || '';
    const tidM = cal.match(/tchid=(\d+)/);
    const tid = tidM ? tidM[1] : '';
    const meta = teacherMeta.get(tid) || { name: '教师' + (idx + 1), code: '', subject: '', summary: '' };
    const classes: Record<string, string> = {};
    const dayArrange: Record<string, string> = {};

    // ---- 解析 .arrange：当天班制（计划块/休息），与时间段正交，存到 dayArrange ----
    //   例：<li class='Monday first'>休息</li>  或  <li class='Tuesday'>A班&nbsp;[13:00-20:00]</li>
    //   存为："周二": "A班 [13:00-20:00]"  或  "周一": "休息"
    const liRe = /<li class='([A-Za-z]+)([^']*)'>([\s\S]*?)<\/li>/g;
    let lm: RegExpExecArray | null;
    while ((lm = liRe.exec(ablock)) !== null) {
      const day = dayMap[lm[1]];
      if (!day) continue;
      const raw = cellText(lm[3]).replace(/\u00a0/g, ' ').trim();
      if (!raw) continue; // 空白不写
      dayArrange[day] = raw;
    }

    // ---- 解析 .calendar：每格真实课程（只取 <a class='cose'>；空格子保持空） ----
    //   外层：<li class='Monday' ...>；内层 3 个 <div class='period time_periodN'>，每个含 2 个 <div id='..._span_...' class='span ...'>；
    //   每 span 内有 <a class='schedule'>（时段文本，点击加课），有课时再加 <a class='cose'>（含 class/sbj）和 lesson-mini-pop。
    const dayRe = /<li class='([A-Za-z]+)([^']*)'>([\s\S]*?)<\/li>/g;
    let dm: RegExpExecArray | null;
    while ((dm = dayRe.exec(cal)) !== null) {
      const day = dayMap[dm[1]];
      if (!day) continue;
      const dayInner = dm[3];
      // 每个 span 含 id='YYYY_MM_DD_HH_MM_span_TCHID'；用 HH_MM 映射到固定 period
      const spanRe = /<div id='(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_span_\d+'[\s\S]*?<\/div>/g;
      let sm: RegExpExecArray | null;
      while ((sm = spanRe.exec(dayInner)) !== null) {
        const start = `${sm[4]}:${sm[5]}`;
        const period = `${start}-${endOfPeriod(start)}`;
        if (!FIXED_PERIODS.includes(period)) continue;
        const inner = sm[0];

        // 只取 <a class='cose'> 真实课程；空格子保持空（班制见 dayArrange）
        //    cose 内 class 属性值是 'class '（尾空格），lesson-mini-pop 的是 'class'（无空格）。
        //    关键：\s* 必须在 'class'/'sbj' 和收尾 ' 之间，否则匹配不上 cose 会跑去匹配后面的 pop。
        //    用非贪婪 + 排除 </a> 防止跨过本 cose。
        // cose 内 <span class='class ...'> 属性值有两类：
        //   - 'class' / 'class '（普通课）
        //   - 'class leave'（请假课，多一个 leave class）—— 之前正则不兼容会被静默丢弃
        // hint 状态字：svac=学(学生请假)/tvac=师(教师请假)/hj=寒(寒假)/cj=暑(暑假)/no=待(待定)/调(调课)
        const coseAll = inner.match(/<a class='cose'(?:(?!<\/a>)[\s\S])*?<\/a>/);
        if (coseAll) {
          // 兼容 'class' 与 'class leave' 两种属性
          const cnMatch = coseAll[0].match(/<span class='class(?:\s+leave)?\s*'>(?:(?!<\/a>)[\s\S])*?<\/span>/);
          const sbMatch = coseAll[0].match(/<span class='sbj\s*'>(?:(?!<\/a>)[\s\S])*?<\/span>/);
          if (cnMatch && sbMatch) {
            const cnInner = cnMatch[0];
            const sbInner = sbMatch[0];
            const isLeave = /class\s*=\s*'class\s+leave'/.test(cnInner.slice(0, 100));
            const extractChars = (s: string): string[] => {
              const re = /<span class='hint[^']*'>([^<]+)<\/span>/g;
              const out: string[] = [];
              let hm: RegExpExecArray | null;
              while ((hm = re.exec(s)) !== null) {
                const ch = hm[1].trim();
                if (ch) out.push(ch);
              }
              return out;
            };
            let cnRaw = cnInner.replace(/<span class='hint[^']*'>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
            let sbRaw = sbInner.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
            const allChars = [...extractChars(cnInner), ...extractChars(sbInner)];
            // 状态标签前缀：请假 > 寒暑假 > 调课 > 待定
            let prefix = '';
            if (isLeave) {
              if (allChars.includes('学')) prefix = '[请假·学生] ';
              else if (allChars.includes('师')) prefix = '[请假·教师] ';
              else prefix = '[请假] ';
            } else if (allChars.includes('寒')) prefix = '[寒假] ';
            else if (allChars.includes('暑')) prefix = '[暑假] ';
            else if (allChars.includes('调')) prefix = '[调课] ';
            else if (allChars.includes('待')) prefix = '[待定] ';
            const key = day + '-' + period;
            const val = prefix + cnRaw + (sbRaw ? ' · ' + sbRaw : '');
            if (classes[key]) classes[key] += '\n' + val;
            else classes[key] = val;
          }
        }
        // 空格子：不写入 classes，UI 渲染"—"或空格
      }
    }

    teachers.push({ name: meta.name, code: meta.code, subject: meta.subject, summary: meta.summary, classes, dayArrange, } as TeacherRow);
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
  let dm2: RegExpExecArray | null;
  while ((dm2 = dateRe.exec(navHtml)) !== null) {
    dates.push(`${dm2[1]}-${dm2[2].padStart(2, '0')}-${dm2[3].padStart(2, '0')}`);
  }
  const ws = dates[0] || null;
  const we = dates[dates.length - 1] || null;

  // 4) 节次排序：固定 6 时段按开始时间
  const periods = FIXED_PERIODS;

  const sourceUrl = `${SOURCE_BASE_URL}/schedules.aspx?module=${SOURCE_MODULE}`;
  return normalizeSchedule({ teachers, periods, weekStartDate: ws, weekEndDate: we, sourceUrl });
}

// 把 "08:00" 这类开始时间映射到完整 period 字符串
function endOfPeriod(start: string): string {
  const m: Record<string, string> = {
    '08:00': '10:00', '10:10': '12:10', '12:50': '14:50',
    '15:00': '17:00', '17:30': '19:30', '19:40': '21:40',
  };
  return m[start] || start;
}

// 判断 period 开始时间是否落在 [start, end) 区间（.arrange 的占位块覆盖范围）
function isInRange(periodStart: string, rangeStart: string, rangeEnd: string): boolean {
  return periodStart >= rangeStart && periodStart < rangeEnd;
}

// ---------- 登录并抓取（ASP.NET WebForms） ----------
// 登录 + GET 课表页面，仅返回原始 HTML（不解析）。供 DEBUG_HINT_ALL 等诊断用。
async function fetchRawHtml(): Promise<string> {
  const loginUrl = `${SOURCE_BASE_URL}/login.aspx?return=schedules.aspx%3fmodule%3d${SOURCE_MODULE}`;
  const schedUrl = `${SOURCE_BASE_URL}/schedules.aspx?module=${SOURCE_MODULE}`;
  const jar = makeCookieJar();

  const loginPageRes = await fetchC(loginUrl, { headers: { referer: loginUrl } }, jar);
  if (!loginPageRes.ok) throw new Error(`源站登录页访问失败：HTTP ${loginPageRes.status}`);
  const loginPageHtml = await loginPageRes.text();
  const fields = extractInputFields(loginPageHtml);
  fields['tb_account'] = SOURCE_USER;
  fields['tb_password'] = SOURCE_PASS;
  fields['btn_submit'] = '登 录';
  const body = Object.keys(fields)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k] ?? '')}`)
    .join('&');

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
  return schedHtml;
}

async function loginAndFetch(): Promise<ScheduleData> {
  const schedHtml = await fetchRawHtml();
  if (SOURCE_PARSE_MODE === 'json') {
    const loginUrl = `${SOURCE_BASE_URL}/login.aspx?return=schedules.aspx%3fmodule%3d${SOURCE_MODULE}`;
    const schedUrl = `${SOURCE_BASE_URL}/schedules.aspx?module=${SOURCE_MODULE}`;
    const jar = makeCookieJar();
    return parseJsonSchedule(async () => {
      const loginPageRes = await fetchC(loginUrl, { headers: { referer: loginUrl } }, jar);
      const loginPageHtml = await loginPageRes.text();
      const fields = extractInputFields(loginPageHtml);
      fields['tb_account'] = SOURCE_USER;
      fields['tb_password'] = SOURCE_PASS;
      fields['btn_submit'] = '登 录';
      const body = Object.keys(fields).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k] ?? '')}`).join('&');
      const loginRes = await fetchC(loginUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', referer: loginUrl },
        body,
        redirect: 'manual',
      }, jar);
      const schedRes = loginRes.status >= 300 && loginRes.status < 400
        ? await fetchC(loginRes.headers.get('location') || schedUrl, { headers: { referer: loginUrl } }, jar)
        : loginRes;
      return schedRes.text();
    });
  }
  return parse91paikeSchedule(schedHtml);
}

// ---------- 主入口 ----------
Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);

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
      return json({ error: 'unauthorized' }, 401, cors);
    }
    if (!userId || !client) return json({ error: 'no user' }, 401, cors);

    if (!SOURCE_USER || !SOURCE_PASS) {
      return json({ error: '源站账号未配置（SOURCE_USER / SOURCE_PASS）' }, 500, cors);
    }

    // DEBUG_HINT_ALL：扫描 HTML 中所有 <span class='hint...'> 状态字，按 (class, char) 统计
    // 触发方式：请求头 x-debug: hint_all（比 env 更可靠，CLI 偶尔 hash 显示导致 secret 值难确认）
    if (req.headers.get('x-debug') === 'hint_all') {
      const html = await fetchRawHtml();
      const hintRe = /<span class='hint([^']*)'>([^<]+)<\/span>/g;
      const counts: Record<string, number> = {};
      const samples: Record<string, string> = {};
      let hm: RegExpExecArray | null;
      while ((hm = hintRe.exec(html)) !== null) {
        const cls = hm[1].trim();
        const ch = hm[2].trim();
        const key = `hint[${cls || ''}]=${ch}`;
        counts[key] = (counts[key] || 0) + 1;
        if (!samples[key]) {
          const ctxStart = Math.max(0, hm.index - 80);
          samples[key] = html.slice(ctxStart, hm.index + hm[0].length + 40).replace(/\s+/g, ' ').trim();
        }
      }
      return json({ ok: true, hintCounts: counts, hintSamples: samples, htmlLen: html.length }, 200, cors);
    }

    // DEBUG_FIRST_TEACHER：返回首位教师的 classes/dayArrange（用于验证请假等状态解析，不入数据库）
    if (req.headers.get('x-debug') === 'first_teacher') {
      const html = await fetchRawHtml();
      const parsed = parse91paikeSchedule(html);
      return json({ ok: true, teacher: parsed.teachers[0] }, 200, cors);
    }

    // DEBUG_STATS：返回所有教师各状态课数统计（不入数据库）
    if (req.headers.get('x-debug') === 'stats') {
      const html = await fetchRawHtml();
      const parsed = parse91paikeSchedule(html);
      const stats: Record<string, { total: number; 请假: number; 寒假: number; 暑假: number; 调课: number; 待定: number }> = {};
      for (const t of parsed.teachers) {
        const s = { total: 0, 请假: 0, 寒假: 0, 暑假: 0, 调课: 0, 待定: 0 };
        for (const k of Object.keys(t.classes || {})) {
          const v = t.classes[k];
          s.total++;
          if (v.includes('[请假')) s.请假++;
          else if (v.includes('[寒假]')) s.寒假++;
          else if (v.includes('[暑假]')) s.暑假++;
          else if (v.includes('[调课]')) s.调课++;
          else if (v.includes('[待定]')) s.待定++;
        }
        stats[t.name] = s;
      }
      const totals = Object.values(stats).reduce((a, b) => ({
        total: a.total + b.total, 请假: a.请假 + b.请假, 寒假: a.寒假 + b.寒假,
        暑假: a.暑假 + b.暑假, 调课: a.调课 + b.调课, 待定: a.待定 + b.待定,
      }), { total: 0, 请假: 0, 寒假: 0, 暑假: 0, 调课: 0, 待定: 0 });
      return json({ ok: true, totals, perTeacher: stats }, 200, cors);
    }

    const schedule = await loginAndFetch();
    const payload = { schedule, fetchedAt: schedule.fetchedAt, source: 'fetch' };

    const { error } = await client
      .from('shared_link')
      .upsert({ user_id: userId, kind: KIND, payload }, { onConflict: 'user_id,kind' });
    if (error) return json({ error: error.message }, 500, cors);

    return json({ ok: true, teachers: schedule.teachers.length, fetchedAt: schedule.fetchedAt }, 200, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500, cors);
  }
});
