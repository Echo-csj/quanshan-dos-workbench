/* ============================================
   tasks.js — 事项看板（Kanban）
   4列: 待办 → 进行中 → 审阅中 → 已完成
   HTML5 拖拽流转状态 | 从时间轴一键生成 | 新建/编辑/删除
   ============================================ */

(function() {

  // 看板列定义（顺序即流转顺序）
  var COLUMNS = [
    { status: 'todo',   label: '待办',   accent: 'var(--text-faint)' },
    { status: 'doing',  label: '进行中', accent: 'var(--accent)' },
    { status: 'review', label: '审阅中', accent: 'var(--warn)' },
    { status: 'done',   label: '已完成', accent: 'var(--ok)' }
  ];

  var PRIORITIES = [
    { v: 'urgent', label: '紧急' },
    { v: 'high',   label: '高' },
    { v: 'normal', label: '普通' },
    { v: 'low',    label: '低' }
  ];

  var dragId = null;
  var doneExpanded = false;          // 已完成列是否展开全部
  var MAX_VISIBLE_DONE = 6;          // 已完成列默认折叠阈值

  /* ---------------- 路由 ---------------- */
  App.router.register('/tasks', function() {
    var container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = renderBoard();
  });

  /* ---------------- 数据访问 ---------------- */
  function getTasks() { return App.store.get('tasks') || []; }

  function statusLabel(s) {
    var c = COLUMNS.filter(function(x) { return x.status === s; })[0];
    return c ? c.label : s;
  }
  function priorityLabel(p) {
    var m = { urgent: '紧急', high: '高', normal: '普通', low: '低' };
    return m[p] || p || '普通';
  }

  /* ---------------- 渲染 ---------------- */
  function renderBoard() {
    var allTasks = getTasks();
    autoArchive(allTasks); // 超期已完成自动归档（移出看板，保留数据）

    var tasks = allTasks.filter(function(t) { return !t.archived; });
    var hideDone = getHideDone();
    var doneVisible = tasks.filter(function(t) { return t.status === 'done'; });
    var archivedCount = allTasks.filter(function(t) { return t.archived; }).length;
    var html = '';

    // 页头 + 工具条
    html += '<div class="page-head"><h1 class="page-title">事项看板</h1>';
    html += '<p class="page-sub">待办 → 进行中 → 审阅中 → 已完成 · 拖拽卡片即可流转状态</p></div>';
    html += '<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center">';
    html += '<button class="btn btn-primary" onclick="App.views.tasks.openTaskModal()">' + App.util.svgIcon('plus', 15) + ' 新建任务</button>';
    html += '<button class="btn btn-secondary" onclick="App.views.tasks.generateFromTimeline()">' + App.util.svgIcon('refresh-cw', 15) + ' 从时间轴生成</button>';
    html += '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer;margin-left:6px"><input type="checkbox" ' + (hideDone ? 'checked' : '') + ' onchange="App.views.tasks.toggleHideDone()"> 隐藏已完成</label>';
    if (doneVisible.length > 0) {
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.archiveAllDone()">📦 归档已完成 (' + doneVisible.length + ')</button>';
    }
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.openArchiveModal()">📦 已归档 (' + archivedCount + ')</button>';
    html += '<span style="margin-left:auto;font-size:12px;color:var(--text-muted);align-self:center">活动 ' + tasks.length + ' 条 · 已归档 ' + archivedCount + ' 条</span>';
    html += '</div>';

    if (tasks.length === 0 && archivedCount === 0) {
      html += '<div class="empty-state" style="padding:50px"><h4>暂无任务</h4><p>点击「新建任务」手动添加，或点「从时间轴生成」把周/月节律节点一键转为待办。</p><button class="btn btn-primary btn-sm" onclick="App.views.tasks.generateFromTimeline()">从时间轴生成</button></div>';
      return html;
    }

    // 看板
    html += '<div class="kanban-board">';
    COLUMNS.forEach(function(col) {
      if (col.status === 'done') {
        html += renderDoneColumn(doneVisible, hideDone);
      } else {
        var colTasks = tasks.filter(function(t) { return t.status === col.status; });
        html += renderNormalColumn(col, colTasks);
      }
    });
    html += '</div>';

    return html;
  }

  function renderNormalColumn(col, colTasks) {
    var html = '<div class="kanban-column">';
    html += '<div class="kanban-col-header" style="border-bottom-color:' + col.accent + '">';
    html += '<span class="kanban-col-title">' + col.label + '</span>';
    html += '<span class="kanban-col-count" style="color:' + col.accent + '">' + colTasks.length + '</span>';
    html += '</div>';
    html += '<div class="kanban-cards" data-status="' + col.status + '" ' +
      'ondragover="App.views.tasks.onDragOver(event)" ' +
      'ondragenter="App.views.tasks.onDragEnter(event)" ' +
      'ondragleave="App.views.tasks.onDragLeave(event)" ' +
      'ondrop="App.views.tasks.onDrop(event, \'' + col.status + '\')">';
    if (colTasks.length === 0) {
      html += '<div class="kanban-empty">拖动任务到此</div>';
    } else {
      colTasks.forEach(function(t) { html += renderCard(t); });
    }
    html += '</div></div>';
    return html;
  }

  function renderDoneColumn(doneTasks, hideDone) {
    var html = '<div class="kanban-column">';
    html += '<div class="kanban-col-header" style="border-bottom-color:var(--ok)">';
    html += '<span class="kanban-col-title">已完成</span>';
    html += '<span class="kanban-col-count" style="color:var(--ok)">' + doneTasks.length + '</span>';
    html += '</div>';
    html += '<div class="kanban-cards" data-status="done" ' +
      'ondragover="App.views.tasks.onDragOver(event)" ' +
      'ondragenter="App.views.tasks.onDragEnter(event)" ' +
      'ondragleave="App.views.tasks.onDragLeave(event)" ' +
      'ondrop="App.views.tasks.onDrop(event, \'done\')">';

    if (hideDone) {
      html += '<div class="kanban-empty">已完成已隐藏<br><button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="App.views.tasks.toggleHideDone()">显示已完成</button></div>';
      html += '</div></div>';
      return html;
    }

    // 按完成时间倒序（最近完成在上），便于定位近期完成项
    var sorted = doneTasks.slice().sort(function(a, b) {
      var ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      var tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return tb - ta;
    });
    var visible = doneExpanded ? sorted : sorted.slice(0, MAX_VISIBLE_DONE);
    var hiddenCount = sorted.length - visible.length;

    if (sorted.length === 0) {
      html += '<div class="kanban-empty">拖动任务到此</div>';
    } else {
      visible.forEach(function(t) { html += renderCard(t); });
      if (hiddenCount > 0) {
        html += '<button class="kanban-expand-btn" onclick="App.views.tasks.expandDone()">展开全部 ' + sorted.length + ' 条已完成 ▾</button>';
      }
    }
    html += '</div></div>';
    return html;
  }

  function renderCard(t) {
    var prio = t.priority || 'normal';
    var overdue = t.status !== 'done' && t.dueDate && isOverdue(t.dueDate);
    var tags = '';

    var html = '<div class="kanban-card" draggable="true" data-id="' + t.id + '" ' +
      'ondragstart="App.views.tasks.onDragStart(event, \'' + t.id + '\')" ' +
      'ondragend="App.views.tasks.onDragEnd(event)">';

    // 操作按钮
    html += '<div class="kanban-card-actions">';
    html += '<button class="btn-icon" title="编辑" onclick="App.views.tasks.editTask(\'' + t.id + '\')">' + App.util.svgIcon('edit', 14) + '</button>';
    if (t.status === 'done') {
      html += '<button class="btn-icon" title="归档" onclick="App.views.tasks.archiveTask(\'' + t.id + '\')">📦</button>';
    }
    html += '<button class="btn-icon btn-icon-danger" title="删除" onclick="App.views.tasks.deleteTask(\'' + t.id + '\')">' + App.util.svgIcon('trash-2', 14) + '</button>';
    html += '</div>';

    // 主体（点击编辑）
    html += '<div class="kanban-card-body" onclick="App.views.tasks.editTask(\'' + t.id + '\')">';
    html += '<div class="kanban-card-title">' + escapeHtml(t.title || '未命名任务') + '</div>';
    html += '<div class="kanban-card-meta">';
    html += '<span class="tag priority-' + prio + '">' + priorityLabel(prio) + '</span>';
    if (t.assignee) html += '<span>👤 ' + escapeHtml(t.assignee) + '</span>';
    if (t.dueDate) html += '<span style="color:' + (overdue ? 'var(--bad)' : 'var(--text-faint)') + '">📅 ' + escapeHtml(t.dueDate) + '</span>';
    html += '</div>';
    if (t.source === 'timeline') html += '<div class="kanban-card-note">⏱ 来自时间轴</div>';
    else if (t.note) html += '<div class="kanban-card-note">' + escapeHtml(t.note) + '</div>';
    html += '</div></div>';

    return html;
  }

  /* ---------------- 拖拽 ---------------- */
  function onDragStart(e, id) {
    dragId = id;
    try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    if (e.currentTarget) e.currentTarget.classList.add('dragging');
  }
  function onDragEnd(e) {
    dragId = null;
    if (e.currentTarget) e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.kanban-cards.drop-over').forEach(function(el) { el.classList.remove('drop-over'); });
  }
  function onDragOver(e) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) {} }
  function onDragEnter(e) { e.preventDefault(); if (e.currentTarget) e.currentTarget.classList.add('drop-over'); }
  function onDragLeave(e) {
    if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-over');
  }
  function onDrop(e, status) {
    e.preventDefault();
    var id = dragId;
    try { id = e.dataTransfer.getData('text/plain') || dragId; } catch (err) {}
    if (e.currentTarget) e.currentTarget.classList.remove('drop-over');
    if (!id) return;
    moveTask(id, status);
  }

  function moveTask(id, status) {
    var tasks = getTasks();
    var t = tasks.filter(function(x) { return x.id === id; })[0];
    if (!t) return;
    if (t.status === status) return;
    t.status = status;
    t.updatedAt = new Date().toISOString();
    if (status === 'done') {
      t.completedAt = new Date().toISOString();
      t.archived = false; // 移入已完成即恢复为活跃（取消归档）
    } else {
      t.completedAt = null; // 移出已完成则清除完成时间
    }
    App.store.set('tasks', tasks);
    App.util.toast('「' + escapeHtml(t.title) + '」→ ' + statusLabel(status), 'ok');
    App.router.resolve();
  }

  /* ---------------- 新建 / 编辑 ---------------- */
  function openTaskModal(id) {
    var isEdit = !!id;
    var t = isEdit ? getTasks().filter(function(x) { return x.id === id; })[0] : null;
    var data = t || { title: '', priority: 'normal', status: 'todo', assignee: '', dueDate: '', note: '' };

    var html = '<div style="display:flex;flex-direction:column;gap:14px">';
    html += '<div class="form-group"><label class="form-label">标题</label><input class="form-input" id="task-title" value="' + escapeAttr(data.title) + '" placeholder="如：完成次月预排课表"></div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label class="form-label">优先级</label><select class="form-input" id="task-priority">' + priorityOptions(data.priority) + '</select></div>';
    html += '<div class="form-group"><label class="form-label">所属状态</label><select class="form-input" id="task-status">' + statusOptions(data.status) + '</select></div>';
    html += '</div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label class="form-label">负责人</label><input class="form-input" id="task-assignee" value="' + escapeAttr(data.assignee) + '" placeholder="如：张老师"></div>';
    html += '<div class="form-group"><label class="form-label">截止日期</label><input class="form-input" id="task-due" type="date" value="' + escapeAttr(data.dueDate) + '"></div>';
    html += '</div>';
    html += '<div class="form-group"><label class="form-label">备注</label><textarea class="form-input" id="task-note" placeholder="补充说明（可选）">' + escapeHtml(data.note || '') + '</textarea></div>';
    html += '</div>';

    App.util.modal({
      title: isEdit ? '编辑任务' : '新建任务',
      content: html,
      confirmText: isEdit ? '保存修改' : '创建任务',
      onConfirm: function(close) { saveTask(isEdit ? id : null, close); }
    });
  }

  function saveTask(id, close) {
    var titleEl = document.getElementById('task-title');
    if (!titleEl) return;
    var title = titleEl.value.trim();
    if (!title) { App.util.toast('请填写任务标题', 'warn'); return; }
    var priority = document.getElementById('task-priority').value;
    var status = document.getElementById('task-status').value;
    var assignee = document.getElementById('task-assignee').value.trim();
    var dueDate = document.getElementById('task-due').value;
    var note = document.getElementById('task-note').value.trim();

    var tasks = getTasks();
    if (id) {
      var t = tasks.filter(function(x) { return x.id === id; })[0];
      if (t) Object.assign(t, { title: title, priority: priority, status: status, assignee: assignee, dueDate: dueDate, note: note, updatedAt: new Date().toISOString() });
    } else {
      tasks.push({
        id: App.store.uid('task'),
        title: title, priority: priority, status: status,
        assignee: assignee, dueDate: dueDate, note: note,
        source: 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    }
    App.store.set('tasks', tasks);
    if (close) close();
    App.util.toast(id ? '已保存修改' : '已创建任务', 'ok');
    App.router.resolve();
  }

  function deleteTask(id) {
    var t = getTasks().filter(function(x) { return x.id === id; })[0];
    if (!t) return;
    App.util.modal({
      title: '确认删除任务',
      content: '确定删除任务「' + escapeHtml(t.title) + '」？此操作不可撤销。',
      confirmText: '删除', confirmStyle: 'danger',
      onConfirm: function(close) {
        var tasks = getTasks().filter(function(x) { return x.id !== id; });
        App.store.set('tasks', tasks);
        close();
        App.util.toast('已删除', 'ok');
        App.router.resolve();
      }
    });
  }

  /* ---------------- 自动归档 / 隐藏 / 折叠 / 归档列表 ---------------- */
  // 已完成且超过阈值天数的事项，自动移入归档（仍保留数据，可从归档列表恢复）
  function autoArchive(tasks) {
    var days = App.store.get('settings.tasksArchiveDays');
    if (days == null || isNaN(days)) days = 30;
    var cutoff = Date.now() - days * 86400000;
    var changed = false;
    tasks.forEach(function(t) {
      if (t.status === 'done' && !t.archived && t.completedAt) {
        if (new Date(t.completedAt).getTime() < cutoff) { t.archived = true; changed = true; }
      }
    });
    if (changed) App.store.set('tasks', tasks);
  }

  function getHideDone() { return localStorage.getItem('tasks_hide_done') === '1'; }
  function toggleHideDone() { localStorage.setItem('tasks_hide_done', getHideDone() ? '0' : '1'); App.router.resolve(); }
  function expandDone() { doneExpanded = true; App.router.resolve(); }

  function archiveTask(id) {
    var tasks = getTasks();
    var t = tasks.filter(function(x) { return x.id === id; })[0];
    if (!t) return;
    t.archived = true;
    App.store.set('tasks', tasks);
    App.util.toast('已归档「' + escapeHtml(t.title) + '」', 'ok');
    App.router.resolve();
  }

  function archiveAllDone() {
    var tasks = getTasks();
    var cnt = 0;
    tasks.forEach(function(t) { if (t.status === 'done' && !t.archived) { t.archived = true; cnt++; } });
    if (cnt === 0) { App.util.toast('没有可归档的已完成事项', 'warn'); return; }
    App.util.modal({
      title: '批量归档已完成',
      content: '确定将 <strong>' + cnt + '</strong> 条已完成事项移入归档吗？归档后将从看板移除，但仍可在「已归档」列表中查询与恢复。',
      confirmText: '归档',
      onConfirm: function(close) {
        App.store.set('tasks', tasks);
        close();
        App.util.toast('已归档 ' + cnt + ' 条已完成事项', 'ok');
        App.router.resolve();
      }
    });
  }

  function openArchiveModal() {
    var ex = document.querySelector('.modal-overlay');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    var all = getTasks();
    var archived = all.filter(function(t) { return t.archived; })
      .sort(function(a, b) {
        var ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        var tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return tb - ta;
      });
    var html = '<div class="archive-list">';
    if (archived.length === 0) {
      html += '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px">暂无已归档事项。</p>';
    } else {
      html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">共 ' + archived.length + ' 条已归档。可恢复回看板，或彻底删除（不可恢复）。</p>';
      archived.forEach(function(t) {
        html += '<div class="archive-row">';
        html += '<div class="archive-row-main">';
        html += '<div class="archive-row-title">' + escapeHtml(t.title || '未命名任务') + '</div>';
        html += '<div class="archive-row-meta">';
        html += '<span class="tag priority-' + (t.priority || 'normal') + '">' + priorityLabel(t.priority) + '</span>';
        if (t.assignee) html += '<span>👤 ' + escapeHtml(t.assignee) + '</span>';
        if (t.completedAt) html += '<span>✅ 完成于 ' + App.util.formatDate(new Date(t.completedAt), 'YYYY-MM-DD') + '</span>';
        html += '</div></div>';
        html += '<div class="archive-row-actions">';
        html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.unarchiveTask(\'' + t.id + '\')">恢复</button>';
        html += '<button class="btn btn-danger btn-ghost btn-sm" onclick="App.views.tasks.purgeArchived(\'' + t.id + '\')">彻底删除</button>';
        html += '</div></div>';
      });
      html += '<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;text-align:right">';
      html += '<button class="btn btn-danger btn-ghost btn-sm" onclick="App.views.tasks.clearAllArchived()">清空全部已归档（彻底删除）</button>';
      html += '</div>';
    }
    html += '</div>';
    App.util.modal({ title: '📦 已归档事项', content: html, showCancel: false, confirmText: '关闭' });
  }

  function unarchiveTask(id) {
    var tasks = getTasks();
    var t = tasks.filter(function(x) { return x.id === id; })[0];
    if (!t) return;
    t.archived = false;
    t.completedAt = null; // 恢复为活跃，不再按旧完成时间自动归档
    App.store.set('tasks', tasks);
    App.util.toast('已恢复「' + escapeHtml(t.title) + '」到看板', 'ok');
    openArchiveModal();
    App.router.resolve();
  }

  function purgeArchived(id) {
    var t = getTasks().filter(function(x) { return x.id === id; })[0];
    if (!t) return;
    App.util.modal({
      title: '确认彻底删除',
      content: '确定彻底删除「' + escapeHtml(t.title) + '」？此操作不可恢复，且不会保留在归档列表中。',
      confirmText: '彻底删除', confirmStyle: 'danger',
      onConfirm: function(close) {
        var tasks = getTasks().filter(function(x) { return x.id !== id; });
        App.store.set('tasks', tasks);
        close();
        App.util.toast('已彻底删除', 'ok');
        openArchiveModal();
        App.router.resolve();
      }
    });
  }

  function clearAllArchived() {
    var tasks = getTasks();
    var cnt = tasks.filter(function(t) { return t.archived; }).length;
    if (cnt === 0) { App.util.toast('没有可清空的归档', 'warn'); return; }
    App.util.modal({
      title: '⚠️ 确认清空全部归档',
      content: '确定彻底删除全部 <strong>' + cnt + '</strong> 条已归档事项？此操作不可恢复。',
      confirmText: '清空全部', confirmStyle: 'danger',
      onConfirm: function(close) {
        var remaining = tasks.filter(function(t) { return !t.archived; });
        App.store.set('tasks', remaining);
        close();
        App.util.toast('已清空 ' + cnt + ' 条归档', 'ok');
        openArchiveModal();
        App.router.resolve();
      }
    });
  }

  /* ---------------- 从时间轴生成 ---------------- */
  function generateFromTimeline() {
    var data = App.store.getData();
    var nodes = ((data.timeline && data.timeline.fixedNodes) || []).concat((data.timeline && data.timeline.customNodes) || []);
    var tasks = getTasks();
    var existingIds = tasks.map(function(t) { return t.timelineNodeId; });
    var added = 0;

    nodes.forEach(function(node) {
      if (existingIds.indexOf(node.id) >= 0) return; // 已生成，跳过
      var due = computeDueDate(node);
      tasks.push({
        id: App.store.uid('task'),
        title: node.title,
        priority: defaultPriority(node),
        assignee: '',
        dueDate: due ? App.util.formatDate(due, 'YYYY-MM-DD') : '',
        status: 'todo',
        source: 'timeline',
        timelineNodeId: node.id,
        note: node.note || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      added++;
    });

    App.store.set('tasks', tasks);
    App.util.toast(added > 0 ? ('已从时间轴生成 ' + added + ' 条待办') : '时间轴节点已全部生成，无新增', 'ok');
    App.router.resolve();
  }

  function defaultPriority(node) {
    if (['sun-report', 'tue-super', 'tue-edu', 'month-prearrange', 'month-schedule'].indexOf(node.id) >= 0) return 'high';
    return 'normal';
  }

  function computeDueDate(node) {
    var now = new Date();
    // 固定星期节点 → 下一个该星期几
    if (node.weekday != null && typeof node.weekday === 'number' && node.type !== 'monthly') {
      var d = new Date(now);
      var diff = node.weekday - d.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
    // 月度节点 → 本月/下月最后一周的该星期几
    if (node.type === 'monthly') {
      var wd = (node.weekday != null && typeof node.weekday === 'number') ? node.weekday : 3;
      for (var m = now.getMonth(); m <= now.getMonth() + 2; m++) {
        var year = now.getFullYear() + Math.floor(m / 12);
        var month = ((m % 12) + 12) % 12;
        var lastDay = new Date(year, month + 1, 0);
        var d2 = new Date(lastDay);
        while (d2.getDay() !== wd) d2.setDate(d2.getDate() - 1);
        if (d2 >= now) return d2;
      }
    }
    return null;
  }

  /* ---------------- 工具 ---------------- */
  function priorityOptions(sel) {
    return PRIORITIES.map(function(p) {
      return '<option value="' + p.v + '"' + (p.v === sel ? ' selected' : '') + '>' + p.label + '</option>';
    }).join('');
  }
  function statusOptions(sel) {
    return COLUMNS.map(function(c) {
      return '<option value="' + c.status + '"' + (c.status === sel ? ' selected' : '') + '>' + c.label + '</option>';
    }).join('');
  }
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function isOverdue(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr + 'T23:59:59');
    return d.getTime() < Date.now();
  }

  /* ---------------- 对外 ---------------- */
  App.views = App.views || {};
  App.views.tasks = {
    onDragStart: onDragStart,
    onDragEnd: onDragEnd,
    onDragOver: onDragOver,
    onDragEnter: onDragEnter,
    onDragLeave: onDragLeave,
    onDrop: onDrop,
    openTaskModal: openTaskModal,
    editTask: openTaskModal,
    deleteTask: deleteTask,
    saveTask: saveTask,
    generateFromTimeline: generateFromTimeline,
    toggleHideDone: toggleHideDone,
    expandDone: expandDone,
    archiveTask: archiveTask,
    archiveAllDone: archiveAllDone,
    openArchiveModal: openArchiveModal,
    unarchiveTask: unarchiveTask,
    purgeArchived: purgeArchived,
    clearAllArchived: clearAllArchived
  };

})();
