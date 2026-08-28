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
  var _pasteResult = null;           // 整次解析结果（含 errors）

  /* ---------------- 路由 ---------------- */
  App.router.register('/tasks', function() {
    var container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = renderBoard();
  });

  /* ---------------- 数据访问 ---------------- */
  function getTasks() { return App.store.get('tasks') || []; }

  /* ---------------- 视图设置（持久化）---------------- */
  var VIEW_DEFAULT = { mode:'kanban', density:'standard', filters:{status:[],priority:[],source:[],scope:[]}, sortBy:'dueDate', sortDir:'asc', search:'', expanded:{}, columnLimit:10 };
  function getViewSettings() {
    var s = App.store.get('settings.tasksView');
    if (!s) return JSON.parse(JSON.stringify(VIEW_DEFAULT));
    if (!s.filters) s.filters = { status:[], priority:[], source:[] };
    if (!s.filters.scope) s.filters.scope = [];
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
    var st = fs.status || [], pr = fs.priority || [], sr = fs.source || [], sc = fs.scope || [];
    return tasks.filter(function(t) {
      if (st.length && st.indexOf(t.status) === -1) return false;
      if (pr.length && pr.indexOf(t.priority || 'normal') === -1) return false;
      if (sr.length) {
        var src = t.source || 'manual';
        if (sr.indexOf(src) === -1) return false;
      }
      if (sc.length && sc.indexOf(t.scope || 'personal') === -1) return false;
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
    updateView({ filters: { status:[], priority:[], source:[], scope:[] }, search: '' });
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
    html += '<button class="btn btn-ghost" onclick="App.views.tasks.openRulesModal()">⚙ 提取规则</button>';
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
    html += '<input class="form-input tasks-search" placeholder="🔍 搜索 标题/负责人/备注" value="' + App.util.escapeAttr(view.search) + '" oninput="App.views.tasks.setSearch(this.value)">';
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
    var srMap = { manual: '手动', timeline: '⏱时间轴', paste: '📋粘贴', 'teacher-milestone': '🎯里程碑' };
    ['manual', 'timeline', 'paste', 'teacher-milestone'].forEach(function(s) {
      var on = (f.source || []).indexOf(s) >= 0;
      html += '<button class="chip' + (on ? ' on' : '') + '" onclick="App.views.tasks.toggleFilter(\'source\',\'' + s + '\')">' + srMap[s] + '</button>';
    });
    html += '<span class="filter-sep"></span>';
    var scopeMap = { personal: '个人', team: '团队' };
    ['personal', 'team'].forEach(function(s) {
      var on = (f.scope || []).indexOf(s) >= 0;
      html += '<button class="chip' + (on ? ' on' : '') + '" onclick="App.views.tasks.toggleFilter(\'scope\',\'' + s + '\')">' + scopeMap[s] + '</button>';
    });
    var anyFilter = (f.status && f.status.length) || (f.priority && f.priority.length) || (f.source && f.source.length) || (f.scope && f.scope.length) || view.search;
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
    var overdue = t.status !== 'done' && t.dueDate && App.util.isOverdue(t.dueDate);
    var srcLabel = t.source === 'timeline' ? '⏱ 时间轴' : (t.source === 'paste' ? '📋 粘贴' : (t.source === 'teacher-milestone' ? '🎯 里程碑' : '手动'));
    var html = '<tr class="tasks-list-row' + (overdue ? ' overdue' : '') + '">';
    html += '<td class="list-title" onclick="App.views.tasks.editTask(\'' + t.id + '\')">' + App.util.escapeHtml(t.title || '未命名任务');
    if (t.scope === 'team') html += '<span class="scope-tag">团队</span>';
    if (t.note) html += '<div class="list-note">' + App.util.escapeHtml(t.note) + '</div>';
    html += '</td>';
    html += '<td><span class="tag status-' + t.status + '">' + App.util.statusLabel(t.status) + '</span></td>';
    html += '<td><span class="tag priority-' + (t.priority || 'normal') + '">' + App.util.priorityLabel(t.priority) + '</span></td>';
    html += '<td>' + (t.assignee ? App.util.escapeHtml(t.assignee) : '<span style="color:var(--text-faint)">—</span>') + '</td>';
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
        html += '<div class="group-preview-item">' + App.util.escapeHtml(App.util.truncate(t.title || '未命名任务', 50)) + '</div>';
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
    var overdue = t.status !== 'done' && t.dueDate && App.util.isOverdue(t.dueDate);
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
    html += '<div class="kanban-card-title">' + App.util.escapeHtml(t.title || '未命名任务') + '</div>';
    html += '<div class="kanban-card-meta">';
    html += '<span class="tag priority-' + prio + '">' + App.util.priorityLabel(prio) + '</span>';
    if (t.scope === 'team') html += '<span class="tag scope-team">团队</span>';
    if (t.assignee) html += '<span>👤 ' + App.util.escapeHtml(t.assignee) + '</span>';
    if (t.dueDate) html += '<span style="color:' + (overdue ? 'var(--bad)' : 'var(--text-faint)') + '">📅 ' + App.util.escapeHtml(t.dueDate) + '</span>';
    html += '</div>';
    if (t.source === 'timeline') html += '<div class="kanban-card-note">⏱ 来自时间轴</div>';
    else if (t.source === 'paste') html += '<div class="kanban-card-note">📋 来自粘贴</div>';
    else if (t.note) html += '<div class="kanban-card-note">' + App.util.escapeHtml(t.note) + '</div>';
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
    App.util.toast('「' + App.util.escapeHtml(t.title) + '」→ ' + App.util.statusLabel(status), 'ok');
    App.router.resolve();
  }

  /* ---------------- 新建 / 编辑 ---------------- */
  function openTaskModal(id) {
    var isEdit = !!id;
    var t = isEdit ? getTasks().filter(function(x) { return x.id === id; })[0] : null;
    var data = t || { title: '', priority: 'normal', status: 'todo', assignee: '', dueDate: '', note: '', scope: 'personal' };

    var html = '<div style="display:flex;flex-direction:column;gap:14px">';
    html += '<div class="form-group"><label class="form-label">标题</label><input class="form-input" id="task-title" value="' + App.util.escapeAttr(data.title) + '" placeholder="如：完成次月预排课表"></div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label class="form-label">优先级</label><select class="form-input" id="task-priority">' + priorityOptions(data.priority) + '</select></div>';
    html += '<div class="form-group"><label class="form-label">所属状态</label><select class="form-input" id="task-status">' + statusOptions(data.status) + '</select></div>';
    html += '</div>';
    html += '<div class="form-group"><label class="form-label">归属</label>';
    html += '<div style="display:flex;gap:16px">';
    html += '<label class="chk-inline"><input type="radio" id="task-scope-personal" name="task-scope" value="personal"' + (data.scope !== 'team' ? ' checked' : '') + '> 个人</label>';
    html += '<label class="chk-inline"><input type="radio" id="task-scope-team" name="task-scope" value="team"' + (data.scope === 'team' ? ' checked' : '') + '> 团队</label>';
    html += '</div></div>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label class="form-label">负责人</label><input class="form-input" id="task-assignee" value="' + App.util.escapeAttr(data.assignee) + '" placeholder="如：张老师"></div>';
    html += '<div class="form-group"><label class="form-label">截止日期</label><input class="form-input" id="task-due" type="date" value="' + App.util.escapeAttr(data.dueDate) + '"></div>';
    html += '</div>';
    html += '<div class="form-group"><label class="form-label">备注</label><textarea class="form-input" id="task-note" placeholder="补充说明（可选）">' + App.util.escapeHtml(data.note || '') + '</textarea></div>';
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
    var scopeTeamEl = document.getElementById('task-scope-team');
    var scope = (scopeTeamEl && scopeTeamEl.checked) ? 'team' : 'personal';

    var tasks = getTasks();
    if (id) {
      var t = tasks.filter(function(x) { return x.id === id; })[0];
      if (t) Object.assign(t, { title: title, priority: priority, status: status, assignee: assignee, dueDate: dueDate, note: note, scope: scope, updatedAt: new Date().toISOString() });
    } else {
      tasks.push({
        id: App.store.uid('task'),
        title: title, priority: priority, status: status,
        assignee: assignee, dueDate: dueDate, note: note, scope: scope,
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
      content: '确定删除任务「' + App.util.escapeHtml(t.title) + '」？此操作不可撤销。',
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

  function archiveTask(id) {
    var tasks = getTasks();
    var t = tasks.filter(function(x) { return x.id === id; })[0];
    if (!t) return;
    t.archived = true;
    App.store.set('tasks', tasks);
    App.util.toast('已归档「' + App.util.escapeHtml(t.title) + '」', 'ok');
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
        html += '<div class="archive-row-title">' + App.util.escapeHtml(t.title || '未命名任务') + '</div>';
        html += '<div class="archive-row-meta">';
        html += '<span class="tag priority-' + (t.priority || 'normal') + '">' + App.util.priorityLabel(t.priority) + '</span>';
        if (t.assignee) html += '<span>👤 ' + App.util.escapeHtml(t.assignee) + '</span>';
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
    App.util.toast('已恢复「' + App.util.escapeHtml(t.title) + '」到看板', 'ok');
    openArchiveModal();
    App.router.resolve();
  }

  function purgeArchived(id) {
    var t = getTasks().filter(function(x) { return x.id === id; })[0];
    if (!t) return;
    App.util.modal({
      title: '确认彻底删除',
      content: '确定彻底删除「' + App.util.escapeHtml(t.title) + '」？此操作不可恢复，且不会保留在归档列表中。',
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
        scope: 'personal',
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

  /* ---------------- 粘贴提取（规则驱动 + 即时校验） ---------------- */
  var _currentRule = null;
  var _editingRuleId = null;
  var _editingRuleBase = null;

  function openPasteModal() {
    var ex = document.querySelector('.modal-overlay');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    _pasteItems = [];
    _pasteSkipped = [];
    _pasteResult = null;
    _currentRule = selectRule(getRules(), '') || getRules()[0] || null;

    var html = '';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.6">从工作群复制内容粘贴到下方，系统按所选<b>规则</b>自动识别字段并即时校验。可在右上「⚙ 管理规则」里自定义字段格式与分隔符。' +
      '识别方式支持 <code>@张三</code>、<code>负责人：张三</code>、<code>（张三）</code>、<code>8月20日</code>、<code>下周三</code>、<code>9.9（周三）</code> 等多种格式，并自动跳过说明/邮件/回复块。</p>';

    // 规则选择条
    html += '<div class="paste-rulebar">';
    html += '<span class="paste-rulebar-label">使用规则</span>';
    html += '<select id="paste-rule" class="form-input" onchange="App.views.tasks.onPasteRuleChange(this.value)">';
    getRules().forEach(function(r) {
      if (!r.enabled) return;
      html += '<option value="' + r.id + '"' + (_currentRule && _currentRule.id === r.id ? ' selected' : '') + '>' + App.util.escapeHtml(r.name) + (r.isDefault ? '（默认）' : '') + '</option>';
    });
    html += '</select>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.openRulesModal()">⚙ 管理规则</button>';
    html += '</div>';

    html += '<textarea id="paste-input" class="form-input" rows="6" style="font-family:var(--font-mono);font-size:12px" placeholder="示例：\n@张老师 完成次月预排课表 8月20日\n下周三前 提交教务周报 — 李教务\n（王主管）核对新生名单 截止8/25 紧急"></textarea>';
    html += '<div id="paste-preview" style="margin-top:14px"></div>';

    App.util.modal({
      title: '📋 粘贴提取待办',
      content: html,
      showCancel: true,
      confirmText: '一键生成待办',
      onConfirm: function(close) { confirmPasteImport(close); }
    });

    var ta = document.getElementById('paste-input');
    if (ta) {
      ta.addEventListener('input', onPasteInput);
      ta.focus();
    }
    onPasteInput();
  }

  function onPasteRuleChange(ruleId) {
    var r = getRules().filter(function(x) { return x.id === ruleId; })[0];
    if (r) _currentRule = r;
    onPasteInput();
  }

  function onPasteInput() {
    var ta = document.getElementById('paste-input');
    if (!ta) return;
    var rule = _currentRule || selectRule(getRules(), ta.value) || getRules()[0];
    _currentRule = rule;
    var result = parsePasteText(ta.value, null, rule);
    _pasteResult = result;
    _pasteItems = result.items;       // 与 result.items 同一引用
    _pasteSkipped = result.skipped;
    renderPastePreview();
  }

  // 校验横幅（三态：成功 / 警告 / 错误）
  function renderPasteBanner(result, rule) {
    var n = result.items.length;
    var errCount = (result.errors || []).length;
    var skipped = (result.skipped || []).length;
    if (n === 0) {
      var msg = skipped > 0
        ? '未识别到待办事项 —— 当前规则与内容不匹配，已跳过 ' + skipped + ' 行说明。可在「⚙ 管理规则」调整，或切换/新建规则。'
        : '未识别到任何内容。请粘贴待办文本，或检查所选规则。';
      return '<div class="paste-banner paste-banner-error">❌ ' + msg + '</div>';
    }
    if (errCount > 0) {
      return '<div class="paste-banner paste-banner-warn">⚠️ 识别 <b>' + n + '</b> 条，其中 <b>' + errCount + '</b> 条缺必填字段（红框标注），可补充后生成，或忽略直接生成。</div>';
    }
    return '<div class="paste-banner paste-banner-ok">✅ 成功匹配 <b>' + n + '</b> 条，字段齐全，可一键生成' + (skipped ? '（另跳过 ' + skipped + ' 行说明）' : '') + '。</div>';
  }

  function renderPastePreview() {
    var box = document.getElementById('paste-preview');
    if (!box) return;
    var result = _pasteResult;
    var rule = _currentRule;
    if (!result) { box.innerHTML = '<p style="font-size:12px;color:var(--text-faint);text-align:center;padding:14px">粘贴文本后将在此预览解析结果…</p>'; return; }

    var html = '';
    html += renderPasteBanner(result, rule);

    if (result.items.length === 0 && result.skipped.length === 0) {
      html += '<p style="font-size:12px;color:var(--text-faint);text-align:center;padding:14px">粘贴文本后将在此预览解析结果，可勾选并编辑后生成。</p>';
    } else if (result.items.length > 0) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 8px">';
      html += '<span style="font-size:12px;color:var(--text-muted)">已识别 <b>' + result.items.length + '</b> 条，可编辑后生成</span>';
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.toggleAllPaste()">全选 / 取消</button>';
      html += '</div>';
      html += renderPreviewTable(result, rule, 'pp');
    }
    html += renderSkipped(result);
    box.innerHTML = html;
  }

  // 纯渲染：提取结果表格（粘贴弹窗与规则编辑器实时测试共用）。idPrefix 避免多实例 id 冲突
  function renderPreviewTable(result, rule, idPrefix) {
    idPrefix = idPrefix || 'pp';
    var fields = orderedEnabledFields(rule);
    var items = result.items;
    if (!items.length) return '<p style="font-size:12px;color:var(--text-faint);text-align:center;padding:14px">未识别到事项。</p>';
    var html = '<div class="paste-table">';
    items.forEach(function(it, i) {
      var hasErr = it._errors && it._errors.length;
      html += '<div class="paste-row' + (hasErr ? ' paste-row-error' : '') + '" data-idx="' + i + '">';
      html += '<input type="checkbox" class="paste-ck" data-idx="' + i + '" checked>';
      html += '<textarea class="form-input paste-f paste-title" id="' + idPrefix + '-title-' + i + '" rows="1" placeholder="事项描述" title="原文：' + App.util.escapeAttr(it._raw || '') + '">' + App.util.escapeHtml(it.title) + '</textarea>';
      html += '<div class="paste-meta">';
      fields.forEach(function(fld) {
        var val = it[fld.key] || '';
        var miss = fld.required && !val;
        if (fld.key === 'dueDate') {
          html += '<input class="form-input paste-f' + (miss ? ' paste-miss' : '') + '" id="' + idPrefix + '-due-' + i + '" type="date" value="' + App.util.escapeAttr(val) + '" title="' + (fld.required ? '必填字段' : '截止日期') + '">';
        } else if (fld.key === 'priority') {
          html += '<select class="form-input paste-f" id="' + idPrefix + '-prio-' + i + '">' + priorityOptions(it.priority) + '</select>';
        } else if (fld.key === 'assignee') {
          html += '<input class="form-input paste-f' + (miss ? ' paste-miss' : '') + '" id="' + idPrefix + '-assignee-' + i + '" value="' + App.util.escapeAttr(val) + '" placeholder="负责人" title="' + (fld.required ? '必填字段' : '负责人') + '">';
        } else if (fld.key === 'time') {
          html += '<input class="form-input paste-f" id="' + idPrefix + '-time-' + i + '" value="' + App.util.escapeAttr(val) + '" placeholder="时间">';
        }
      });
      // 置信度胶囊
      var conf = it.confidence || 'none';
      var confLabel = ({ high: '高', medium: '中', low: '低', none: '未识别' })[conf] || '未识别';
      var confColor = ({ high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--text-muted)', none: 'var(--bad)' })[conf] || 'var(--bad)';
      html += '<span class="paste-conf" style="color:' + confColor + '" title="置信度: ' + conf + ' — ' + confHint(conf) + '">📅 ' + confLabel + '</span>';
      html += '<button class="btn-icon btn-icon-danger" title="移除" onclick="App.views.tasks.removePasteRow(' + i + ')">✕</button>';
      html += '</div>';
      if (it._errors && it._errors.length) {
        html += '<div class="paste-warning">⚠️ ' + App.util.escapeHtml(it._errors.join(' · ')) + '</div>';
      } else if (it.warnings && it.warnings.length) {
        html += '<div class="paste-warning">⚠️ ' + App.util.escapeHtml(it.warnings.join(' · ')) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderSkipped(result) {
    if (!result.skipped || !result.skipped.length) return '';
    var html = '<details style="margin-top:14px"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">⏭ 被识别为说明跳过 ' + result.skipped.length + ' 行（点击展开）</summary>';
    html += '<div style="margin-top:8px;padding:10px;background:var(--surface-2);border-radius:var(--radius);font-size:11px;color:var(--text-muted);line-height:1.7">';
    result.skipped.forEach(function(s) {
      html += '<div style="margin-bottom:4px"><code style="color:var(--text-faint)">[' + App.util.escapeHtml(s.reason) + ']</code> ' + App.util.escapeHtml(s.line) + '</div>';
    });
    html += '</div></details>';
    return html;
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
    var items = _pasteResult ? _pasteResult.items : _pasteItems;
    for (var i = 0; i < items.length; i++) {
      var ck = document.querySelector('.paste-ck[data-idx="' + i + '"]');
      if (ck && !ck.checked) continue;
      var titleEl = document.getElementById('pp-title-' + i);
      var title = titleEl ? titleEl.value.trim() : '';
      if (!title) continue;
      var assignee = (document.getElementById('pp-assignee-' + i) || {}).value.trim();
      var due = (document.getElementById('pp-due-' + i) || {}).value;
      var prio = (document.getElementById('pp-prio-' + i) || {}).value;
      var timeVal = (document.getElementById('pp-time-' + i) || {}).value.trim();
      tasks.push({
        id: App.store.uid('task'),
        title: title,
        priority: prio,
        status: 'todo',
        assignee: assignee,
        dueDate: due || '',
        note: timeVal ? ('时间 ' + timeVal) : '',
        source: 'paste',
        scope: 'personal',
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

  /* ---------------- 规则管理 + 编辑器 ---------------- */
  function openRulesModal() {
    var ex = document.querySelector('.modal-overlay');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    App.util.modal({
      title: '⚙ 提取规则管理',
      content: '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;line-height:1.6">粘贴时系统按「触发关键词」自动选用最匹配的规则；都不命中时回退到<strong>默认规则</strong>。点击规则可编辑字段、格式、分隔符与跳过项。切换/删除后即时生效。</p>' +
               '<div id="rules-list-wrap"></div>',
      showCancel: true,
      cancelText: '关闭',
      confirmText: '＋ 新建规则',
      onConfirm: function(close) { openRuleEditor(null); }
    });
    renderRulesList();
  }

  function renderRulesList() {
    var wrap = document.getElementById('rules-list-wrap');
    if (!wrap) return;
    var rules = getRules();
    var html = '<div class="rules-list">';
    rules.forEach(function(r) {
      var trig = (r.triggers || []).length ? r.triggers.join('、') : '<span class="rule-faint">（兜底，无触发词）</span>';
      var fcount = Object.keys(r.fields || {}).filter(function(k) { return r.fields[k] && r.fields[k].enabled !== false; }).length;
      html += '<div class="rule-card">';
      html += '<div class="rule-card-head">';
      html += '<label class="switch switch-sm"><input type="checkbox" ' + (r.enabled ? 'checked' : '') + ' onchange="App.views.tasks.toggleRule(\'' + r.id + '\')"><span class="slider"></span></label>';
      html += '<span class="rule-name">' + App.util.escapeHtml(r.name) + '</span>';
      if (r.isDefault) html += '<span class="rule-badge rule-badge-default">默认</span>';
      html += '</div>';
      html += '<div class="rule-card-meta">触发词：' + trig + ' · 启用字段 <b>' + fcount + '</b> 个</div>';
      html += '<div class="rule-card-actions">';
      if (!r.isDefault) html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.setDefaultRule(\'' + r.id + '\')">设为默认</button>';
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.openRuleEditor(\'' + r.id + '\')">编辑</button>';
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.duplicateRule(\'' + r.id + '\')">复制</button>';
      if (rules.length > 1) html += '<button class="btn btn-danger btn-ghost btn-sm" onclick="App.views.tasks.deleteRule(\'' + r.id + '\')">删除</button>';
      html += '</div></div>';
    });
    html += '</div>';
    wrap.innerHTML = html;
  }

  function toggleRule(id) {
    var rules = getRules();
    var r = rules.filter(function(x) { return x.id === id; })[0];
    if (r) { r.enabled = !r.enabled; saveRules(rules); renderRulesList(); }
  }

  function setDefaultRule(id) {
    var rules = getRules();
    rules.forEach(function(r) { r.isDefault = (r.id === id); });
    saveRules(rules);
    App.store.set('settings.defaultRuleId', id);
    renderRulesList();
  }

  function duplicateRule(id) {
    var rules = getRules();
    var src = rules.filter(function(x) { return x.id === id; })[0];
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = 'rule_' + Date.now().toString(36);
    copy.name = src.name + ' 副本';
    copy.isDefault = false;
    rules.push(copy);
    saveRules(rules);
    renderRulesList();
  }

  function deleteRule(id) {
    var rules = getRules();
    if (rules.length <= 1) { App.util.toast('至少保留一条规则', 'warn'); return; }
    var name = (rules.filter(function(x) { return x.id === id; })[0] || {}).name || '';
    App.util.modal({
      title: '确认删除规则',
      content: '确定删除规则「<b>' + App.util.escapeHtml(name) + '</b>」？',
      confirmText: '删除', confirmStyle: 'danger',
      onConfirm: function(close) {
        var remaining = rules.filter(function(x) { return x.id !== id; });
        if (remaining.length && !remaining.some(function(r) { return r.isDefault; })) {
          remaining[0].isDefault = true;
          App.store.set('settings.defaultRuleId', remaining[0].id);
        }
        saveRules(remaining);
        close();
        renderRulesList();
      }
    });
  }

  function blankRule() {
    return {
      id: 'rule_' + Date.now().toString(36),
      name: '新规则',
      enabled: true,
      isDefault: false,
      triggers: [],
      lineDelimiter: '\\n',
      rowDelimiter: '',
      fields: {
        title:    { key: 'title',    label: '事项',     enabled: true,  required: true,  method: 'remainder', col: 0 },
        dueDate:  { key: 'dueDate',  label: '截止日期', enabled: true,  required: false, method: 'auto', col: 0, formats: ['YMD', 'MD_CN', 'MD_DOT', 'MD_HAO', 'WEEKDAY', 'RELATIVE', 'RANGE'], rangeLatest: true },
        time:     { key: 'time',     label: '时间',     enabled: true,  required: false, method: 'auto', col: 0 },
        assignee: { key: 'assignee', label: '负责人',   enabled: true,  required: false, method: 'auto', col: 0, markers: ['at', 'colon', 'parens', 'dash', 'role'] },
        priority: { key: 'priority', label: '优先级',   enabled: true,  required: false, method: 'auto', col: 0, keywords: ['紧急', '加急', '特急', '尽快', '重要', '高优'] }
      },
      lineFilters: { skipReply: true, skipSectionHeaders: true, skipNegative: true, skipEmailLines: true, skipPreface: true, skipNotice: true, groupBackfill: true }
    };
  }

  var _FIELD_LABELS = { title: '事项', dueDate: '截止日期', time: '时间', assignee: '负责人', priority: '优先级' };

  function openRuleEditor(ruleId) {
    var rules = getRules();
    var existing = ruleId ? rules.filter(function(r) { return r.id === ruleId; })[0] : null;
    var rule = existing ? JSON.parse(JSON.stringify(existing)) : blankRule();
    _editingRuleId = existing ? existing.id : null;

    var html = '<div class="rule-editor">';
    // 名称 + 启用
    html += '<div class="form-row">';
    html += '<div class="form-group" style="flex:2"><label class="form-label">规则名称</label><input class="form-input" id="re-name" value="' + App.util.escapeAttr(rule.name) + '"></div>';
    html += '<div class="form-group" style="flex:0 0 90px"><label class="form-label">启用</label><label class="switch"><input type="checkbox" id="re-enabled" ' + (rule.enabled ? 'checked' : '') + '><span class="slider"></span></label></div>';
    html += '</div>';
    // 触发词
    html += '<div class="form-group"><label class="form-label">触发关键词（粘贴内容含任一词即优先选用，逗号分隔；留空 = 兜底规则）</label><input class="form-input" id="re-triggers" value="' + App.util.escapeAttr((rule.triggers || []).join('，')) + '" placeholder="如：竞聘，9月事项，新生"></div>';
    // 行内字段分隔符（分隔符模式）
    html += '<div class="form-group"><label class="form-label">行内字段分隔符（留空 = 按整行智能提取；填「|」或「,」等可将一行拆列，再用下方「指定列」精确取字段）</label><input class="form-input" id="re-rowDelim" value="' + App.util.escapeAttr(rule.rowDelimiter || '') + '" placeholder="如： |  或  ， （单字符）"></div>';

    // —— 字段配置 ——
    html += '<h4 class="rule-sec-title">字段配置（勾选即提取该列；可设「指定列」用分隔符精确取数，或设必填）</h4>';
    html += '<div class="rule-fields">';
    ['title', 'dueDate', 'time', 'assignee', 'priority'].forEach(function(k) {
      var fc = rule.fields[k] || {};
      var method = fc.method || (k === 'title' ? 'remainder' : 'auto');
      html += '<div class="rule-field-row">';
      html += '<label class="switch switch-sm"><input type="checkbox" id="re-f-' + k + '" ' + (fc.enabled !== false ? 'checked' : '') + '><span class="slider"></span></label>';
      html += '<span class="rule-field-label">' + _FIELD_LABELS[k] + '</span>';
      // 提取方式：自动 / 指定列
      html += '<span class="rule-field-opts">';
      html += '<label class="chk-inline">方式<select class="form-input re-method" data-key="' + k + '" style="width:auto;display:inline-block;padding:2px 6px;margin-left:4px">' +
        '<option value="' + (k === 'title' ? 'remainder' : 'auto') + '"' + (method === 'auto' || method === 'remainder' ? ' selected' : '') + '>自动</option>' +
        '<option value="column"' + (method === 'column' ? ' selected' : '') + '>指定列</option>' +
        '</select></label>';
      html += '<label class="chk-inline">列号<input type="number" min="0" class="form-input re-col" data-key="' + k + '" value="' + (typeof fc.col === 'number' ? fc.col : 0) + '" style="width:54px;padding:2px 6px;margin-left:4px"></label>';
      html += '</span>';
      if (k === 'dueDate') {
        var fmts = fc.formats || [];
        var fmtDefs = [['YMD', '年-月-日'], ['MD_CN', 'M月D日'], ['MD_DOT', 'M.D / M/D'], ['MD_HAO', 'M号'], ['WEEKDAY', '星期/周X'], ['RELATIVE', '今天/明天'], ['RANGE', '区间 M-M']];
        html += '<span class="rule-field-opts">';
        fmtDefs.forEach(function(fd) {
          html += '<label class="chk-inline"><input type="checkbox" class="re-dfmt" data-fmt="' + fd[0] + '" ' + (fmts.indexOf(fd[0]) >= 0 ? 'checked' : '') + '> ' + fd[1] + '</label>';
        });
        html += '<label class="chk-inline"><input type="checkbox" id="re-rangeLatest" ' + (fc.rangeLatest ? 'checked' : '') + '> 区间取最晚</label>';
        html += '</span>';
      }
      if (k === 'assignee') {
        var mk = fc.markers || [];
        var mkDefs = [['at', '@姓名'], ['colon', '负责人：'], ['parens', '（姓名）'], ['dash', '行尾—姓名'], ['role', '请各位主管']];
        html += '<span class="rule-field-opts">';
        mkDefs.forEach(function(md) {
          html += '<label class="chk-inline"><input type="checkbox" class="re-marker" data-mk="' + md[0] + '" ' + (mk.indexOf(md[0]) >= 0 ? 'checked' : '') + '> ' + md[1] + '</label>';
        });
        html += '</span>';
      }
      if (k === 'priority') {
        html += '<span class="rule-field-opts"><input class="form-input" id="re-prio-kw" value="' + App.util.escapeAttr((fc.keywords || []).join('，')) + '" placeholder="关键词逗号分隔" style="width:200px"></span>';
      }
      if (k !== 'title') {
        html += '<label class="chk-inline rule-req"><input type="checkbox" id="re-req-' + k + '" ' + (fc.required ? 'checked' : '') + '> 必填</label>';
      }
      html += '</div>';
    });
    html += '</div>';

    // —— 行级过滤 ——
    html += '<h4 class="rule-sec-title">跳过项（识别为说明而非任务行）</h4>';
    html += '<div class="rule-filters">';
    var lfDefs = [
      ['skipReply', '回复块（收到回复后整段跳过）'],
      ['skipSectionHeaders', '章节标题（👉一、/ 一、事项）'],
      ['skipNegative', '否定式告诫（不见…不…）'],
      ['skipEmailLines', '邮件/抄送行（无日期才跳过）'],
      ['skipPreface', '前言引出句（另有…说明）'],
      ['skipNotice', '通知行（以上是/现将/各位…）'],
      ['groupBackfill', '分组后置截止（以上N项+日期回填）']
    ];
    lfDefs.forEach(function(lfd) {
      html += '<label class="chk-inline"><input type="checkbox" id="re-lf-' + lfd[0] + '" ' + (rule.lineFilters[lfd[0]] ? 'checked' : '') + '> ' + lfd[1] + '</label>';
    });
    html += '</div>';

    // —— 实时测试 ——
    html += '<h4 class="rule-sec-title">实时测试（按当前配置即时解析）</h4>';
    html += '<textarea id="re-test-input" class="form-input" rows="4" style="font-family:var(--font-mono);font-size:12px" placeholder="在此粘贴示例文本，下方即时显示提取结果…"></textarea>';
    html += '<div id="re-test-preview" style="margin-top:10px"></div>';
    html += '</div>';

    App.util.modal({
      title: existing ? ('编辑规则 · ' + rule.name) : '新建提取规则',
      content: html,
      showCancel: true,
      confirmText: '保存规则',
      onConfirm: function(close) { saveRuleFromForm(existing ? existing.id : null, close); }
    });

    var ta = document.getElementById('re-test-input');
    if (ta) {
      ta.addEventListener('input', ruleTestInput);
      ta.value = '@示例 提交周报 8月20日 紧急\n下周三前 完成排课 — 李教务\n9.14--9.18 集团竞聘述职';
      ruleTestInput();
    }
  }

  function gatherRuleFromForm() {
    var name = ((document.getElementById('re-name') || {}).value || '').trim() || '新规则';
    var enabled = document.getElementById('re-enabled') ? document.getElementById('re-enabled').checked : true;
    var triggers = ((document.getElementById('re-triggers') || {}).value || '').split(/[，,\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
    var rowDelim = ((document.getElementById('re-rowDelim') || {}).value || '').trim();
    var fields = {};
    ['title', 'dueDate', 'time', 'assignee', 'priority'].forEach(function(k) {
      var en = document.getElementById('re-f-' + k) ? document.getElementById('re-f-' + k).checked : false;
      var methodSel = document.querySelector('.re-method[data-key="' + k + '"]');
      var colInp = document.querySelector('.re-col[data-key="' + k + '"]');
      var method = methodSel ? methodSel.value : (k === 'title' ? 'remainder' : 'auto');
      var col = colInp ? parseInt(colInp.value, 10) || 0 : 0;
      var base = { key: k, label: _FIELD_LABELS[k], enabled: en, required: false, method: method, col: col };
      if (k === 'title' && method === 'auto') base.method = 'remainder';
      if (k === 'dueDate') {
        var fmts = []; document.querySelectorAll('.re-dfmt:checked').forEach(function(c) { fmts.push(c.getAttribute('data-fmt')); });
        base.formats = fmts;
        base.rangeLatest = document.getElementById('re-rangeLatest') ? document.getElementById('re-rangeLatest').checked : true;
      }
      if (k === 'assignee') {
        var mk = []; document.querySelectorAll('.re-marker:checked').forEach(function(c) { mk.push(c.getAttribute('data-mk')); });
        base.markers = mk;
      }
      if (k === 'priority') {
        base.keywords = ((document.getElementById('re-prio-kw') || {}).value || '').split(/[，,\s]+/).map(function(s) { return s.trim(); }).filter(Boolean);
      }
      if (k !== 'title') { base.required = document.getElementById('re-req-' + k) ? document.getElementById('re-req-' + k).checked : false; }
      fields[k] = base;
    });
    var lf = {};
    ['skipReply', 'skipSectionHeaders', 'skipNegative', 'skipEmailLines', 'skipPreface', 'skipNotice', 'groupBackfill'].forEach(function(k) {
      lf[k] = document.getElementById('re-lf-' + k) ? document.getElementById('re-lf-' + k).checked : false;
    });
    return { name: name, enabled: enabled, triggers: triggers, lineDelimiter: '\\n', rowDelimiter: rowDelim, fields: fields, lineFilters: lf };
  }

  function ruleTestInput() {
    var ta = document.getElementById('re-test-input');
    var box = document.getElementById('re-test-preview');
    if (!ta || !box) return;
    var r = gatherRuleFromForm();
    r.id = _editingRuleId || 'rule_test';
    var result = parseWithRule(r, ta.value, new Date());
    box.innerHTML = renderPasteBanner(result, r) + (result.items.length ? renderPreviewTable(result, r, 'rt') : '') + renderSkipped(result);
  }

  function saveRuleFromForm(existingId, close) {
    var rules = getRules();
    var r = gatherRuleFromForm();
    if (existingId) {
      var idx = rules.map(function(x) { return x.id; }).indexOf(existingId);
      if (idx >= 0) {
        r.id = existingId;
        r.isDefault = rules[idx].isDefault;
        rules[idx] = r;
      } else { rules.push(r); }
    } else {
      r.id = 'rule_' + Date.now().toString(36);
      if (rules.length === 0) { r.isDefault = true; App.store.set('settings.defaultRuleId', r.id); }
      rules.push(r);
    }
    saveRules(rules);
    App.util.toast('规则已保存', 'ok');
    if (close) close();
    if (document.getElementById('rules-list-wrap')) renderRulesList();
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

  /* ---------------- 规则驱动解析引擎 ---------------- */
  function getRules() {
    var r = App.store.get('settings.extractionRules');
    return Array.isArray(r) ? r : [];
  }
  function saveRules(rules) { App.store.set('settings.extractionRules', rules); }
  function getDefaultRuleId() { return App.store.get('settings.defaultRuleId'); }

  // 自动选规则：触发词命中数最多者优先；都未命中则回退默认/第一条
  function selectRule(rules, text) {
    var enabled = (rules || []).filter(function(r) { return r && r.enabled; });
    if (!enabled.length) return null;
    var best = null, bestScore = -1;
    enabled.forEach(function(r) {
      var score = 0;
      (r.triggers || []).forEach(function(t) { if (t && text.indexOf(t) >= 0) score++; });
      if (r.isDefault) score += 0.5;
      if (score > bestScore) { bestScore = score; best = r; }
    });
    if (bestScore <= 0) {
      var def = enabled.filter(function(r) { return r.isDefault; })[0];
      return def || enabled[0] || null;
    }
    return best;
  }

  // 主入口（兼容旧签名）：未指定 rule 时自动选默认规则
  function parsePasteText(text, base, rule) {
    if (!rule) {
      var rules = getRules();
      rule = selectRule(rules, text) || rules[0];
    }
    if (!rule) return { items: [], skipped: [], linesCount: 0, errors: [] };
    return parseWithRule(rule, text, base);
  }

  // 规则驱动解析（输出 items + skipped + errors；errors 为必填缺失的行下标）
  function parseWithRule(rule, text, base) {
    if (!base) base = new Date();
    var lines = (text || '').split(/\r?\n/);
    var items = [], skipped = [], errors = [];
    var lastGroupCount = 0, inReply = false;
    var lf = rule.lineFilters || {};

    lines.forEach(function (orig) {
      var line = (orig || '').trim();
      if (!line) return;

      if (lf.skipReply && /^(收到回复|回复[:：]|回复如下|医生回复[:：]?)/.test(line)) {
        inReply = true; skipped.push({ line: line, reason: '回复块' }); return;
      }
      if (inReply) { skipped.push({ line: line, reason: '回复块' }); return; }

      if (lf.skipSectionHeaders && isSectionHeader(line)) { skipped.push({ line: line, reason: '章节标题' }); return; }

      // 分隔符（表格）模式：非表格行与表头行直接跳过，不当作任务（实现「模板=规则、零调整」）
      if (rule && rule.rowDelimiter) {
        var _normLine = line.replace(/｜/g, '|');
        if (_normLine.indexOf(rule.rowDelimiter) < 0) {
          skipped.push({ line: line, reason: '非表格行' }); return;
        }
        var _hdTokens = ['事项', '任务', '标题', '名称', '内容', '工作'].concat((rule.headerTokens || []));
        var _firstCol = _normLine.split(rule.rowDelimiter)[0].trim();
        if (_hdTokens.indexOf(_firstCol) >= 0) { skipped.push({ line: line, reason: '表头行' }); return; }
      }

      var content = stripLeading(line);
      if (!content) return;

      if (lf.groupBackfill) {
        var gfm = content.match(/^以上\s*([一二三四五六七八九十两俩\d]+)\s*项/);
        if (gfm) {
          lastGroupCount = cnToNum(gfm[1]);
          var gd = parseDate(content, base, rule);
          if (gd && gd.date && lastGroupCount) { applyDueToLast(items, lastGroupCount, gd); lastGroupCount = 0; }
          skipped.push({ line: line, reason: '分组后置截止指令' }); return;
        }
        if (/完成|截止/.test(content) && isShortDirective(content)) {
          var d = parseDate(content, base, rule);
          if (d && d.date) {
            var n = lastGroupCount || countTasksWithoutDue(items);
            applyDueToLast(items, n, d); lastGroupCount = 0;
            skipped.push({ line: line, reason: '截止指令' }); return;
          }
        }
      }

      var hdrReason = classifyAsHeader(content, rule);
      if (hdrReason) { skipped.push({ line: line, reason: hdrReason }); return; }

      var item = extractOne(content, base, rule);
      if (item && item.title && isMeaningfulTitle(item.title)) {
        items.push(item);
      } else if (item) {
        skipped.push({ line: line, reason: '标题无意义' });
      } else {
        skipped.push({ line: line, reason: '未能识别' });
      }
    });

    // 必填字段校验
    var reqFields = requiredFields(rule);
    items.forEach(function(it, i) {
      it._errors = [];
      reqFields.forEach(function(f) {
        var v = it[f.key];
        if (!v) it._errors.push(f.label + '缺失');
      });
      if (it._errors.length) errors.push(i);
    });

    return { items: items, skipped: skipped, linesCount: lines.length, errors: errors };
  }

  function requiredFields(rule) {
    var out = [];
    var f = rule.fields || {};
    Object.keys(f).forEach(function(k) {
      var fc = f[k];
      if (fc && fc.enabled !== false && fc.required) out.push({ key: k, label: fc.label || k });
    });
    return out;
  }

  function orderedEnabledFields(rule) {
    var f = rule.fields || {};
    var order = ['dueDate', 'time', 'assignee', 'priority'];
    var out = [];
    order.forEach(function(k) {
      var fc = f[k];
      if (fc && fc.enabled !== false) out.push({ key: k, label: fc.label || k, required: !!fc.required });
    });
    return out;
  }

  // 行首清洗：emoji → 中文序号 → 阿拉伯序号（点后必须非数字）→ trim（顺序不能换）
  function stripLeading(line) {
    return line
      .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/^[一二三四五六七八九十]+[、.)\s]\s*/, '')
      .replace(/^\d+[、)]\s*/, '')
      .replace(/^\d+[.]\s*(?=[^\d.])/, '')
      .trim();
  }

  // 说明/邮件/否定句分类：受 rule.lineFilters 开关控制；返回 reason 字符串；null 表示不是 header
  function classifyAsHeader(content, rule) {
    var lf = (rule && rule.lineFilters) || {};
    // 前言/引出句：另有几项事项说明 / 以下是安排 / 共X项任务 等
    if (lf.skipPreface && /^(另有|还有|以下是?|现|今|共(?:有)?)\s*[\d几数多若干]+?\s*(?:项|个)?\s*(?:事项|任务|安排|说明|通知|要求|工作|部署|如下|以下)/.test(content)) return '说明引出句';
    if (lf.skipNotice && content.length >= 6 && /^(以上是|以下是|现将|现就|特此|综上|总之|本次|本周期|本季度|本学期|本学年|同学们|各位|大家|注意[:：]?|任务如下|有如下|有以下|邮件发送|抄送|主送|发件人|收件人|转发|令)/.test(content)) return '邮件/说明行';
    if (lf.skipNotice && /^(针对|关于|根据|按照|请各|请将|请于|请在)/.test(content)) {
      if (/(有以下|有如下|任务如下|几项任务|以下任务|如下[:：]|任务清单|安排如下|具体任务)/.test(content)) return '说明引出句';
    }
    // 否定式限定/告诫：不见、不接、不准、不要、禁止、严禁、不允许、拒绝、绝不
    if (lf.skipNegative && /^(不见|不接|不准|不要|禁止|严禁|不允许|拒绝|绝不|不允许)[\u4e00-\u9fa5]/.test(content)) return '否定式告诫';
    // 邮件/通知 类时间戳行：仅有时间属性且不含具体日期 → 跳过；
    // 含具体事项 + 日期（如「竞聘邮件发送时间：8.21号」）→ 视为任务，向下交给 extractOne
    if (lf.skipEmailLines && /(发送时间|发送日期|发件时间|发送期限|提交时间|通知时间|到期时间|截止时间|截止日期)/.test(content)) {
      if (!hasDateHint(content)) return '邮件时间说明';
    }
    return null;
  }

  // 行内是否含有「具体日期」提示（区分纯时间说明行 与「事项 + 时间」任务行）
  function hasDateHint(s) {
    return /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(\d{1,2}月\d{1,2}[日号])|(\d{1,2}[\./]\d{1,2}\s*号)|(\d{1,2}[\./]\d{1,2}(?!\d))|(周|星期)[一二三四五六日天]|(今天|今日|明天|明日|后天|昨晚)|(本周|下周|上周)/.test(s);
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

  // 顶级章节标题：👉一、新生 / ▶二、9月事项安排 / 一、任务部署 等 → 跳过，不当作任务
  function isSectionHeader(line) {
    // 带箭头/符号的顶级中文编号标题
    if (/^(👉|▶|◆|●|•|·|★|☆|➤|➜|►|\s)*[一二三四五六七八九十百零]+[、.、)\s（(]/.test(line)) return true;
    // 中文序号 + 章节名词（无箭头也视为标题）
    if (/^[一二三四五六七八九十百零]+[、.、][^\n]*?(新生|事项|安排|任务|工作|计划|通知|说明|要求|汇报|总结|会议|活动|部署|专题|板块|模块|阶段|内容|如下|以下|落地|推进)/.test(line)) return true;
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
  function extractOne(line, base, rule) {
    var raw = line;
    var f = (rule && rule.fields) || {};

    // 分隔符模式：按 rowDelimiter 把一行拆成列，被「指定列」字段占用的列从自动文本中剔除
    var cols = null, working;
    if (rule && rule.rowDelimiter) {
      cols = line.replace(/｜/g, '|').split(rule.rowDelimiter).map(function(c) { return c.trim(); });
      var consumed = {};
      Object.keys(f).forEach(function(k) {
        var fc = f[k];
        if (fc && fc.enabled !== false && fc.method === 'column' && typeof fc.col === 'number') consumed[fc.col] = true;
      });
      working = cols.filter(function(c, i) { return !consumed[i]; }).join(' ');
    } else {
      working = line;
    }

    // 1) 负责人
    var assignee = '';
    var af = f.assignee;
    if (af && af.enabled !== false) {
      if (af.method === 'column' && typeof af.col === 'number' && cols && cols[af.col] !== undefined) {
        assignee = cols[af.col].replace(/^负责人[：:]\s*/, '').trim();
      } else {
        var ap = extractAssignee(working, af);
        assignee = ap.assignee;
        working = ap.rest;
      }
    }

    // 2) 日期
    var dueDate = '', timeText = '';
    var df = f.dueDate;
    if (df && df.enabled !== false) {
      if (df.method === 'column' && typeof df.col === 'number' && cols && cols[df.col] !== undefined) {
        var dpc = parseDate(cols[df.col], base, rule);
        dueDate = dpc.date || '';
        timeText = dpc.timeText || '';
      } else {
        var dp = parseDate(working, base, rule);
        dueDate = dp.date || '';
        timeText = dp.timeText || '';
        working = stripDateAndWeekday(working);
      }
    }

    // 2.5) 独立时间列（time 字段单独成列时，取该列的时间，不污染日期）
    var tf2 = f.time;
    if (tf2 && tf2.enabled !== false && tf2.method === 'column' && typeof tf2.col === 'number' && cols && cols[tf2.col] !== undefined) {
      var tpc = parseDate(cols[tf2.col], base, rule);
      if (tpc && tpc.timeText) timeText = tpc.timeText;
    }

    // 3) 优先级
    var priority = 'normal';
    var pf = f.priority;
    if (pf && pf.enabled !== false) {
      if (pf.method === 'column' && typeof pf.col === 'number' && cols && cols[pf.col] !== undefined) {
        priority = normalizePriorityText(cols[pf.col]);
      } else {
        priority = detectPriority(raw, pf);
        working = stripPriority(working);
      }
    }

    // 4) 清洗标题
    var title = '';
    var tf = f.title;
    if (tf && tf.method === 'column' && typeof tf.col === 'number' && cols && cols[tf.col] !== undefined) {
      title = cleanTitle(cols[tf.col]);
    } else {
      title = cleanTitle(working);
    }
    if (!title) return null;

    // 5) 置信度
    var confidence = computeConfidence({
      hasTitle: !!title,
      hasDate: !!dueDate,
      hasTime: !!timeText,
      hasAssignee: !!assignee,
      dateConfidence: (f.dueDate && f.dueDate.enabled !== false && dueDate) ? 'high' : null
    });
    var warnings = [];
    if (!dueDate) warnings.push('未能识别日期');
    if (!assignee) warnings.push('未识别负责人');

    return {
      title: title,
      assignee: assignee || '',
      dueDate: dueDate || '',
      time: timeText || '',
      timeText: timeText || '',
      priority: priority,
      confidence: confidence,
      warnings: warnings,
      status: 'todo',
      _raw: raw,
      _dateRaw: ''
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
  function parseDate(text, base, rule) {
    if (!text) return { date: null, dateConfidence: null, raw: '', timeText: '' };
    var df = (rule && rule.fields) ? rule.fields.dueDate : null;
    var fmts = df ? (df.formats || null) : null;   // null = 全部启用
    var allow = function (k) { return !fmts || fmts.indexOf(k) >= 0; };

    // 时间片段只识别「数字:数字」（不识别点号"9.10" → "9:10" 那是日期）
    var tm = text.match(/\b([01]?\d|2[0-3])[:：]\s*([0-5]\d)\b/);
    var timeText = '';
    if (tm) timeText = tm[0].replace(/[：]/g, ':').replace(/\s+/g, '');

    // 1) 完整年-月-日 2026-08-20 / 2026/8/20
    if (allow('YMD')) {
      var m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (m) {
        var d1 = ymdStr(+m[1], +m[2], +m[3]);
        if (d1) return { date: d1, dateConfidence: 'high', raw: m[0], timeText: timeText };
      }
    }

    // 2) M月D日 / M月D号
    if (allow('MD_CN')) {
      var m2 = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
      if (m2) {
        var d2 = mdThisOrNextYear(+m2[1], +m2[2], base);
        if (d2) return { date: d2, dateConfidence: 'high', raw: m2[0], timeText: timeText };
      }
    }

    // 3) 多区间 MD--MD [&] MD--MD：单次全局扫描，找出每个 (from, to) 对，截止日取所有 to 的最晚
    if (allow('RANGE') && df && df.rangeLatest) {
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
    }

    // 4) 单日期 M/D 或 M.D
    if (allow('MD_DOT')) {
      var m4 = text.match(/(\d{1,2})[\/.](\d{1,2})(?!\d)/);
      if (m4) {
        var d4 = mdThisOrNextYear(+m4[1], +m4[2], base);
        if (d4) return { date: d4, dateConfidence: 'high', raw: m4[0], timeText: timeText };
      }
    }

    // 5) 单独 M号 / M号（信封/邮件时间戳）
    if (allow('MD_HAO')) {
      var m5 = text.match(/(\d{1,2})[\./](\d{1,2})\s*号/);
      if (m5) {
        var d5 = mdThisOrNextYear(+m5[1], +m5[2], base);
        if (d5) return { date: d5, dateConfidence: 'high', raw: m5[0], timeText: timeText };
      }
    }

    // 6) 相对星期
    if (allow('WEEKDAY')) {
      var rd = parseRelativeWeekday(text, base);
      if (rd) {
        var wm = text.match(/(本周|这周|下周|下个?周|上周|上個?周)?\s*(?:周|星期)\s*[一二三四五六日天]|\b[一二三四五六日天]周(?:[一二三四五六日天])?/);
        return { date: rd, dateConfidence: 'high', raw: wm ? wm[0] : '', timeText: timeText };
      }
    }

    // 7) 今天/明天/后天
    if (allow('RELATIVE')) {
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

  function extractAssignee(text, cfg) {
    var markers = (cfg && cfg.markers) || ['at', 'colon', 'parens', 'dash', 'role'];
    var assignee = '';
    var rest = text;

    // 1. @姓名
    if (markers.indexOf('at') >= 0) {
      var m = rest.match(/@([^\s，。；、,;：:）)】\]]+)/);
      if (m && _NAME_RE.test(m[1])) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }

    // 2. 负责人：姓名
    if (!assignee && markers.indexOf('colon') >= 0) {
      m = rest.match(/负责人[：:\s]*([^\s，。；、,;]{1,10}?)(?=[，,。；;：:、\s)]|$)/);
      if (m && _NAME_RE.test(m[1].trim())) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }

    // 2.5 请各位/各/全体 + 角色（主管/老师/经理…）→ 负责人
    if (!assignee && markers.indexOf('role') >= 0) {
      m = rest.match(/请\s*(?:各位|各|全体|所有)?\s*([\u4e00-\u9fa5]{0,4}(?:主管|老师|经理|校长|组长|负责人|专员|部长|主任|科长|教务|客服|科组))/);
      if (m) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }

    // 3. （姓名）或(姓名) — 但只接受"明确人名特征"的（如带"老师"/"经理"/"主管"/"校长"等）或 2~6 字姓名
    if (!assignee && markers.indexOf('parens') >= 0) {
      m = rest.match(/[（(]([\u4e00-\u9fa5·]{2,6})[）)]/);
      if (m) {
        var cand = m[1].trim();
        if (!_BLACK_PARENS.test(cand)) { assignee = cand; rest = rest.replace(m[0], ' '); }
      }
    }

    // 4. 行尾 — 姓名 / - 姓名（破折号接 2~6 字姓名）
    if (!assignee && markers.indexOf('dash') >= 0) {
      m = rest.match(/[—\-–=]\s*([\u4e00-\u9fa5·]{2,6})\s*$/);
      if (m) { assignee = m[1].trim(); rest = rest.replace(m[0], ' '); }
    }

    return { assignee: assignee, rest: rest };
  }

  function detectPriority(text, cfg) {
    var kws = (cfg && cfg.keywords) || [];
    var urgentMark = ['紧急', '加急', '特急', '尽快', '🔴'];
    var highMark = ['重要', '高优', '⚠'];
    var custom = kws.filter(function (k) { return urgentMark.indexOf(k) < 0 && highMark.indexOf(k) < 0; });
    if (urgentMark.some(function (k) { return text.indexOf(k) >= 0; })) return 'urgent';
    if (highMark.some(function (k) { return text.indexOf(k) >= 0; })) return 'high';
    if (custom.some(function (k) { return k && text.indexOf(k) >= 0; })) return 'high';
    return 'normal';
  }

  // 优先级列中文归一到应用枚举（紧急/重要/普通/低），容忍「高/中」等口语写法
  function normalizePriorityText(s) {
    if (!s) return 'normal';
    var t = String(s).replace(/[\s（(].*$/, '').trim();
    if (/紧急|加急|特急|尽快|urgent/i.test(t)) return 'urgent';
    if (/重要|高优|高|优先|high/i.test(t)) return 'high';
    if (/低|low/i.test(t)) return 'low';
    if (/普通|中|正常|一般|normal/i.test(t)) return 'normal';
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
      // 尾部时间属性词（发送时间/截止时间/时间/日期）→ 「竞聘邮件发送」这类标题更干净
      .replace(/(?:发送时间|提交时间|截止时间|通知时间|发送日期|截止日期|到期时间|的?时间|的?日期)[\s：:、，。！？]*$/, '')
      // 多余空白
      .replace(/\s{2,}/g, ' ')
      // 边界标点
      .replace(/^[\s：:、，。\-—–=·•,.;；！？]+/, '')
      .replace(/[\s：:、，。\-—–=·•,.;；！？]+$/, '')
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
    onPasteRuleChange: onPasteRuleChange,
    onPasteInput: onPasteInput,
    removePasteRow: removePasteRow,
    toggleAllPaste: toggleAllPaste,
    // —— 规则管理 + 编辑器 ——
    openRulesModal: openRulesModal,
    openRuleEditor: openRuleEditor,
    toggleRule: toggleRule,
    setDefaultRule: setDefaultRule,
    duplicateRule: duplicateRule,
    deleteRule: deleteRule,
    saveRuleFromForm: saveRuleFromForm,
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
