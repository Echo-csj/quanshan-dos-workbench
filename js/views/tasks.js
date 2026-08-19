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
    var _pasteItems = [];              // 粘贴解析预览暂存
  var _pasteSkipped = [];            // 被识别为说明/邮件/否定句而跳过的行

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

  /* ---------------- 视图设置（持久化）---------------- */
  var VIEW_DEFAULT = { mode:'kanban', density:'standard', filters:{status:[],priority:[],source:[]}, sortBy:'dueDate', sortDir:'asc', search:'', expanded:{}, columnLimit:10 };
  function getViewSettings() {
    var s = App.store.get('settings.tasksView');
    if (!s) return JSON.parse(JSON.stringify(VIEW_DEFAULT));
    if (!s.filters) s.filters = { status:[], priority:[], source:[] };
    if (!s.expanded) s.expanded = {};
    if (!s.columnLimit) s.columnLimit = 10;
    return s;
  }
  function saveViewSettings(v) { App.store.set('settings.tasksView', v); }
  function updateView(patch) {
    var v = getViewSettings();
    Object.keys(patch).forEach(function(k) { v[k] = patch[k]; });
    saveViewSettings(v);
  }

  /* ---------------- 筛选 / 搜索 / 排序 ---------------- */
  function applyFilters(tasks, view) {
    var q = (view.search || '').trim().toLowerCase();
    var fs = view.filters || {};
    var st = fs.status || [], pr = fs.priority || [], sr = fs.source || [];
    return tasks.filter(function(t) {
      if (st.length && st.indexOf(t.status) === -1) return false;
      if (pr.length && pr.indexOf(t.priority || 'normal') === -1) return false;
      if (sr.length) {
        var src = t.source || 'manual';
        if (sr.indexOf(src) === -1) return false;
      }
      if (q) {
        var hay = ((t.title||'') + ' ' + (t.assignee||'') + ' ' + (t.note||'') + ' ' + (t.priority||'') + ' ' + (t.status||'')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  var _PRIO_W = { urgent:3, high:2, normal:1, low:0 };
  function prioWeight(p) { return _PRIO_W[p] || 1; }
  // 默认排序：优先级降序 → 截止日升序 → 创建时间降序
  function sortTasksDefault(tasks) {
    return tasks.slice().sort(function(a,b) {
      var dw = prioWeight(b.priority) - prioWeight(a.priority);
      if (dw) return dw;
      var da = a.dueDate || '9999-99-99', db = b.dueDate || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      return (b.createdAt||'').localeCompare(a.createdAt||'');
    });
  }
  // 列表视图的自定义排序
  function sortTasksBy(tasks, view) {
    var dir = view.sortDir === 'desc' ? -1 : 1;
    return tasks.slice().sort(function(a,b) {
      var cmp = 0;
      if (view.sortBy === 'priority') cmp = prioWeight(a.priority) - prioWeight(b.priority);
      else if (view.sortBy === 'createdAt') cmp = (a.createdAt||'').localeCompare(b.createdAt||'');
      else if (view.sortBy === 'title') cmp = (a.title||'').localeCompare(b.title||'','zh');
      else cmp = (a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99');
      if (cmp === 0) cmp = prioWeight(b.priority) - prioWeight(a.priority);
      return cmp * dir;
    });
  }
  // 已完成列：按完成时间倒序
  function sortDoneTasks(tasks) {
    return tasks.slice().sort(function(a,b) {
      var ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      var tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return tb - ta;
    });
  }

  /* ---------------- 视图切换操作（onclick 触发）---------------- */
  function setViewMode(mode) { updateView({ mode: mode }); App.router.resolve(); }
  function setDensity(d) { updateView({ density: d }); App.router.resolve(); }
  function setSearch(q) { updateView({ search: q }); App.router.resolve(); }
  function toggleFilter(kind, val) {
    var v = getViewSettings();
    var arr = (v.filters[kind] || []).slice();
    var i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1); else arr.push(val);
    var f = JSON.parse(JSON.stringify(v.filters));
    f[kind] = arr;
    updateView({ filters: f });
    App.router.resolve();
  }
  function clearFilters() {
    updateView({ filters: { status:[], priority:[], source:[] }, search: '' });
    App.router.resolve();
  }
  function setSort(by) {
    var v = getViewSettings();
    if (v.sortBy === by) updateView({ sortDir: v.sortDir === 'asc' ? 'desc' : 'asc' });
    else updateView({ sortBy: by, sortDir: 'asc' });
    App.router.resolve();
  }
  function toggleSortDir() {
    var v = getViewSettings();
    updateView({ sortDir: v.sortDir === 'asc' ? 'desc' : 'asc' });
    App.router.resolve();
  }
  function toggleGroup(key) {
    var v = getViewSettings();
    v.expanded[key] = !v.expanded[key];
    saveViewSettings(v);
    App.router.resolve();
  }
  function setColumnLimit(n) { updateView({ columnLimit: n }); App.router.resolve(); }

  /* ---------------- 渲染 ---------------- */
  function renderBoard() {
    var allTasks = getTasks();
    autoArchive(allTasks); // 超期已完成自动归档

    var tasks = allTasks.filter(function(t) { return !t.archived; });
    var view = getViewSettings();
    var hideDone = getHideDone();
    var archivedCount = allTasks.filter(function(t) { return t.archived; }).length;

    // 筛选 + 搜索 + 隐藏已完成
    var filtered = applyFilters(tasks, view);
    if (hideDone) filtered = filtered.filter(function(t) { return t.status !== 'done'; });
    var doneVisible = tasks.filter(function(t) { return t.status === 'done'; });

    var html = '';

    // 页头（按当前视图给不同副标题）
    var modeHint = view.mode === 'kanban' ? '待办 → 进行中 → 审阅中 → 已完成 · 拖拽卡片即可流转状态'
      : (view.mode === 'list' ? '一屏看全所有事项，支持排序 / 筛选 / 搜索'
      : (view.mode === 'date' ? '按截止日折叠分组：逾期 / 今日 / 未来 7 天 / 更远 / 无截止'
      : '按优先级分组：紧急 / 高 / 普通'));
    html += '<div class="page-head"><h1 class="page-title">事项看板</h1>';
    html += '<p class="page-sub">' + modeHint + '</p></div>';

    // 工具条
    html += renderToolbar(view, filtered, archivedCount, doneVisible);

    if (filtered.length === 0) {
      var emptyBody = tasks.length === 0
        ? '<p>点击「新建任务」手动添加，或点「从时间轴生成」把周/月节律节点一键转为待办。</p><button class="btn btn-primary btn-sm" onclick="App.views.tasks.generateFromTimeline()">从时间轴生成</button>'
        : '<p>当前筛选/搜索条件下没有匹配的任务，试试调整搜索词或清空筛选。</p><button class="btn btn-ghost btn-sm" onclick="App.views.tasks.clearFilters()">清空筛选</button>';
      html += '<div class="empty-state" style="padding:50px"><h4>' + (tasks.length === 0 ? '暂无任务' : '没有匹配的任务') + '</h4>' + emptyBody + '</div>';
      return html;
    }

    if (view.mode === 'kanban') html += renderKanbanView(filtered, view);
    else if (view.mode === 'list') html += renderListView(filtered, view);
    else if (view.mode === 'date') html += renderDateGroupedView(filtered, view);
    else if (view.mode === 'priority') html += renderPriorityGroupedView(filtered, view);

    return html;
  }

  /* ---------------- 工具条 ---------------- */
  function renderToolbar(view, filtered, archivedCount, doneVisible) {
    var f = view.filters || {};
    var html = '<div class="tasks-toolbar">';

    // Row 1: 主操作 + 视图 tabs + 搜索 + 计数
    html += '<div class="tasks-toolbar-row">';
    html += '<button class="btn btn-primary" onclick="App.views.tasks.openTaskModal()">' + App.util.svgIcon('plus', 15) + ' 新建任务</button>';
    html += '<button class="btn btn-secondary" onclick="App.views.tasks.generateFromTimeline()">' + App.util.svgIcon('refresh-cw', 15) + ' 从时间轴生成</button>';
    html += '<button class="btn btn-secondary" onclick="App.views.tasks.openPasteModal()">📋 粘贴提取</button>';
    html += '<span class="toolbar-sep"></span>';
    var modes = [
      { v: 'kanban', icon: '📋', label: '看板' },
      { v: 'list',   icon: '📑', label: '列表' },
      { v: 'date',   icon: '📅', label: '按日期' },
      { v: 'priority', icon: '⭐', label: '按优先级' }
    ];
    html += '<div class="view-tabs">';
    modes.forEach(function(m) {
      var active = view.mode === m.v;
      html += '<button class="view-tab' + (active ? ' active' : '') + '" onclick="App.views.tasks.setViewMode(\'' + m.v + '\')">' + m.icon + ' ' + m.label + '</button>';
    });
    html += '</div>';
    html += '<span class="toolbar-sep"></span>';
    html += '<input class="form-input tasks-search" placeholder="🔍 搜索 标题/负责人/备注" value="' + escapeAttr(view.search) + '" oninput="App.views.tasks.setSearch(this.value)">';
    html += '<span style="margin-left:auto;font-size:12px;color:var(--text-muted)">活动 ' + filtered.length + ' 条 · 已归档 ' + archivedCount + ' 条</span>';
    html += '</div>';

    // Row 2: 筛选 chips + 排序（仅列表）+ 密度 + 隐藏已完成 + 归档
    html += '<div class="tasks-toolbar-row">';
    html += '<div class="tasks-filters">';
    var stMap = { todo: '待办', doing: '进行中', review: '审阅中', done: '已完成' };
    ['todo', 'doing', 'review', 'done'].forEach(function(s) {
      var on = (f.status || []).indexOf(s) >= 0;
      html += '<button class="chip chip-status-' + s + (on ? ' on' : '') + '" onclick="App.views.tasks.toggleFilter(\'status\',\'' + s + '\')">' + stMap[s] + '</button>';
    });
    html += '<span class="filter-sep"></span>';
    var prMap = { urgent: '紧急', high: '高', normal: '普通' };
    ['urgent', 'high', 'normal'].forEach(function(p) {
      var on = (f.priority || []).indexOf(p) >= 0;
      html += '<button class="chip chip-prio-' + p + (on ? ' on' : '') + '" onclick="App.views.tasks.toggleFilter(\'priority\',\'' + p + '\')">' + prMap[p] + '</button>';
    });
    html += '<span class="filter-sep"></span>';
    var srMap = { manual: '手动', timeline: '⏱时间轴', paste: '📋粘贴' };
    ['manual', 'timeline', 'paste'].forEach(function(s) {
      var on = (f.source || []).indexOf(s) >= 0;
      html += '<button class="chip' + (on ? ' on' : '') + '" onclick="App.views.tasks.toggleFilter(\'source\',\'' + s + '\')">' + srMap[s] + '</button>';
    });
    var anyFilter = (f.status && f.status.length) || (f.priority && f.priority.length) || (f.source && f.source.length) || view.search;
    if (anyFilter) html += '<button class="chip chip-clear" onclick="App.views.tasks.clearFilters()">清空</button>';
    html += '</div>';

    if (view.mode === 'list') {
      var sortLabelMap = { dueDate: '截止日', priority: '优先级', createdAt: '创建时间', title: '标题' };
      html += '<select class="form-input tasks-sort" onchange="App.views.tasks.setSort(this.value)">';
      Object.keys(sortLabelMap).forEach(function(k) {
        html += '<option value="' + k + '"' + (view.sortBy === k ? ' selected' : '') + '>排序：' + sortLabelMap[k] + '</option>';
      });
      html += '</select>';
      html += '<button class="btn-icon" title="切换方向" onclick="App.views.tasks.toggleSortDir()">' + (view.sortDir === 'asc' ? '↑' : '↓') + '</button>';
    }

    html += '<div class="density-tabs">';
    [{ v: 'compact', label: '紧凑' }, { v: 'standard', label: '标准' }, { v: 'comfortable', label: '宽松' }].forEach(function(d) {
      html += '<button class="density-tab' + (view.density === d.v ? ' active' : '') + '" onclick="App.views.tasks.setDensity(\'' + d.v + '\')">' + d.label + '</button>';
    });
    html += '</div>';

    html += '<span class="toolbar-sep"></span>';
    html += '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer"><input type="checkbox" ' + (getHideDone() ? 'checked' : '') + ' onchange="App.views.tasks.toggleHideDone()"> 隐藏已完成</label>';
    if (doneVisible.length > 0) html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.archiveAllDone()">📦 归档已完成 (' + doneVisible.length + ')</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.openArchiveModal()">📦 已归档 (' + archivedCount + ')</button>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function expandFooter(key, hidden, expanded, limit, total) {
    if (hidden > 0) return '<button class="kanban-expand-btn" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">展开 ' + hidden + ' 条 ▾</button>';
    if (expanded && total > limit) return '<button class="kanban-expand-btn" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">收起 ▴</button>';
    return '';
  }

  /* ---------------- 看板视图 ---------------- */
  function renderKanbanView(tasks, view) {
    var html = '<div class="kanban-board density-' + view.density + '">';
    COLUMNS.forEach(function(col) {
      var colTasks = tasks.filter(function(t) { return t.status === col.status; });
      if (col.status === 'done') html += renderKanbanDoneColumn(sortDoneTasks(colTasks), view);
      else html += renderKanbanColumn(col, sortTasksDefault(colTasks), view);
    });
    html += '</div>';
    return html;
  }

  function renderKanbanColumn(col, sorted, view) {
    var key = 'col:' + col.status;
    var expanded = !!view.expanded[key];
    var limit = view.columnLimit;
    var visible = expanded ? sorted : sorted.slice(0, limit);
    var hidden = sorted.length - visible.length;
    var html = '<div class="kanban-column">';
    html += '<div class="kanban-col-header" style="border-bottom-color:' + col.accent + '">';
    html += '<span class="kanban-col-title">' + col.label + '</span>';
    html += '<span class="kanban-col-count" style="color:' + col.accent + '">' + sorted.length + '</span>';
    html += '</div>';
    html += '<div class="kanban-cards" data-status="' + col.status + '" ' +
      'ondragover="App.views.tasks.onDragOver(event)" ' +
      'ondragenter="App.views.tasks.onDragEnter(event)" ' +
      'ondragleave="App.views.tasks.onDragLeave(event)" ' +
      'ondrop="App.views.tasks.onDrop(event, \'' + col.status + '\')">';
    if (sorted.length === 0) html += '<div class="kanban-empty">拖动任务到此</div>';
    else {
      visible.forEach(function(t) { html += renderCard(t); });
      html += expandFooter(key, hidden, expanded, limit, sorted.length);
    }
    html += '</div></div>';
    return html;
  }

  function renderKanbanDoneColumn(sorted, view) {
    var html = '<div class="kanban-column">';
    html += '<div class="kanban-col-header" style="border-bottom-color:var(--ok)">';
    html += '<span class="kanban-col-title">已完成</span>';
    html += '<span class="kanban-col-count" style="color:var(--ok)">' + sorted.length + '</span>';
    html += '</div>';
    html += '<div class="kanban-cards" data-status="done" ' +
      'ondragover="App.views.tasks.onDragOver(event)" ' +
      'ondragenter="App.views.tasks.onDragEnter(event)" ' +
      'ondragleave="App.views.tasks.onDragLeave(event)" ' +
      'ondrop="App.views.tasks.onDrop(event, \'done\')">';
    if (getHideDone()) {
      html += '<div class="kanban-empty">已完成已隐藏<br><button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="App.views.tasks.toggleHideDone()">显示已完成</button></div></div></div>';
      return html;
    }
    var key = 'col:done';
    var expanded = !!view.expanded[key];
    var limit = view.columnLimit;
    var visible = expanded ? sorted : sorted.slice(0, limit);
    var hidden = sorted.length - visible.length;
    if (sorted.length === 0) html += '<div class="kanban-empty">拖动任务到此</div>';
    else {
      visible.forEach(function(t) { html += renderCard(t); });
      html += expandFooter(key, hidden, expanded, limit, sorted.length);
    }
    html += '</div></div>';
    return html;
  }

  /* ---------------- 列表视图 ---------------- */
  function renderListView(tasks, view) {
    var sorted = sortTasksBy(tasks, view);
    var key = 'list:all';
    var expanded = !!view.expanded[key];
    var limit = 30;
    var visible = expanded ? sorted : sorted.slice(0, limit);
    var hidden = sorted.length - visible.length;
    var html = '<div class="tasks-list-wrap density-' + view.density + '">';
    html += '<table class="tasks-list-table">';
    html += '<thead><tr><th>标题</th><th>状态</th><th>优先级</th><th>负责人</th><th>截止</th><th>来源</th><th>操作</th></tr></thead><tbody>';
    if (visible.length === 0) html += '<tr><td colspan="7" style="text-align:center;color:var(--text-faint);padding:30px">无任务</td></tr>';
    else visible.forEach(function(t) { html += renderListRow(t); });
    html += '</tbody></table>';
    if (hidden > 0) html += '<button class="kanban-expand-btn" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">展开 ' + hidden + ' 条 ▾</button>';
    else if (expanded && sorted.length > limit) html += '<button class="kanban-expand-btn" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">收起 ▴</button>';
    html += '</div>';
    return html;
  }

  function renderListRow(t) {
    var overdue = t.status !== 'done' && t.dueDate && isOverdue(t.dueDate);
    var srcLabel = t.source === 'timeline' ? '⏱ 时间轴' : (t.source === 'paste' ? '📋 粘贴' : '手动');
    var html = '<tr class="tasks-list-row' + (overdue ? ' overdue' : '') + '">';
    html += '<td class="list-title" onclick="App.views.tasks.editTask(\'' + t.id + '\')">' + escapeHtml(t.title || '未命名任务');
    if (t.note) html += '<div class="list-note">' + escapeHtml(t.note) + '</div>';
    html += '</td>';
    html += '<td><span class="tag status-' + t.status + '">' + statusLabel(t.status) + '</span></td>';
    html += '<td><span class="tag priority-' + (t.priority || 'normal') + '">' + priorityLabel(t.priority) + '</span></td>';
    html += '<td>' + (t.assignee ? escapeHtml(t.assignee) : '<span style="color:var(--text-faint)">—</span>') + '</td>';
    html += '<td style="color:' + (overdue ? 'var(--bad)' : 'var(--text-faint)') + '">' + (t.dueDate || '<span style="color:var(--text-faint)">—</span>') + '</td>';
    html += '<td><span style="font-size:11px;color:var(--text-muted)">' + srcLabel + '</span></td>';
    html += '<td class="list-actions">';
    html += '<button class="btn-icon" title="编辑" onclick="App.views.tasks.editTask(\'' + t.id + '\')">' + App.util.svgIcon('edit', 14) + '</button>';
    if (t.status === 'done') html += '<button class="btn-icon" title="归档" onclick="App.views.tasks.archiveTask(\'' + t.id + '\')">📦</button>';
    html += '<button class="btn-icon btn-icon-danger" title="删除" onclick="App.views.tasks.deleteTask(\'' + t.id + '\')">' + App.util.svgIcon('trash-2', 14) + '</button>';
    html += '</td>';
    html += '</tr>';
    return html;
  }

  /* ---------------- 按日期分组 ---------------- */
  function renderDateGroupedView(tasks, view) {
    var today = App.util.formatDate(new Date(), 'YYYY-MM-DD');
    var t7 = new Date(); t7.setDate(t7.getDate() + 7);
    var t7str = App.util.formatDate(t7, 'YYYY-MM-DD');
    var groups = [
      { key: 'gdate:overdue', label: '⚠ 逾期', tasks: [] },
      { key: 'gdate:today',   label: '📅 今日 (' + today + ')', tasks: [] },
      { key: 'gdate:week',    label: '📅 未来 7 天（截至 ' + t7str + '）', tasks: [] },
      { key: 'gdate:later',   label: '📅 更远', tasks: [] },
      { key: 'gdate:nodue',   label: '— 无截止日期', tasks: [] }
    ];
    tasks.forEach(function(t) {
      if (!t.dueDate) groups[4].tasks.push(t);
      else if (t.status !== 'done' && t.dueDate < today) groups[0].tasks.push(t);
      else if (t.dueDate === today) groups[1].tasks.push(t);
      else if (t.dueDate <= t7str) groups[2].tasks.push(t);
      else groups[3].tasks.push(t);
    });
    var html = '<div class="tasks-grouped density-' + view.density + '">';
    groups.forEach(function(g) { html += renderGroupedSection(g.key, g.label, sortTasksDefault(g.tasks), view); });
    html += '</div>';
    return html;
  }

  /* ---------------- 按优先级分组 ---------------- */
  function renderPriorityGroupedView(tasks, view) {
    var groups = [
      { key: 'gprio:urgent', label: '⚡ 紧急', tasks: [] },
      { key: 'gprio:high',   label: '⚠ 高',   tasks: [] },
      { key: 'gprio:normal', label: '● 普通', tasks: [] }
    ];
    tasks.forEach(function(t) {
      var p = t.priority || 'normal';
      groups[p === 'urgent' ? 0 : (p === 'high' ? 1 : 2)].tasks.push(t);
    });
    groups.forEach(function(g) { g.tasks = sortTasksDefault(g.tasks); });
    var html = '<div class="tasks-grouped density-' + view.density + '">';
    groups.forEach(function(g) { html += renderGroupedSection(g.key, g.label, g.tasks, view); });
    html += '</div>';
    return html;
  }

  /* ---------------- 分组区块（日期/优先级 视图共用）---------------- */
  function renderGroupedSection(key, label, tasks, view) {
    var html = '<div class="tasks-group">';
    if (tasks.length === 0) {
      html += '<div class="tasks-group-head empty" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">';
      html += '<span class="group-toggle">▸</span>';
      html += '<span class="group-label">' + label + '</span>';
      html += '<span class="group-count">0</span>';
      html += '</div></div>';
      return html;
    }
    var expanded = !!view.expanded[key];
    var limit = view.columnLimit;
    var visible = expanded ? tasks : tasks.slice(0, limit);
    var hidden = tasks.length - visible.length;
    html += '<div class="tasks-group-head" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">';
    html += '<span class="group-toggle">' + (expanded ? '▾' : '▸') + '</span>';
    html += '<span class="group-label">' + label + '</span>';
    html += '<span class="group-count">' + tasks.length + '</span>';
    html += '</div>';
    if (expanded || tasks.length <= limit) {
      html += '<div class="tasks-group-body">';
      visible.forEach(function(t) { html += renderCard(t); });
      html += '</div>';
    } else {
      html += '<div class="tasks-group-preview">';
      visible.slice(0, 3).forEach(function(t) {
        html += '<div class="group-preview-item">' + escapeHtml(App.util.truncate(t.title || '未命名任务', 50)) + '</div>';
      });
      if (hidden > 0) html += '<div class="group-preview-more">+ 还有 ' + hidden + ' 条，点击展开</div>';
      html += '</div>';
    }
    if (hidden > 0) html += '<button class="kanban-expand-btn" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">展开 ' + hidden + ' 条 ▾</button>';
    else if (expanded && tasks.length > limit) html += '<button class="kanban-expand-btn" onclick="App.views.tasks.toggleGroup(\'' + key + '\')">收起 ▴</button>';
    html += '</div>';
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
  function expandDone() { /* 已迁移至 toggleGroup('col:done')，保留为 no-op 以防历史引用 */ }

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
    _pasteSkipped = [];

    var html = '';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.6">从工作群复制内容粘贴到下方，系统自动识别 <b>事项 / 负责人 / 时间</b>。每行一条；支持 ' +
      '<code>@张三</code>、<code>负责人：张三</code>、<code>（张三）</code>、<code>8月20日</code>、<code>下周三</code>、<code>明天</code> 等格式。' +
      '还支持「<b>以上N项 + 日期完成</b>」批量设截止日、自动跳过「抄送/邮件发送/收到回复/否定式告诫」等说明行；每行右侧显示置信度。</p>';
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
    var result = parsePasteText(ta.value);
    _pasteItems = result.items;
    _pasteSkipped = result.skipped;
    renderPastePreview();
  }

  function renderPastePreview() {
    var box = document.getElementById('paste-preview');
    if (!box) return;
    if (_pasteItems.length === 0 && _pasteSkipped.length === 0) {
      box.innerHTML = '<p style="font-size:12px;color:var(--text-faint);text-align:center;padding:14px">粘贴文本后将在此预览解析结果，可勾选并编辑后生成。</p>';
      return;
    }
    var html = '';
    if (_pasteItems.length === 0 && _pasteSkipped.length > 0) {
      html += '<p style="font-size:12px;color:var(--text-faint);text-align:center;padding:14px">全部 ' + _pasteSkipped.length + ' 行被识别为说明/邮件/否定告诫，未识别出待办事项。</p>';
    } else {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<span style="font-size:12px;color:var(--text-muted)">已识别 <b>' + _pasteItems.length + '</b> 条，可编辑后生成</span>';
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.toggleAllPaste()">全选 / 取消</button>';
      html += '</div>';
      html += '<div class="paste-table">';
      _pasteItems.forEach(function(it, i) {
        var conf = it.confidence || 'none';
        var confLabel = ({ high: '高', medium: '中', low: '低', none: '未识别' })[conf] || '未识别';
        var confColor = ({ high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--text-muted)', none: 'var(--bad)' })[conf] || 'var(--bad)';
        html += '<div class="paste-row" data-idx="' + i + '">';
        html += '<input type="checkbox" class="paste-ck" data-idx="' + i + '" checked>';
        html += '<textarea class="form-input paste-f paste-title" id="pp-title-' + i + '" rows="1" placeholder="事项描述" title="原文：' + escapeAttr(it._raw || '') + '">' + escapeHtml(it.title) + '</textarea>';
        html += '<div class="paste-meta">';
        html += '<input class="form-input paste-f" id="pp-assignee-' + i + '" value="' + escapeAttr(it.assignee) + '" placeholder="负责人">';
        html += '<input class="form-input paste-f" id="pp-due-' + i + '" type="date" value="' + escapeAttr(it.dueDate) + '">';
        html += '<select class="form-input paste-f" id="pp-prio-' + i + '">' + priorityOptions(it.priority) + '</select>';
        html += '<span class="paste-conf" style="color:' + confColor + '" title="置信度: ' + conf + ' — ' + confHint(conf) + '">📅 ' + confLabel + '</span>';
        html += '<button class="btn-icon btn-icon-danger" title="移除" onclick="App.views.tasks.removePasteRow(' + i + ')">✕</button>';
        html += '</div>';
        if (it.warnings && it.warnings.length) {
          html += '<div class="paste-warning">⚠️ ' + escapeHtml(it.warnings.join(' · ')) + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
    // 跳过清单（可点击展开）
    if (_pasteSkipped.length > 0) {
      html += '<details style="margin-top:14px"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">⏭ 被识别为说明跳过 ' + _pasteSkipped.length + ' 行（点击展开）</summary>';
      html += '<div style="margin-top:8px;padding:10px;background:var(--surface-2);border-radius:var(--radius);font-size:11px;color:var(--text-muted);line-height:1.7">';
      _pasteSkipped.forEach(function(s) {
        html += '<div style="margin-bottom:4px"><code style="color:var(--text-faint)">[' + escapeHtml(s.reason) + ']</code> ' + escapeHtml(s.line) + '</div>';
      });
      html += '</div></details>';
    }
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

  /**
   * 粘贴文本解析主入口（v2：输出结构化结果 + 跳过清单 + 每项置信度）
   * 返回 { items, skipped, linesCount }
   *  - items: 待办数组，含 title/dueDate/timeText/assignee/priority/confidence/warnings/_raw
   *  - skipped: [{line, reason}] 被识别为说明/邮件/回复块而跳过的原始行
   */
  function parsePasteText(text, base) {
    if (!base) base = new Date();
    var lines = (text || '').split(/\r?\n/);
    var items = [];
    var skipped = [];
    var lastGroupCount = 0;   // 来自「以上N项」
    var inReply = false;      // 回复块之后不再当作任务

    lines.forEach(function (orig) {
      var line = (orig || '').trim();
      if (!line) return;

      // 1) 回复块：收到回复 / 回复：之后均为留言，跳过
      if (/^(收到回复|回复[:：]|回复如下|医生回复[:：]?)/.test(line)) {
        inReply = true;
        skipped.push({ line: line, reason: '回复块' });
        return;
      }
      if (inReply) { skipped.push({ line: line, reason: '回复块' }); return; }

      // 2) 去掉行首序号 + emoji：先 emoji（顶格 👇）→ 再阿拉伯/中文序号
      var content = line
        .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2700}-\u{27BF}]/gu, '')
        .replace(/^[一二三四五六七八九十]+[、.)\s]\s*/, '')
        .replace(/^\d+[、)]\s*/, '')
        // 阿拉伯序号 + 点仅当点后紧接非数字/点（"1." → 中文）才删；避免吞日期"9.9"
        .replace(/^\d+[.]\s*(?=[^\d.])/, '');
      content = content.trim();
      if (!content) return;

      // 3) 分组指令行：以上N项…（含或不含完成日期）
      var gfm = content.match(/^以上\s*([一二三四五六七八九十两俩\d]+)\s*项/);
      if (gfm) {
        lastGroupCount = cnToNum(gfm[1]);
        var gd = parseDate(content, base);
        if (gd && lastGroupCount) { applyDueToLast(items, lastGroupCount, gd); lastGroupCount = 0; }
        skipped.push({ line: line, reason: '分组后置截止指令' });
        return;
      }

      // 4) 单独的完成/截止指令行：本周六完成 / 今日完成
      if (/完成|截止/.test(content) && isShortDirective(content)) {
        var d = parseDate(content, base);
        if (d) {
          var n = lastGroupCount || countTasksWithoutDue(items);
          applyDueToLast(items, n, d);
          lastGroupCount = 0;
          skipped.push({ line: line, reason: '截止指令' });
          return;
        }
      }

      // 5) 其它说明性标题行（真实条目如「针对家长…跟进」放行）
      var hdrReason = classifyAsHeader(content);
      if (hdrReason) {
        skipped.push({ line: line, reason: hdrReason });
        return;
      }

      // 6) 解析为任务
      var item = extractOne(content, base);
      if (item && item.title && isMeaningfulTitle(item.title)) {
        items.push(item);
      } else if (item) {
        skipped.push({ line: line, reason: '标题无意义' });
      } else {
        skipped.push({ line: line, reason: '未能识别' });
      }
    });

    return { items: items, skipped: skipped, linesCount: lines.length };
  }

  // 说明/邮件/否定句分类：返回 reason 字符串（可优化为命中 token）；null 表示不是 header
  function classifyAsHeader(content) {
    if (content.length >= 6 && /^(以上是|以下是|现将|现就|特此|综上|总之|本次|本周期|本季度|本学期|本学年|同学们|各位|大家|注意[:：]?|任务如下|有如下|有以下|邮件发送|抄送|主送|发件人|收件人|转发|令)/.test(content)) return '邮件/说明行';
    if (/^(针对|关于|根据|按照|请各|请将|请于|请在)/.test(content)) {
      if (/(有以下|有如下|任务如下|几项任务|以下任务|如下[:：]|任务清单|安排如下|具体任务)/.test(content)) return '说明引出句';
    }
    // 否定式限定/告诫：不见、不接、不准、不要、禁止、严禁、不允许、拒绝、绝不
    if (/^(不见|不接|不准|不要|禁止|严禁|不允许|拒绝|绝不|不要|不允许)[\u4e00-\u9fa5]/.test(content)) return '否定式告诫';
    // 邮件/通知 类时间戳行：*邮件发送时间：xx号 / 通知时间 / 提交时间
    if (/(发送时间|发送日期|发件时间|发送期限|提交时间|通知时间|到期时间|截止时间|截止日期)/.test(content)) return '邮件时间说明';
    return null;
  }

  function applyDueToLast(items, n, dateOrGd) {
    var dateStr = dateOrGd && dateOrGd.date !== undefined ? dateOrGd.date : dateOrGd;
    if (!dateStr || n <= 0) return;
    var start = Math.max(0, items.length - n);
    for (var i = start; i < items.length; i++) items[i].dueDate = dateStr; // 分组截止日是权威日期
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

  /**
   * 单行解析（v2：结构化 + 置信度 + 不可识别警告）
   * 流程：
   *   1) extract assignee
   *   2) extract date range (含 timeText)
   *   3) extract priority
   *   4) 标题 = 原行 - 日期片段 - 星期括号 - 优先级词 - 负责人残留 - emoji - 边界标点
   *   5) compute confidence + warnings
   */
  function extractOne(line, base) {
    var raw = line;
    var working = line;

    // 1) 负责人
    var ap = extractAssignee(working);
    var assignee = ap.assignee;
    working = ap.rest;

    // 2) 日期
    var dp = parseDate(working, base);
    var dueDate = dp.date;
    var timeText = dp.timeText;

    // 去掉日期片段 + 星期括号（"（周三）" 这种星期标签括号，不再被误作负责人）
    working = stripDateAndWeekday(working);

    // 3) 优先级
    var priority = detectPriority(raw);
    working = stripPriority(working);

    // 4) 清洗标题
    var title = cleanTitle(working);
    if (!title) return null;

    // 5) 置信度
    var confidence = computeConfidence({
      hasTitle: !!title,
      hasDate: !!dueDate,
      hasTime: !!timeText,
      hasAssignee: !!assignee,
      dateConfidence: dp.dateConfidence
    });
    var warnings = [];
    if (!dueDate) warnings.push('未能识别日期');
    if (!assignee) warnings.push('未识别负责人');

    return {
      title: title,
      assignee: assignee || '',
      dueDate: dueDate || '',
      timeText: timeText || '',
      priority: priority,
      confidence: confidence,
      warnings: warnings,
      status: 'todo',
      _raw: raw,
      _dateRaw: dp.raw
    };
  }

  // 把行内已经"识别走"的日期片段 + 星期括号 删掉（避免重复出现）
  // 不用 \b：JS \b 只对 \w 有效，中文/全角标点全无边界，导致 9.9、（ 之间的边界缺失
  function stripDateAndWeekday(s) {
    return s
      // 9.14--9.18 / 9.14-9.18（区间，可能含 & 连接）
      .replace(/\d{1,2}[\./]\d{1,2}\s*[-–—~到至]+\s*\d{1,2}[\./]\d{1,2}(?:\s*&\s*\d{1,2}[\./]\d{1,2}\s*[-–—~到至]+\s*\d{1,2}[\./]\d{1,2})?/g, ' ')
      // 8月21号 / 8月21日
      .replace(/\d{1,2}月\d{1,2}[日号]/g, ' ')
      // 8.21 号  / 8.21号
      .replace(/\d{1,2}[\./]\d{1,2}\s*号/g, ' ')
      // 9.9 / 9/9 / 9.10
      .replace(/\d{1,2}[\./]\d{1,2}/g, ' ')
      // 2026-08-20
      .replace(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g, ' ')
      // （周三）/ (周四)
      .replace(/[（(]\s*[周星期]\s*[一二三四五六日天]\s*[）)]/g, ' ')
      // 13:00 / 9:30 / 14:30（不再含点号，避免 9.10 被误判为时间）
      .replace(/[01]?\d[:：][0-5]\d/g, ' ');
  }

  function stripPriority(s) {
    return s.replace(/紧急|加急|特急|尽快|重要|高优|🔴|⚠|⭐/g, ' ');
  }

  // 置信度 → 简短原因（用于 hover 提示，告诉用户为什么是这个等级）
  function confHint(c) {
    return ({
      high: '要素齐全、日期明确（绝对日期/具体星期）',
      medium: '识别到区间/相对日期或缺一项关键字段',
      low: '仅有标题或日期模糊',
      none: '无可识别的标题/日期/负责人'
    })[c] || '未知';
  }

  function computeConfidence(c) {
    var score = 0;
    if (c.hasTitle) score += 1;
    if (c.hasDate && c.dateConfidence === 'high') score += 3;
    else if (c.hasDate && c.dateConfidence === 'medium') score += 2;
    else if (c.hasDate) score += 1;
    if (c.hasTime) score += 0.5;
    if (c.hasAssignee) score += 1;
    if (score >= 4.5) return 'high';
    if (score >= 3) return 'medium';
    if (score >= 1.5) return 'low';
    return 'none';
  }

  /**
   * 日期提取（v2：分级解析 + 区间 + 报告）
   * 返回 { date: 'YYYY-MM-DD'|null, dateConfidence: 'high'|'medium'|'low'|null, raw: 命中片段原文 }
   *  - 完整日期（年-月-日） / M月D日 / M/D / M.D ：high
   *  - 相对星期（本周X/下周X/X） ：high
   *  - 今天/明天/后天/今日/明日 ：high
   *  - 「9.14--9.18」 区间 ：medium（取截止日 9.18）
   *  - 多区间「9.14--9.18 & 9.21--9.25」 ：medium（取所有区间截止日的最晚）
   *  - 8.21号 / 8月21号 ：high
   *  - 「13:00单独时间」返回 null + timeText
   */
  function parseDate(text, base) {
    if (!text) return { date: null, dateConfidence: null, raw: '', timeText: '' };

    // 时间片段只识别「数字:数字」（不识别点号"9.10" → "9:10" 那是日期）
    var tm = text.match(/\b([01]?\d|2[0-3])[:：]\s*([0-5]\d)\b/);
    var timeText = tm ? (tm[1].length <= 2 ? tm[1] + ':' : '') : '';
    if (tm) timeText = tm[0].replace(/[：]/g, ':').replace(/\s+/g, '');

    // 1) 完整年-月-日 2026-08-20 / 2026/8/20
    var m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      var d1 = ymdStr(+m[1], +m[2], +m[3]);
      if (d1) return { date: d1, dateConfidence: 'high', raw: m[0], timeText: timeText };
    }

    // 2) M月D日 / M月D号
    m = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
    if (m) {
      var d2 = mdThisOrNextYear(+m[1], +m[2], base);
      if (d2) return { date: d2, dateConfidence: 'high', raw: m[0], timeText: timeText };
    }

    // 3) 多区间 MD--MD [&] MD--MD：单次全局扫描，找出每个 (from, to) 对，截止日取所有 to 的最晚
    var rangeRe = /(\d{1,2})[\./](\d{1,2})\s*[-–—~到至]+\s*(\d{1,2})[\./](\d{1,2})/g;
    var rangeMatches = [];
    var rm;
    while ((rm = rangeRe.exec(text)) !== null) {
      var toDate = mdPairNum(+rm[3], +rm[4], base);
      var fromDate = mdPairNum(+rm[1], +rm[2], base);
      if (toDate) rangeMatches.push({ to: toDate, from: fromDate, raw: rm[0] });
    }
    if (rangeMatches.length) {
      rangeMatches.sort(function (a, b) { return a.to < b.to ? -1 : 1; });
      var latest = rangeMatches[rangeMatches.length - 1];
      return { date: latest.to, dateConfidence: 'medium', raw: latest.raw, timeText: timeText };
    }

    // 4) 单日期 M/D 或 M.D（允许括号周X跟在后面）
    m = text.match(/(\d{1,2})[\/.](\d{1,2})(?!\d)/);
    if (m) {
      var d4 = mdThisOrNextYear(+m[1], +m[2], base);
      if (d4) return { date: d4, dateConfidence: 'high', raw: m[0], timeText: timeText };
    }

    // 5) 单独 M号 或 M号：xxxx（信封/邮件时间戳）
    m = text.match(/(\d{1,2})[\./](\d{1,2})\s*号/);
    if (m) {
      var d5 = mdThisOrNextYear(+m[1], +m[2], base);
      if (d5) return { date: d5, dateConfidence: 'high', raw: m[0], timeText: timeText };
    }

    // 6) 相对星期
    var rd = parseRelativeWeekday(text, base);
    if (rd) return { date: rd, dateConfidence: 'high', raw: text.match(/(本周|这周|下周|下个?周|上周|上個?周)?\s*(?:周|星期)\s*[一二三四五六日天]|\b[一二三四五六日天]周(?:[一二三四五六日天])?/)[0], timeText: timeText };

    // 7) 今天/明天/后天
    if (/明天|明日/.test(text)) {
      var dt = new Date(base); dt.setDate(dt.getDate() + 1);
      return { date: App.util.formatDate(dt, 'YYYY-MM-DD'), dateConfidence: 'high', raw: '明天', timeText: timeText };
    }
    if (/后天/.test(text)) {
      var dt2 = new Date(base); dt2.setDate(dt2.getDate() + 2);
      return { date: App.util.formatDate(dt2, 'YYYY-MM-DD'), dateConfidence: 'high', raw: '后天', timeText: timeText };
    }
    if (/今天|今日|今晚/.test(text)) {
      return { date: App.util.formatDate(base, 'YYYY-MM-DD'), dateConfidence: 'high', raw: '今天', timeText: timeText };
    }

    // 仅时间无日期
    if (timeText) return { date: null, dateConfidence: null, raw: '', timeText: timeText };

    return { date: null, dateConfidence: null, raw: '', timeText: '' };
  }

  // 工具：把 (月, 日) 解析（直接走 mdThisOrNextYear）
  function mdPairNum(mo, d, base) {
    return mdThisOrNextYear(mo, d, base);
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

  // 标签分析：尝试在文本上找出所有人名候选。规则：
  //  - 「@张三」 → 必为负责人
  //  - 「负责人：张三」 → 必为负责人
  //  - 「（张三）」或「(张三)」 → 候选；优先于后置「—张三」
  //  - 行尾「—张三」/「-张三」 → 候选
  // 反向黑名单：括号内命中以下不当作负责人
  //  - 星期/日期标签：周一…周日、天
  //  - 全员/不限制/不参与等通用说明
  //  - 单字（无姓氏名特征） / 含数字 / 含标点的杂项
  var _WEEKDAY_TOKENS = '一二三四五六日天';
  var _BLACK_PARENS = /^(?:周[一二三四五六日天]|星期[一二三四五六日天]|全员|不限制|不限|不参与|不请假|均不|均需|所有|全部|普通|高层|基层|统一|同时|自定|自定义|TBD|TBA|TBC|N\/A|na|n\/a|[一二三四五六日天]|可接可不接)$/i;
  var _NAME_RE = /[\u4e00-\u9fa5·]{2,6}/;

  function extractAssignee(text) {
    var assignee = '';
    var rest = text;

    // 1. @姓名
    var m = rest.match(/@([^\s，。；、,;：:）)】\]]+)/);
    if (m && _NAME_RE.test(m[1])) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }

    // 2. 负责人：姓名
    if (!assignee) {
      m = rest.match(/负责人[：:\s]*([^\s，。；、,;]{1,10}?)(?=[，,。；;：:、\s)]|$)/);
      if (m && _NAME_RE.test(m[1].trim())) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }

    // 3. （姓名）或(姓名) — 但只接受"明确人名特征"的（如带"老师"/"经理"/"主管"/"校长"等）或 2~6 字姓名
    if (!assignee) {
      m = rest.match(/[（(]([\u4e00-\u9fa5·]{2,6})[）)]/);
      if (m) {
        var cand = m[1].trim();
        if (!_BLACK_PARENS.test(cand)) { assignee = cand; rest = rest.replace(m[0], ' '); }
      }
    }

    // 4. 行尾 — 姓名 / - 姓名（破折号接 2~6 字姓名）
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

  // 清洗标题——只删除已经抽取出去的字段，不能再把日期/负责人/优先级删第二次
  // 这里负责删: emoji / [@] / 「负责人」提示文字 / [方括号表情] / 边界标点 / 多余空白
  function cleanTitle(s) {
    if (!s) return '';
    var x = String(s)
      // 微信方括号表情 [加油] [抱拳] 等
      .replace(/\[[\u4e00-\u9fa5a-zA-Z0-9 _+]{1,10}\]/g, ' ')
      // 单左方括号残留
      .replace(/[\[【]([^】\]]*)/g, ' ')
      .replace(/[】\]]/g, ' ')
      // emoji（包含全字符集）
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, ' ')
      // 「另、」一类的虚词前缀（前缀若是序号/虚词可以删）
      .replace(/^(?:另|另外|再|额外|附加|还|还有|以及)\s*[、,，]\s*/, '')
      // 微信括号说明（全员.../不予请假）— 因为前面已经过滤过负责人括号，这里剩下的（xxx）可以认为是非负责人说明
      .replace(/[（(][\u4e00-\u9fa5a-zA-Z0-9_,，。：:；;·\s]{2,30}[）)]/g, ' ')
      // 多余空白
      .replace(/\s{2,}/g, ' ')
      // 边界标点
      .replace(/^[\s：:、，。\-—–=·•,.;；]+/, '')
      .replace(/[\s：:、，。\-—–=·•,.;；]+$/, '')
      .trim();
    return x;
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
    archiveTask: archiveTask,
    archiveAllDone: archiveAllDone,
    openArchiveModal: openArchiveModal,
    unarchiveTask: unarchiveTask,
    purgeArchived: purgeArchived,
    clearAllArchived: clearAllArchived,
    // —— 视图增强 v2 ——
    setViewMode: setViewMode,
    setDensity: setDensity,
    setSearch: setSearch,
    toggleFilter: toggleFilter,
    clearFilters: clearFilters,
    setSort: setSort,
    toggleSortDir: toggleSortDir,
    toggleGroup: toggleGroup,
    setColumnLimit: setColumnLimit
  };

})();
