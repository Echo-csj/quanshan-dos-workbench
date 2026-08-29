/* ============================================
   task-share.js — 任务双向发送 / 同步（Supabase）
   复用 sync.js 的 Supabase 客户端与会话，按邮箱路由。
   仅在已登录云端时可用；未登录时按钮/弹窗给出提示。
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});
  var cfg = global.APP_CONFIG || {};
  var TABLE = 'task_share';
  var CONTACTS_KEY = 'task_share_contacts';

  var _inboxCache = [];
  var _outboxCache = [];
  var _activeTab = 'inbox';
  var _pending = 0;
  var _pendingListeners = [];
  var _incomingChannel = null;

  function disabled() {
    return !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
      /YOUR_/.test(cfg.SUPABASE_URL || '') || /YOUR_/.test(cfg.SUPABASE_ANON_KEY || '');
  }
  // 模块总开关（config.js 的 TASK_SHARE）：关闭时整模块停摆，UI 入口不渲染
  function moduleEnabled() { return cfg.TASK_SHARE === true; }
  function client() { return App.sync && App.sync.getClient ? App.sync.getClient() : null; }
  function myEmail() {
    var e = App.sync && App.sync.getEmail ? App.sync.getEmail() : null;
    return e ? String(e).toLowerCase() : null;
  }
  function signedIn() { return moduleEnabled() && !disabled() && !!myEmail(); }

  function setPending(n) {
    _pending = n;
    var b = document.getElementById('ts-badge');
    if (b) { if (n > 0) { b.textContent = n; b.style.display = ''; } else { b.style.display = 'none'; } }
    _pendingListeners.forEach(function (f) { try { f(n); } catch (e) {} });
  }

  /* ---------------- 联系人 ---------------- */
  function getContacts() {
    try { return JSON.parse(localStorage.getItem(CONTACTS_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveContact(name, mail) {
    var m = String(mail).toLowerCase();
    var list = getContacts().filter(function (c) { return c.email !== m; });
    list.unshift({ name: name || m, email: m });
    try { localStorage.setItem(CONTACTS_KEY, JSON.stringify(list.slice(0, 20))); } catch (e) {}
  }

  /* ---------------- 发送 ---------------- */
  function send(task, toEmail) {
    if (!signedIn()) { App.util.toast('请先登录云端同步（右下角小组件）', 'warn'); return Promise.resolve({ error: 'not-signed-in' }); }
    var c = client();
    if (!c) { App.util.toast('云端未配置', 'warn'); return Promise.resolve({ error: 'no-client' }); }
    var snap = {
      title: (task && task.title) || '',
      priority: (task && task.priority) || 'normal',
      dueDate: (task && task.dueDate) || '',
      note: (task && task.note) || '',
      assignee: (task && task.assignee) || ''
    };
    return c.from(TABLE).insert({
      from_email: myEmail(),
      to_email: String(toEmail).toLowerCase(),
      task: snap,
      status: 'sent'
    }).then(function (r) {
      if (r.error) { App.util.toast('发送失败：' + (r.error.message || r.error), 'warn'); return { error: r.error }; }
      saveContact((String(toEmail).split('@')[0] || toEmail), toEmail);
      App.util.toast('已发送给 ' + toEmail, 'ok');
      return { ok: true };
    });
  }

  /* ---------------- 拉取 ---------------- */
  function inbox() {
    if (!signedIn()) return Promise.resolve([]);
    var c = client(); if (!c) return Promise.resolve([]);
    return c.from(TABLE).select('*').eq('to_email', myEmail()).order('created_at', { ascending: false })
      .then(function (r) {
        _inboxCache = r.error ? [] : (r.data || []);
        setPending(_inboxCache.filter(function (x) { return x.status === 'sent'; }).length);
        return _inboxCache;
      });
  }
  function outbox() {
    if (!signedIn()) return Promise.resolve([]);
    var c = client(); if (!c) return Promise.resolve([]);
    return c.from(TABLE).select('*').eq('from_email', myEmail()).order('created_at', { ascending: false })
      .then(function (r) { _outboxCache = r.error ? [] : (r.data || []); return _outboxCache; });
  }
  function refreshPending() { return inbox(); }
  function findInbox(id) { return _inboxCache.filter(function (r) { return r.id === id; })[0]; }

  /* ---------------- 状态回写 ---------------- */
  function markStatus(id, status) {
    var c = client(); if (!c) return Promise.resolve();
    return c.from(TABLE).update({ status: status }).eq('id', id).then(function (r) {
      if (r.error) { App.util.toast('操作失败：' + (r.error.message || r.error), 'warn'); return r; }
      [_inboxCache, _outboxCache].forEach(function (arr) {
        var row = arr.filter(function (x) { return x.id === id; })[0];
        if (row) row.status = status;
      });
      return r;
    });
  }

  /* ---------------- 接收 / 拒绝 ---------------- */
  function accept(id) {
    var row = findInbox(id);
    if (!row) { App.util.toast('未找到该任务', 'warn'); return; }
    var t = row.task || {};
    var tasks = App.store.get('tasks') || [];
    if (tasks.some(function (x) { return x.shareId === row.id; })) {
      App.util.toast('该任务已在你的任务列表', 'warn');
      markStatus(id, 'accepted').then(function () { refreshPending(); });
      return;
    }
    tasks.push({
      id: App.store.uid('task'),
      title: t.title || '（无标题）',
      priority: t.priority || 'normal',
      status: 'todo',
      assignee: t.assignee || '',
      dueDate: t.dueDate || '',
      note: t.note || '',
      scope: App.util.deriveScope(t.assignee || ''),
      source: 'share',
      shareId: row.id,
      shareFrom: row.from_email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    App.store.set('tasks', tasks);
    markStatus(id, 'accepted').then(function () { refreshPending(); });
    App.util.toast('已接收任务', 'ok');
    App.router.resolve();
    reRenderList();
  }
  function decline(id) {
    markStatus(id, 'declined').then(function () { refreshPending(); reRenderList(); });
    App.util.toast('已拒绝', 'ok');
  }
  function reRenderList() {
    var listEl = document.getElementById('ts-list');
    if (listEl) showTab(_activeTab);
  }

  /* ---------------- 实时订阅 ---------------- */
  function subscribeRealtime() {
    var c = client();
    var me = myEmail();
    if (!c || !me) return;
    if (_incomingChannel) { try { c.removeChannel(_incomingChannel); } catch (e) {} _incomingChannel = null; }
    _incomingChannel = c.channel('task-share:' + me)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE, filter: 'to_email=eq.' + me }, function (payload) {
        var t = payload.new && payload.new.task;
        App.util.toast('收到新任务：' + (t && t.title ? t.title : '（无标题）'), 'ok');
        refreshPending();
        reRenderList();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: 'from_email=eq.' + me }, function () {
        reRenderList();
      })
      .subscribe();
  }

  /* ---------------- 协作弹窗 ---------------- */
  function openInbox() {
    if (!signedIn()) { App.util.toast('请先登录云端同步（右下角小组件）', 'warn'); return; }
    App.util.modal({
      title: '任务协作',
      content: '<div class="ts-tabs">' +
        '<button class="ts-tab" id="ts-tab-in" onclick="App.taskShare.showTab(\'inbox\')">收到的任务</button>' +
        '<button class="ts-tab" id="ts-tab-out" onclick="App.taskShare.showTab(\'outbox\')">发出的任务</button>' +
        '</div><div id="ts-list" class="ts-list">加载中…</div>',
      showCancel: false,
      onClose: function () { _activeTab = 'inbox'; }
    });
    showTab('inbox');
  }
  function showTab(tab) {
    _activeTab = tab;
    var t1 = document.getElementById('ts-tab-in'), t2 = document.getElementById('ts-tab-out');
    if (t1) t1.className = 'ts-tab' + (tab === 'inbox' ? ' active' : '');
    if (t2) t2.className = 'ts-tab' + (tab === 'outbox' ? ' active' : '');
    var listEl = document.getElementById('ts-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="ts-loading">加载中…</div>';
    if (tab === 'inbox') inbox().then(renderInbox);
    else outbox().then(renderOutbox);
  }

  function fmtDate(s) { return s ? String(s).slice(0, 10) : ''; }
  function statusBadge(status, isSender) {
    var map = isSender
      ? { sent: ['待处理', 'grey'], accepted: ['对方已接收', 'blue'], done: ['对方已完成', 'green'], declined: ['对方已拒绝', 'red'] }
      : { sent: ['待接收', 'grey'], accepted: ['已接收', 'blue'], done: ['已完成', 'green'], declined: ['已拒绝', 'red'] };
    var m = map[status] || [status, 'grey'];
    return '<span class="ts-badge ts-badge-' + m[1] + '">' + m[0] + '</span>';
  }
  function renderInbox(rows) {
    var listEl = document.getElementById('ts-list');
    if (!listEl) return;
    if (!rows.length) { listEl.innerHTML = '<div class="ts-empty">暂无收到的任务</div>'; return; }
    var html = '';
    rows.forEach(function (r) {
      var t = r.task || {};
      html += '<div class="ts-item">' +
        '<div class="ts-item-title">' + App.util.escapeHtml(t.title || '（无标题）') + ' ' + statusBadge(r.status, false) + '</div>' +
        '<div class="ts-item-meta">来自 ' + App.util.escapeHtml(r.from_email) +
        (t.priority ? ' · ' + App.util.priorityLabel(t.priority) : '') +
        (t.dueDate ? ' · 截止 ' + App.util.escapeHtml(fmtDate(t.dueDate)) : '') +
        ' · ' + App.util.escapeHtml(fmtDate(r.created_at)) + '</div>' +
        (t.note ? '<div class="ts-item-note">' + App.util.escapeHtml(t.note) + '</div>' : '') +
        (r.status === 'sent' ? '<div class="ts-item-actions">' +
          '<button class="btn btn-primary btn-sm" onclick="App.taskShare.accept(\'' + r.id + '\')">接收</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="App.taskShare.decline(\'' + r.id + '\')">拒绝</button>' +
          '</div>' : '') +
        '</div>';
    });
    listEl.innerHTML = html;
  }
  function renderOutbox(rows) {
    var listEl = document.getElementById('ts-list');
    if (!listEl) return;
    if (!rows.length) { listEl.innerHTML = '<div class="ts-empty">暂无发出的任务</div>'; return; }
    var html = '';
    rows.forEach(function (r) {
      var t = r.task || {};
      html += '<div class="ts-item">' +
        '<div class="ts-item-title">' + App.util.escapeHtml(t.title || '（无标题）') + ' ' + statusBadge(r.status, true) + '</div>' +
        '<div class="ts-item-meta">发给 ' + App.util.escapeHtml(r.to_email) +
        (t.priority ? ' · ' + App.util.priorityLabel(t.priority) : '') +
        (t.dueDate ? ' · 截止 ' + App.util.escapeHtml(fmtDate(t.dueDate)) : '') +
        ' · ' + App.util.escapeHtml(fmtDate(r.created_at)) + '</div>' +
        '</div>';
    });
    listEl.innerHTML = html;
  }

  /* ---------------- 启动：登录后订阅（模块关闭时不订阅、不查表） ---------------- */
  if (moduleEnabled() && App.sync && App.sync.onStatus) {
    App.sync.onStatus(function (s) {
      if (s === 'ok') { subscribeRealtime(); refreshPending(); }
      else if (s === 'signedout' || s === 'disabled') { setPending(0); }
    });
  }

  /* ---------------- 对外 ---------------- */
  App.taskShare = {
    send: send,
    inbox: inbox,
    outbox: outbox,
    accept: accept,
    decline: decline,
    markStatus: markStatus,
    markDone: function (id) { return markStatus(id, 'done'); },
    getContacts: getContacts,
    saveContact: saveContact,
    openInbox: openInbox,
    showTab: showTab,
    onPending: function (f) { _pendingListeners.push(f); },
    getPending: function () { return _pending; },
    refreshPending: refreshPending,
    signedIn: signedIn,
    isEnabled: moduleEnabled
  };
})(window);
