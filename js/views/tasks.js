/* ============================================
   tasks.js — 事项跟进
   看板/列表双视图 + CRUD + 状态流转 + 逾期标红
   ============================================ */

(function() {

  App.router.register('/tasks', function() {
    var container = document.getElementById('view-container');
    if (!container) return;

    var mode = localStorage.getItem('tasks_view') || 'kanban';

    var html = '';

    // 工具栏
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    html += '<button class="btn btn-primary" onclick="App.views.tasks.openTaskModal()">' + App.util.svgIcon('plus', 14) + '新建待办</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.tasks.openDecompose()">' + App.util.svgIcon('edit', 14) + '拆解下发</button>';
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

    // 绑定筛选器事件（如果存在）
    var fp = document.getElementById('task-filter-project');
    if (fp) fp.value = projFilter;
  });

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

  function renderKanban(tasks) {
    var columns = [
      { key: 'overdue', label: '⚠️ 已逾期', color: 'bad' },
      { key: 'todo', label: '📋 待办', color: 'neutral' },
      { key: 'doing', label: '🔄 进行中', color: 'accent' },
      { key: 'following', label: '👁 待跟进', color: 'warn' },
      { key: 'done', label: '✅ 已完成', color: 'ok' }
    ];

    var html = '<div class="kanban-board">';
    columns.forEach(function(col) {
      var colTasks = tasks.filter(function(t) { return t.status === col.key; });
      html += '<div class="kanban-column">';
      html += '<div class="kanban-col-header">';
      html += '<span class="kanban-col-title">' + col.label + '</span>';
      html += '<span class="kanban-col-count">' + colTasks.length + '</span>';
      html += '</div>';

      colTasks.forEach(function(t) {
        html += renderKanbanCard(t);
      });

      if (colTasks.length === 0) {
        html += '<div style="text-align:center;padding:20px;color:var(--text-faint);font-size:12px">暂无</div>';
      }

      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderKanbanCard(t) {
    var pg = t.project ? App.projectGroups[t.project] : null;
    var isOverdue = t.status === 'overdue';

    var html = '<div class="kanban-card" onclick="App.views.tasks.showTaskDetail(\'' + t.id + '\')">';
    html += '<div class="kanban-card-title"' + (isOverdue ? ' style="color:var(--bad)"' : '') + '>' + App.util.truncate(t.title, 35) + '</div>';
    html += '<div class="kanban-card-meta">';
    if (t.priority === 'urgent' || t.priority === 'high') {
      html += '<span class="' + (t.priority === 'urgent' ? 'priority-urgent' : 'priority-high') + '">' + App.util.priorityLabel(t.priority) + '</span>';
    }
    if (t.due) {
      var dueClass = new Date(t.due) < new Date() ? 'tag-bad' : 'tag-neutral';
      html += '<span class="tag ' + dueClass + '" style="font-size:10px">' + t.due + '</span>';
    }
    if (pg) {
      html += '<span class="tag tag-neutral" style="font-size:10px">' + pg.name.replace('项目组','') + '</span>';
    }
    html += '</div></div>';
    return html;
  }

  function renderList(tasks) {
    // 排序：逾期优先 > 截止日期近优先 > 高优先级优先
    var sorted = tasks.slice().sort(function(a, b) {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1;
      if (b.status === 'overdue' && a.status !== 'overdue') return 1;
      var pa = { urgent: 0, high: 1, normal: 2, low: 3 };
      if ((pa[a.priority] || 99) !== (pa[b.priority] || 99)) return (pa[a.priority] || 99) - (pa[b.priority] || 99);
      if (a.due && b.due) return a.due.localeCompare(b.due);
      return 0;
    });

    var html = '<div class="card" style="overflow:hidden"><table class="data-table"><thead><tr>';
    html += '<th style="width:36px"></th><th>事项</th><th style="width:80px">优先级</th><th style="width:100px">截止日期</th><th style="width:80px">状态</th><th style="width:100px">项目组</th><th style="width:60px">操作</th>';
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
        html += '<td><div style="display:flex;gap:4px">';
        if (t.status !== 'done') {
          html += '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();App.views.tasks.quickStatus(\'' + t.id + '\')" title="快速流转">✓</button>';
        }
        html += '</td></tr>';
      });
    }

    html += '</tbody></table></div>';
    return html;
  }

  // --- Public API ---

  App.views = App.views || {};
  App.views.tasks = {
    switchView: function(mode) {
      localStorage.setItem('tasks_view', mode);
      App.router.resolve();
    },

    openTaskModal: function(editId) {
      var task = editId ? (App.store.get('tasks') || []).find(function(t) { return t.id === editId; }) : null;
      var isEdit = !!task;

      App.util.modal({
        title: isEdit ? '✏️ 编辑待办' : '➕ 新建待办',
        content: '<div class="form-group"><label class="form-label">标题 *</label><input class="form-input" id="task-title" placeholder="待办事项标题" value="' + (task ? task.title : '') + '"></div>' +
          '<div class="form-row"><div class="form-group"><label class="form-label">来源会议/项目</label><input class="form-input" id="task-source" placeholder="如：主管会、教务会" value="' + (task ? (task.source || '') : '') + '"></div>' +
          '<div class="form-group"><label class="form-label">关联项目组</label><select class="form-select" id="task-project"><option value="">无</option>' +
          Object.keys(App.projectGroups).map(function(k) { return '<option value="' + k + '"' + (task && task.project === k ? ' selected' : '') + '>' + App.projectGroups[k].name + '</option>'; }).join('') +
          '</select></div></div>' +
          '<div class="form-row"><div class="form-group"><label class="form-label">负责人</label><input class="form-input" id="task-owner" placeholder="self 或 姓名" value="' + (task ? (task.owner || 'self') : 'self') + '"></div>' +
          '<div class="form-group"><label class="form-label">优先级</label><select class="form-select" id="task-priority"><option value="low"' + (task && task.priority === 'low' ? ' selected' : '') + '>低</option><option value="normal"' + (!task || task.priority === 'normal' ? ' selected' : '') + '>普通</option><option value="high"' + (task && task.priority === 'high' ? ' selected' : '') + '>高</option><option value="urgent"' + (task && task.priority === 'urgent' ? ' selected' : '') + '>紧急</option></select></div></div>' +
          '<div class="form-row"><div class="form-group"><label class="form-label">截止日期</label><input class="form-input" id="task-due" type="date" value="' + (task ? (task.due || '') : '') + '"></div>' +
          '<div class="form-group"><label class="form-label">状态</label><select class="form-select" id="task-status"><option value="todo"' + (!task || task.status === 'todo' ? ' selected' : '') + '>待办</option><option value="doing"' + (task && task.status === 'doing' ? ' selected' : '') + '>进行中</option><option value="following"' + (task && task.status === 'following' ? ' selected' : '') + '>待跟进</option><option value="done"' + (task && task.status === 'done' ? ' selected' : '') + '>已完成</option></select></div></div>' +
          '<div class="form-group"><label class="form-label">备注</label><textarea class="form-textarea" id="task-note" placeholder="补充说明...">' + (task ? (task.note || '') : '') + '</textarea></div>',
        confirmText: isEdit ? '保存修改' : '创建',
        onConfirm: function(close) {
          var title = document.getElementById('task-title').value.trim();
          if (!title) { App.util.toast('请输入标题', 'warn'); return; }

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

          close();
          App.router.resolve();
        }
      });
    },

    showTaskDetail: function(id) {
      App.views.tasks.openTaskModal(id);
    },

    quickStatus: function(id) {
      var tasks = App.store.get('tasks') || [];
      var task = tasks.find(function(t) { return t.id === id; });
      if (!task) return;

      var statusFlow = { todo: 'doing', doing: 'following', following: 'done', done: 'done', overdue: 'doing' };
      var nextStatus = statusFlow[task.status] || 'doing';

      App.store.update('tasks', id, { status: nextStatus });
      App.util.toast('已更新为：' + App.util.statusLabel(nextStatus), 'ok');
      App.router.resolve();
    },

    openDecompose: function() {
      // 复用 today 的拆解功能
      if (App.views.today && App.views.today.decomposeMeeting) {
        App.views.today.decomposeMeeting();
      }
    },

    render: function() {
      App.router.resolve();
    }
  };

})();
