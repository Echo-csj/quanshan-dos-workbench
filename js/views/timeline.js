/* ============================================
   timeline.js — 时间轴视图
   周/月工作节律时间线
   ============================================ */

(function() {

  App.router.register('/timeline', function() {
    var container = document.getElementById('view-container');
    if (!container) return;

    var today = new Date();
    var anchor = getAnchor();

    var data = App.store.getData();
    var fixedNodes = (data.timeline && data.timeline.fixedNodes) || [];
    var customNodes = (data.timeline && data.timeline.customNodes) || [];
    var allNodes = fixedNodes.concat(customNodes);

    // Tab 切换状态
    var viewMode = localStorage.getItem('timeline_view') || 'week';

    var weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    var html = '';

    // --- 视图切换 Tabs ---
    html += '<div class="timeline-toolbar">';
    html += '<div class="tabs" style="margin-bottom:0">';
    html += '<button class="tab ' + (viewMode === 'week' ? 'active' : '') + '" onclick="App.views.timeline.switchView(\'week\')">📅 周视图</button>';
    html += '<button class="tab ' + (viewMode === 'month' ? 'active' : '') + '" onclick="App.views.timeline.switchView(\'month\')">📆 月视图</button>';
    html += '</div>';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.timeline.openNodeModal()">' + App.util.svgIcon('plus', 15) + ' 新建节点</button>';
    html += '</div>';
    html += '<p style="font-size:12px;color:var(--text-faint);margin:0 0 12px">💡 点击卡片可编辑<b>类型/颜色</b>，<b>拖动卡片</b>到其它星期列即可调整时间位置（实时生效）。</p>';

    if (viewMode === 'week') {
      html += renderWeekView(anchor, today, allNodes, weekdayNames);
    } else {
      html += renderMonthView(anchor, today, allNodes, fixedNodes);
    }

    container.innerHTML = html;
  });

  function renderWeekView(anchor, today, allNodes, weekdayNames) {
    var html = '';

    // 计算本周起始日（周一）
    var startOfWeek = new Date(anchor);
    var dayDiff = anchor.getDay() === 0 ? 6 : anchor.getDay() - 1;
    startOfWeek.setDate(anchor.getDate() - dayDiff);

    html += '<div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">';
    html += '<span style="font-size:13px;color:var(--text-muted)">' + App.util.formatDate(startOfWeek, 'MM/DD') + ' ~ ' + App.util.formatDate(new Date(startOfWeek.getTime() + 6*86400000), 'MM/DD') + '</span>';
    html += '<div style="display:flex;gap:6px">';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.timeline.shiftWeek(-1)">← 上周</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.timeline.shiftWeek(0)">今天</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.timeline.shiftWeek(1)">下周 →</button>';
    html += '</div></div>';

    // 7列时间线
    html += '<div class="timeline-week">';
    for (var d = 0; d < 7; d++) {
      var date = new Date(startOfWeek.getTime() + d * 86400000);
      var dateStr = App.util.formatDate(date, 'YYYY-MM-DD');
      var isToday = dateStr === App.util.formatDate(today, 'YYYY-MM-DD');

      html += '<div class="timeline-day' + (isToday ? ' today' : '') + '" ondragover="App.views.timeline.onDragOver(event)" ondragleave="App.views.timeline.onDragLeave(event)" ondrop="App.views.timeline.onDrop(event, ' + date.getDay() + ')">';
      html += '<div class="timeline-day-header">';
      html += '<span>' + weekdayNames[date.getDay()] + '</span>';
      html += '<span class="mono" style="font-size:11px;color:var(--text-faint)">' + (date.getMonth() + 1) + '/' + date.getDate() + '</span>';
      html += '</div>';

      // 渲染该日的节点（含"最后一周周三"类月度节点）
      var dayNodes = allNodes.filter(function(n) {
        if (n.type === 'monthly') {
          if (n.weekday != null && n.weekday === date.getDay()) {
            if (n.which === 'last') return App.util.isLastWeekOfMonth(date);
            if (n.cron === 'last-week-of-month') return App.util.isLastWeekOfMonth(date);
          }
          return false;
        }
        return n.weekday === date.getDay();
      });
      dayNodes.forEach(function(node) {
        var nodeClass = node.type === 'fixed' ? 'node-fixed' : (node.type === 'monthly' ? 'node-monthly' : 'node-custom');
        var colorCls = node.color ? ' nl-' + node.color : '';
        var colorAttr = node.color ? ' data-color="' + App.util.escapeAttr(node.color) + '"' : '';
        var draggable = (node.type === 'monthly' && node.weekday == null) ? '' : ' draggable="true" ondragstart="App.views.timeline.onDragStart(event, \'' + node.id + '\')"';
        html += '<div class="timeline-node ' + nodeClass + colorCls + '"' + colorAttr + draggable + ' title="点击编辑 · 拖动可改星期" onclick="App.views.timeline.openNodeModal(\'' + node.id + '\')">';
        html += '<strong>' + App.util.escapeHtml(node.title) + '</strong>';
        if (node.time) { html += '<span class="mono" style="margin-left:auto;font-size:10px">' + node.time + '</span>'; }
        html += '<span class="node-edit-hint">✎</span>';
        html += '</div>';
        if (node.note) {
          html += '<p style="font-size:11px;color:var(--text-faint);margin:2px 0 0 8px;line-height:1.4">' + App.util.escapeHtml(App.util.truncate(node.note, 50)) + '</p>';
        }
      });

      html += '</div>'; // .timeline-day
    }
    html += '</div>'; // .timeline-week

    // 月度节点提示区
    var monthlyNodes = allNodes.filter(function(n) { return n.type === 'monthly'; });
    if (monthlyNodes.length > 0) {
      html += '<div class="card" style="margin-top:18px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('clock', 18) + '月度周期节点</h3></div>';
      monthlyNodes.forEach(function(node) {
        html += '<div class="timeline-node node-monthly' + (node.color ? ' nl-' + node.color : '') + '"' + (node.color ? ' data-color="' + App.util.escapeAttr(node.color) + '"' : '') + ' style="margin-bottom:6px;cursor:pointer" title="点击编辑" onclick="App.views.timeline.openNodeModal(\'' + node.id + '\')">';
        html += '<strong>' + App.util.escapeHtml(node.title) + '</strong>';
        html += '<span style="font-size:11px;color:var(--warn-text);margin-left:8px">' + (node.cron || '') + '</span>';
        html += '<span class="node-edit-hint" style="margin-left:auto">✎</span>';
        html += '</div>';
        if (node.note) {
          html += '<p style="font-size:12px;color:var(--text-muted);margin-top:4px">' + App.util.escapeHtml(node.note) + '</p>';
        }
      });
      html += '</div>';
    }

    return html;
  }

  function renderMonthView(anchor, today, allNodes, fixedNodes) {
    var year = anchor.getFullYear();
    var month = anchor.getMonth();
    var firstDay = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0);
    var startPad = firstDay.getDay(); // 0=Sunday
    var totalDays = lastDay.getDate();

    var html = '';
    html += '<div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.timeline.shiftMonth(-1)">← 上月</button>';
    html += '<span style="font-size:18px;font-weight:600">' + year + ' 年 ' + (month + 1) + ' 月</span>';
    html += '<div style="display:flex;gap:6px">';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.timeline.shiftMonth(0)">本月</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.timeline.shiftMonth(1)">下月 →</button>';
    html += '</div></div>';

    // 星期表头
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border-radius:var(--radius);overflow:hidden">';
    ['日', '一', '二', '三', '四', '五', '六'].forEach(function(d) {
      html += '<div style="background:var(--surface-2);padding:8px;text-align:center;font-size:11px;font-weight:600;color:var(--text-muted)">' + d + '</div>';
    });

    // 空白填充
    for (var p = 0; p < startPad; p++) {
      html += '<div style="background:var(--bg);min-height:70px;padding:4px"></div>';
    }

    // 日期格子
    for (var day = 1; day <= totalDays; day++) {
      var d = new Date(year, month, day);
      var isToday = App.util.formatDate(d, 'YYYY-MM-DD') === App.util.formatDate(today, 'YYYY-MM-DD');
      var dateStr = App.util.formatDate(d, 'YYYY-MM-DD');

      // 找到这天的固定节点（含"最后一周周三"类月度节点）
      var dayFixedNodes = allNodes.filter(function(n) {
        if (n.type === 'monthly') {
          if (n.weekday != null && n.weekday === d.getDay() && n.which === 'last') {
            return App.util.isLastWeekOfMonth(d);
          }
          return false;
        }
        return n.weekday === d.getDay();
      });

      html += '<div class="tl-month-cell" style="background:' + (isToday ? 'var(--accent-soft)' : 'var(--bg)') + ';min-height:70px;padding:4px 6px;position:relative" ondragover="App.views.timeline.onDragOver(event)" ondragleave="App.views.timeline.onDragLeave(event)" ondrop="App.views.timeline.onDrop(event, ' + d.getDay() + ')">';
      html += '<span style="font-size:12px;font-weight:' + (isToday ? '700;color:var(--accent)' : '500') + '">' + day + '</span>';

      if (dayFixedNodes.length > 0) {
        dayFixedNodes.forEach(function(n) {
          var colorCls = n.color ? ' nl-' + n.color : '';
          var colorAttr = n.color ? ' data-color="' + App.util.escapeAttr(n.color) + '"' : '';
          html += '<div class="tl-month-chip' + colorCls + '"' + colorAttr + ' draggable="true" ondragstart="App.views.timeline.onDragStart(event, \'' + n.id + '\')" onclick="App.views.timeline.openNodeModal(\'' + n.id + '\')" title="' + App.util.escapeAttr(n.title) + ' · 点击编辑/拖动改星期">' + App.util.escapeHtml(n.title) + '</div>';
        });
      }

      html += '</div>';
    }

    html += '</div>'; // grid

    // 月度节点列表
    var monthlyNodes = allNodes.filter(function(n) { return n.type === 'monthly'; });
    if (monthlyNodes.length > 0) {
      html += '<div class="card" style="margin-top:18px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('clock', 18) + '月度周期任务</h3></div>';
      monthlyNodes.forEach(function(node) {
        var rowColorCls = node.color ? ' nl-' + node.color : '';
        html += '<div class="' + rowColorCls.trim() + '"' + (node.color ? ' data-color="' + App.util.escapeAttr(node.color) + '"' : '') + ' style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;cursor:pointer' + (node.color ? ';background:var(--nc-bg)' : '') + '" title="点击编辑" onclick="App.views.timeline.openNodeModal(\'' + node.id + '\')">';
        html += '<span class="status-dot" style="background:' + (node.color ? 'var(--nc)' : 'var(--warn)') + '"></span>';
        html += '<div><strong style="font-size:13px">' + App.util.escapeHtml(node.title) + '</strong>';
        if (node.note) { html += '<p style="font-size:11px;color:var(--text-muted);margin-top:2px">' + App.util.escapeHtml(node.note) + '</p>'; }
        html += '</div>';
        html += '<span class="node-edit-hint" style="margin-left:auto">✎</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  /* ---------------- 节点编辑 ---------------- */
  var PALETTE = [
    { key: 'indigo', name: '靛蓝' }, { key: 'blue', name: '蓝' }, { key: 'green', name: '绿' },
    { key: 'amber', name: '琥珀' }, { key: 'red', name: '红' }, { key: 'purple', name: '紫' },
    { key: 'pink', name: '粉' }, { key: 'teal', name: '青' }
  ];
  function getAllNodes() {
    return (App.store.get('timeline.fixedNodes') || []).concat(App.store.get('timeline.customNodes') || []);
  }

  function openNodeModal(id) {
    var isEdit = !!id;
    var node = isEdit ? getAllNodes().filter(function(n) { return n.id === id; })[0] : null;
    var data = node || { title: '', type: 'fixed', weekday: 1, time: '', note: '', reminder: true };

    var isMonthly = data.type === 'monthly';
    var weekdayVal = (data.weekday == null) ? '' : String(data.weekday);

    var html = '<div style="display:flex;flex-direction:column;gap:14px">';
    // 节点类型
    html += '<div class="form-group"><label class="form-label">节点类型</label><select class="form-input" id="node-type">';
    html += '<option value="weekly"' + (!isMonthly ? ' selected' : '') + '>每周固定（指定星期）</option>';
    html += '<option value="monthly"' + (isMonthly ? ' selected' : '') + '>每月固定（最后一周）</option>';
    html += '</select></div>';
    // 标题
    html += '<div class="form-group"><label class="form-label">标题</label><input class="form-input" id="node-title" value="' + App.util.escapeAttr(data.title) + '" placeholder="如：集团会议"></div>';
    // 星期
    var wdNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    html += '<div class="form-group"><label class="form-label">星期</label><select class="form-input" id="node-weekday">';
    html += '<option value="">不指定（整月有效）</option>';
    wdNames.forEach(function(n, i) {
      html += '<option value="' + i + '"' + (weekdayVal === String(i) ? ' selected' : '') + '>' + n + '</option>';
    });
    html += '</select></div>';
    // 颜色标记
    html += '<div class="form-group"><label class="form-label">颜色标记（用于区分事项）</label><div id="node-color-swatches" class="color-swatches">';
    PALETTE.forEach(function(c) {
      var sel = (data.color === c.key) ? ' selected' : '';
      html += '<button type="button" class="color-swatch nl-' + c.key + '" data-c="' + c.key + '"' + sel + ' title="' + c.name + '" onclick="App.views.timeline.pickColor(\'' + c.key + '\')"></button>';
    });
    html += '</div><input type="hidden" id="node-color" value="' + App.util.escapeAttr(data.color || '') + '"></div>';
    // 时间 + 提醒
    html += '<div class="form-row">';
    html += '<div class="form-group"><label class="form-label">时间（可选）</label><input class="form-input" id="node-time" type="time" value="' + App.util.escapeAttr(data.time || '') + '"></div>';
    html += '<div class="form-group"><label class="form-label">提醒</label><div style="display:flex;align-items:center;gap:8px;height:38px"><input type="checkbox" id="node-reminder"' + (data.reminder ? ' checked' : '') + '><span style="font-size:13px;color:var(--text-muted)">开启节点提醒</span></div></div>';
    html += '</div>';
    // 备注
    html += '<div class="form-group"><label class="form-label">备注（可选）</label><textarea class="form-input" id="node-note" placeholder="补充说明">' + App.util.escapeHtml(data.note || '') + '</textarea></div>';
    html += '</div>';

    var modalOpts = {
      title: isEdit ? '编辑时间轴节点' : '新建时间轴节点',
      content: html,
      confirmText: isEdit ? '保存修改' : '创建节点',
      onConfirm: function(close) { saveNode(isEdit ? id : null, close); }
    };
    if (isEdit) {
      modalOpts.onDelete = function(close) { deleteNode(id, close); };
      modalOpts.deleteText = '删除';
    }
    App.util.modal(modalOpts);
  }

  function saveNode(id, close) {
    var titleEl = document.getElementById('node-title');
    if (!titleEl) return;
    var title = titleEl.value.trim();
    if (!title) { App.util.toast('请填写节点标题', 'warn'); return; }
    var isMonthly = document.getElementById('node-type').value === 'monthly';
    var weekdaySel = document.getElementById('node-weekday').value;
    var weekday = weekdaySel === '' ? null : parseInt(weekdaySel, 10);
    var time = document.getElementById('node-time').value;
    var reminder = document.getElementById('node-reminder').checked;
    var note = document.getElementById('node-note').value.trim();
    var color = document.getElementById('node-color').value;

    var newNode = {
      title: title,
      type: isMonthly ? 'monthly' : 'fixed',
      weekday: weekday,
      time: time,
      reminder: reminder,
      note: note
    };
    if (color) newNode.color = color; else newNode.color = null;
    if (isMonthly) {
      if (weekday != null) newNode.which = 'last';
      else newNode.cron = 'last-week-of-month';
    }

    if (id) {
      var fixed = App.store.get('timeline.fixedNodes') || [];
      var custom = App.store.get('timeline.customNodes') || [];
      var fi = -1, ci = -1;
      fixed.forEach(function(n, i) { if (n.id === id) fi = i; });
      custom.forEach(function(n, i) { if (n.id === id) ci = i; });
      if (fi >= 0) { fixed[fi] = Object.assign({}, fixed[fi], newNode); if (newNode.color === null) delete fixed[fi].color; App.store.set('timeline.fixedNodes', fixed); }
      else if (ci >= 0) { custom[ci] = Object.assign({}, custom[ci], newNode); if (newNode.color === null) delete custom[ci].color; App.store.set('timeline.customNodes', custom); }
    } else {
      newNode.id = App.store.uid('node');
      App.store.push('timeline.customNodes', newNode);
    }
    if (close) close();
    App.util.toast(id ? '已保存修改' : '已创建节点', 'ok');
    App.router.resolve();
  }

  function deleteNode(id, close) {
    var node = getAllNodes().filter(function(n) { return n.id === id; })[0];
    if (!node) return;
    App.util.modal({
      title: '确认删除节点',
      content: '确定删除时间轴节点「' + App.util.escapeHtml(node.title) + '」？此操作不可撤销。',
      confirmText: '删除', confirmStyle: 'danger',
      onConfirm: function(c) {
        var fixed = (App.store.get('timeline.fixedNodes') || []).filter(function(n) { return n.id !== id; });
        var custom = (App.store.get('timeline.customNodes') || []).filter(function(n) { return n.id !== id; });
        App.store.set('timeline.fixedNodes', fixed);
        App.store.set('timeline.customNodes', custom);
        if (c) c();
        if (close) close();
        App.util.toast('已删除', 'ok');
        App.router.resolve();
      }
    });
  }

  /* ---------------- 颜色选择 ---------------- */
  function pickColor(c) {
    var inp = document.getElementById('node-color');
    if (!inp) return;
    inp.value = (inp.value === c) ? '' : c; // 再次点击同一色 = 取消（回到类型默认色）
    var sw = document.querySelectorAll('#node-color-swatches .color-swatch');
    for (var i = 0; i < sw.length; i++) {
      sw[i].classList.toggle('selected', sw[i].getAttribute('data-c') === inp.value);
    }
  }

  /* ---------------- 拖动改时间节点 ---------------- */
  function clearDragging() {
    var els = document.querySelectorAll('.timeline-node.dragging, .tl-month-chip.dragging');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('dragging');
  }
  function onDragStart(e, id) {
    if (e.dataTransfer) {
      try { e.dataTransfer.setData('text/plain', id); } catch (err) {}
      e.dataTransfer.effectAllowed = 'move';
    }
    if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('dragging');
  }
  function onDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('drop-target');
  }
  function onDragLeave(e) {
    if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('drop-target');
  }
  function onDrop(e, weekday) {
    e.preventDefault();
    if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('drop-target');
    clearDragging();
    var id = e.dataTransfer ? e.dataTransfer.getData('text/plain') : null;
    if (!id) return;
    moveNodeWeekday(id, weekday);
  }

  // 把节点移动到新的星期列（校准 time 坐标），不影响其它节点
  function moveNodeWeekday(id, weekday) {
    var fixed = App.store.get('timeline.fixedNodes') || [];
    var custom = App.store.get('timeline.customNodes') || [];
    var fi = -1, ci = -1;
    fixed.forEach(function(n, i) { if (n.id === id) fi = i; });
    custom.forEach(function(n, i) { if (n.id === id) ci = i; });
    if (fi >= 0) {
      fixed[fi] = Object.assign({}, fixed[fi], { weekday: weekday });
      App.store.set('timeline.fixedNodes', fixed);
    } else if (ci >= 0) {
      custom[ci] = Object.assign({}, custom[ci], { weekday: weekday });
      App.store.set('timeline.customNodes', custom);
    } else {
      return;
    }
    App.util.toast('已更新时间位置', 'ok');
    App.router.resolve();
  }

  // 当前查看锚点（支持跨周/跨月翻阅；刷新页面后回到本周/本月）
  var _anchor = null;
  function getAnchor() { return _anchor || new Date(); }
  function setAnchor(d) { _anchor = d; }

  // 视图切换
  App.views = App.views || {};
  App.views.timeline = {
    switchView: function(mode) {
      localStorage.setItem('timeline_view', mode);
      App.router.resolve();
    },
    openNodeModal: openNodeModal,
    saveNode: saveNode,
    deleteNode: deleteNode,
    pickColor: pickColor,
    onDragStart: onDragStart,
    onDragOver: onDragOver,
    onDragLeave: onDragLeave,
    onDrop: onDrop,
    moveNodeWeekday: moveNodeWeekday,
    shiftWeek: function(dir) {
      if (dir === 0) setAnchor(new Date());
      else { var a = getAnchor(); a.setDate(a.getDate() + dir * 7); setAnchor(a); }
      App.router.resolve();
    },
    shiftMonth: function(dir) {
      if (dir === 0) setAnchor(new Date());
      else { var a = getAnchor(); a.setMonth(a.getMonth() + dir); setAnchor(a); }
      App.router.resolve();
    },
  };

})();
