/* test_sync_login.js
   验证登录静默修复（#登录bug）：
     - signIn() 入口立即 setStatus('signingin')（任何入口点击即有反馈，不再多数静默）
     - 当 Supabase CDN 挂起（脚本 onload/onerror 永不触发）时，loadSupabaseLib 仍会因超时
       而 resolve(false)，signIn 最终落到 setStatus('error')，绝不永久挂起（修复“永久静默”）。
   运行：node tests/test_sync_login.js
*/
var path = require('path');

// ---- 缩放 setTimeout：把 7000ms 的库加载超时缩到 30ms，使超时路径可在毫秒级被验证 ----
var realSetTimeout = setTimeout;
var realClearTimeout = clearTimeout;

// ---- 极简 DOM 桩：所有元素都是 permissive 的 fakeEl，避免 renderWidget 抛错 ----
function fakeEl() {
  var store = {};
  return new Proxy(function () {}, {
    get: function (t, prop) {
      if (prop === 'style') return store.style || (store.style = {});
      if (prop === 'classList') return { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } };
      if (prop === 'querySelector' || prop === 'closest') return function () { return fakeEl(); };
      if (prop === 'appendChild' || prop === 'removeChild' || prop === 'remove' || prop === 'setAttribute' || prop === 'addEventListener' || prop === 'removeEventListener') return function () {};
      if (prop === 'getAttribute') return function () { return null; };
      if (prop === 'parentNode') return store.parentNode || null;
      if (prop in store) return store[prop];
      return undefined;
    },
    set: function (t, prop, val) { store[prop] = val; if (prop === 'parentNode') store.parentNode = val; return true; }
  });
}

global.window = global;
global.document = {
  readyState: 'loading', // 关键：阻止 IIFE 自动 start()，由测试手动调用 signIn
  addEventListener: function () {},
  removeEventListener: function () {},
  getElementById: function () { return fakeEl(); },
  querySelectorAll: function () { return { forEach: function () {} }; },
  createElement: function () { return fakeEl(); }, // 返回的 script 永不被触发 → 模拟 CDN 挂起
  head: fakeEl(),
  body: fakeEl()
};
global.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
global.location = { hash: '', pathname: '/', search: '' };
global.history = { replaceState: function () {} };
global.fetch = function () { return Promise.reject(new Error('no fetch in test')); };
global.AbortController = function () { this.abort = function () {}; this.signal = {}; };
global.Event = function (n) { this.type = n; };
global.setTimeout = function (fn, ms) { return realSetTimeout(fn, (typeof ms === 'number' && ms >= 1000) ? 30 : ms); };
global.clearTimeout = realClearTimeout;

// 有效 APP_CONFIG：启用同步（非 disabled），但 global.supabase 保持 undefined（模拟库未加载）
global.APP_CONFIG = { SUPABASE_URL: 'https://supabase.dosworkbench.top', SUPABASE_ANON_KEY: 'eyJhbGci.test' };
global.supabase = undefined;

// 加载被测试模块（IIFE 注入 window=global）
require(path.join('..', 'js', 'sync.js'));

var App = global.App;
var pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } }

(async function () {
  console.log('\n# 登录静默修复');

  ok(App && App.sync, 'sync 模块已挂载');
  ok(App.sync.getStatus() === 'signedout', '初始状态 signedout（start 未运行，disabled=false）');

  // 调用 signIn：CDN 被桩成“挂起”，但入口应立刻进入 signingin
  var p = App.sync.signIn('dos@dosworkbench.top', 'secret');
  ok(App.sync.getStatus() === 'signingin', '点击登录即刻进入 signingin（立即反馈，不再静默）');

  var resolved = false;
  p.then(function () { resolved = true; }).catch(function () { resolved = true; });
  // 等待（超时路径约 2×30ms 后即 resolve）；给足余量
  await new Promise(function (r) { realSetTimeout(r, 400); });

  ok(resolved, 'signIn Promise 已 resolve（绝不永久挂起）');
  ok(App.sync.getStatus() === 'error', 'CDN 挂起后最终落到 error（显式报错，而非无声失败）');

  console.log('\n----------------------------------------');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  console.log('----------------------------------------');
  process.exit(fail ? 1 : 0);
})();
