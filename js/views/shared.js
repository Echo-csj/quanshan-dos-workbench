/* ============================================
   views/shared.js — 子工作台「共享数据」
   查看总工作台共享给我的内容；按权限呈现摘要/只读/可编辑；可回传
   ============================================ */
(function () {
  'use strict';
  var App = window.App || (window.App = {});

  var _items = [];
  var _grants = [];
  var _filter = 'tasks';

  App.router.register('/shared', function () {
    var c = document.getElementById('view-container');
    if (!c) return;
    c.innerHTML = '<div class="oa-tip">加载中…</div>';
    loadAll().then(render);
  });

  async function loadAll() {
    if (!App.sharedInbox || !App.sharedInbox.ready()) { _items = []; _grants = []; return; }
    _items = await App.sharedInbox.listIncoming();
    _grants = await App.sharedInbox.listMyGrants();
    App.sharedInbox.clearNew();
  }

  function render() {
    var c = document.getElementById('view-container');
    if (!c) return;
    if (!App.sharedInbox || !App.sharedInbox.ready()) {
      c.innerHTML = '<div class="oa-tip">请先在右下角小组件登录云端同步，才能接收总工作台共享的数据。</div>';
      return;
    }

    var types = (App.masterHub && App.masterHub.DATA_TYPES) || [];
    var used = {};
    _items.forEach(function (it) { used[it.data_type] = (used[it.data_type] || 0) + 1; });
    if (!used[_filter]) _filter = Object.keys(used)[0] || 'tasks';

    var html = '<div class="oa-head">' +
      '<div><h2 class="oa-title">共享数据</h2>' +
      '<div class="oa-sub">来自总工作台 · 你的可见范围由总工作台设定</div></div></div>';

    // 权限概览
    if (_grants.length) {
      html += '<div class="oa-permbar">';
      html += _grants.map(function (g) {
        var t = types.filter(function (x) { return x.v === g.data_type; })[0];
        return '<span class="oa-badge">' + App.util.escapeHtml(t ? t.label : g.data_type) + '：' +
          App.util.escapeHtml(permLabel(g.permission)) +
          (g.allow_reverse ? ' · 可回传' : ' · 只读不回传') + '</span>';
      }).join('');
      html += '</div>';
    }

    // 类型切换
    html += '<div class="oa-tabs">';
    html += Object.keys(used).map(function (k) {
      var t = types.filter(function (x) { return x.v === k; })[0];
      return '<button class="oa-tab' + (k === _filter ? ' active' : '') + '" onclick="App.views.shared.setFilter(\'' + k + '\')">' +
        App.util.escapeHtml(t ? t.label : k) + ' (' + used[k] + ')</button>';
    }).join('');
    html += '</div>';

    if (!_items.length) {
      html += '<div class="oa-tip">暂无共享数据。总工作台给你下发后，这里会实时出现。</div>';
    } else {
      var list = _items.filter(function (x) { return x.data_type === _filter; });
      html += list.map(renderItem).join('');
    }
    c.innerHTML = html;
  }

  function permLabel(p) {
    return p === 'summary' ? '仅摘要' : (p === 'edit' ? '可编辑' : '只读');
  }

  function renderItem(it) {
    var editable = it.permission === 'edit';
    var g = App.sharedInbox.grantFor(it.data_type);
    var canReverse = !!(g && g.allow_reverse);
    var html = '<div class="sh-item">';
    html += '<div class="sh-item-head">' + renderTitle(it) +
      '<span class="oa-badge">' + App.util.escapeHtml(permLabel(it.permission)) + '</span>' +
      (canReverse ? '<span class="oa-badge ok">可回传</span>' : '') +
      '</div>';

    if (it.data_type === 'tasks') html += renderTaskBody(it);
    else html += '<div class="sh-json"><pre>' + App.util.escapeHtml(JSON.stringify(it.payload, null, 2)) + '</pre></div>';

    if (editable && canReverse) {
      html += '<div class="sh-edit">' +
        '<div class="form-row">' +
        '<div class="form-group"><label class="form-label">我的完成状态</label>' +
        '<select class="form-input" id="sh-status-' + it.id + '">' + statusOptions(it.payload && it.payload.status) + '</select></div>' +
        '<div class="form-group"><label class="form-label">备注（可回传说明）</label>' +
        '<input class="form-input" id="sh-note-' + it.id + '" value="' + App.util.escapeAttr((it.payload && it.payload.note) || '') + '"></div>' +
        '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="App.views.shared.reverse(\'' + it.id + '\')">回传给总工作台</button>' +
        '</div>';
    } else if (editable && !canReverse) {
      html += '<div class="oa-hint">你有编辑权限，但总工作台未开启回传，修改不会同步给对方。</div>';
    }
    html += '</div>';
    return html;
  }

  function renderTitle(it) {
    if (it.data_type === 'tasks') return '<strong>' + App.util.escapeHtml((it.payload && it.payload.title) || '（无标题）') + '</strong>';
    return '<strong>' + App.util.escapeHtml(it.item_id || '') + '</strong>';
  }

  function renderTaskBody(it) {
    var p = it.payload || {};
    var html = '<div class="sh-meta">';
    if (p.status) html += '<span>' + App.util.escapeHtml(statusLabel(p.status)) + '</span>';
    if (p.priority) html += '<span>' + App.util.escapeHtml(App.util.priorityLabel(p.priority)) + '</span>';
    if (p.dueDate) html += '<span>截止 ' + App.util.escapeHtml(p.dueDate) + '</span>';
    if (p.assignee) html += '<span>👤 ' + App.util.escapeHtml(p.assignee) + '</span>';
    html += '</div>';
    if (it.permission === 'summary') {
      html += '<div class="oa-hint">摘要视图：明细字段（负责人/备注等）未共享。</div>';
    } else if (p.note) {
      html += '<div class="sh-note">' + App.util.escapeHtml(p.note) + '</div>';
    }
    return html;
  }

  function statusOptions(sel) {
    var opts = [['todo', '待办'], ['doing', '进行中'], ['review', '审阅中'], ['done', '已完成']];
    return opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
  }
  function statusLabel(s) {
    return App.util.statusLabel ? App.util.statusLabel(s) : s;
  }

  /* ---------------- 交互 ---------------- */
  function setFilter(k) { _filter = k; render(); }

  async function reverse(id) {
    var it = _items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var stEl = document.getElementById('sh-status-' + id);
    var ntEl = document.getElementById('sh-note-' + id);
    var patch = {};
    if (stEl) patch.status = stEl.value;
    if (patch.status === 'done') patch.completedAt = new Date().toISOString();
    if (ntEl) patch.note = ntEl.value;
    await App.sharedInbox.reverseItem(id, patch);
    await loadAll();
    render();
  }

  async function openItem(id) {
    await App.sharedInbox.readItem(id);
  }

  App.views = App.views || {};
  App.views.shared = {
    setFilter: setFilter,
    reverse: reverse,
    openItem: openItem
  };
})();
