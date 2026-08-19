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
  var _pasteItems = [];              // 粘贴解析预览暂存

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
    html += '<button class="btn btn-secondary" onclick="App.views.tasks.openPasteModal()">📋 粘贴提取</button>';
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
    else if (t.source === 'paste') html += '<div class="kanban-card-note">📋 来自粘贴</div>';
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

  /* ---------------- 粘贴提取 ---------------- */
  // 入口：粘贴框 + 实时解析预览
  function openPasteModal() {
    var ex = document.querySelector('.modal-overlay');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    _pasteItems = [];

    var html = '';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.6">从工作群复制内容粘贴到下方，系统自动识别 <b>事项 / 负责人 / 时间</b>。每行一条；支持 ' +
      '<code>@张三</code>、<code>负责人：张三</code>、<code>（张三）</code>、<code>8月20日</code>、<code>下周三</code>、<code>明天</code> 等格式。' +
      '还支持「<b>以上N项 + 日期完成</b>」批量设截止日、自动跳过「抄送/邮件发送/收到回复」等说明行。解析结果可勾选并编辑后再生成。</p>';
    html += '<textarea id="paste-input" class="form-input" rows="6" style="font-family:var(--font-mono);font-size:12px" placeholder="示例：\n@张老师 完成次月预排课表 8月20日\n下周三前 提交教务周报 — 李教务\n（王主管）核对新生名单 截止8/25 紧急"></textarea>';
    html += '<div id="paste-preview" style="margin-top:14px"></div>';

    App.util.modal({
      title: '📋 粘贴提取待办',
      content: html,
      showCancel: true,
      confirmText: '生成待办',
      onConfirm: function(close) { confirmPasteImport(close); }
    });

    var ta = document.getElementById('paste-input');
    if (ta) {
      ta.addEventListener('input', onPasteInput);
      ta.focus();
    }
    onPasteInput();
  }

  function onPasteInput() {
    var ta = document.getElementById('paste-input');
    if (!ta) return;
    _pasteItems = parsePasteText(ta.value);
    renderPastePreview();
  }

  function renderPastePreview() {
    var box = document.getElementById('paste-preview');
    if (!box) return;
    if (_pasteItems.length === 0) {
      box.innerHTML = '<p style="font-size:12px;color:var(--text-faint);text-align:center;padding:14px">粘贴文本后将在此预览解析结果，可勾选并编辑后生成。</p>';
      return;
    }
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<span style="font-size:12px;color:var(--text-muted)">已识别 <b>' + _pasteItems.length + '</b> 条，可编辑后生成</span>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.toggleAllPaste()">全选 / 取消</button>';
    html += '</div>';
    html += '<div class="paste-table">';
    _pasteItems.forEach(function(it, i) {
      html += '<div class="paste-row" data-idx="' + i + '">';
      html += '<input type="checkbox" class="paste-ck" data-idx="' + i + '" checked>';
      html += '<textarea class="form-input paste-f paste-title" id="pp-title-' + i + '" rows="1" placeholder="事项描述" title="原文：' + escapeAttr(it._raw || '') + '">' + escapeHtml(it.title) + '</textarea>';
      html += '<div class="paste-meta">';
      html += '<input class="form-input paste-f" id="pp-assignee-' + i + '" value="' + escapeAttr(it.assignee) + '" placeholder="负责人">';
      html += '<input class="form-input paste-f" id="pp-due-' + i + '" type="date" value="' + escapeAttr(it.dueDate) + '">';
      html += '<select class="form-input paste-f" id="pp-prio-' + i + '">' + priorityOptions(it.priority) + '</select>';
      html += '<button class="btn-icon btn-icon-danger" title="移除" onclick="App.views.tasks.removePasteRow(' + i + ')">✕</button>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  }

  function removePasteRow(i) {
    _pasteItems.splice(i, 1);
    renderPastePreview();
  }

  function toggleAllPaste() {
    var cks = document.querySelectorAll('.paste-ck');
    var allChecked = Array.prototype.every.call(cks, function(c) { return c.checked; });
    Array.prototype.forEach.call(cks, function(c) { c.checked = !allChecked; });
  }

  function confirmPasteImport(close) {
    var tasks = getTasks();
    var added = 0;
    for (var i = 0; i < _pasteItems.length; i++) {
      var ck = document.querySelector('.paste-ck[data-idx="' + i + '"]');
      if (ck && !ck.checked) continue;
      var titleEl = document.getElementById('pp-title-' + i);
      var title = titleEl ? titleEl.value.trim() : '';
      if (!title) continue;
      var assignee = (document.getElementById('pp-assignee-' + i) || {}).value.trim();
      var due = (document.getElementById('pp-due-' + i) || {}).value;
      var prio = (document.getElementById('pp-prio-' + i) || {}).value;
      tasks.push({
        id: App.store.uid('task'),
        title: title,
        priority: prio,
        status: 'todo',
        assignee: assignee,
        dueDate: due || '',
        note: '',
        source: 'paste',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      added++;
    }
    if (added === 0) { App.util.toast('没有可生成的待办', 'warn'); return; }
    App.store.set('tasks', tasks);
    if (close) close();
    App.util.toast('已生成 ' + added + ' 条待办（来自粘贴）', 'ok');
    App.router.resolve();
  }

  // —— 解析纯函数（不依赖 DOM，支持「分组后置截止日期 / 抄送行 / 回复块」）——
  var _CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '两': 2, '俩': 2 };
  function cnToNum(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === '十') return 10;
    if (s.length === 2 && s[0] === '十') return 10 + (_CN_NUM[s[1]] || 0);
    if (s.length === 2 && s[1] === '十') return (_CN_NUM[s[0]] || 0) * 10;
    if (s.length === 3 && s[1] === '十') return (_CN_NUM[s[0]] || 0) * 10 + (_CN_NUM[s[2]] || 0);
    var n = 0; for (var i = 0; i < s.length; i++) n += (_CN_NUM[s[i]] || 0); return n;
  }

  function parsePasteText(text) {
    var lines = (text || '').split(/\r?\n/);
    var items = [];
    var base = new Date();
    var lastGroupCount = 0;   // 来自「以上N项」
    var inReply = false;      // 回复块之后不再当作任务

    lines.forEach(function(orig) {
      var line = (orig || '').trim();
      if (!line) return;

      // 1) 回复块：收到回复 / 回复：之后均为留言，跳过
      if (/^(收到回复|回复[:：]|回复如下|医生回复[:：]?)/.test(line)) { inReply = true; return; }
      if (inReply) return;

      // 2) 去掉行首序号 / 项目符号
      var content = line.replace(/^[\d]+[.、)]\s*/, '').replace(/^[-*•·]\s*/, '');
      if (!content) return;

      // 3) 分组指令行：以上N项…（含或不含完成日期）
      var gfm = content.match(/^以上\s*([一二三四五六七八九十两俩\d]+)\s*项/);
      if (gfm) {
        lastGroupCount = cnToNum(gfm[1]);
        var gd = parseDate(content, base);
        if (gd && lastGroupCount) { applyDueToLast(items, lastGroupCount, gd); lastGroupCount = 0; }
        return; // 不当作任务
      }

      // 4) 单独的完成/截止指令行：本周六完成 / 今日完成（把日期填给上面 N 项）
      if (/完成|截止/.test(content) && isShortDirective(content)) {
        var d = parseDate(content, base);
        if (d) {
          var n = lastGroupCount || countTasksWithoutDue(items);
          applyDueToLast(items, n, d);
          lastGroupCount = 0;
          return;
        }
      }

      // 5) 其它说明性标题行（真实条目如「针对家长…跟进」放行）
      if (isLikelyHeader(content)) return;

      // 6) 解析为任务
      var item = parseLine(content, base);
      if (item && item.title && isMeaningfulTitle(item.title)) items.push(item);
    });

    return items;
  }

  function applyDueToLast(items, n, date) {
    if (!date || n <= 0) return;
    var start = Math.max(0, items.length - n);
    for (var i = start; i < items.length; i++) items[i].dueDate = date; // 分组截止日是权威日期
  }
  function countTasksWithoutDue(items) {
    var c = 0; items.forEach(function(it) { if (!it.dueDate) c++; }); return c;
  }
  // 行很短，去掉日期词与「完成/截止/前」后基本无残留 → 判定为纯指令行
  function isShortDirective(line) {
    if (line.length > 24) return false;
    var rest = line
      .replace(/(本周|这周|下周|上周)?\s*[周星期]?\s*[一二三四五六日天]/g, '')
      .replace(/今天|今日|明天|明日|后天/g, '')
      .replace(/完成|截止|前/g, '')
      .replace(/\s/g, '');
    return rest.length <= 2;
  }

  // 跳过明显的"列表说明"行（不当作任务）；真实条目（如"针对家长…跟进"）放行
  function isLikelyHeader(line) {
    if (line.length < 8) return false;
    if (/^(以上是|以下是|现将|现就|特此|综上|总之|本次|本周期|本季度|本学期|本学年|同学们|各位|大家|注意[:：]?|任务如下|有如下|有以下|邮件发送|抄送|主送|发件人|收件人|转发|令)/.test(line)) return true;
    if (/^(针对|关于|根据|按照|请各|请将|请于|请在)/.test(line)) {
      return /(有以下|有如下|任务如下|几项任务|以下任务|如下[:：]|任务清单|安排如下|具体任务)/.test(line);
    }
    return false;
  }

  // 标题必须包含至少 2 个有效字符（排除纯标点/纯数字/纯空白）
  function isMeaningfulTitle(s) {
    if (!s) return false;
    var stripped = s.replace(/[\s+\-—–=、，。：:；;·•*#@()（）\[\]【】"'`~!?:：；]/g, '');
    if (stripped.length < 2) return false;
    if (/^[\d\s\-—–=+]+$/.test(stripped)) return false;
    return true;
  }

  function parseLine(line, base) {
    var raw = line;
    var title = line;
    var dueDate = parseDate(title, base);     // 仅提取，不改 title
    var ap = extractAssignee(title);          // 提取并清理负责人
    var assignee = ap.assignee;
    title = ap.rest;
    var priority = detectPriority(line);
    title = cleanTitle(title);                // 清理日期/星期/优先级残留
    if (!title) return null;
    return { title: title, assignee: assignee || '', dueDate: dueDate || '', priority: priority, status: 'todo', _raw: raw };
  }

  // 返回 'YYYY-MM-DD' 或 null
  function parseDate(text, base) {
    // 绝对：年-月-日 / 年/月/日
    var m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return ymdStr(+m[1], +m[2], +m[3]);
    // M月D日 / M月D号
    m = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
    if (m) return mdThisOrNextYear(+m[1], +m[2], base);
    // M/D 或 M.D
    m = text.match(/(\d{1,2})[\/.](\d{1,2})(?!\d)/);
    if (m) return mdThisOrNextYear(+m[1], +m[2], base);
    // 相对星期（本周六 / 下周三 / 周六 …）
    var rd = parseRelativeWeekday(text, base);
    if (rd) return rd;
    if (/明天|明日/.test(text)) { var d2 = new Date(base); d2.setDate(d2.getDate() + 1); return App.util.formatDate(d2, 'YYYY-MM-DD'); }
    if (/后天/.test(text)) { var d3 = new Date(base); d3.setDate(d3.getDate() + 2); return App.util.formatDate(d3, 'YYYY-MM-DD'); }
    if (/今天|今日/.test(text)) { return App.util.formatDate(base, 'YYYY-MM-DD'); }
    return null;
  }

  function parseRelativeWeekday(text, base) {
    var wdMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
    var m = text.match(/(本周|这周|下周|下个?周|上周|上個?周)\s*(?:周|星期)?\s*([一二三四五六日天])/);
    var dir = null, dayChar = null;
    if (m) { dir = m[1]; dayChar = m[2]; }
    else {
      m = text.match(/(?:周|星期)\s*([一二三四五六日天])/);
      if (m) dayChar = m[1];
    }
    if (!dayChar) return null;
    var wd = wdMap[dayChar];
    if (wd == null) return null;
    var d = new Date(base);
    var diff = wd - d.getDay();
    if (dir === '下周' || dir === '下个周') diff += 7;
    else if (dir === '上周' || dir === '上個周') diff -= 7;
    else if (dir === '本周' || dir === '这周') { if (diff < 0) diff += 7; }
    else { if (diff <= 0) diff += 7; } // 无方向词，默认下一个该星期
    d.setDate(d.getDate() + diff);
    return App.util.formatDate(d, 'YYYY-MM-DD');
  }

  function ymdStr(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; // 无效日期
    return App.util.formatDate(dt, 'YYYY-MM-DD');
  }

  function mdThisOrNextYear(mo, d, base) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(base.getFullYear(), mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    if (dt.getTime() < base.getTime()) dt.setFullYear(base.getFullYear() + 1); // 已过去则视为明年
    return App.util.formatDate(dt, 'YYYY-MM-DD');
  }

  function extractAssignee(text) {
    var assignee = '';
    var rest = text;
    // 1. @姓名
    var m = rest.match(/@([^\s，。；、,;：:）)】\]]+)/);
    if (m) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    // 2. 负责人：姓名
    if (!assignee) {
      m = rest.match(/负责人[：:\s]*([^\s，。；、,;]{1,10})/);
      if (m) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }
    // 3. （姓名）或(姓名)
    if (!assignee) {
      m = rest.match(/[（(]([\u4e00-\u9fa5·]{2,6})[）)]/);
      if (m) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }
    // 4. 行尾 — 姓名 / - 姓名
    if (!assignee) {
      m = rest.match(/[—\-–=]\s*([\u4e00-\u9fa5·]{2,6})\s*$/);
      if (m) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }
    return { assignee: assignee, rest: rest };
  }

  function detectPriority(text) {
    if (/紧急|加急|特急|尽快|🔴/.test(text)) return 'urgent';
    if (/重要|高优|⚠/.test(text)) return 'high';
    return 'normal';
  }

  function cleanTitle(s) {
    s = s.replace(/@/g, ' ')
      .replace(/负责人[：:\s]*/g, ' ')
      .replace(/[（(][\u4e00-\u9fa5·]{2,6}[）)]/g, ' ')
      .replace(/[—\-–=]\s*[\u4e00-\u9fa5·]{2,6}\s*$/g, ' ')
      .replace(/(?:本周|这周|下周|下个?周|上周|上個?周|周|星期)\s*[一二三四五六日天](?:\s*前)?/g, ' ')
      .replace(/明天|今天|今日|后天/g, ' ')
      .replace(/截止/g, ' ')
      .replace(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g, ' ')
      .replace(/(\d{1,2})月(\d{1,2})[日号]/g, ' ')
      .replace(/(\d{1,2})[\/.](\d{1,2})/g, ' ')
      .replace(/\[[\u4e00-\u9fa5]+\]/g, ' ')
      .replace(/[\[【]/g, ' ')
      .replace(/紧急|加急|特急|尽快|重要|高优/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[：:、，。\-—\s]+|[：:、，。\-—\s]+$/g, '')
      .trim();
    return s;
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
    openPasteModal: openPasteModal,
    removePasteRow: removePasteRow,
    toggleAllPaste: toggleAllPaste,
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
