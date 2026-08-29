/* ============================================
   shared-inbox.js — 子工作台（数据层）
   读取总工作台共享给我的数据 / 查看我的权限 / 编辑并回传
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});
  var cfg = global.APP_CONFIG || {};

  var _incoming = [];
  var _grants = [];
  var _channel = null;
  var _newCount = 0;
  var _listeners = [];

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

  function notify() { _listeners.forEach(function (f) { try { f(_newCount); } catch (e) {} }); }

  /* ---------------- 收到的共享 ---------------- */
  async function listIncoming() {
    var c = client(); if (!c || !uid()) return [];
    var r = await c.from('shared_item')
      .select('*')
      .eq('to_user_id', uid())
      .eq('direction', 'down')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (r.error) { console.warn('[sharedInbox] listIncoming', r.error); return []; }
    _incoming = r.data || [];
    return _incoming;
  }

  /* ---------------- 我的权限 ---------------- */
  async function listMyGrants() {
    var c = client(); if (!c || !uid()) return [];
    var r = await c.from('share_grant').select('*').eq('to_user_id', uid()).eq('active', true);
    if (r.error) { console.warn('[sharedInbox] listMyGrants', r.error); return []; }
    _grants = r.data || [];
    return _grants;
  }

  function grantFor(dataType) {
    var g = _grants.filter(function (x) { return x.data_type === dataType; })[0];
    return g || _grants.filter(function (x) { return x.data_type === '*'; })[0] || null;
  }

  /* ---------------- 打开（记日志） ---------------- */
  async function readItem(id) {
    var c = client(); if (!c || !uid()) return;
    var it = _incoming.filter(function (x) { return x.id === id; })[0];
    try {
      await c.from('share_log').insert({
        actor_user_id: uid(),
        action: 'item_read',
        org_id: it ? it.org_id : null,
        target_user_id: uid(),
        data_type: it ? it.data_type : null,
        item_id: it ? it.item_id : null
      });
    } catch (e) { /* 日志失败不影响使用 */ }
  }

  /* ---------------- 回传（编辑 / 状态） ---------------- */
  async function reverseItem(id, patch) {
    var c = client(); if (!c || !uid()) return;
    var it = _incoming.filter(function (x) { return x.id === id; })[0];
    if (!it) { App.util.toast('未找到该条数据', 'warn'); return; }
    var g = grantFor(it.data_type);
    if (!g || !g.allow_reverse) {
      App.util.toast('总工作台未开启回传，无法提交修改', 'warn');
      return;
    }
    var payload = {};
    Object.keys(patch || {}).forEach(function (k) { payload[k] = patch[k]; });
    if (g.reverse_mode === 'status') {
      // 只允许回传状态类字段
      var allowed = {};
      ['status', 'completedAt', 'progress'].forEach(function (k) {
        if (payload[k] !== undefined) allowed[k] = payload[k];
      });
      // tasks 的状态回传允许带备注说明
      if (payload.note !== undefined) allowed.note = payload.note;
      payload = allowed;
      if (!Object.keys(payload).length) { App.util.toast('当前仅允许回传完成状态', 'warn'); return; }
    }

    var row = {
      org_id: it.org_id,
      grant_id: it.grant_id,
      from_user_id: uid(),
      to_user_id: it.from_user_id,
      data_type: it.data_type,
      item_id: it.item_id,
      permission: it.permission,
      direction: 'up',
      reply_to_id: it.id,
      payload: payload,
      status: 'active'
    };
    var r = await c.from('shared_item').insert(row);
    if (r.error) { App.util.toast('回传失败：' + (r.error.message || ''), 'warn'); return; }
    try {
      await c.from('share_log').insert({
        org_id: it.org_id, actor_user_id: uid(), action: 'item_reversed',
        target_user_id: it.from_user_id, data_type: it.data_type, item_id: it.item_id,
        detail: { payload: payload }
      });
    } catch (e) {}
    App.util.toast('已回传给总工作台', 'ok');
  }

  /* ---------------- 实时订阅：总工作台下发新数据 ---------------- */
  function subscribeRealtime() {
    var c = client(); var me = uid();
    if (!c || !me) return;
    if (_channel) { try { c.removeChannel(_channel); } catch (e) {} _channel = null; }
    _channel = c.channel('shared-inbox:' + me)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'shared_item', filter: 'to_user_id=eq.' + me
      }, function () {
        _newCount += 1;
        notify();
        App.util.toast('收到总工作台共享的新数据', 'ok');
        if (App.router && App.router.getCurrentRoute && App.router.getCurrentRoute() === '/shared') {
          App.router.resolve();
        }
      })
      .subscribe();
  }

  function clearNew() { _newCount = 0; notify(); }

  if (App.sync && App.sync.onStatus) {
    App.sync.onStatus(function (s) {
      if (s === 'ok') { subscribeRealtime(); listIncoming(); listMyGrants(); }
    });
  }

  App.sharedInbox = {
    ready: ready,
    listIncoming: listIncoming,
    listMyGrants: listMyGrants,
    grantFor: grantFor,
    readItem: readItem,
    reverseItem: reverseItem,
    subscribeRealtime: subscribeRealtime,
    clearNew: clearNew,
    getNew: function () { return _newCount; },
    onNew: function (f) { _listeners.push(f); }
  };
})(window);
