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
  function ensureClient() {
    if (disabled || client) return client;
    if (global.supabase && global.supabase.createClient) {
      client = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
    return client;
  }
  // 确保 Supabase 客户端库已加载：先试 jsdelivr，被网络/代理拦截则回退 unpkg。
  // 自行动态加载（非阻塞），避免 index.html 里同步 <script> 在 CDN 卡顿时阻塞整页、导致“登录无反应”。
  var libLoadPromise = null;
  function loadSupabaseLib() {
    if (global.supabase && global.supabase.createClient) return Promise.resolve(true);
    if (libLoadPromise) return libLoadPromise;
    var CDNS = [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
      'https://unpkg.com/@supabase/supabase-js@2'
    ];
    function tryLoad(i) {
      if (i >= CDNS.length) return Promise.resolve(false);
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = CDNS[i];
        s.async = true;
        s.onload = function () { resolve(!!(global.supabase && global.supabase.createClient)); };
        s.onerror = function () { resolve(false); };
        document.head.appendChild(s);
      }).then(function (ok) { return ok ? true : tryLoad(i + 1); });
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
    var c = ensureClient();
    if (!c) {
      // 首选 CDN 未生效，尝试兜底加载一次，避免“点击登录毫无反应”
      var loaded = await loadSupabaseLib();
      c = loaded ? ensureClient() : null;
    }
    if (!c) { setStatus('error', '同步服务加载失败：无法连接云端。请检查网络 / 代理后刷新重试。'); return; }
    setStatus('signingin');
    try {
      var r = await c.auth.signInWithPassword({ email: email, password: password });
      if (r.error) { setStatus('error', r.error.message || '登录失败'); return; }
      session = r.data.session;
      setStatus('ok');
      subscribeStore();
      await applyRemote();
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
    // 供 task-share.js 复用同一 Supabase 客户端与会话
    getClient: function () { return ensureClient(); },
    getSession: function () { return session; },
    getEmail: function () { return session && session.user && session.user.email ? session.user.email : null; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
