/* ============================================
   tasks.js — 事项跟进 v2
   看板/列表双视图 + 完整CRUD + 拖拽状态切换
   + 拆解下发（父子任务）+ 删除确认
   ============================================ */

(function() {

  /* ---- 路由注册 ---- */
  App.router.register('/tasks', function() {
    var container = document.getElementById('view-container');
    if (!container) return;

    var mode = localStorage.getItem('tasks_view') || 'kanban';

    var html = '';

    // 工具栏
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    html += '<button class="btn btn-primary" onclick="App.views.tasks.openTaskModal()">' + App.util.svgIcon('plus', 14) + ' 新建待办</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.tasks.openDecompose()">' + App.util.svgIcon('edit', 14) + ' 拆解下发</button>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    // 筛选
    html += '<select class="form-select btn-sm" id="task-filter-project" onchange="App.views.tasks.render()" style="width:auto;padding:6px 24px 6px 10px;font-size:12px"><option value="">全部项目组</option>' +
      Object.keys(App.projectGroups).map(function(k) { return '<option value="' + k + '">' + App.projectGroups[k].name + '</option>'; }).join('') +
      '</select>';
    html += '</div></div>';

    // 视图切换
    html += '<div class="tabs">';
    html += '<button class="tab ' + (mode === 'kanban' ? 'active' : '') + '" onclick="App.views.tasks.switchView(\'kanban\')">看板</button>';
    html += '<button class="tab ' + (mode === 'list' ? 'active' : '') + '" onclick="App.views.tasks.switchView(\'list\')">列表</button>';
    html += '</div>';

    // 获取筛选后的任务
    var filterProj = document.getElementById('task-filter-project');
    var projFilter = filterProj ? filterProj.value : '';
    var tasks = getFilteredTasks(projFilter);

    if (mode === 'kanban') {
      html += renderKanban(tasks);
    } else {
      html += renderList(tasks);
    }

    container.innerHTML = html;

    // 绑定筛选器
    var fp = document.getElementById('task-filter-project');
    if (fp) fp.value = projFilter;

    // 绑定拖拽事件（仅看板模式）
    if (mode === 'kanban') bindDragDrop();
  });

  /* ---- 数据获取与过滤 ---- */
  function getFilteredTasks(projectFilter) {
    var tasks = App.store.get('tasks') || [];
    var today = App.util.formatDate(new Date(), 'YYYY-MM-DD');

    // 自动标记逾期
    tasks.forEach(function(t) {
      if (t.status !== 'done' && t.status !== 'overdue' && t.due && t.due < today) {
        t.status = 'overdue';
      }
    });

    if (projectFilter) {
      tasks = tasks.filter(function(t) { return t.project === projectFilter; });
    }

    return tasks;
  }

  /* ==================== 看板视图 ==================== */
  var COLUMNS = [
    { key: 'overdue', label: '⚠️ 已逾期' },
    { key: 'todo',    label: '📋 待办' },
    { key: 'doing',   label: '🔄 进行中' },
    { key: 'following',label:'👁 待跟进' },
    { key: 'done',    label: '✅ 已完成' }
  ];

  function renderKanban(tasks) {
    var html = '<div class="kanban-board" id="kanban-board">';
    COLUMNS.forEach(function(col) {
      var colTasks = tasks.filter(function(t) { return t.status === col.key; });
      html += '<div class="kanban-column" data-status="' + col.key + '" id="col-' + col.key + '">';
      html += '<div class="kanban-col-header">';
      html += '<span class="kanban-col-title">' + col.label + '</span>';
      html += '<span class="kanban-col-count">' + colTasks.length + '</span>';
      html += '</div>';
      html += '<div class="kanban-cards" data-status="' + col.key + '">';

      colTasks.forEach(function(t) {
        html += renderKanbanCard(t);
      });

      if (colTasks.length === 0) {
        html += '<div class="kanban-empty">暂无</div>';
      }

      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function renderKanbanCard(t) {
    var pg = t.project ? App.projectGroups[t.project] : null;
    var isOverdue = t.status === 'overdue';
    var hasChildren = t.children && t.children.length > 0;

    var html = '';
    html += '<div class="kanban-card" draggable="true" data-task-id="' + t.id + '" id="card-' + t.id + '">';
    // 操作按钮行（右上角）
    html += '<div class="kanban-card-actions">';
    html += '<button class="btn-icon" title="编辑" onclick="event.stopPropagation();App.views.tasks.openTaskModal(\'' + t.id + '\')">' + App.util.svgIcon('edit', 13) + '</button>';
    html += '<button class="btn-icon btn-icon-danger" title="删除" onclick="event.stopPropagation();App.views.tasks.confirmDelete(\'' + t.id + '\')">' + App.util.svgIcon('trash-2', 13) + '</button>';
    html += '</div>';

    // 标题（点击也可编辑）
    html += '<div class="kanban-card-body" onclick="App.views.tasks.openTaskModal(\'' + t.id + '\')">';
    html += '<div class="kanban-card-title"' + (isOverdue ? ' style="color:var(--bad)"' : '') + '>' + App.util.truncate(t.title, 35) + '</div>';
    html += '<div class="kanban-card-meta">';
    if (t.priority === 'urgent' || t.priority === 'high') {
      html += '<span class="' + (t.priority === 'urgent' ? 'priority-urgent' : 'priority-high') + '">' + App.util.priorityLabel(t.priority) + '</span>';
    }
    if (t.due) {
      var dueClass = new Date(t.due) < new Date() && t.status !== 'done' ? 'tag-bad' : 'tag-neutral';
      html += '<span class="tag ' + dueClass + '" style="font-size:10px">' + t.due + '</span>';
    }
    if (pg) {
      html += '<span class="tag tag-neutral" style="font-size:10px">' + pg.name.replace('项目组','') + '</span>';
    }
    if (hasChildren) {
      html += '<span class="tag tag-accent" style="font-size:10px">📎 ' + t.children.length + '子项</span>';
    }
    html += '</div>'; // meta
    if (t.note) {
      html += '<div class="kanban-card-note">' + App.util.truncate(t.note, 50) + '</div>';
    }
    html += '</div>'; // body
    html += '</div>'; // card
    return html;
  }

  /* ==================== 列表视图 ==================== */
  function renderList(tasks) {
    var sorted = tasks.slice().sort(function(a, b) {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1;
      if (b.status === 'overdue' && a.status !== 'overdue') return 1;
      var pa = { urgent: 0, high: 1, normal: 2, low: 3 };
      if ((pa[a.priority] || 99) !== (pa[b.priority] || 99)) return (pa[a.priority] || 99) - (pa[b.priority] || 99);
      if (a.due && b.due) return a.due.localeCompare(b.due);
      return 0;
    });

    var html = '<div class="card" style="overflow:hidden"><table class="data-table"><thead><tr>';
    html += '<th style="width:36px"></th><th>事项</th><th style="width:80px">优先级</th><th style="width:100px">截止日期</th><th style="width:80px">状态</th><th style="width:100px">项目组</th><th style="width:120px">操作</th>';
    html += '</tr></thead><tbody>';

    if (sorted.length === 0) {
      html += '<tr><td colspan="7"><div class="empty-state" style="padding:30px"><p>暂无待办事项</p></div></td></tr>';
    } else {
      sorted.forEach(function(t) {
        var pg = t.project ? App.projectGroups[t.project] : null;
        html += '<tr>';
        html += '<td><span class="status-dot ' + App.util.statusColor(t.status) + '"></span></td>';
        html += '<td><strong' + (t.status === 'overdue' ? ' style="color:var(--bad)"' : '') + '>' + App.util.truncate(t.title, 40) + '</strong>';
        if (t.source) { html += '<br><span style="font-size:11px;color:var(--text-faint)">来源: ' + t.source + '</span>'; }
        html += '</td>';
        html += '<td><span class="' + (t.priority === 'urgent' ? 'priority-urgent' : t.priority === 'high' ? 'priority-high' : 'priority-normal') + '">' + App.util.priorityLabel(t.priority) + '</span></td>';
        html += '<td class="mono" style="font-size:12px' + (t.due && t.due < App.util.formatDate(new Date(), 'YYYY-MM-DD') && t.status !== 'done' ? ';color:var(--bad)' : '') + '">' + (t.due || '-') + '</td>';
        html += '<td><span class="tag tag-' + App.util.statusColor(t.status) + '" style="font-size:11px">' + App.util.statusLabel(t.status) + '</span></td>';
        html += '<td>' + (pg ? '<span class="tag tag-neutral" style="font-size:10px">' + pg.name.replace('项目组','') + '</span>' : '-') + '</td>';
        html += '<td><div style="display:flex;gap:4px;flex-wrap:wrap">';
        html += '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();App.views.tasks.openTaskModal(\'' + t.id + '\')" title="编辑">✏️</button>';
        if (t.status !== 'done') {
          html += '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();App.views.tasks.quickStatus(\'' + t.id + '\')" title="快速流转">✓</button>';
        }
        html += '<button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="event.stopPropagation();App.views.tasks.confirmDelete(\'' + t.id + '\')" title="删除">🗑</button>';
        html += '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    return html;
  }

  /* ==================== 拖拽：HTML5 Drag & Drop ==================== */
  var dragSrcEl = null;

  function bindDragDrop() {
    var board = document.getElementById('kanban-board');
    if (!board) return;

    var cards = board.querySelectorAll('.kanban-card[draggable]');
    var dropZones = board.querySelectorAll('.kanban-cards[data-status]');

    cards.forEach(function(card) {
      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragend', handleDragEnd);
      card.addEventListener('dragenter', handleDragEnter);
      card.addEventListener('dragleave', handleDragLeave);
      card.addEventListener('dragover', handleDragOver);
      card.addEventListener('drop', handleDrop);
    });
  }

  function handleDragStart(e) {
    dragSrcEl = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.taskId);
    // 延迟添加半透明效果
    setTimeout(function() {
      if (dragSrcEl) dragSrcEl.style.opacity = '0.4';
    }, 0);
  }

  function handleDragEnd(e) {
    this.classList.remove('dragging');
    this.style.opacity = '';
    dragSrcEl = null;
    // 清除所有 drop-zone 高亮
    document.querySelectorAll('.kanban-cards').forEach(function(z) {
      z.classList.remove('drop-over');
    });
  }

  function handleDragEnter(e) {
    e.preventDefault();
    // 找到最近的 .kanban-cards 容器
    var zone = this.closest('.kanban-cards');
    if (zone) zone.classList.add('drop-over');
  }

  function handleDragLeave(e) {
    var zone = this.closest('.kanban-cards');
    if (zone && !zone.contains(e.relatedTarget)) {
      zone.classList.remove('drop-over');
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    var taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    // 找到目标列的状态
    var targetZone = this.closest('.kanban-cards');
    if (!targetZone) return;

    var newStatus = targetZone.dataset.status;
    if (!newStatus || newStatus === dragSrcEl.dataset.taskId) return;

    // 更新状态
    App.store.update('tasks', taskId, { status: newStatus });
    App.util.toast('已移动到「' + statusLabelCN(newStatus) + '」', 'ok');

    // 移除高亮
    targetZone.classList.remove('drop-over');

    // 重新渲染
    App.router.resolve();
  }

  function statusLabelCN(status) {
    var map = { overdue: '已逾期', todo: '待办', doing: '进行中', following: '待跟进', done: '已完成' };
    return map[status] || status;
  }

  /* ==================== CRUD：新建 / 编辑 Modal ==================== */
  function openTaskModal(editId) {
    var allTasks = App.store.get('tasks') || [];
    var task = editId ? allTasks.find(function(t) { return t.id === editId; }) : null;
    var isEdit = !!task;

    App.util.modal({
      title: isEdit ? '✏️ 编辑待办' : '➕ 新建待办',
      content: buildFormHtml(task),
      confirmText: isEdit ? '保存修改' : '创建',
      showCancel: true,
      onConfirm: function(close) {
        if (!saveFromForm(isEdit, editId)) return;
        close();
        App.router.resolve();
      }
    });
  }

  function buildFormHtml(task) {
    var h = '';
    h += '<div class="form-group"><label class="form-label">标题 *</label>';
    h += '<input class="form-input" id="task-title" placeholder="待办事项标题" value="' + escapeAttr(task ? task.title : '') + '"></div>';

    h += '<div class="form-row">';
    h += '<div class="form-group"><label class="form-label">来源会议/项目</label>';
    h += '<input class="form-input" id="task-source" placeholder="如：主管会、教务会" value="' + escapeAttr(task ? (task.source || '') : '') + '"></div>';
    h += '<div class="form-group"><label class="form-label">关联项目组</label>';
    h += '<select class="form-select" id="task-project"><option value="">无</option>';
    Object.keys(App.projectGroups).map(function(k) {
      h += '<option value="' + k + '"' + (task && task.project === k ? ' selected' : '') + '>' + App.projectGroups[k].name + '</option>';
    }).join('');
    h += '</select></div></div>';

    h += '<div class="form-row">';
    h += '<div class="form-group"><label class="form-label">负责人</label>';
    h += '<input class="form-input" id="task-owner" placeholder="self 或 姓名" value="' + escapeAttr(task ? (task.owner || 'self') : 'self') + '"></div>';
    h += '<div class="form-group"><label class="form-label">优先级</label>';
    h += '<select class="form-select" id="task-priority">';
    ['low','normal','high','urgent'].forEach(function(p) {
      var labels = { low: '低', normal: '普通', high: '高', urgent: '紧急' };
      h += '<option value="' + p + '"' + (task && task.priority === p ? ' selected' : '') + '>' + labels[p] + '</option>';
    });
    h += '</select></div></div>';

    h += '<div class="form-row">';
    h += '<div class="form-group"><label class="form-label">截止日期</label>';
    h += '<input class="form-input" id="task-due" type="date" value="' + (task ? (task.due || '') : '') + '"></div>';
    h += '<div class="form-group"><label class="form-label">状态</label>';
    h += '<select class="form-select" id="task-status">';
    var statuses = [
      { v: 'todo', l: '待办' }, { v: 'doing', l: '进行中' },
      { v: 'following', l: '待跟进' }, { v: 'done', l: '已完成' }
    ];
    statuses.forEach(function(s) {
      h += '<option value="' + s.v + '"' + (task && task.status === s.v ? ' selected' : '') + '>' + s.l + '</option>';
    });
    h += '</select></div></div>';

    h += '<div class="form-group"><label class="form-label">备注</label>';
    h += '<textarea class="form-textarea" id="task-note" placeholder="补充说明..." rows="3">' + escapeAttr(task ? (task.note || '') : '') + '</textarea></div>';

    // 编辑模式下显示删除按钮
    if (isEdit) {
      h += '<div style="margin-top:12px;text-align:right">';
      h += '<button class="btn btn-ghost btn-sm" style="color:var(--bad)" id="modal-delete-btn" type="button">🗑 删除此待办</button>';
      h += '</div>';
    }

    return h;
  }

  function saveFromForm(isEdit, editId) {
    var title = document.getElementById('task-title').value.trim();
    if (!title) { App.util.toast('请输入标题', 'warn'); return false; }

    var taskData = {
      title: title,
      source: document.getElementById('task-source').value.trim(),
      project: document.getElementById('task-project').value || null,
      owner: document.getElementById('task-owner').value.trim() || 'self',
      priority: document.getElementById('task-priority').value,
      due: document.getElementById('task-due').value || null,
      status: document.getElementById('task-status').value,
      note: document.getElementById('task-note').value.trim()
    };

    if (isEdit) {
      App.store.update('tasks', editId, taskData);
      App.util.toast('已更新待办', 'ok');
    } else {
      taskData.id = App.store.uid('task');
      taskData.parentId = null;
      taskData.children = [];
      taskData.createdAt = new Date().toISOString();
      App.store.push('tasks', taskData);
      App.util.toast('已创建待办', 'ok');
    }
    return true;
  }

  function escapeAttr(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ==================== 删除（带确认） ==================== */
  function confirmDelete(taskId) {
    var allTasks = App.store.get('tasks') || [];
    var task = allTasks.find(function(t) { return t.id === taskId; });
    if (!task) return;

    // 同时检查子任务
    var childCount = (task.children || []).length;

    var msg = '确定要删除「' + task.title + '」吗？';
    if (childCount > 0) {
      msg += '\n\n该待办下有 ' + childCount + ' 个子项，将一并删除。';
    }

    App.util.modal({
      title: '🗑 确认删除',
      content: '<p style="font-size:14px;color:var(--text-muted);margin-bottom:8px">' + msg.replace(/\n/g,'<br>') + '</p>',
      confirmText: '确认删除',
      confirmStyle: 'danger',
      onConfirm: function(close) {
        doDelete(taskId);
        close();
        App.router.resolve();
      }
    });
  }

  function doDelete(taskId) {
    var allTasks = App.store.get('tasks') || [];

    // 递归删除子任务
    function removeWithChildren(id) {
      var t = allTasks.find(function(x) { return x.id === id; });
      if (t && t.children) {
        t.children.forEach(function(cid) { removeWithChildren(cid); });
      }
      App.store.remove('tasks', id);
    }

    // 如果是子任务，从父任务的 children 中移除
    var task = allTasks.find(function(t) { return t.id === taskId; });
    if (task && task.parentId) {
      var parent = allTasks.find(function(t) { return t.id === task.parentId; });
      if (parent && parent.children) {
        parent.children = parent.children.filter(function(c) { return c !== taskId; });
        App.store.update('tasks', parent.id, { children: parent.children });
      }
    }

    removeWithChildren(taskId);
    App.util.toast('已删除', 'ok');
  }

  /* ==================== 快速状态流转 ==================== */
  function quickStatus(id) {
    var tasks = App.store.get('tasks') || [];
    var task = tasks.find(function(t) { return t.id === id; });
    if (!task) return;

    var statusFlow = { todo: 'doing', doing: 'following', following: 'done', done: 'done', overdue: 'doing' };
    var nextStatus = statusFlow[task.status] || 'doing';

    App.store.update('tasks', id, { status: nextStatus });
    App.util.toast('已更新为：' + statusLabelCN(nextStatus), 'ok');
    App.router.resolve();
  }

  /* ==================== 拆解下发 ==================== */
  function openDecompose() {
    var allTasks = App.store.get('tasks') || [];
    var activeTasks = allTasks.filter(function(t) { return t.status !== 'done'; });

    var h = '';
    h += '<div class="form-group"><label class="form-label">拆解来源</label>';
    h += '<input class="form-input" id="decompose-source" placeholder="如：集团会议 / 主管会 / 教务会" value="集团会议"></div>';

    h += '<div class="form-group"><label class="form-label">待拆解事项（每行一条）</label>';
    h += '<textarea class="form-textarea" id="decompose-items" placeholder="例如：&#10;完成7月生产数据分析&#10;跟进数学组停课学员回访&#10;提交讲义检查报告" rows="5"></textarea></div>';

    h += '<div class="form-row">';
    h += '<div class="form-group"><label class="form-label">默认截止日期</label>';
    h += '<input class="form-input" id="decompose-due" type="date" value="' + App.util.formatDate(new Date(Date.now() + 3*86400000), 'YYYY-MM-DD') + '"></div>';
    h += '<div class="form-group"><label class="form-label">关联项目组</label>';
    h += '<select class="form-select" id="decompose-project"><option value="">无</option>';
    Object.keys(App.projectGroups).map(function(k) {
      h += '<option value="' + k + '">' + App.projectGroups[k].name + '</option>';
    }).join('');
    h += '</select></div></div>';

    h += '<div class="form-group"><label class="form-label">默认负责人</label>';
    h += '<input class="form-input" id="decompose-owner" placeholder="self 或 姓名" value="self"></div>';

    // 可选：选择一个父任务来挂载子项
    if (activeTasks.length > 0) {
      h += '<div class="form-group"><label class="form-label">关联父任务（可选）</label>';
      h += '<select class="form-select" id="decompose-parent"><option value="">不关联</option>';
      activeTasks.slice(0, 20).forEach(function(t) {
        h += '<option value="' + t.id + '">' + App.util.truncate(t.title, 30) + '</option>';
      });
      h += '</select></div>';
    }

    App.util.modal({
      title: '📋 事项拆解下发',
      content: h,
      confirmText: '拆解并下发',
      onConfirm: function(close) {
        var source = document.getElementById('decompose-source').value.trim() || '未命名';
        var itemsText = document.getElementById('decompose-items').value.trim();
        var due = document.getElementById('decompose-due').value;
        var project = document.getElementById('decompose-project').value || null;
        var owner = document.getElementById('decompose-owner').value.trim() || 'self';
        var parentId = document.getElementById('decompose-parent') ?
          document.getElementById('decompose-parent').value : '';

        if (!itemsText) { App.util.toast('请输入待拆解事项', 'warn'); return; }

        var lines = itemsText.split('\n').filter(function(l) { return l.trim(); });
        if (!lines.length) { App.util.toast('请至少输入一条事项', 'warn'); return; }

        var now = new Date();
        var childIds = [];

        lines.forEach(function(line) {
          var taskData = {
            id: App.store.uid('task'),
            title: line.trim(),
            source: source,
            project: project,
            owner: owner,
            priority: 'normal',
            due: due || null,
            status: 'todo',
            note: '',
            parentId: parentId || null,
            children: [],
            createdAt: now.toISOString()
          };
          App.store.push('tasks', taskData);
          childIds.push(taskData.id);
        });

        // 如果有父任务，把子任务 ID 挂上去
        if (parentId) {
          var parent = (App.store.get('tasks') || []).find(function(t) { return t.id === parentId; });
          if (parent) {
            parent.children = (parent.children || []).concat(childIds);
            App.store.update('tasks', parentId, { children: parent.children });
          }
        }

        App.util.toast('已拆解下发 ' + lines.length + ' 项事项', 'ok');
        close();
        App.router.resolve();
      }
    });
  }

  /* ==================== 视图切换 ==================== */
  function switchView(mode) {
    localStorage.setItem('tasks_view', mode);
    App.router.resolve();
  }

  function render() {
    App.router.resolve();
  }

  /* ==================== Public API ==================== */
  App.views = App.views || {};
  App.views.tasks = {
    switchView: switchView,
    openTaskModal: openTaskModal,
    showTaskDetail: openTaskModal,
    quickStatus: quickStatus,
    confirmDelete: confirmDelete,
    openDecompose: openDecompose,
    render: render
  };

})();
