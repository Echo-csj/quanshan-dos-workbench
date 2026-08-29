/* ============================================
   master-hub.js — 总工作台（数据层）
   组织 / 子工作台纳管 / 共享规则 / 下发 / 回传合并 / 审计日志
   依赖：App.sync 的 Supabase 客户端与会话；schema.sql 第 7 节的表
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});
  var cfg = global.APP_CONFIG || {};

  // 摘要裁剪：permission='summary' 时只保留这些字段
  var SUMMARY_FIELDS = {
    tasks:    ['title', 'dueDate', 'priority', 'status'],
    teachers: ['name', 'subjectGroup', 'positionCode'],
    timeline: ['title', 'weekday', 'time', 'type'],
    reports:  ['month', 'label', 'metrics', 'yoy'],
    hr:       ['weekLabel', 'hireCount', 'leaveCount', 'month'],
    projects: []
  };

  var DATA_TYPES = [
    { v: 'tasks',    label: '任务事项' },
    { v: 'teachers', label: '教师花名册' },
    { v: 'reports',  label: '教学数据' },
    { v: 'timeline', label: '时间轴' },
    { v: 'projects', label: '项目组' },
    { v: 'hr',       label: '人事数据' }
  ];

  function disabled() {
    return !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
      /YOUR_/.test(cfg.SUPABASE_URL || '') || /YOUR_/.test(cfg.SUPABASE_ANON_KEY || '');
  }
  function client() { return App.sync && App.sync.getClient ? App.sync.getClient() : null; }
  function uid() {
    var s = App.sync && App.sync.getSession ? App.sync.getSession() : null;
    return s && s.user ? s.user.id : null;
  }
  function ready() { return !disabled() && !!client() && !!uid(); }

  /* ---------------- 本地数据 → 可共享条目 ---------------- */
  function extractItems(dataType, data) {
    var items = [];
    data = data || {};
    if (dataType === 'tasks') {
      (data.tasks || []).forEach(function (t) { items.push({ itemId: t.id, payload: t }); });
    } else if (dataType === 'teachers') {
      (data.teachers || []).forEach(function (t) { items.push({ itemId: t.id, payload: t }); });
    } else if (dataType === 'reports') {
      var monthly = (data.reports && data.reports.monthly) || {};
      Object.keys(monthly).forEach(function (k) { items.push({ itemId: k, payload: monthly[k] }); });
    } else if (dataType === 'timeline') {
      var tl = data.timeline || {};
      (tl.fixedNodes || []).concat(tl.customNodes || []).forEach(function (n) {
        items.push({ itemId: n.id, payload: n });
      });
    } else if (dataType === 'hr') {
      var weekly = (data.hr && data.hr.weekly) || {};
      Object.keys(weekly).forEach(function (k) { items.push({ itemId: k, payload: weekly[k] }); });
    } else if (dataType === 'projects') {
      var pj = data.projects || {};
      Object.keys(pj).forEach(function (k) { items.push({ itemId: k, payload: pj[k] }); });
    }
    return items;
  }

  function trimPayload(permission, dataType, payload) {
    if (permission !== 'summary') return payload;
    var fields = SUMMARY_FIELDS[dataType];
    if (!fields || !fields.length) return payload;
    var out = {};
    fields.forEach(function (f) { if (payload && payload[f] !== undefined) out[f] = payload[f]; });
    return out;
  }

  function matchFilter(payload, filter) {
    if (!filter) return true;
    try {
      var f = typeof filter === 'string' ? JSON.parse(filter) : filter;
      return Object.keys(f).every(function (k) {
        var want = f[k];
        if (Array.isArray(want)) return want.indexOf(payload[k]) !== -1;
        return payload[k] === want;
      });
    } catch (e) { return true; }
  }

  /* ---------------- 日志 ---------------- */
  async function log(action, opts) {
    var c = client(); if (!c || !uid()) return;
    opts = opts || {};
    try {
      await c.from('share_log').insert({
        org_id: opts.orgId || (await getMyOrgId()),
        actor_user_id: uid(),
        action: action,
        target_user_id: opts.targetUserId || null,
        data_type: opts.dataType || null,
        item_id: opts.itemId || null,
        detail: opts.detail || null
      });
    } catch (e) { console.warn('[masterHub] log skipped:', e && e.message ? e.message : e); }
  }

  var _orgIdCache = null;
  async function getMyOrgId() {
    if (_orgIdCache) return _orgIdCache;
    var c = client(); if (!c || !uid()) return null;
    var r = await c.from('org').select('id').eq('owner_user_id', uid()).maybeSingle();
    _orgIdCache = r.data ? r.data.id : null;
    return _orgIdCache;
  }

  /* ---------------- 组织 ---------------- */
  async function getMyOrg() {
    var c = client(); if (!c || !uid()) return null;
    var r = await c.from('org').select('*').eq('owner_user_id', uid()).maybeSingle();
    if (r.error) { console.warn('[masterHub] getMyOrg', r.error); return null; }
    if (r.data) _orgIdCache = r.data.id;
    return r.data || null;
  }

  async function createOrg(name) {
    var c = client(); if (!c || !uid()) { App.util.toast('请先登录云端同步', 'warn'); return { ok: false, error: 'not-signed-in' }; }
    name = (name || '我的团队').trim();
    // 已有组织则直接返回，避免重复创建
    var existing = await getMyOrg();
    if (existing) { App.util.toast('已有组织「' + existing.name + '」', 'ok'); return { ok: true, data: existing }; }
    var r = await c.from('org').insert({ name: name, owner_user_id: uid() }).select().maybeSingle();
    if (r.error) {
      console.error('[masterHub] createOrg 失败:', r.error);
      var msg = r.error.message || (r.error.details ? r.error.details : JSON.stringify(r.error));
      App.util.toast('创建组织失败：' + msg, 'warn');
      return { ok: false, error: msg };
    }
    var org = r.data;
    if (!org) org = await getMyOrg();   // select 被挡回时兜底重查
    if (!org) { App.util.toast('组织已创建但读取失败，请刷新页面', 'warn'); return { ok: false, error: 'read-back-failed' }; }
    _orgIdCache = org.id;
    await log('org_created', { orgId: org.id, detail: { name: name } });
    App.util.toast('组织已创建', 'ok');
    return { ok: true, data: org };
  }

  /* ---------------- 子工作台成员 ---------------- */
  async function resolveUserByEmail(email) {
    var c = client(); if (!c) return null;
    try {
      var p = await c.from('profile').select('user_id').ilike('email', email).maybeSingle();
      if (p.data && p.data.user_id) return p.data.user_id;
      var r = await c.rpc('lookup_user_id_by_email', { p_email: email });
      if (r.data) return r.data;
    } catch (e) { console.warn('[masterHub] resolve email', e && e.message ? e.message : e); }
    return null;
  }

  async function listSubs() {
    var orgId = await getMyOrgId();
    var c = client(); if (!c || !orgId) return [];
    var r = await c.from('org_member').select('*').eq('org_id', orgId).order('created_at');
    if (r.error) { console.warn('[masterHub] listSubs', r.error); return []; }
    return r.data || [];
  }

  async function addSub(email, name, role) {
    var orgId = await getMyOrgId();
    var c = client();
    if (!c || !orgId) { App.util.toast('请先创建组织', 'warn'); return null; }
    email = String(email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1) { App.util.toast('请填写正确的邮箱', 'warn'); return null; }
    if (email === ((App.sync.getSession() && App.sync.getSession().user.email) || '').toLowerCase()) {
      App.util.toast('不能把自己加为子工作台', 'warn'); return null;
    }
    var targetId = await resolveUserByEmail(email);
    if (!targetId) {
      App.util.toast('没找到该邮箱对应的账号，请先在 Supabase 建好账号', 'warn');
      return null;
    }
    role = role || 'subject_lead';   // 默认归属「学科组长」
    var r = await c.from('org_member')
      .upsert({ org_id: orgId, user_id: targetId, name: name || email.split('@')[0], role: role, status: 'active' },
              { onConflict: 'org_id,user_id' })
      .select().maybeSingle();
    if (r.error) { App.util.toast('纳管失败：' + (r.error.message || ''), 'warn'); return null; }
    await log('member_added', { orgId: orgId, targetUserId: targetId, detail: { email: email, name: name, role: role } });
    App.util.toast('已纳管子工作台', 'ok');
    return r.data;
  }

  // 设置子工作台权限角色（学科组长 / 教学校长实习生 / 项目组负责人）
  async function setSubRole(memberId, role) {
    var c = client(); if (!c) return null;
    role = role || 'subject_lead';
    var r = await c.from('org_member').update({ role: role }).eq('id', memberId).select().maybeSingle();
    if (r.error) { App.util.toast('设置角色失败：' + (r.error.message || ''), 'warn'); return null; }
    await log('member_role_set', { targetUserId: r.data && r.data.user_id, detail: { role: role } });
    App.util.toast('已更新权限角色', 'ok');
    return r.data;
  }

  // 设置子工作台项目组标签（用于「项目组」权限标签的任务同步）
  async function setSubProjectTags(memberId, tags) {
    var c = client(); if (!c) return null;
    tags = Array.isArray(tags) ? tags : [];
    var r = await c.from('org_member').update({ project_tags: tags }).eq('id', memberId).select().maybeSingle();
    if (r.error) { App.util.toast('设置项目组标签失败：' + (r.error.message || ''), 'warn'); return null; }
    await log('member_tags_set', { targetUserId: r.data && r.data.user_id, detail: { project_tags: tags } });
    App.util.toast('已更新项目组标签', 'ok');
    return r.data;
  }

  async function suspendSub(memberId, suspended) {
    var c = client(); if (!c) return;
    var r = await c.from('org_member').update({ status: suspended ? 'suspended' : 'active' }).eq('id', memberId).select().maybeSingle();
    if (r.error) { App.util.toast('操作失败：' + (r.error.message || ''), 'warn'); return; }
    await log('member_suspended', { targetUserId: r.data && r.data.user_id, detail: { suspended: !!suspended } });
    App.util.toast(suspended ? '已停用' : '已启用', 'ok');
  }

  async function removeSub(memberId) {
    var c = client(); if (!c) return;
    var m = await c.from('org_member').select('user_id').eq('id', memberId).maybeSingle();
    var r = await c.from('org_member').delete().eq('id', memberId);
    if (r.error) { App.util.toast('移除失败：' + (r.error.message || ''), 'warn'); return; }
    await log('member_suspended', { targetUserId: m.data && m.data.user_id, detail: { removed: true } });
    App.util.toast('已移除子工作台', 'ok');
  }

  /* ---------------- 共享规则 ---------------- */
  async function listGrants(toUserId) {
    var c = client(); if (!c || !uid()) return [];
    var q = c.from('share_grant').select('*').eq('from_user_id', uid()).order('created_at');
    if (toUserId) q = q.eq('to_user_id', toUserId);
    var r = await q;
    if (r.error) { console.warn('[masterHub] listGrants', r.error); return []; }
    return r.data || [];
  }

  async function createGrant(toUserId, opts) {
    var orgId = await getMyOrgId();
    var c = client();
    if (!c || !orgId) { App.util.toast('请先创建组织', 'warn'); return null; }
    opts = opts || {};
    var row = {
      org_id: orgId,
      from_user_id: uid(),
      to_user_id: toUserId,
      data_type: opts.dataType || 'tasks',
      item_id: opts.itemId || null,
      item_filter: opts.itemFilter || null,
      permission: opts.permission || 'read',
      allow_reverse: !!opts.allowReverse,
      reverse_mode: opts.allowReverse ? (opts.reverseMode || 'status') : null,
      active: true
    };
    var r = await c.from('share_grant').insert(row).select().maybeSingle();
    if (r.error) { App.util.toast('创建规则失败：' + (r.error.message || ''), 'warn'); return null; }
    await log('grant_created', {
      orgId: orgId, targetUserId: toUserId, dataType: row.data_type,
      detail: { permission: row.permission, allowReverse: row.allow_reverse, reverseMode: row.reverse_mode, itemId: row.item_id }
    });
    return r.data;
  }

  async function updateGrant(grantId, patch) {
    var c = client(); if (!c) return null;
    var r = await c.from('share_grant').update(patch).eq('id', grantId).select().maybeSingle();
    if (r.error) { App.util.toast('更新失败：' + (r.error.message || ''), 'warn'); return null; }
    await log('grant_updated', { targetUserId: r.data && r.data.to_user_id, dataType: r.data && r.data.data_type, detail: patch });
    App.util.toast('已更新共享规则', 'ok');
    return r.data;
  }

  async function revokeGrant(grantId) {
    var c = client(); if (!c) return;
    var g = await c.from('share_grant').select('to_user_id,data_type').eq('id', grantId).maybeSingle();
    await c.from('share_grant').update({ active: false }).eq('id', grantId);
    // 级联撤销已下发的数据
    await c.from('shared_item').update({ status: 'revoked' }).eq('grant_id', grantId).eq('status', 'active');
    await log('grant_revoked', { targetUserId: g.data && g.data.to_user_id, dataType: g.data && g.data.data_type, detail: { grantId: grantId } });
    App.util.toast('已撤销共享（对方立即可见范围收回）', 'ok');
  }

  /* ---------------- 下发 ---------------- */
  async function publish(grantId) {
    var orgId = await getMyOrgId();
    var c = client();
    if (!c || !orgId) { App.util.toast('请先创建组织', 'warn'); return { error: 'no-org' }; }
    var g = await c.from('share_grant').select('*').eq('id', grantId).maybeSingle();
    if (!g.data) { App.util.toast('未找到共享规则', 'warn'); return { error: 'no-grant' }; }
    var grant = g.data;
    var data = App.store.getData();
    var items = extractItems(grant.data_type, data);
    if (grant.item_id) items = items.filter(function (it) { return String(it.itemId) === String(grant.item_id); });
    items = items.filter(function (it) { return matchFilter(it.payload, grant.item_filter); });

    // 旧版本作废
    await c.from('shared_item').update({ status: 'superseded' }).eq('grant_id', grantId).eq('status', 'active');

    var rows = items.map(function (it) {
      return {
        org_id: orgId,
        grant_id: grant.id,
        from_user_id: uid(),
        to_user_id: grant.to_user_id,
        data_type: grant.data_type,
        item_id: String(it.itemId),
        permission: grant.permission,
        direction: 'down',
        payload: trimPayload(grant.permission, grant.data_type, it.payload),
        status: 'active'
      };
    });

    if (rows.length) {
      var ins = await c.from('shared_item').insert(rows);
      if (ins.error) { App.util.toast('下发失败：' + (ins.error.message || ''), 'warn'); return { error: ins.error }; }
    }
    await log('item_shared', {
      orgId: orgId, targetUserId: grant.to_user_id, dataType: grant.data_type,
      detail: { grantId: grantId, count: rows.length, permission: grant.permission }
    });
    App.util.toast('已下发 ' + rows.length + ' 条', 'ok');
    return { ok: true, count: rows.length };
  }

  /* ---------------- 已下发 / 回传 ---------------- */
  async function listOutgoing() {
    var c = client(); if (!c || !uid()) return [];
    var r = await c.from('shared_item').select('*').eq('from_user_id', uid()).eq('direction', 'down').order('created_at', { ascending: false });
    if (r.error) { console.warn('[masterHub] listOutgoing', r.error); return []; }
    return r.data || [];
  }

  async function listReverse() {
    var c = client(); if (!c || !uid()) return [];
    var r = await c.from('shared_item').select('*').eq('to_user_id', uid()).eq('direction', 'up').order('created_at', { ascending: false });
    if (r.error) { console.warn('[masterHub] listReverse', r.error); return []; }
    return r.data || [];
  }

  // 把子工作台回传的内容合并进本地数据（当前完整支持 tasks，其他类型提示未支持）
  async function mergeReverse(itemId) {
    var c = client(); if (!c || !uid()) return;
    var r = await c.from('shared_item').select('*').eq('id', itemId).maybeSingle();
    if (!r.data) { App.util.toast('未找到回传记录', 'warn'); return; }
    var it = r.data;
    if (it.data_type !== 'tasks') {
      App.util.toast('该类型的回传合并后续版本支持', 'warn');
      return;
    }
    var tasks = App.store.get('tasks') || [];
    var idx = -1;
    tasks.forEach(function (t, i) { if (String(t.id) === String(it.item_id)) idx = i; });
    if (idx === -1) { App.util.toast('本地找不到对应任务', 'warn'); return; }
    Object.keys(it.payload || {}).forEach(function (k) {
      if (k === 'id') return;
      tasks[idx][k] = it.payload[k];
    });
    tasks[idx].updatedAt = new Date().toISOString();
    App.store.set('tasks', tasks);
    await c.from('shared_item').update({ status: 'superseded' }).eq('id', itemId);
    await log('item_edited', { targetUserId: it.from_user_id, dataType: it.data_type, itemId: it.item_id, detail: { merged: true } });
    App.util.toast('已合并回传内容', 'ok');
  }

  async function dismissReverse(itemId) {
    var c = client(); if (!c) return;
    await c.from('shared_item').update({ status: 'superseded' }).eq('id', itemId);
    App.util.toast('已忽略', 'ok');
  }

  /* ---------------- 日志查询 ---------------- */
  async function listLogs(limit) {
    var c = client(); if (!c || !uid()) return [];
    var r = await c.from('share_log').select('*').order('created_at', { ascending: false }).limit(limit || 50);
    if (r.error) { console.warn('[masterHub] listLogs', r.error); return []; }
    return r.data || [];
  }

  /* ---------------- 团队汇总：读取/操作子工作台整档数据 ---------------- */
  // 读某个子工作台的整档数据（依赖 schema.sql 7.10 的 RLS 授权）
  async function fetchMemberData(userId) {
    var c = client(); if (!c || !uid()) return null;
    var r = await c.from('dos_workbench').select('data,updated_at').eq('user_id', userId).maybeSingle();
    if (r.error) { console.warn('[masterHub] fetchMemberData', r.error); return null; }
    return (r.data && r.data.data) || {};
  }

  // 拉取所有子工作台的整档数据（含成员名 / userId / data）
  async function fetchAllMembersData() {
    var subs = await listSubs();
    var out = [];
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i];
      if (s.status && s.status !== 'active') continue;
      var data = await fetchMemberData(s.user_id);
      out.push({ userId: s.user_id, name: s.name || '未命名', data: data || {} });
    }
    return out;
  }

  // 总台对子工作台内容发「标注提示」（只读 + 标注，不直接修改子台数据）
  // targetType: 'teacherMilestone' | 'task' | 'teacher' | ...；targetId: 目标条目 id；note: 标注文字
  async function sendAnnotation(toUserId, targetType, targetId, note) {
    var orgId = await getMyOrgId();
    var c = client();
    if (!c || !orgId) { App.util.toast('请先创建组织', 'warn'); return { ok: false }; }
    note = String(note || '').trim();
    if (!note) { App.util.toast('请填写标注内容', 'warn'); return { ok: false }; }
    var r = await c.from('shared_item').insert({
      org_id: orgId,
      grant_id: null,
      from_user_id: uid(),
      to_user_id: toUserId,
      data_type: 'annotation',
      item_id: String(targetId || ''),
      permission: 'read',
      direction: 'down',
      payload: { targetType: targetType, targetId: targetId, note: note, at: new Date().toISOString() },
      status: 'active'
    });
    if (r.error) { App.util.toast('标注失败：' + (r.error.message || ''), 'warn'); return { ok: false }; }
    await log('annotation_sent', { targetUserId: toUserId, dataType: 'annotation', itemId: targetId, detail: { note: note } });
    App.util.toast('标注已发送给子工作台', 'ok');
    return { ok: true };
  }

  /* ---------------- 对外 ---------------- */
  App.masterHub = {
    ready: ready,
    DATA_TYPES: DATA_TYPES,
    getMyOrg: getMyOrg,
    getMyOrgId: getMyOrgId,
    createOrg: createOrg,
    listSubs: listSubs,
    addSub: addSub,
    setSubRole: setSubRole,
    setSubProjectTags: setSubProjectTags,
    suspendSub: suspendSub,
    removeSub: removeSub,
    listGrants: listGrants,
    createGrant: createGrant,
    updateGrant: updateGrant,
    revokeGrant: revokeGrant,
    publish: publish,
    listOutgoing: listOutgoing,
    listReverse: listReverse,
    mergeReverse: mergeReverse,
    dismissReverse: dismissReverse,
    listLogs: listLogs,
    fetchMemberData: fetchMemberData,
    fetchAllMembersData: fetchAllMembersData,
    sendAnnotation: sendAnnotation,
    // 工具（供视图复用）
    extractItems: extractItems,
    trimPayload: trimPayload
  };
})(window);
