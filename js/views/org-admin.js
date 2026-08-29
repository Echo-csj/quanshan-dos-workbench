/* ============================================
   views/org-admin.js — 总工作台「子工作台管理」
   子工作台列表 / 纳管 / 查看内容 / 标注提示 / 日志
   ============================================ */
(function () {
  'use strict';
  var App = window.App || (window.App = {});
  var esc = function (s) { return App.util.escapeHtml ? App.util.escapeHtml(s) : (s == null ? '' : String(s)); };

  var _org = null;
  var _subs = [];
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
    _org = null; _subs = []; _logs = []; _profiles = {};
    if (!App.masterHub || !App.masterHub.ready()) return;
    _org = await App.masterHub.getMyOrg();
    if (!_org) return;
    _subs = await App.masterHub.listSubs();
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
      '<div><h2 class="oa-title">' + esc(_org.name) + '</h2>' +
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
    if (_selected) setTimeout(function () { loadMemberView(); }, 0);
  }

  function renderNoOrg() {
    return '<div class="oa-tip">' +
      '<p><strong>还没有创建组织。</strong></p>' +
      '<p>组织就是你的「总工作台」，创建后即可把下属纳管为子工作台，查看他们的内容并发送标注提示。</p>' +
      '<button class="btn btn-primary" onclick="App.views.orgAdmin.openCreateOrg()">创建组织</button>' +
      '</div>';
  }

  function renderSubItem(s) {
    var p = _profiles[s.user_id] || {};
    var active = s.user_id === _selected ? ' active' : '';
    return '<div class="oa-sub-item' + active + '" onclick="App.views.orgAdmin.select(\'' + s.user_id + '\')">' +
      '<div class="oa-sub-name">' + esc(s.name || (p.email || '子工作台')) + '</div>' +
      '<div class="oa-sub-mail">' + esc(p.email || s.user_id) + '</div>' +
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
      '<div><strong>' + esc(s.name || (p.email || '')) + '</strong>' +
      '<div class="oa-sub-mail">' + esc(p.email || s.user_id) + '</div></div>' +
      '<div class="oa-detail-actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="App.views.orgAdmin.toggleSuspend(\'' + s.id + '\',' + (s.status === 'suspended') + ')">' + (s.status === 'suspended' ? '启用' : '停用') + '</button>' +
      '<button class="btn btn-danger btn-sm" onclick="App.views.orgAdmin.removeSub(\'' + s.id + '\')">移除</button>' +
      '</div></div>';

    html += '<div class="oa-section-title">查看子工作台内容</div>';
    html += '<div id="oa-view-content" class="oa-view-content"><div class="oa-hint">加载中…</div></div>';

    html += '<div class="oa-section-title">标注提示</div>';
    html += '<div class="oa-annotate">' +
      '<textarea class="form-input" id="oa-anno-note" rows="2" placeholder="给该子工作台发一条提示（只提示，不修改其数据）"></textarea>' +
      '<button class="btn btn-primary btn-sm" onclick="App.views.orgAdmin.sendAnno()">发送标注</button>' +
      '</div>';

    return html;
  }

  // 查看子工作台内容（读其云端整档数据，展示摘要）
  async function loadMemberView() {
    var box = document.getElementById('oa-view-content');
    if (!box || !_selected) return;
    var data = await App.masterHub.fetchMemberData(_selected);
    if (!data || !Object.keys(data).length) {
      box.innerHTML = '<div class="oa-hint">该子工作台尚未登录云端同步，暂无数据可查看。</div>';
      return;
    }
    var teachers = data.teachers || [];
    var tasks = data.tasks || [];
    var pendingTasks = tasks.filter(function (t) { return t.status !== 'done' && !t.archived; }).length;
    var ms = data.teacherMilestones || [];
    var pendingMs = ms.filter(function (m) { return m.status !== 'done'; }).length;
    var tl = data.timeline || {};
    var nodeCount = ((tl.fixedNodes || []).concat(tl.customNodes || [])).length;
    var reports = data.reports || {};
    var monthCount = Object.keys(reports.monthly || {}).length;

    var html = '<div class="oa-view-stats">' +
      stat('教师', teachers.length) + stat('待办任务', pendingTasks) + stat('待处理提醒', pendingMs) +
      stat('时间轴节点', nodeCount) + stat('数据月份', monthCount) +
      '</div>';

    var subTasks = tasks.filter(function (t) { return t.source === 'sub'; });
    html += '<div class="oa-section-title">子台自建任务（' + subTasks.length + '）</div>';
    if (!subTasks.length) html += '<div class="oa-hint">暂无</div>';
    else {
      html += '<div class="oa-items">' + subTasks.slice(0, 20).map(function (t) {
        return '<div class="oa-item"><span class="oa-typ">' + (t.status === 'done' ? '已完成' : '待处理') + '</span>' +
          esc(t.title || '') + (t.dueDate ? ' <span class="muted">· ' + t.dueDate + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }

    var pendingMsList = ms.filter(function (m) { return m.status !== 'done'; });
    html += '<div class="oa-section-title">待处理转正/工龄提醒（' + pendingMsList.length + '）</div>';
    if (!pendingMsList.length) html += '<div class="oa-hint">暂无</div>';
    else {
      html += '<div class="oa-items">' + pendingMsList.slice(0, 20).map(function (m) {
        return '<div class="oa-item"><span class="oa-typ">' + esc(m.label || '') + '</span>' +
          esc(m.teacherName || '') + ' ' + esc(m.title || '') + '</div>';
      }).join('') + '</div>';
    }

    box.innerHTML = html;
  }

  function stat(label, n) {
    return '<div class="oa-stat"><div class="oa-stat-n">' + n + '</div><div class="oa-stat-l">' + label + '</div></div>';
  }

  function renderLogs() {
    if (!_logs.length) return '';
    var html = '<div class="oa-section-title" style="margin-top:26px">操作日志</div><div class="oa-logs">';
    html += _logs.slice(0, 30).map(function (l) {
      return '<div class="oa-log"><span class="oa-log-time">' + esc(fmt(l.created_at)) + '</span>' +
        '<span class="oa-log-act">' + esc(actionLabel(l.action)) + '</span>' +
        '<span class="oa-log-detail">' + esc(logDetail(l)) + '</span></div>';
    }).join('');
    html += '</div>';
    return html;
  }

  /* ---------------- 小工具 ---------------- */
  function actionLabel(a) {
    var m = {
      org_created: '创建组织', member_added: '纳管子工作台', member_suspended: '停用/移除子工作台',
      annotation_sent: '发送标注', item_read: '查看数据', item_edited: '编辑/合并'
    };
    return m[a] || a;
  }
  function logDetail(l) {
    var d = l.detail || {};
    if (l.action === 'member_added') return (d.name || '') + ' ' + (d.email || '');
    if (l.action === 'annotation_sent') return (d.note || '');
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
        '<div class="form-group"><label class="form-label">子工作台名称（＝学科组，须与「教师管理」科组一致）</label>' +
        '<input class="form-input" id="oa-sub-name" placeholder="如：数学 / 英语 / 文综 / 理综"></div>' +
        '<div class="oa-hint">账号创建：Supabase 控制台 → Authentication → Users → Add user（勾选 Auto Confirm User）。名称须为学科组名称（数学/英语/文综/理综，可带「科组/组」后缀），子台据此筛选本科组教师与转正提醒；同时作为任务归属标识。</div>' +
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

  async function sendAnno() {
    if (!_selected) return;
    var noteEl = document.getElementById('oa-anno-note');
    var note = noteEl ? noteEl.value.trim() : '';
    if (!note) { App.util.toast('请填写标注内容', 'warn'); return; }
    var r = await App.masterHub.sendAnnotation(_selected, 'general', '', note);
    if (r && r.ok) { if (noteEl) noteEl.value = ''; loadAll().then(render); }
  }

  async function toggleSuspend(memberId, isSuspended) {
    await App.masterHub.suspendSub(memberId, !isSuspended);
    await loadAll(); render();
  }

  async function removeSub(memberId) {
    App.util.modal({
      title: '移除子工作台',
      content: '移除后该成员将不再是你的子工作台，你也不再能查看其内容。确定移除吗？',
      confirmText: '移除', confirmStyle: 'danger',
      onConfirm: function (close) {
        App.masterHub.removeSub(memberId).then(function () { close(); loadAll().then(render); });
      }
    });
  }

  App.views = App.views || {};
  App.views.orgAdmin = {
    openCreateOrg: openCreateOrg,
    openAddSub: openAddSub,
    select: select,
    sendAnno: sendAnno,
    toggleSuspend: toggleSuspend,
    removeSub: removeSub
  };
})();
