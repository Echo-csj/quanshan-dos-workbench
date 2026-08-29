/* ============================================
   views/org-admin.js — 总工作台「子工作台管理」
   子工作台列表 / 纳管 / 共享配置 / 下发 / 回传处理 / 日志
   ============================================ */
(function () {
  'use strict';
  var App = window.App || (window.App = {});

  var PERMISSIONS = [
    { v: '',         label: '不共享' },
    { v: 'summary',  label: '仅摘要' },
    { v: 'read',     label: '只读' },
    { v: 'edit',     label: '可编辑' }
  ];

  var _org = null;
  var _subs = [];
  var _grants = [];
  var _outgoing = [];
  var _reverse = [];
  var _logs = [];
  var _profiles = {};
  var _selected = null;

  App.router.register('/org', function () {
    var c = document.getElementById('view-container');
    if (!c) return;
    c.innerHTML = '<div class="oa-tip">加载中…</div>';
    loadAll().then(render);
  });

  /* ---------------- 数据 ---------------- */
  async function loadAll() {
    _org = null; _subs = []; _grants = []; _outgoing = []; _reverse = []; _logs = []; _profiles = {};
    if (!App.masterHub || !App.masterHub.ready()) return;
    _org = await App.masterHub.getMyOrg();
    if (!_org) return;
    _subs = await App.masterHub.listSubs();
    _grants = await App.masterHub.listGrants();
    _outgoing = await App.masterHub.listOutgoing();
    _reverse = await App.masterHub.listReverse();
    _logs = await App.masterHub.listLogs(60);
    _profiles = await loadProfiles(_subs.map(function (s) { return s.user_id; }));
    var still = _subs.filter(function (s) { return s.user_id === _selected; })[0];
    if (!still) _selected = _subs.length ? _subs[0].user_id : null;
  }

  async function loadProfiles(ids) {
    var c = App.sync && App.sync.getClient ? App.sync.getClient() : null;
    if (!c || !ids.length) return {};
    try {
      var r = await c.from('profile').select('user_id,email,name').in('user_id', ids);
      var map = {};
      (r.data || []).forEach(function (p) { map[p.user_id] = p; });
      return map;
    } catch (e) { return {}; }
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var c = document.getElementById('view-container');
    if (!c) return;
    if (!App.masterHub || !App.masterHub.ready()) {
      c.innerHTML = '<div class="oa-tip">请先在右下角小组件登录云端同步，再使用子工作台管理。</div>';
      return;
    }
    if (!_org) { c.innerHTML = renderNoOrg(); return; }

    var html = '';
    html += '<div class="oa-head">' +
      '<div><h2 class="oa-title">' + App.util.escapeHtml(_org.name) + '</h2>' +
      '<div class="oa-sub">共 ' + _subs.length + ' 个子工作台 · 子工作台之间互相不可见</div></div>' +
      '<button class="btn btn-primary" onclick="App.views.orgAdmin.openAddSub()">+ 纳管子工作台</button>' +
      '</div>';

    if (!_subs.length) {
      html += '<div class="oa-tip">还没有子工作台。点右上角「纳管子工作台」，输入下属的登录邮箱即可。</div>';
    } else {
      html += '<div class="oa-layout">';
      html += '<div class="oa-list">' + _subs.map(renderSubItem).join('') + '</div>';
      html += '<div class="oa-detail">' + renderDetail() + '</div>';
      html += '</div>';
    }
    html += renderLogs();
    c.innerHTML = html;
  }

  function renderNoOrg() {
    return '<div class="oa-tip">' +
      '<p><strong>还没有创建组织。</strong></p>' +
      '<p>组织就是你的「总工作台」，创建后即可把下属纳管为子工作台并向他们共享数据。</p>' +
      '<button class="btn btn-primary" onclick="App.views.orgAdmin.openCreateOrg()">创建组织</button>' +
      '</div>';
  }

  function renderSubItem(s) {
    var p = _profiles[s.user_id] || {};
    var active = s.user_id === _selected ? ' active' : '';
    var nOut = _outgoing.filter(function (x) { return x.to_user_id === s.user_id && x.status === 'active'; }).length;
    var nRev = _reverse.filter(function (x) { return x.from_user_id === s.user_id && x.status === 'active'; }).length;
    var badge = nRev ? '<span class="oa-badge warn">回传 ' + nRev + '</span>' : '';
    return '<div class="oa-sub-item' + active + '" onclick="App.views.orgAdmin.select(\'' + s.user_id + '\')">' +
      '<div class="oa-sub-name">' + App.util.escapeHtml(s.name || (p.email || '子工作台')) + '</div>' +
      '<div class="oa-sub-mail">' + App.util.escapeHtml(p.email || s.user_id) + '</div>' +
      '<div class="oa-sub-meta">已共享 ' + nOut + ' 条 ' + badge + '</div>' +
      (s.status === 'suspended' ? '<span class="oa-badge">已停用</span>' : '') +
      '</div>';
  }

  function renderDetail() {
    if (!_selected) return '<div class="oa-tip">请选择左侧的子工作台</div>';
    var s = _subs.filter(function (x) { return x.user_id === _selected; })[0];
    if (!s) return '';
    var p = _profiles[s.user_id] || {};
    var html = '';

    html += '<div class="oa-detail-head">' +
      '<div><strong>' + App.util.escapeHtml(s.name || (p.email || '')) + '</strong>' +
      '<div class="oa-sub-mail">' + App.util.escapeHtml(p.email || s.user_id) + '</div></div>' +
      '<div class="oa-detail-actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="App.views.orgAdmin.toggleSuspend(\'' + s.id + '\',' + (s.status === 'suspended') + ')">' + (s.status === 'suspended' ? '启用' : '停用') + '</button>' +
      '<button class="btn btn-danger btn-sm" onclick="App.views.orgAdmin.removeSub(\'' + s.id + '\')">移除</button>' +
      '</div></div>';

    html += '<div class="oa-section-title">共享内容配置</div>';
    html += '<table class="oa-table"><tr><th>数据类型</th><th>可见范围</th><th>允许回传</th><th>回传粒度</th></tr>';
    App.masterHub.DATA_TYPES.forEach(function (t) {
      var g = _grants.filter(function (x) { return x.to_user_id === s.user_id && x.data_type === t.v && x.active; })[0];
      var perm = g ? g.permission : '';
      var rev = g ? !!g.allow_reverse : false;
      var mode = g && g.reverse_mode ? g.reverse_mode : 'status';
      html += '<tr>' +
        '<td>' + App.util.escapeHtml(t.label) + '</td>' +
        '<td><select class="oa-select" id="oa-perm-' + t.v + '">' + permOptions(perm) + '</select></td>' +
        '<td><input type="checkbox" id="oa-rev-' + t.v + '"' + (rev ? ' checked' : '') + '></td>' +
        '<td><select class="oa-select" id="oa-revmode-' + t.v + '">' +
          '<option value="status"' + (mode === 'status' ? ' selected' : '') + '>仅状态</option>' +
          '<option value="full"' + (mode === 'full' ? ' selected' : '') + '>完整编辑</option>' +
        '</select></td>' +
        '</tr>';
    });
    html += '</table>';
    html += '<div class="oa-actions"><button class="btn btn-primary" onclick="App.views.orgAdmin.saveConfig()">保存并立即下发</button>' +
      '<span class="oa-hint">保存后按配置把当前数据下发给该子工作台；选「不共享」则收回。</span></div>';

    // 已下发
    var outs = _outgoing.filter(function (x) { return x.to_user_id === s.user_id; });
    html += '<div class="oa-section-title">已下发（' + outs.length + '）</div>';
    if (!outs.length) html += '<div class="oa-hint">暂无</div>';
    else {
      html += '<div class="oa-items">' + outs.slice(0, 30).map(function (x) {
        return '<div class="oa-item"><span class="oa-typ">' + App.util.escapeHtml(typeLabel(x.data_type)) + '</span>' +
          App.util.escapeHtml(x.payload && x.payload.title ? x.payload.title : (x.item_id || '')) +
          ' <span class="oa-badge">' + App.util.escapeHtml(x.permission) + '</span></div>';
      }).join('') + '</div>';
    }

    // 回传
    var revs = _reverse.filter(function (x) { return x.from_user_id === s.user_id && x.status === 'active'; });
    html += '<div class="oa-section-title">收到回传（' + revs.length + '）</div>';
    if (!revs.length) html += '<div class="oa-hint">暂无</div>';
    else {
      html += '<div class="oa-items">' + revs.map(function (x) {
        return '<div class="oa-item">' +
          '<span class="oa-typ">' + App.util.escapeHtml(typeLabel(x.data_type)) + '</span>' +
          App.util.escapeHtml(x.item_id || '') +
          '<div class="oa-item-body"><pre>' + App.util.escapeHtml(JSON.stringify(x.payload, null, 2)) + '</pre></div>' +
          '<div class="oa-item-actions">' +
          '<button class="btn btn-primary btn-sm" onclick="App.views.orgAdmin.merge(\'' + x.id + '\')">合并到我的数据</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="App.views.orgAdmin.dismiss(\'' + x.id + '\')">忽略</button>' +
          '</div></div>';
      }).join('') + '</div>';
    }
    return html;
  }

  function renderLogs() {
    if (!_logs.length) return '';
    var html = '<div class="oa-section-title" style="margin-top:26px">操作日志</div><div class="oa-logs">';
    html += _logs.slice(0, 30).map(function (l) {
      return '<div class="oa-log"><span class="oa-log-time">' + App.util.escapeHtml(fmt(l.created_at)) + '</span>' +
        '<span class="oa-log-act">' + App.util.escapeHtml(actionLabel(l.action)) + '</span>' +
        (l.data_type ? '<span class="oa-typ">' + App.util.escapeHtml(typeLabel(l.data_type)) + '</span>' : '') +
        '<span class="oa-log-detail">' + App.util.escapeHtml(logDetail(l)) + '</span></div>';
    }).join('');
    html += '</div>';
    return html;
  }

  /* ---------------- 小工具 ---------------- */
  function permOptions(sel) {
    return PERMISSIONS.map(function (p) {
      return '<option value="' + p.v + '"' + (p.v === sel ? ' selected' : '') + '>' + p.label + '</option>';
    }).join('');
  }
  function typeLabel(v) {
    var t = (App.masterHub.DATA_TYPES || []).filter(function (x) { return x.v === v; })[0];
    return t ? t.label : (v || '');
  }
  function actionLabel(a) {
    var m = {
      org_created: '创建组织', member_added: '纳管子工作台', member_suspended: '停用/移除子工作台',
      grant_created: '创建共享规则', grant_updated: '更新共享规则', grant_revoked: '撤销共享',
      item_shared: '下发数据', item_read: '查看数据', item_edited: '编辑/合并',
      item_reversed: '子工作台回传', item_revoked: '收回数据'
    };
    return m[a] || a;
  }
  function logDetail(l) {
    var d = l.detail || {};
    if (l.action === 'item_shared') return '下发 ' + (d.count || 0) + ' 条（' + (d.permission || '') + '）';
    if (l.action === 'member_added') return (d.name || '') + ' ' + (d.email || '');
    if (l.action === 'grant_created') return (d.permission || '') + (d.allowReverse ? ' · 允许回传' : '');
    if (l.action === 'item_reversed') return JSON.stringify(d.payload || {});
    return '';
  }
  function fmt(s) { return s ? String(s).slice(0, 19).replace('T', ' ') : ''; }

  /* ---------------- 交互 ---------------- */
  function openCreateOrg() {
    App.util.modal({
      title: '创建组织（总工作台）',
      content: '<div class="form-group"><label class="form-label">组织名称</label>' +
        '<input class="form-input" id="oa-org-name" placeholder="如：状元港教学团队"></div>' +
        '<div id="oa-org-err" class="oa-err" style="display:none"></div>',
      confirmText: '创建',
      onConfirm: function (close) {
        var v = document.getElementById('oa-org-name').value.trim();
        if (!v) { App.util.toast('请填写组织名称', 'warn'); return; }
        var errEl = document.getElementById('oa-org-err');
        if (errEl) errEl.style.display = 'none';
        App.masterHub.createOrg(v).then(function (r) {
          if (r && r.ok) { close(); loadAll().then(render); }
          else if (errEl) {
            errEl.textContent = '创建失败：' + (r && r.error ? r.error : '未知错误');
            errEl.style.display = '';
          }
        });
      }
    });
  }

  function openAddSub() {
    App.util.modal({
      title: '纳管子工作台',
      content: '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="form-group"><label class="form-label">下属的登录邮箱</label>' +
        '<input class="form-input" id="oa-sub-email" type="email" placeholder="需先在 Supabase 建好该账号"></div>' +
        '<div class="form-group"><label class="form-label">显示名称</label>' +
        '<input class="form-input" id="oa-sub-name" placeholder="如：泉山校区"></div>' +
        '<div class="oa-hint">账号创建：Supabase 控制台 → Authentication → Users → Add user（勾选 Auto Confirm User）。</div>' +
        '</div>',
      confirmText: '纳管',
      onConfirm: function (close) {
        var e = document.getElementById('oa-sub-email').value.trim();
        var n = document.getElementById('oa-sub-name').value.trim();
        if (!e) { App.util.toast('请填写邮箱', 'warn'); return; }
        App.masterHub.addSub(e, n).then(function (r) { if (r) { close(); loadAll().then(render); } });
      }
    });
  }

  function select(userId) { _selected = userId; render(); }

  async function saveConfig() {
    if (!_selected) return;
    var types = App.masterHub.DATA_TYPES || [];
    for (var i = 0; i < types.length; i++) {
      var t = types[i].v;
      var permEl = document.getElementById('oa-perm-' + t);
      var revEl = document.getElementById('oa-rev-' + t);
      var modeEl = document.getElementById('oa-revmode-' + t);
      var perm = permEl ? permEl.value : '';
      var allowRev = revEl ? revEl.checked : false;
      var mode = modeEl ? modeEl.value : 'status';
      var existing = _grants.filter(function (g) {
        return g.to_user_id === _selected && g.data_type === t && g.active;
      })[0];
      if (!perm) {
        if (existing) await App.masterHub.revokeGrant(existing.id);
        continue;
      }
      var patch = { permission: perm, allow_reverse: allowRev, reverse_mode: allowRev ? mode : null, active: true };
      if (existing) {
        await App.masterHub.updateGrant(existing.id, patch);
        await App.masterHub.publish(existing.id);
      } else {
        var g = await App.masterHub.createGrant(_selected, { dataType: t, permission: perm, allowReverse: allowRev, reverseMode: mode });
        if (g) await App.masterHub.publish(g.id);
      }
    }
    await loadAll();
    render();
  }

  async function toggleSuspend(memberId, isSuspended) {
    await App.masterHub.suspendSub(memberId, !isSuspended);
    await loadAll(); render();
  }

  async function removeSub(memberId) {
    App.util.modal({
      title: '移除子工作台',
      content: '移除后该成员将不再收到你共享的数据（已下发数据会同步收回）。确定移除吗？',
      confirmText: '移除', confirmStyle: 'danger',
      onConfirm: function (close) {
        App.masterHub.removeSub(memberId).then(function () { close(); loadAll().then(render); });
      }
    });
  }

  async function merge(itemId) {
    await App.masterHub.mergeReverse(itemId);
    await loadAll(); render();
  }
  async function dismiss(itemId) {
    await App.masterHub.dismissReverse(itemId);
    await loadAll(); render();
  }

  App.views = App.views || {};
  App.views.orgAdmin = {
    openCreateOrg: openCreateOrg,
    openAddSub: openAddSub,
    select: select,
    saveConfig: saveConfig,
    toggleSuspend: toggleSuspend,
    removeSub: removeSub,
    merge: merge,
    dismiss: dismiss
  };
})();
