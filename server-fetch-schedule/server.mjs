#!/usr/bin/env node
// server-fetch-schedule/server.mjs
// 课程表自动抓取服务（自建服务器版，替代 Cloudflare Worker）
//
// 零依赖：仅用 Node 内置 http 模块 + 全局 fetch（Node 18+ 自带，本机已是 Node 24）。
//
// 功能：
//   1) HTTP POST /fetch  （必须带请求头 x-cron-secret） → 立即执行一次抓取并写回自建 Supabase 的 shared_link(kind='schedule_fetch')
//   2) 内置每日定时（默认 06:00，可用 FETCH_SCHEDULE=HH:MM 改）自动执行同样逻辑
//   前端「同步抓取」按钮即调用本服务的 /fetch 端点（config.js 的 COURSE_FETCH_WORKER_URL 指向它）。
//
// 配置：所有密钥从环境变量读取（见 .env.example）。生产部署用 systemd / pm2 常驻，
//       或在 docker 容器内直接 `node server.mjs`。端口默认 28888（FETCH_PORT 可改）。
//
// 部署后防火墙需放行 TCP 28888（与 8000 同理）。

import http from 'node:http';

// ---------- 配置（来自环境变量）----------
const cleanSecret = (v) => (v || '').replace(/[^\x20-\x7e]/g, '').trim();
function cfg() {
  return {
    SUPABASE_URL: (process.env.SUPABASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
    SERVICE_ROLE: cleanSecret(process.env.SERVICE_ROLE_KEY || ''),
    OWNER_USER_ID: cleanSecret(process.env.OWNER_USER_ID || ''),
    CRON_SECRET: cleanSecret(process.env.CRON_SECRET || ''),
    SOURCE_BASE_URL: (process.env.SOURCE_BASE_URL || 'http://zyg.91paike.com').replace(/\/$/, '').trim(),
    SOURCE_MODULE: (process.env.SOURCE_MODULE || '400002').trim(),
    SOURCE_USER: (process.env.SOURCE_USER || '').trim(),
    SOURCE_PASS: (process.env.SOURCE_PASS || '').trim(),
  };
}

const KIND = 'schedule_fetch';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PORT = parseInt(process.env.FETCH_PORT || '28888', 10);
const ALLOW_ORIGIN = (process.env.ALLOW_ORIGIN || 'https://echo-csj.github.io')
  .split(',').map((s) => s.trim()).filter(Boolean);

// ---------- 工具 ----------
function isAscii(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return false;
  return true;
}
function makeCookieJar() {
  const cookies = new Map();
  const store = (res) => {
    let list = [];
    if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie();
    else if (res.headers.get('set-cookie')) list = [res.headers.get('set-cookie')];
    list.forEach((sc) => {
      const [kv] = sc.split(';');
      const idx = kv.indexOf('=');
      if (idx > 0) cookies.set(kv.slice(0, idx).trim(), kv.slice(idx + 1).trim());
    });
  };
  const header = () =>
    Array.from(cookies.entries())
      .filter(([k, v]) => isAscii(k) && isAscii(v))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  return { store, header, has: () => cookies.size > 0 };
}
async function fetchC(url, init = {}, jar = makeCookieJar()) {
  const headers = new Headers(init.headers || {});
  const c = jar.header();
  if (c) headers.set('cookie', c);
  if (!headers.has('user-agent')) headers.set('user-agent', UA);
  const res = await fetch(url, { ...init, headers });
  jar.store(res);
  return res;
}

const DAY_ALIAS = {
  '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四',
  '星期五': '周五', '星期六': '周六', '星期日': '周日', '周天': '周日', '礼拜一': '周一',
};
const normDay = (d) => DAY_ALIAS[d] || d;

function thisMonday() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function thisSunday() {
  const d = new Date(thisMonday());
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function normalizeSchedule(parsed) {
  const periods = (parsed.periods && parsed.periods.length)
    ? parsed.periods.map((p) => String(p).trim())
    : ['08:00-10:00', '10:10-12:10', '12:50-14:50', '15:00-17:00', '17:30-19:30', '19:40-21:40'];
  const teachers = (parsed.teachers || []).map((t) => {
    const classes = {};
    const src = t.classes || {};
    Object.keys(src).forEach((k) => {
      const idx = k.indexOf('-');
      const ad = idx >= 0 ? k.slice(0, idx) : k;
      const ap = idx >= 0 ? k.slice(idx + 1) : '';
      const v = String(src[k] == null ? '' : src[k]).trim();
      if (v) classes[normDay(ad) + '-' + ap] = v;
    });
    const dayArrange = {};
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
  return { weekStartDate: ws, weekEndDate: we, periods, teachers, sourceUrl: parsed.sourceUrl || '', fetchedAt: new Date().toISOString() };
}

// ---------- 解析：91paike HTML ----------
function cellText(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractInputFields(html) {
  const fields = {};
  const re = /<input\b[^>]*>/gi;
  let m;
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

// 源站地址在运行时由 cfg() 提供；用闭包变量覆盖 parse 内的占位
let SOURCE_BASE_URL_PLACEHOLDER = 'http://zyg.91paike.com';
let SOURCE_MODULE_PLACEHOLDER = '400002';

function parse91paikeSchedule(html) {
  const teacherMeta = new Map();
  const navRe = /<li id='(\d+)'[^>]*>([\s\S]*?)<\/li>/g;
  let nm;
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

  const arrBlocks = [...html.matchAll(/<div class='arrange'><ul class='cnt'>([\s\S]*?)<\/ul>/g)].map((x) => x[1]);
  const calBlocks = [...html.matchAll(/<div class='calendar'><ul class='cnt'>([\s\S]*?)<\/ul>/g)].map((x) => x[1]);
  const dayMap = { Monday: '周一', Tuesday: '周二', Wednesday: '周三', Thursday: '周四', Friday: '周五', Saturday: '周六', Sunday: '周日' };

  const teachers = [];
  const FIXED_PERIODS = ['08:00-10:00', '10:10-12:10', '12:50-14:50', '15:00-17:00', '17:30-19:30', '19:40-21:40'];

  arrBlocks.forEach((ablock, idx) => {
    const cal = calBlocks[idx] || '';
    const tidM = cal.match(/tchid=(\d+)/);
    const tid = tidM ? tidM[1] : '';
    const meta = teacherMeta.get(tid) || { name: '教师' + (idx + 1), code: '', subject: '', summary: '' };
    const classes = {};
    const dayArrange = {};

    const liRe = /<li class='([A-Za-z]+)([^']*)'>([\s\S]*?)<\/li>/g;
    let lm;
    while ((lm = liRe.exec(ablock)) !== null) {
      const day = dayMap[lm[1]];
      if (!day) continue;
      const raw = cellText(lm[3]).replace(/\u00a0/g, ' ').trim();
      if (!raw) continue;
      dayArrange[day] = raw;
    }

    const dayRe = /<li class='([A-Za-z]+)([^']*)'>([\s\S]*?)<\/li>/g;
    let dm;
    while ((dm = dayRe.exec(cal)) !== null) {
      const day = dayMap[dm[1]];
      if (!day) continue;
      const dayInner = dm[3];
      const spanRe = /<div id='(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_span_\d+'[\s\S]*?<\/div>/g;
      let sm;
      while ((sm = spanRe.exec(dayInner)) !== null) {
        const start = `${sm[4]}:${sm[5]}`;
        const period = `${start}-${endOfPeriod(start)}`;
        if (!FIXED_PERIODS.includes(period)) continue;
        const inner = sm[0];
        const coseAll = inner.match(/<a class='cose'(?:(?!<\/a>)[\s\S])*?<\/a>/);
        if (coseAll) {
          const cnMatch = coseAll[0].match(/<span class='class(?:\s+leave)?\s*'>(?:(?!<\/a>)[\s\S])*?<\/span>/);
          const sbMatch = coseAll[0].match(/<span class='sbj\s*'>(?:(?!<\/a>)[\s\S])*?<\/span>/);
          if (cnMatch && sbMatch) {
            const cnInner = cnMatch[0];
            const sbInner = sbMatch[0];
            const isLeave = /class\s*=\s*'class\s+leave'/.test(cnInner.slice(0, 100));
            const extractChars = (s) => {
              const re = /<span class='hint[^']*'>([^<]+)<\/span>/g;
              const out = [];
              let hm;
              while ((hm = re.exec(s)) !== null) out.push(hm[1].trim());
              return out;
            };
            let cnRaw = cnInner.replace(/<span class='hint[^']*'>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
            let sbRaw = sbInner.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
            const allChars = [...extractChars(cnInner), ...extractChars(sbInner)];
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
      }
    }
    teachers.push({ name: meta.name, code: meta.code, subject: meta.subject, summary: meta.summary, classes, dayArrange });
  });

  if (!teachers.length) {
    throw new Error('HTML 解析：未找到任何教师课表块（.arrange / .calendar）。可能登录失效或页面结构变化。');
  }

  const navIdx = html.indexOf('day-nav');
  const navEnd = html.indexOf('</ul>', navIdx);
  const navHtml = navIdx >= 0 ? html.slice(navIdx, navEnd >= 0 ? navEnd : navIdx + 4000) : '';
  const dateRe = /y=(\d+)&m=(\d+)&d=(\d+)/g;
  const dates = [];
  let dm2;
  while ((dm2 = dateRe.exec(navHtml)) !== null) {
    dates.push(`${dm2[1]}-${dm2[2].padStart(2, '0')}-${dm2[3].padStart(2, '0')}`);
  }
  const ws = dates[0] || null;
  const we = dates[dates.length - 1] || null;
  const periods = FIXED_PERIODS;
  const sourceUrl = `${SOURCE_BASE_URL_PLACEHOLDER}/schedules.aspx?module=${SOURCE_MODULE_PLACEHOLDER}`;
  return normalizeSchedule({ teachers, periods, weekStartDate: ws, weekEndDate: we, sourceUrl });
}

function endOfPeriod(start) {
  const m = {
    '08:00': '10:00', '10:10': '12:10', '12:50': '14:50',
    '15:00': '17:00', '17:30': '19:30', '19:40': '21:40',
  };
  return m[start] || start;
}

// ---------- 登录并抓取（ASP.NET WebForms）----------
async function fetchRawHtml(C) {
  const loginUrl = `${C.SOURCE_BASE_URL}/login.aspx?return=schedules.aspx%3fmodule%3d${C.SOURCE_MODULE}`;
  const schedUrl = `${C.SOURCE_BASE_URL}/schedules.aspx?module=${C.SOURCE_MODULE}`;
  const jar = makeCookieJar();
  const loginPageRes = await fetchC(loginUrl, { headers: { referer: loginUrl } }, jar);
  if (!loginPageRes.ok) throw new Error(`源站登录页访问失败：HTTP ${loginPageRes.status}`);
  const loginPageHtml = await loginPageRes.text();
  const fields = extractInputFields(loginPageHtml);
  fields['tb_account'] = C.SOURCE_USER;
  fields['tb_password'] = C.SOURCE_PASS;
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
    const target = loc ? (loc.startsWith('http') ? loc : `${C.SOURCE_BASE_URL}/${loc.replace(/^\//, '')}`) : schedUrl;
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

async function loginAndFetch(C) {
  const html = await fetchRawHtml(C);
  SOURCE_BASE_URL_PLACEHOLDER = C.SOURCE_BASE_URL;
  SOURCE_MODULE_PLACEHOLDER = C.SOURCE_MODULE;
  return parse91paikeSchedule(html);
}

// ---------- 写回自建 Supabase（直接调 REST API，service_role 绕过 RLS）----------
async function upsertShared(C, userId, payload) {
  const url = `${C.SUPABASE_URL}/rest/v1/shared_link?on_conflict=user_id,kind`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${C.SERVICE_ROLE}`,
      'apikey': C.SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ user_id: userId, kind: KIND, payload }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`写回 shared_link 失败：HTTP ${res.status} ${txt}`);
  }
  return res;
}

// ---------- 主逻辑 ----------
async function runFetch(debug) {
  const C = cfg();
  if (!C.SOURCE_USER || !C.SOURCE_PASS) throw new Error('源站账号未配置（SOURCE_USER / SOURCE_PASS）');
  if (!(C.SERVICE_ROLE && C.OWNER_USER_ID)) throw new Error('Supabase 配置缺失（SERVICE_ROLE_KEY / OWNER_USER_ID）');

  if (debug === 'hint_all') {
    const html = await fetchRawHtml(C);
    const hintRe = /<span class='hint([^']*)'>([^<]+)<\/span>/g;
    const counts = {}; const samples = {}; let hm;
    while ((hm = hintRe.exec(html)) !== null) {
      const cls = hm[1].trim(); const ch = hm[2].trim();
      const key = `hint[${cls || ''}]=${ch}`;
      counts[key] = (counts[key] || 0) + 1;
      if (!samples[key]) {
        const ctx0 = Math.max(0, hm.index - 80);
        samples[key] = html.slice(ctx0, hm.index + hm[0].length + 40).replace(/\s+/g, ' ').trim();
      }
    }
    return { ok: true, hintCounts: counts, hintSamples: samples, htmlLen: html.length };
  }
  if (debug === 'first_teacher') {
    const parsed = await loginAndFetch(C);
    return { ok: true, teacher: parsed.teachers[0] };
  }
  if (debug === 'stats') {
    const parsed = await loginAndFetch(C);
    const stats = {};
    for (const t of parsed.teachers) {
      const s = { total: 0, 请假: 0, 寒假: 0, 暑假: 0, 调课: 0, 待定: 0 };
      for (const k of Object.keys(t.classes || {})) {
        const v = t.classes[k]; s.total++;
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
    return { ok: true, totals, perTeacher: stats };
  }

  const schedule = await loginAndFetch(C);
  const payload = { schedule, fetchedAt: schedule.fetchedAt, source: 'fetch' };
  await upsertShared(C, C.OWNER_USER_ID, payload);
  return { ok: true, teachers: schedule.teachers.length, fetchedAt: schedule.fetchedAt };
}

// ---------- HTTP 服务 ----------
function buildCors(origin) {
  const allow = ALLOW_ORIGIN.includes(origin) || ALLOW_ORIGIN.includes('*') ? (origin || '*') : (ALLOW_ORIGIN[0] || '*');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, x-cron-secret, content-type, x-client-info, apikey',
    'access-control-max-age': '86400',
    'vary': 'Origin, Access-Control-Request-Headers',
  };
}

const server = http.createServer(async (req, res) => {
  const cors = buildCors(req.headers.origin);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ error: 'method not allowed' })); return; }

    const C = cfg();
    const cronSecret = req.headers['x-cron-secret'] || '';
    if (!(cronSecret && C.CRON_SECRET && cronSecret === C.CRON_SECRET && C.SERVICE_ROLE && C.OWNER_USER_ID)) {
      res.writeHead(401, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const debug = req.headers['x-debug'] || '';
    const result = await runFetch(debug);
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(500, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ error: msg }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[schedule-fetch] listening on http://0.0.0.0:${PORT}  (ALLOW_ORIGIN=${ALLOW_ORIGIN.join(',')})`);
});

// ---------- 内置每日定时（默认 06:00）----------
const sched = (process.env.FETCH_SCHEDULE || '06:00').split(':').map((x) => parseInt(x, 10));
const sh = sched[0] ?? 6, sm = sched[1] ?? 0;
console.log(`[schedule-fetch] 每日定时：${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')} 自动抓取`);
setInterval(() => {
  const d = new Date();
  if (d.getHours() === sh && d.getMinutes() === sm) {
    runFetch().then((r) => console.log('[schedule-fetch] 定时抓取完成:', r)).catch((e) => console.error('[schedule-fetch] 定时抓取失败:', e.message));
  }
}, 60 * 1000);

// 进程退出前打印
process.on('SIGINT', () => { console.log('[schedule-fetch] bye'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[schedule-fetch] bye'); process.exit(0); });
