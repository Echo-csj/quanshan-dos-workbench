#!/usr/bin/env node
// server-fetch-schedule/server.mjs
// 课程表自动抓取服务（自建服务器版，替代 Cloudflare Worker）
//
// 零依赖：仅用 Node 内置 http 模块 + 全局 fetch（Node 18+ 自带，本机已是 Node 24）。
//
// 功能：
//   1) HTTP POST /fetch  （二选一鉴权） → 立即执行一次抓取并写回自建 Supabase 的 shared_link(kind='schedule_fetch')
//        a) 请求头 x-cron-secret = 服务端 cron secret（定时抓取 / pg_cron 用，原逻辑不变）
//        b) 请求头 Authorization: Bearer <用户会话 JWT>（前端「同步抓取」按钮用，去 Supabase 验真）
//   2) 内置每日定时（默认 06:00，可用 FETCH_SCHEDULE=HH:MM 改）自动执行同样逻辑
//   前端「同步抓取」按钮即调用本服务的 /fetch 端点（config.js 的 COURSE_FETCH_WORKER_URL 指向它）。
//
// 周次切换抓取（核心）：91paike 站点没有月份/周次下拉，只有"上一周/下一周"链接（GET，靠 y/m/d 参数定位周次）。
//   请求体可带 { weekStartDate }（目标周周一）指定要抓的周；后端登录后解析页面当前周，
//   若给定目标周则直接 GET 带 y/m/d 的课表页 URL 拿到该周再解析（无需逐周翻页）。
//   不带 weekStartDate / 定时抓取 → 抓"当前周"。
//   调试：POST 时加请求头 x-debug: nav 可仅验证周次导航（返回 currentWeek / targetWeek / finalWeek）。
//
// 配置：所有密钥从环境变量读取（见 .env.example）。生产部署用 systemd / pm2 常驻，
//       或在 docker 容器内直接 `node server.mjs`。端口默认 28888（FETCH_PORT 可改）。
//
// 部署后防火墙需放行 TCP 28888（与 8000 同理）。

import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

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

