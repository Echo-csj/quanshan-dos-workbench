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
  function myRole() { return identity && identity.member && identity.member.role ? identity.member.role : 'subject_lead'; }
  function myProjectTags() {
    var t = identity && identity.member && identity.member.project_tags;
    if (Array.isArray(t)) return t;
    if (typeof t === 'string') { try { return JSON.parse(t); } catch (e) { return []; } }
    return [];
  }

  // ---------- 权限角色 / 模块可见性 / 任务权限标签（静态常量）----------
  var ROLES = [
    { v: 'subject_lead',     label: '学科组长' },
    { v: 'principal_intern', label: '教学校长实习生' },
    { v: 'project_lead',     label: '项目组负责人' }
  ];
  var ROLE_LABELS = { subject_lead: '学科组长', principal_intern: '教学校长实习生', project_lead: '项目组负责人' };

  // 任务权限标签（学科组长/教学校长实习生/项目组负责人/团队/个人/项目组）
  var TASK_TAGS = [
    { v: 'subject_lead',     label: '学科组长' },
    { v: 'principal_intern', label: '教学校长实习生' },
    { v: 'project_lead',     label: '项目组负责人' },
    { v: 'team',     label: '团队' },
    { v: 'personal', label: '个人' },
    { v: 'project',  label: '项目组' }
  ];
  var TASK_TAG_LABELS = {};
  TASK_TAGS.forEach(function (t) { TASK_TAG_LABELS[t.v] = t.label; });

  // 各角色在子台需要隐藏的「主功能区」路由（总台不受影响，拥有最高权限）
  // 教学校长实习生 = 内容与 DOS 一致（全模块；教师管理隐藏三字段由 teachers.js 统一处理）
  // 项目组负责人 = 隐藏「数据看板 / 教师管理」，保留 今日指挥台 / 时间轴 / 事项看板 / 项目组中心
  var ROLE_HIDDEN_ROUTES = {
    subject_lead:     [],
    principal_intern: [],
    project_lead:     ['/data', '/teachers']
  };

  // 子台是否允许查看某路由（模块可见性守卫）
  function canView(route) {
    if (!isSub()) return true;               // 总台最高权限
    var hidden = ROLE_HIDDEN_ROUTES[myRole()] || [];
    return hidden.indexOf(route) === -1;
  }
  function hiddenRoutes() {
    return isSub() ? (ROLE_HIDDEN_ROUTES[myRole()] || []) : [];
  }

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
    applySubUI();      // 子台视角 UI：隐藏「团队」导航段 + 按角色隐藏无权模块
    try { if (App.router && App.router.resolve) App.router.resolve(); } catch (e) {}
    await loadMaster();
    subscribeRealtime();
    fireReady();
  }

  function onReady(cb) {
    if (readyFired) { try { cb(); } catch (e) {} return; }
    readyCbs.push(cb);
  }

  // 子台视角 UI 调整：隐藏「团队」导航段 + 按角色隐藏无权模块
  function applySubUI() {
    try {
      var nav = document.getElementById('nav-team');
      if (nav) nav.style.display = 'none';
    } catch (e) {}
    applyRoleVisibility();
  }

  // 按角色隐藏无权访问的侧栏/移动端模块入口
  function applyRoleVisibility() {
    if (!isSub()) return;
    var hidden = ROLE_HIDDEN_ROUTES[myRole()] || [];
    if (!hidden.length) return;
    try {
      var items = document.querySelectorAll('[data-route]');
      Array.prototype.forEach.call(items, function (el) {
        var r = el.getAttribute('data-route');
        if (hidden.indexOf(r) !== -1) el.style.display = 'none';
      });
    } catch (e) {}
  }

  function notify() {
    listeners.forEach(function (f) { try { f(); } catch (e) {} });
    // 子台首次拉取到总台数据后，刷新当前视图以展示合并后的数据
    try { if (isSub() && App.router && App.router.resolve) App.router.resolve(); } catch (e) {}
  }
  function onMasterChange(f) { listeners.push(f); }

  // 子台判断某条（总台）任务是否可见：优先按权限标签 permTags，否则回退旧 scope 规则
  function taskVisibleToSub(t) {
    var tags = t.permTags || [];
    if (tags.length) {
      if (tags.indexOf('personal') >= 0) return false;   // 个人标签优先：仅 DOS 可见，子台一律不可见
      var role = myRole();
      var projTags = myProjectTags();
      for (var i = 0; i < tags.length; i++) {
        var g = tags[i];
        if (g === 'team') return true;               // 团队：全员可见
        if (g === 'subject_lead' || g === 'principal_intern' || g === 'project_lead') {
          if (g === role) return true;               // 角色标签命中我的角色
        }
        if (g === 'project') {                       // 项目组标签：任务具体项目命中我的项目组标签
          var pg = t.projGroup || t.projectGroup || '';
          if (pg && projTags.indexOf(pg) >= 0) return true;
        }
      }
      return false;
    }
    // 旧数据无权限标签，沿用 scope：团队可见 / 派给我的个人任务 / 未分配
    var name = myName();
    if (t.scope === 'team') return true;
    if (t.scope === 'personal' && name && t.assignee === name) return true;
    if (!t.scope) return true;
    return false;
  }

  // 合并任务视图：按权限标签/scope 过滤的总台任务 + 我的自建任务
  function mergedTasks() {
    var map = {};
    var md = masterData || {};
    (md.tasks || []).forEach(function (t) {
      if (!t || !t.id) return;
      if (taskVisibleToSub(t)) map[t.id] = t;
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
    myRole: myRole,
    myProjectTags: myProjectTags,
    onMasterChange: onMasterChange,
    onReady: onReady
  };

  // 权限模块（供总台/子台共用：角色列表、任务标签、模块可见性守卫）
  App.perm = {
    ROLES: ROLES,
    ROLE_LABELS: ROLE_LABELS,
    TASK_TAGS: TASK_TAGS,
    TASK_TAG_LABELS: TASK_TAG_LABELS,
    myRole: myRole,
    myProjectTags: myProjectTags,
    canView: canView,
    hiddenRoutes: hiddenRoutes
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
