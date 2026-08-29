/* ============================================
   sub-context.js — 子工作台上下文
   识别子台身份（org_member）、读取总台整档数据、提供合并视图。
   依赖：schema.sql 7.12（子台读总台授权）；App.sync 的客户端与会话。
   数据原则：子台数据源于总台 → 子台实时读总台 dos_workbench，本地按模块规则过滤；
             子台自建任务存本地（source='sub'），由 sync.js 自动同步云端，总台读子台数据可见。
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});
  var cfg = global.APP_CONFIG || {};

  var identity = null;      // { member, org }
  var masterData = null;    // 总台整档数据
  var listeners = [];
  var readyCbs = [];
  var readyFired = false;
  var started = false;

  function client() { return App.sync && App.sync.getClient ? App.sync.getClient() : null; }
  function uid() {
    var s = App.sync && App.sync.getSession ? App.sync.getSession() : null;
    return s && s.user ? s.user.id : null;
  }
  function disabled() {
    return !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
      /YOUR_/.test(cfg.SUPABASE_URL || '') || /YOUR_/.test(cfg.SUPABASE_ANON_KEY || '');
  }

  function isSub() { return !!identity; }
  function myName() { return identity && identity.member ? identity.member.name : null; }
  function myOrgId() { return identity && identity.org ? identity.org.id : null; }
  function ownerUserId() { return identity && identity.org ? identity.org.owner_user_id : null; }
  function getMasterData() { return masterData || {}; }

  // 识别：我是否某组织的子工作台成员
  async function resolveIdentity() {
    var c = client(); var u = uid();
    if (!c || !u) return null;
    try {
      var r = await c.from('org_member').select('*').eq('user_id', u).eq('status', 'active').maybeSingle();
      if (r.error || !r.data) return null;
      var member = r.data;
      var o = await c.from('org').select('*').eq('id', member.org_id).maybeSingle();
      if (o.error || !o.data) return null;
      return { member: member, org: o.data };
    } catch (e) { return null; }
  }

  // 拉取总台整档数据
  async function loadMaster() {
    var id = identity;
    if (!id || !id.org.owner_user_id) return;
    var c = client(); if (!c) return;
    try {
      var r = await c.from('dos_workbench').select('data,updated_at').eq('user_id', id.org.owner_user_id).maybeSingle();
      if (r.error) { console.warn('[subContext] loadMaster', r.error); return; }
      if (r.data) { masterData = r.data.data || {}; }
      notify();
    } catch (e) { console.warn('[subContext] loadMaster', e); }
  }

  function subscribeRealtime() {
    var id = identity; var c = client();
    if (!id || !id.org.owner_user_id || !c) return;
    try {
      c.channel('sub-master-' + id.org.owner_user_id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dos_workbench', filter: 'user_id=eq.' + id.org.owner_user_id }, function () { loadMaster(); })
        .subscribe();
    } catch (e) {}
  }

  function fireReady() {
    if (readyFired) return;
    readyFired = true;
    readyCbs.forEach(function (cb) { try { cb(); } catch (e) {} });
  }

  async function start() {
    if (started) return;
    started = true;
    if (disabled()) { fireReady(); return; }
    var id = await resolveIdentity();
    if (!id) { fireReady(); return; }   // 不是子台（可能是总台或独立用户）
    identity = id;
    applySubUI();      // 子台视角 UI：隐藏「团队」导航段
    await loadMaster();
    subscribeRealtime();
    fireReady();
  }

  function onReady(cb) {
    if (readyFired) { try { cb(); } catch (e) {} return; }
    readyCbs.push(cb);
  }

  // 子台视角 UI 调整：隐藏「团队」导航段（子台不需要子工作台管理/共享数据）
  function applySubUI() {
    try {
      var nav = document.getElementById('nav-team');
      if (nav) nav.style.display = 'none';
    } catch (e) {}
  }

  function notify() {
    listeners.forEach(function (f) { try { f(); } catch (e) {} });
    // 子台首次拉取到总台数据后，刷新当前视图以展示合并后的数据
    try { if (isSub() && App.router && App.router.resolve) App.router.resolve(); } catch (e) {}
  }
  function onMasterChange(f) { listeners.push(f); }

  // 合并任务视图：团队任务 + 派给我的个人任务 + 我的自建任务
  function mergedTasks() {
    var map = {};
    var md = masterData || {};
    var name = myName();
    (md.tasks || []).forEach(function (t) {
      if (!t || !t.id) return;
      var ok = false;
      if (t.scope === 'team') ok = true;
      else if (t.scope === 'personal' && name && t.assignee === name) ok = true;
      else if (!t.scope) ok = true;   // 旧数据无 scope，视为团队可见
      if (ok) map[t.id] = t;
    });
    // 我的自建任务（本地 source='sub'）
    (App.store.get('tasks') || []).forEach(function (t) {
      if (t && t.id && t.source === 'sub') map[t.id] = t;
    });
    var out = [];
    Object.keys(map).forEach(function (k) { out.push(map[k]); });
    return out;
  }

  // 我的自建任务
  function myOwnTasks() {
    return (App.store.get('tasks') || []).filter(function (t) { return t && t.source === 'sub'; });
  }

  // 取总台某字段（全量模块用），支持点路径
  function masterField(path, fallback) {
    var md = masterData || {};
    var parts = String(path).split('.');
    var v = md;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) break;
      v = v[parts[i]];
    }
    return v === undefined ? (fallback === undefined ? null : fallback) : v;
  }

  // 合并视图数据：全量模块用总台数据，任务用合并视图，settings/meta 用本地
  var MIRROR_KEYS = ['timeline', 'reports', 'projects', 'teachers', 'hr', 'teacherMilestones'];
  function viewData() {
    if (!isSub()) return App.store.getData();
    var local = App.store.getData() || {};
    var md = masterData || {};
    var out = {};
    Object.keys(local).forEach(function (k) { out[k] = local[k]; });
    MIRROR_KEYS.forEach(function (k) {
      if (md[k] !== undefined) out[k] = md[k];
    });
    out.tasks = mergedTasks();
    return out;
  }

  App.subContext = {
    start: start,
    isSub: isSub,
    myName: myName,
    myOrgId: myOrgId,
    ownerUserId: ownerUserId,
    getMasterData: getMasterData,
    loadMaster: loadMaster,
    mergedTasks: mergedTasks,
    myOwnTasks: myOwnTasks,
    masterField: masterField,
    viewData: viewData,
    onMasterChange: onMasterChange,
    onReady: onReady
  };

  // 统一视图数据入口：子台返回合并视图，否则返回本地整档
  App.viewData = function () {
    return (App.subContext && App.subContext.isSub && App.subContext.isSub())
      ? App.subContext.viewData()
      : App.store.getData();
  };

  // 是否子工作台视角（供各视图隐藏/禁用编辑入口）
  App.isSub = function () {
    return !!(App.subContext && App.subContext.isSub && App.subContext.isSub());
  };

  // 登录后自动识别身份并加载总台数据
  if (App.sync && App.sync.onStatus) {
    App.sync.onStatus(function (s) { if (s === 'ok') start(); });
  }
})(window);