// ---------- 会话 JWT 校验（手动「同步抓取」走用户登录令牌）----------
// 不依赖 JWT 密钥，直接拿令牌去 Supabase 的 /auth/v1/user 验真（服务端已知 SUPABASE_URL）。
// 仅当返回合法用户时才放行；匿名 anon key 不会通过（无用户 id）。
// apikey 用公开 anon key（与官方客户端 getUser 行为一致，确保合法用户令牌一定放行）。
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5MTk1Mzk5LCJleHAiOjQxMDI0NDQ4MDB9.Yejt5D7n9lzPzORBa9nUYJrzccPgxk3i5-sihrn-AV4';
async function verifyUserJWT(jwt, C) {
  if (!jwt || !C.SUPABASE_URL) return null;
  try {
    const r = await fetch(`${C.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (u && u.id) return u;
  } catch { /* 网络/解析异常一律视为未授权 */ }
  return null;
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

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function thisMonday() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return ymd(d);
}
function thisSunday() {
  const d = new Date(thisMonday());
  d.setDate(d.getDate() + 6);
  return ymd(d);
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
    const nameM = tag.match(/\bname\s*=\s*(["'])([^"']+)\1/i) || tag.match(/\bname\s*=\s*([^\s>]+)/i);
    if (!nameM) continue;
    const name = nameM[2] !== undefined ? nameM[2] : nameM[1];
    const valM = tag.match(/\bvalue\s*=\s*(["'])([^"']*)\1/i) || tag.match(/\bvalue\s*=\s*([^\s>]+)/i);
    fields[name] = valM ? (valM[2] !== undefined ? valM[2] : valM[1]) : '';
  }
  return fields;
}

// 源站地址在运行时由 cfg() 提供；用闭包变量覆盖 parse 内的占位
let SOURCE_BASE_URL_PLACEHOLDER = 'http://zyg.91paike.com';
let SOURCE_MODULE_PLACEHOLDER = '400002';

// ---------- 周次导航（91paike 无月份/周次下拉，仅"上一周/下一周"链接）----------
// 做法：登录后解析页面当前显示的周次（month-nav 的 .currect 文本，如"第39周 （2026-09-21 ~ 2026-09-27）"），
// 若给定目标周（weekStartDate=目标周周一），直接 GET 带 y/m/d 参数的课表页 URL 即可拿到该周，无需逐周回发。
// 关键：源站周次切换本质是 schedules.aspx?...&period=week&y=Y&m=M&d=D 的 GET 链接（d 取目标周任意一天）。
const MAX_WEEK_STEPS = 60; // 最多导航约 14 个月，足够覆盖历史周次

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // 0=周一
  d.setDate(d.getDate() - day);
  return ymd(d); // 用本地日期分量，避免 toISOString 的 UTC 时区偏移（宿主机 UTC+8 会错位一天）
}

// 以 UTC 历法天数做差值（与时区无关）：同一日历日的 dayNumber 固定
function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function weekDiff(targetMon, currentMon) {
  return Math.round((dayNumber(targetMon) - dayNumber(currentMon)) / 7); // >0 未来(下一周)，<0 过去(上一周)
}

// 从页面解析当前显示的周起止。优先取 month-nav 里的 .currect 文本（"第39周 （2026-09-21 ~ 2026-09-27）"），
// 该 span 同时含起止两个日期，最可靠；回退到 day-nav 文本或全页扫描（兼容 "2026年9月21日~9月27日" / "2026/09/21~09/27"）。
// 从一段 HTML 中解析"周起~周止"日期。支持三种格式：
//   短横：2026-09-21 ~ 2026-09-27
//   斜杠：2026/09/21 ~ 09/27（结束缺省年/月）
//   中文：2026年9月21日 ~ 9月27日（结束缺省年）
// 无明确结束日时，默认 start + 6 天（一周）。
function parseDatesFromRegion(region) {
  const pad2 = (n) => String(n).padStart(2, '0');
  // 1) 短横
  const dash = [...region.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)];
  if (dash.length >= 2) return { start: `${dash[0][1]}-${pad2(dash[0][2])}-${pad2(dash[0][3])}`, end: `${dash[1][1]}-${pad2(dash[1][2])}-${pad2(dash[1][3])}` };
  if (dash.length === 1) {
    const s = `${dash[0][1]}-${pad2(dash[0][2])}-${pad2(dash[0][3])}`;
    const dt = new Date(`${s}T00:00:00`); dt.setDate(dt.getDate() + 6);
    return { start: s, end: ymd(dt) };
  }
  // 2) 斜杠：2026/09/21 ~ 09/27
  const slash = [...region.matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2})/g)];
  if (slash.length) {
    const y = +slash[0][1], m = +slash[0][2], d = +slash[0][3];
    const endM = /(?:~|-|至)\s*(\d{1,2})\/(\d{1,2})/.exec(region);
    const em = endM ? +endM[1] : m, ed = endM ? +endM[2] : d + 6;
    return { start: `${y}-${pad2(m)}-${pad2(d)}`, end: `${y}-${pad2(em)}-${pad2(ed)}` };
  }
  // 3) 中文：2026年9月21日 ~ 9月27日
  const cn = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(region);
  if (cn) {
    const y = +cn[1], m = +cn[2], d = +cn[3];
    const endM = /(?:~|-|至)\s*(\d{1,2})月(\d{1,2})日/.exec(region);
    const em = endM ? +endM[1] : m, ed = endM ? +endM[2] : d + 6;
    return { start: `${y}-${pad2(m)}-${pad2(d)}`, end: `${y}-${pad2(em)}-${pad2(ed)}` };
  }
  return null;
}

function extractWeekDates(html) {
  // 优先：month-nav 的 .currect span（真实格式 "第39周 （2026-09-21 ~ 2026-09-27）"）
  // 只解析该 span 内部，避免被页面靠前出现的"今天"日期（如 2026-09-25）干扰。
  const curIdx = html.indexOf('currect');
  if (curIdx >= 0) {
    const open = html.indexOf('>', curIdx); // 跳过 class="currect"
    const close = open >= 0 ? html.indexOf('</span>', open) : -1;
    const inner = close > open ? html.slice(open + 1, close) : html.slice(open + 1, open + 400);
    const r = parseDatesFromRegion(inner);
    if (r) return r;
    // .currect 内部未解析出日期 → 继续走下方回退
  }
  // 回退：day-nav 区域 或 全文（兼容旧版中文/斜杠格式）
  const region = html.indexOf('day-nav') >= 0 ? html.slice(html.indexOf('day-nav'), html.indexOf('day-nav') + 4000) : html;
  return parseDatesFromRegion(region);
}

// 构建"指定周"的课表页 URL：91paike 的周次切换是普通 GET 链接，靠 y/m/d 查询参数定位周次
// （真实链接形如 schedules.aspx?module=400002&dept=1&owner=teacher&period=week&y=2026&m=9&d=20，
//  d=20 是周日）。为兼容"d=周日止"和"d 落在当周自动吸附(Mon 起)"两种源站实现口径，
// 统一传目标周的【周日=周一+6】作为 d：两种口径都会解析到同一周，避免差一周。
function buildWeekUrl(C, mondayIso) {
  const [y, m, d] = mondayIso.split('-').map(Number);
  const sun = new Date(Date.UTC(y, m - 1, d));
  sun.setUTCDate(sun.getUTCDate() + 6); // 纯 UTC 运算，避免时区偏移
  const sy = sun.getUTCFullYear(), sm = sun.getUTCMonth() + 1, sd = sun.getUTCDate();
  return `${C.SOURCE_BASE_URL}/schedules.aspx?module=${C.SOURCE_MODULE}&dept=1&owner=teacher&period=week&y=${sy}&m=${sm}&d=${sd}`;
}

// 登录源站，返回已登录的课表页 HTML（当前周，未导航）
async function doLogin(C) {
  const loginUrl = `${C.SOURCE_BASE_URL}/login.aspx?return=schedules.aspx%3fmodule%3d${C.SOURCE_MODULE}`;
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
    body, redirect: 'manual',
  }, jar);
  let schedHtml = '';
  let schedUrl = `${C.SOURCE_BASE_URL}/schedules.aspx?module=${C.SOURCE_MODULE}`;
  if (loginRes.status >= 300 && loginRes.status < 400) {
    const loc = loginRes.headers.get('location');
    const target = loc ? (loc.startsWith('http') ? loc : `${C.SOURCE_BASE_URL}/${loc.replace(/^\//, '')}`) : schedUrl;
    const schedRes = await fetchC(target, { headers: { referer: loginUrl } }, jar);
    if (!schedRes.ok) throw new Error(`抓取课表失败：HTTP ${schedRes.status}`);
    schedHtml = await schedRes.text();
    schedUrl = target;
  } else {
    schedHtml = await loginRes.text();
    schedUrl = loginUrl;
  }
  if (!schedHtml || schedHtml.length < 1000) {
    throw new Error('登录后未取到课表页面（可能账号/密码错误、需要验证码，或会话已失效）');
  }
  return { jar, schedHtml, schedUrl };
}

// 导航到目标周：91paike 周次切换是 GET 链接（y/m/d 参数），直接请求目标周 URL 即可，
// 无需逐周回发。一次 GET 拿到目标周页面。trace 记录本次请求便于联调。
async function navigateToWeek(C, jar, schedUrl, schedHtml, targetMon, trace) {
  const cur = extractWeekDates(schedHtml);
  const curMon = cur ? mondayOf(cur.start) : thisMonday();
  const tMon = mondayOf(targetMon);
  if (tMon === curMon) return schedHtml; // 已是目标周，无需导航
  const url = buildWeekUrl(C, tMon);
  if (trace) trace.push({ step: 1, dir: tMon > curMon ? 'next' : 'prev', url, target: tMon });
  const res = await fetchC(url, { headers: { referer: schedUrl } }, jar);
  if (!res.ok) throw new Error(`历史周抓取失败：HTTP ${res.status}`);
  const html = await res.text();
  const w = extractWeekDates(html);
  if (!w) throw new Error('历史周页面解析失败（可能周次超出源站可查范围，或页面结构变化）');
  return html;
}

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

  // 周次起止来自页面 day-nav 文本（"2026年9月21日~9月27日" 等），兼容无 y/m/d 参数的 91paike
  const wk = extractWeekDates(html);
  const ws = wk ? wk.start : null;
  const we = wk ? wk.end : null;
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

// ---------- 登录并抓取（ASP.NET WebForms，按"上一周/下一周"按钮导航）----------
// weekStartDate：可选，目标周周一(YYYY-MM-DD)；给定则导航到该周；缺省=当前周
async function fetchRawHtml(C, weekStartDate) {
  const { jar, schedHtml, schedUrl } = await doLogin(C);
  const cur = extractWeekDates(schedHtml);
  const targetMon = /^\d{4}-\d{2}-\d{2}$/.test(weekStartDate || '')
    ? weekStartDate
    : mondayOf((cur || { start: thisMonday() }).start);
  return navigateToWeek(C, jar, schedUrl, schedHtml, targetMon);
}

async function loginAndFetch(C, weekStartDate) {
  const html = await fetchRawHtml(C, weekStartDate);
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
// opts.weekStartDate：可选，目标周周一(YYYY-MM-DD)；缺省=当前周
async function runFetch(debug, opts) {
  const C = cfg();
  if (!C.SOURCE_USER || !C.SOURCE_PASS) throw new Error('源站账号未配置（SOURCE_USER / SOURCE_PASS）');
  if (!(C.SERVICE_ROLE && C.OWNER_USER_ID)) throw new Error('Supabase 配置缺失（SERVICE_ROLE_KEY / OWNER_USER_ID）');

  const ws = (opts && /^\d{4}-\d{2}-\d{2}$/.test(opts.weekStartDate || '')) ? opts.weekStartDate : null;

  if (debug === 'hint_all') {
    const html = await fetchRawHtml(C, ws);
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
  if (debug === 'nav') {
    // 仅验证周次导航：登录→按目标周逐周点击"上一周/下一周"，返回经过的周次轨迹
    const { jar, schedHtml, schedUrl } = await doLogin(C);
    const cur = extractWeekDates(schedHtml);
    const targetMon = ws || mondayOf((cur || { start: thisMonday() }).start);
    const trace = [];
    const finalHtml = await navigateToWeek(C, jar, schedUrl, schedHtml, targetMon, trace);
    const finalWk = extractWeekDates(finalHtml);
    return { ok: true, currentWeek: cur, targetWeek: targetMon, steps: trace, finalWeek: finalWk, htmlLen: finalHtml.length };
  }
  if (debug === 'first_teacher') {
    const parsed = await loginAndFetch(C, ws);
    return { ok: true, teacher: parsed.teachers[0] };
  }
  if (debug === 'stats') {
    const parsed = await loginAndFetch(C, ws);
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

  const schedule = await loginAndFetch(C, ws);
  const payload = { schedule, fetchedAt: schedule.fetchedAt, source: 'fetch' };
  await upsertShared(C, C.OWNER_USER_ID, payload);
  return { ok: true, teachers: schedule.teachers.length, fetchedAt: schedule.fetchedAt, weekStartDate: schedule.weekStartDate, weekEndDate: schedule.weekEndDate };
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

    // 读取请求体（前端「同步抓取」会带 { weekStartDate, weekEndDate } 指定目标周）
    let bodyStr = '';
    try { for await (const chunk of req) bodyStr += chunk; } catch { /* 忽略读取异常 */ }
    let bodyObj = {};
    try { bodyObj = JSON.parse(bodyStr || '{}'); } catch { bodyObj = {}; }
    const reqWeek = /^\d{4}-\d{2}-\d{2}$/.test(bodyObj.weekStartDate) ? bodyObj.weekStartDate : null;

    const C = cfg();
    const cronSecret = req.headers['x-cron-secret'] || '';
    const authHeader = req.headers['authorization'] || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    // 两条通路，任一通过即放行：
    // ① 定时抓取：服务端持有的 cron secret（pg_cron / 原逻辑不变）
    const cronOk = !!(cronSecret && C.CRON_SECRET && cronSecret === C.CRON_SECRET && C.SERVICE_ROLE && C.OWNER_USER_ID);
    // ② 手动「同步抓取」：前端传来当前登录用户的会话 JWT（拿去 Supabase 验真，零依赖）
    const user = jwt ? await verifyUserJWT(jwt, C) : null;
    const jwtOk = !!user;

    if (!(cronOk || jwtOk)) {
      res.writeHead(401, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const debug = req.headers['x-debug'] || '';
    const result = await runFetch(debug, { weekStartDate: reqWeek });
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify(result));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(500, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ error: msg }));
  }
});

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  // 若存在同目录 .env 则自动加载（Node 20.12+；缺失/失败不影响已通过环境变量注入的场景，如 pm2 env_file / systemd EnvironmentFile / --env-file）
  try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '.env')); } catch { /* 忽略 */ }
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
}

// 导出纯函数 / 导航函数，供单元测试（import 时不会启动 HTTP 服务，因已做 isMain 守卫）
export {
  mondayOf, weekDiff, extractWeekDates, buildWeekUrl,
  extractInputFields, navigateToWeek, doLogin, parse91paikeSchedule,
  normalizeSchedule, thisMonday, thisSunday, MAX_WEEK_STEPS,
};
