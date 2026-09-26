/* sync.js — 云端同步（Supabase）· 个人工作台（DOS）版
 * 设计：单用户 = 每库整文档。登录后拉取云端覆盖本地；每次保存防抖后整份推送；
 *       订阅 Realtime 实现跨设备近实时；读取 shared_link 展示「联动数据」。
 * 关键：未配置 APP_CONFIG（仍是 YOUR_ 占位符）时自动禁用 —— 站点行为与之前完全一致（纯本地）。
 */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});
  var cfg = global.APP_CONFIG || {};
  var TABLE = 'dos_workbench';

  var disabled = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
    /YOUR_/.test(cfg.SUPABASE_URL) || /YOUR_/.test(cfg.SUPABASE_ANON_KEY);
  var client = null, session = null, channel = null, pushTimer = null;
  var applyingRemote = false;
  var status = disabled ? 'disabled' : 'signedout';
  var statusListeners = [];

  function setStatus(s, msg) {
    // 关键：仅当状态「真正变化」时才通知监听者。
    // 否则每次 push（store 变化后防抖上传）都会触发 setStatus('ok') → auth-gate 的 onStatus → router.resolve
    // → 联动数据视图再次渲染并写库 → 再次 push …… 形成无限重渲染（闪屏）。
    if (s !== status) {
      status = s;
      statusListeners.forEach(function (f) { try { f(s, msg); } catch (e) {} });
    }
    try { renderWidget(); } catch (e) {}   // 始终重绘小组件，保证登录态/按钮正确
  }
  // 带「超时 + 指数退避重试」的 fetch，注入 Supabase 客户端。
  // 目的：缓解校园网到 supabase.dosworkbench.top 的 TLS 握手偶发被重置（Connection reset）。
  // 仅在网络层失败（连接被重置 / 超时）时重试；HTTP 响应（含 4xx/5xx）一律不重试，避免重复写入。
  function makeResilientFetch(timeoutMs, maxRetries) {
    return function (input, init) {
      var attempt = 0;
      function run() {
        attempt++;
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, timeoutMs) : null;
        var init2 = init || {};
        if (controller && !init2.signal) init2.signal = controller.signal;
        return fetch(input, init2).then(function (res) {
          if (timer) clearTimeout(timer);
          return res;
        }, function (err) {
          if (timer) clearTimeout(timer);
          if (attempt <= maxRetries) {
            var delay = Math.min(800 * Math.pow(2, attempt - 1), 5000);
            return new Promise(function (resolve) { setTimeout(resolve, delay); }).then(run);
          }
          throw err;
        });
      }
      return run();
    };
  }
  var resilientFetch = makeResilientFetch(10000, 3);
  // 信号无关的硬超时：即便底层 fetch 的 AbortController 被 Supabase 自建网关覆盖而失效，
  // 也保证 Promise 在 ms 后 reject，彻底杜绝“登录点击后永久无响应 / 卡在登录中”。
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error((label || '请求') + '超时（' + Math.round(ms / 1000) + 's），请检查网络或稍后重试'));
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(v);
      }, function (err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
    });
  }
  function ensureClient() {
    if (disabled || client) return client;
    if (global.supabase && global.supabase.createClient) {
      client = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { fetch: resilientFetch });
    }
    return client;
  }
  // 确保 Supabase 客户端库已加载：先试 jsdelivr，被网络/代理拦截则回退 unpkg。
  // 自行动态加载（非阻塞），避免 index.html 里同步 <script> 在 CDN 卡顿时阻塞整页、导致“登录无反应”。
  // 关键修复：每个 CDN 尝试都带超时（LIB_TIMEOUT），杜绝“CDN 连接挂起 → loadSupabaseLib 永不 resolve →
  // 登录点击后永久静默、连错误提示都没有”的故障。超时/失败即回退下一个，全部失败则返回 false 让 signIn 显式报错。
  var libLoadPromise = null;
  var LIB_TIMEOUT = 7000; // 单个 CDN 尝试超时（ms）
  function loadScript(src, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        s.onload = s.onerror = null;
        try { if (s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
        resolve(false); // 超时：当作加载失败，绝不挂起
      }, ms);
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(!!(global.supabase && global.supabase.createClient));
      };
      s.onerror = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(false);
      };
      document.head.appendChild(s);
    });
  }
  function loadSupabaseLib() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve(true);
    if (libLoadPromise) return libLoadPromise;
    var CDNS = [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
      'https://unpkg.com/@supabase/supabase-js@2'
    ];
    function tryLoad(i) {
      if (i >= CDNS.length) return Promise.resolve(false);
      return loadScript(CDNS[i], LIB_TIMEOUT).then(function (ok) {
        if (ok && global.supabase && global.supabase.createClient) return true;
        return tryLoad(i + 1);
      });
    }
    libLoadPromise = tryLoad(0);
    return libLoadPromise;
  }
  function toast(msg) {
    var c = document.getElementById('toast-container'); if (!c) return;
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function uid() { return session && session.user ? session.user.id : null; }

  // 兜底清除 Supabase 本端持久化的会话令牌（键形如 sb-<ref>-auth-token），
  // 保证即便 signOut 网络请求失败，刷新后也不会“复活”会话。
  function clearAuthToken() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (/^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  // ---- profile 自动 upsert（多层级工作台：邮箱 ↔ user_id 解析） ----
  // 表尚未建立（未执行 schema.sql 第 7 节）时静默跳过，不影响登录与主流程
  async function upsertProfile() {
    var c = ensureClient();
    var u = session && session.user;
    if (!c || !u) return;
    try {
      await c.from('profile').upsert(
        { user_id: u.id, email: u.email || null },
        { onConflict: 'user_id' }
      );
    } catch (e) {
      console.warn('[sync] profile upsert skipped:', e && e.message ? e.message : e);
    }
  }

  // ---- 认证 ----
  async function handleRedirect() {
    if (disabled) return false;
    var c = ensureClient(); if (!c) return false;
    try {
      if (location.hash && location.hash.indexOf('access_token') !== -1) {
        var r = await c.auth.getSessionFromUrl();
        if (r.error) { console.warn('[sync] getSessionFromUrl', r.error); return false; }
        session = r.data.session;
        history.replaceState(null, '', location.pathname + location.search);
        return true;
      }
      var g = await c.auth.getSession();
      if (g.data && g.data.session) { session = g.data.session; return true; }
    } catch (e) { console.warn('[sync]', e); }
    return false;
  }
  async function signIn(email, password) {
    // 关键修复：点击登录即刻进入“登录中”态（即使客户端库尚未就绪），
    // 避免「多数情况静默、偶尔才显示」——任何入口（全屏门禁 / 侧栏小组件）点击都会立刻有反馈。
    setStatus('signingin');
    var c = ensureClient();
    if (!c) {
      // 首选 CDN 未生效，尝试兜底加载一次（带超时，不会永久挂起）
      var loaded = await loadSupabaseLib();
      c = loaded ? ensureClient() : null;
    }
    if (!c) { setStatus('error', '同步服务加载失败：无法连接云端。请检查网络 / 代理后刷新重试。'); return; }
    try {
      // 关键修复：登录网络请求套「信号无关的硬超时」。
      // 自建 supabase.dosworkbench.top 在慢/不可达时，底层 fetch 的 AbortController 可能被网关覆盖而失效，
      // resilientFetch 的 10s abort 不兜底 → signInWithPassword 挂起数分钟 → 用户看到「点击后卡在登录中」。
      // withTimeout 独立于信号，保证 12s 后必 reject，给出明确报错而非永久无响应。
      var r = await withTimeout(c.auth.signInWithPassword({ email: email, password: password }), 12000, '登录');
      if (r.error) { setStatus('error', r.error.message || '登录失败'); return; }
      session = r.data.session;
      setStatus('ok');
      subscribeStore();
      // 远端数据拉取同样可能挂起；套 15s 硬超时但**不**因此失败整个登录——
      // 即便云端拉取超时，用户已处于登录态，稍后可用「立即同步」重试。
      try { await withTimeout(applyRemote(), 15000, '数据同步'); }
      catch (e) { console.warn('[sync] 远端数据拉取超时（已登录，稍后可在「立即同步」重试）:', e && e.message ? e.message : e); }
      try { if (App.router && App.router.resolve) App.router.resolve(); } catch (e) {}
      subscribeRealtime();
      upsertProfile();
      // 通知联动数据模块（若已挂载）刷新
      try { window.dispatchEvent(new Event('dos:linked-update')); } catch (e) {}
    } catch (e) {
      console.error('[sync] signIn 异常', e);
      setStatus('error', (e && e.message) ? e.message : '网络异常，请稍后重试');
    }
  }
  async function signOut() {
    // 释放实时订阅与防抖推送，避免退出后残留连接/定时器
    if (channel) {
      try { channel.unsubscribe(); } catch (e) {}
      try { if (client && client.removeChannel) client.removeChannel(channel); } catch (e) {}
      channel = null;
    }
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    // 退出：scope:'local' 只清本端会话，不撤销其它设备/另一工作台的会话
    if (client) {
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { console.warn('[sync] signOut', e); }
    }
    // 兜底：无论网络成败，强制清除本端持久化令牌，防刷新后会话复活
    clearAuthToken();
    session = null;
    setStatus('signedout');
    // 重置子台身份，保证换账号后重新解析角色/科组
    try { if (App.subContext && App.subContext.reset) App.subContext.reset(); } catch (e) {}
    // 清除本机记住的邮箱，避免残留上一账号
    try { localStorage.removeItem('ca_remember'); } catch (e) {}
    // 回默认页，避免下次进入深层/无权路由
    try { if (App.router && App.router.navigate) App.router.navigate('/today'); } catch (e) {}
    renderWidget();
  }

  // ---- 数据 ----
  async function pull() {
    if (!session) return null;
    var c = ensureClient(); if (!c) return null;
    var r = await c.from(TABLE).select('data,updated_at').eq('user_id', uid()).maybeSingle();
    if (r.error) { console.warn('[sync] pull', r.error); return null; }
    return r.data;
  }
  async function push(obj) {
    if (!session) return;
    var c = ensureClient(); if (!c) return;
    var r = await c.from(TABLE).upsert({ user_id: uid(), data: obj, updated_at: new Date().toISOString() });
    if (r.error) { console.warn('[sync] push', r.error); setStatus('error', r.error.message); return; }
    setStatus('ok');
  }
  function schedulePush(obj) {
    if (disabled || !session) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push(obj); }, 800);
  }
  async function applyRemote() {
    if (applyingRemote) return;
    var local = App.store.getData();
    var remote = await pull();
    if (!remote) {
      // 云端为空：把本机已有数据上传（首次登录即完成迁移）
      if (local && Object.keys(local).length) { await push(local); }
      setStatus('ok'); return;
    }
    applyingRemote = true;
    try {
      App.store.applyRemote(remote.data);
      setStatus('ok');
    } finally { applyingRemote = false; }
    // 通知各模块：远端整档已覆盖本地。供其在「最新云端数据」上做修正
    // （如 teacher-milestones 清理随云端同步回来的历史孤儿过期待办/节点，保证零残留）。
    // 放在 applyRemote 之后，确保清理跑在云端数据落地之后，避免「本地清空→云端覆盖回填」的竞态。
    try { window.dispatchEvent(new Event('dos:store-remote-applied')); } catch (e) {}
  }
  function subscribeStore() {
    App.store.subscribe(function () {
      if (applyingRemote) return;
      schedulePush(App.store.getData());
    });
  }
  function onVisibility() { if (!document.hidden && session) applyRemote(); }
  function subscribeRealtime() {
    if (!session || !client) return;
    try {
      // 幂等：释放已存在的同频道订阅，避免重复订阅触发“cannot add postgres_changes after subscribe”
      if (channel) {
        try { channel.unsubscribe(); } catch (e) {}
        try { client.removeChannel(channel); } catch (e) {}
        channel = null;
      }
      channel = client.channel(TABLE + ':' + uid())
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: 'user_id=eq.' + uid() }, function () { applyRemote(); })
        .subscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      document.addEventListener('visibilitychange', onVisibility);
    } catch (e) {
      // 实时订阅失败不应影响登录主流程
      console.warn('[sync] subscribeRealtime 失败（不影响登录）:', e && e.message ? e.message : e);
    }
  }

  // ---- 联动桥：读取分析台推送的快照 ----
  async function readShared() {
    if (!session) return [];
    var c = ensureClient(); if (!c) return [];
    // 子工作台（科组组长 / DOST·教学校长实习生）数据源于总台：读总台 owner 推送的分析快照；
    // 项目组负责人(project_lead)无数据看板权限，仍读自己的（为空），权限不受影响。
    var targetUid = uid();
    if (App.subContext && App.subContext.isSub && App.subContext.isSub()) {
      if (App.perm && App.perm.canView && App.perm.canView('/data')) {
        var oid = App.subContext.ownerUserId && App.subContext.ownerUserId();
        if (oid) targetUid = oid;
      }
    }
    var r = await c.from('shared_link').select('*').eq('user_id', targetUid).order('updated_at');
    if (r.error) { console.warn(r.error); return []; }
    return r.data || [];
  }
  function openSharedModal() {
    readShared().then(function (rows) {
      var mask = document.createElement('div'); mask.className = 'sw-modal-mask';
      var html = '<div class="sw-modal"><button class="sw-close" onclick="this.closest(\'.sw-modal-mask\').remove()">×</button>' +
        '<h3>联动数据 · 来自数据分析工作台</h3>';
      if (!rows.length) html += '<p style="color:#71717a">暂无推送。请在数据分析工作台点击「推送分析到个人台」。</p>';
      rows.forEach(function (row) {
        var p = row.payload || {};
        html += '<div style="margin:10px 0;padding:10px;border:1px solid #e4e4e7;border-radius:8px">' +
          '<div style="font-weight:600">' + (row.kind || '') + ' · 更新于 ' + new Date(row.updated_at).toLocaleString() + '</div>';
        var lbs = p.latestByStream || {};
        Object.keys(lbs).forEach(function (s) {
          html += '<details style="margin-top:6px"><summary style="cursor:pointer">' + s + '（最新一条）</summary>' +
            '<pre style="background:#f4f4f5;border-radius:6px;padding:8px;overflow:auto;font:12px/1.5 JetBrains Mono,monospace;white-space:pre-wrap">' +
            escapeHtml(JSON.stringify(lbs[s], null, 2)) + '</pre></details>';
        });
        html += '<div style="color:#71717a;font-size:12px;margin-top:4px">共 ' + (p.totalRecords || 0) + ' 条记录</div></div>';
      });
      html += '</div>';
      mask.innerHTML = html;
      mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
      document.body.appendChild(mask);
    });
  }
  function escapeHtml(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // 立即同步：把本机最新整档推送到云端，再拉取云端覆盖本地（整档 last-write-wins）。
  // 用于「立即同步」按钮：用户在多设备间手动触发一次对齐。
  async function syncNow() {
    if (disabled || !session) { if (App.util && App.util.toast) App.util.toast('未登录或同步未启用', 'warn'); return; }
    try {
      await push(App.store.getData());
      await applyRemote();
      if (App.util && App.util.toast) App.util.toast('已同步至云端', 'ok');
    } catch (e) {
      console.error('[sync] syncNow 失败', e);
      if (App.util && App.util.toast) App.util.toast('同步失败：' + ((e && e.message) ? e.message : '网络异常'), 'bad');
    }
  }

  // ---- 启动 ----
  async function start() {
    if (disabled) { setStatus('disabled'); renderWidget(); return; }
    // 启动即确保 Supabase 库就绪（jsdelivr→unpkg 回退），否则刷新后无法恢复会话、登录无反应
    await loadSupabaseLib();
    var ok = await handleRedirect();
    if (ok) { setStatus('ok'); subscribeStore(); await applyRemote(); try { if (App.router && App.router.resolve) App.router.resolve(); } catch (e) {} subscribeRealtime(); upsertProfile(); try { window.dispatchEvent(new Event('dos:linked-update')); } catch (e) {} }
    else { setStatus('signedout'); }
    renderWidget();
  }

  // ---- 小组件 UI ----
  function el(id) { return document.getElementById(id); }
  function renderWidget() {
    var w = el('sync-widget');
    if (!w) { w = document.createElement('div'); w.id = 'sync-widget'; w.className = 'sync-widget'; document.body.appendChild(w); }
    if (status === 'disabled') {
      w.innerHTML = '<div class="sw-box"><span class="sw-dot grey"></span>云端同步未启用（可选）</div>';
      return;
    }
    if (status === 'signedout' || status === 'signingin') {
      var signing = status === 'signingin';
      w.innerHTML = '<div class="sw-box"><span class="sw-dot ' + (signing ? 'blue' : 'grey') + '"></span>' +
        '<div class="sw-row"><input id="sync-email" type="email" placeholder="邮箱" class="sw-input"' + (signing ? ' disabled' : '') + '/>' +
        '<input id="sync-pass" type="password" placeholder="密码" class="sw-input"' + (signing ? ' disabled' : '') + '/>' +
        '<button id="sync-login" class="sw-btn"' + (signing ? ' disabled' : '') + '>' + (signing ? '登录中…' : '登录') + '</button></div>' +
        (signing ? '<div class="sw-tip">正在验证身份…</div>' : '<div class="sw-tip">开启后数据可在多设备同步（本机仍保留备份）</div>') + '</div>';
      if (!signing) {
        el('sync-login').onclick = function () {
          var e = el('sync-email').value.trim();
          var p = el('sync-pass').value;
          if (e && p) signIn(e, p);
        };
      }
      return;
    }
    if (status === 'error') {
      w.innerHTML = '<div class="sw-box"><span class="sw-dot red"></span>同步出错，请刷新重试<a id="sync-retry" class="sw-link">重试</a></div>';
      el('sync-retry').onclick = function () { start(); };
      return;
    }
    var user = session && session.user && session.user.email ? session.user.email : '已同步';
    var tsOn = !!(App.taskShare && App.taskShare.isEnabled && App.taskShare.isEnabled());
    var foot = el('auth-foot');
    if (foot) {
      // 登录态/退出移入左侧栏底部账户区（不再用右上角悬浮条遮挡内容）
      w.style.display = 'none';
      foot.innerHTML = '<div class="sf-mail">' + user + ' · 已同步</div>' +
        (tsOn ? '<button id="sync-tasks" class="sf-logout">任务协作<span id="ts-badge" class="sw-badge" style="display:none"></span></button>' : '') +
        '<button id="sync-link" class="sf-logout">查看联动数据</button>' +
        '<button id="sync-out" class="sf-logout">退出登录</button>';
      if (tsOn) el('sync-tasks').onclick = function () { if (App.taskShare && App.taskShare.openInbox) App.taskShare.openInbox(); };
      el('sync-link').onclick = openSharedModal;
      el('sync-out').onclick = signOut;
      return;
    }
    // 回退：无侧栏账户区时仍用浮动小组件
    w.style.display = '';
    w.innerHTML = '<div class="sw-box"><span class="sw-dot green"></span>' +
      '<span class="sw-user">' + user + ' · 已同步</span>' +
      (tsOn ? '<button id="sync-tasks" class="sw-btn small">任务协作<span id="ts-badge" class="sw-badge" style="display:none"></span></button>' : '') +
      '<button id="sync-link" class="sw-btn small">查看联动数据</button>' +
      '<button id="sync-out" class="sw-link">退出</button></div>';
    if (tsOn) el('sync-tasks').onclick = function () { if (App.taskShare && App.taskShare.openInbox) App.taskShare.openInbox(); };
    el('sync-link').onclick = openSharedModal;
    el('sync-out').onclick = signOut;
  }

  App.sync = {
    start: start, signIn: signIn, signOut: signOut,
    readShared: readShared, openSharedModal: openSharedModal,
    onStatus: function (f) { statusListeners.push(f); },
    getStatus: function () { return status; },
    applyRemote: applyRemote,
    syncNow: syncNow,
    // 供 task-share.js 复用同一 Supabase 客户端与会话
    getClient: function () { return ensureClient(); },
    getSession: function () { return session; },
    getEmail: function () { return session && session.user && session.user.email ? session.user.email : null; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
