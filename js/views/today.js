/* ============================================
   today.js — 今日指挥台
   今天该做什么 + 待办提醒 + 关键指标概览
   ============================================ */

(function() {

  App.router.register('/today', function() {
    var container = document.getElementById('view-container');
    if (!container) return;

    var now = new Date();
    var todayWeekday = now.getDay(); // 0=Sun ... 6=Sat
    var daysToSun = App.util.daysUntilSunday(now);
    var monthWeek = App.util.getMonthWeek(now);
    var weekNum = App.util.getWeekNumber(now);

    // 获取数据
    var data = App.store.getData();
    var fixedNodes = (data.timeline && data.timeline.fixedNodes) || [];
    var tasks = data.tasks || [];

    // 筛选今日固定节点（含"最后一周周三"类月度节点）
    var todayNodes = fixedNodes.filter(function(n) {
      if (n.type === 'monthly') {
        if (n.weekday != null && n.weekday === todayWeekday) {
          if (n.which === 'last') return App.util.isLastWeekOfMonth(now);
          if (n.cron === 'last-week-of-month') return App.util.isLastWeekOfMonth(now);
        }
        return false;
      }
      return n.weekday === todayWeekday;
    });

    // 筛选待办提醒
    var todayStr = App.util.formatDate(now, 'YYYY-MM-DD');
    var overdueTasks = tasks.filter(function(t) {
      return t.status !== 'done' && t.due && t.due < todayStr;
    });
    var todayTasks = tasks.filter(function(t) {
      return t.status !== 'done' && t.due === todayStr;
    });
    var thisWeekTasks = tasks.filter(function(t) {
      if (t.status === 'done') return false;
      if (!t.due) return false;
      var due = new Date(t.due);
      var diffDays = Math.ceil((due - now) / 86400000);
      return diffDays >= 0 && diffDays <= (7 - todayWeekday);
    });

    // 构建HTML
    var html = '';

    // --- 顶部状态条信息 ---
    html += '<div class="grid-4" style="margin-bottom:24px">';
    html += metricCard('当前日期', App.util.formatDate(now, 'YYYY年MM月DD日'), 'calendar', App.util.getWeekdayName(now));
    html += metricCard('周次', '第' + weekNum + '周', 'clock', App.util.getMonthName(now.getMonth()) + ' 第' + monthWeek + '周');
    var countdownClass = daysToSun <= 2 ? 'urgent' : '';
    html += metricCard('距周报截止', daysToSun === 0 ? '今天！' : daysToSun + ' 天', 'alert-circle', '周日 DOS 周报', countdownClass);
    html += metricCard('待办事项', String(overdueTasks.length + todayTasks.length), 'check-square', overdueTasks.length > 0 ? overdueTasks.length + '项逾期' : '一切正常');
    html += '</div>';

    // --- 今天该做什么 ---
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('sun', 18) + '今天该做什么</h3></div>';
    if (todayNodes.length > 0) {
      html += '<div style="display:flex;flex-direction:column;gap:10px">';
      todayNodes.forEach(function(node) {
        html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--accent-soft);border-radius:var(--radius);border-left:3px solid var(--accent)">';
        html += '<span style="font-weight:600;color:var(--accent-text);font-size:14px">' + node.title + '</span>';
        if (node.time) { html += '<span class="tag tag-accent mono">' + node.time + '</span>'; }
        html += '</div>';
        if (node.note) {
          html += '<p style="font-size:12px;color:var(--text-muted);margin-left:4px;padding-left:16px;border-left:2px solid var(--border)">' + node.note + '</p>';
        }
      });
      html += '</div>';

      // 如果是周二，额外显示拆解下发快捷按钮
      if (todayWeekday === 2) {
        html += '<div style="margin-top:14px;display:flex;gap:8px">';
        html += '<button class="btn btn-primary btn-sm" onclick="App.views.today.decomposeMeeting()">' + App.util.svgIcon('edit', 14) + '事项拆解下发</button>';
        html += '</div>';
      }
    } else {
      html += '<p style="color:var(--text-muted);font-size:13px">今天没有固定的日程安排节点。</p>';
    }
    html += '</div>';

    // --- 待办提醒 ---
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('alert-circle', 18) + '待办提醒</h3><button class="btn btn-ghost btn-sm" onclick="App.router.navigate(\'/tasks\')">查看全部 →</button></div>';

    if (overdueTasks.length > 0) {
      html += '<div style="margin-bottom:12px"><span style="font-size:12px;font-weight:600;color:var(--bad)">⚠ ' + overdueTasks.length + ' 项已逾期</span></div>';
      html += taskListHtml(overdueTasks.slice(0, 5), true);
    }

    if (todayTasks.length > 0) {
      html += '<div style="margin-bottom:8px;margin-top:' + (overdueTasks.length > 0 ? '12px' : '0') + '"><span style="font-size:12px;font-weight:600;color:var(--accent)">📌 今日待办 (' + todayTasks.length + ')</span></div>';
      html += taskListHtml(todayTasks.slice(0, 5));
    }

    if (thisWeekTasks.length > 0 && todayTasks.length === 0 && overdueTasks.length === 0) {
      html += '<div style="margin-top:8px"><span style="font-size:12px;font-weight:600;color:var(--text-muted)">📋 本周待办 (' + thisWeekTasks.length + ')</span></div>';
      html += taskListHtml(thisWeekTasks.slice(0, 5));
    }

    if (overdueTasks.length === 0 && todayTasks.length === 0 && thisWeekTasks.length === 0) {
      html += '<div class="empty-state"><p>暂无待办事项，一切井然有序 ✨</p><button class="btn btn-primary btn-sm" onclick="App.views.tasks.openTaskModal()">+ 新建待办</button></div>';
    }
    html += '</div>';

    // --- 快捷操作 ---
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('zap', 18) + '快捷操作</h3></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    html += '<button class="btn btn-secondary" onclick="App.views.tasks.openTaskModal()">' + App.util.svgIcon('plus', 14) + '新建待办</button>';
    html += '<button class="btn btn-secondary" onclick="App.router.navigate(\'/data\')">' + App.util.svgIcon('bar-chart-2', 14) + '录入数据</button>';
    html += '<button class="btn btn-secondary" onclick="App.router.navigate(\'/timeline\')">' + App.util.svgIcon('calendar', 14) + '查看时间轴</button>';
    html += '<button class="btn btn-secondary" onclick="App.router.navigate(\'/projects\')">' + App.util.svgIcon('folder', 14) + '项目组中心</button>';
    html += '</div></div>';

    container.innerHTML = html;
  });

  function metricCard(label, value, icon, sub, extraClass) {
    var ec = extraClass ? ' ' + extraClass : '';
    return '<div class="metric-card' + ec + '"><div><div class="metric-value">' + value + '</div><div class="metric-label">' + label + '</div>' + (sub ? '<div class="metric-delta">' + sub + '</div>' : '') + '</div><div style="color:var(--text-faint)">' + App.util.svgIcon(icon, 22) + '</div></div>';
  }

  function taskListHtml(taskList, isOverdue) {
    var html = '<div style="display:flex;flex-direction:column;gap:6px">';
    taskList.forEach(function(t) {
      var statusCls = isOverdue ? 'bad' : App.util.statusColor(t.status);
      var priorityCls = t.priority === 'urgent' || t.priority === 'high' ? 'priority-high' : 'priority-normal';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-2);border-radius:var(--radius-sm);cursor:pointer;transition:all var(--fast)" onclick="App.router.navigate(\'/tasks\')">';
      html += '<span class="status-dot ' + statusCls + '"></span>';
      html += '<span style="flex:1;font-size:13px;' + (isOverdue ? 'color:var(--bad);text-decoration:line-through' : '') + '">' + App.util.truncate(t.title, 40) + '</span>';
      if (t.priority === 'urgent' || t.priority === 'high') {
        html += '<span class="tag tag-bad" style="font-size:10px">' + App.util.priorityLabel(t.priority) + '</span>';
      }
      if (t.project) {
        var pg = App.projectGroups[t.project];
        if (pg) html += '<span class="tag tag-neutral" style="font-size:10px">' + pg.name + '</span>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // 周二事项拆解下发功能
  App.views = App.views || {};
  App.views.today = {
    decomposeMeeting: function() {
      App.util.modal({
        title: '📋 周二 · 事项拆解下发',
        content: '<div class="form-group"><label class="form-label">会议名称</label><input class="form-input" id="decompose-source" placeholder="如：集团会议 / 主管会 / 教务会" value="集团会议"></div>' +
          '<div class="form-group"><label class="form-label">待拆解事项（每行一条）</label><textarea class="form-textarea" id="decompose-items" placeholder="例如：&#10;完成7月生产数据分析&#10;跟进数学组停课学员回访&#10;提交讲义检查报告" rows="6"></textarea>' +
          '<p class="form-hint">每输入一行将生成一个子任务，可后续分配负责人和截止日期</p></div>' +
          '<div class="form-row"><div class="form-group"><label class="form-label">默认截止日期</label><input class="form-input" id="decompose-due" type="date" value="' + App.util.formatDate(new Date(Date.now() + 3*86400000), 'YYYY-MM-DD') + '"></div>' +
          '<div class="form-group"><label class="form-label">关联项目组</label><select class="form-select" id="decompose-project"><option value="">无</option>' +
          Object.keys(App.projectGroups).map(function(k) { return '<option value="' + k + '">' + App.projectGroups[k].name + '</option>'; }).join('') +
          '</select></div></div>',
        confirmText: '生成待办',
        onConfirm: function(close) {
          var source = document.getElementById('decompose-source').value.trim();
          var itemsText = document.getElementById('decompose-items').value.trim();
          var due = document.getElementById('decompose-due').value;
          var project = document.getElementById('decompose-project').value;

          if (!itemsText) { App.util.toast('请输入待拆解事项', 'warn'); return; }

          var items = itemsText.split('\n').filter(function(s) { return s.trim(); });
          var parentId = App.store.uid('task');

          // 创建父任务
          App.store.push('tasks', {
            id: parentId,
            title: source + '·事项拆解（' + new Date().getMonth() + 1 + '月第' + App.util.getMonthWeek(new Date()) + '周）',
            source: source,
            project: project || null,
            owner: 'self',
            priority: 'high',
            due: due,
            status: 'doing',
            parentId: null,
            children: [],
            note: '从「' + source + '」拆解的 ' + items.length + ' 项事项',
            createdAt: new Date().toISOString()
          });

          // 创建子任务
          items.forEach(function(item) {
            App.store.push('tasks', {
              id: App.store.uid('task'),
              title: item.trim(),
              source: source,
              project: project || null,
              owner: 'self',
              priority: 'normal',
              due: due,
              status: 'todo',
              parentId: parentId,
              children: [],
              note: '',
              createdAt: new Date().toISOString()
            });
          });

          close();
          App.util.toast('已生成 ' + (items.length + 1) + ' 项待办（1个父任务 + ' + items.length + '个子任务）', 'ok');
          App.router.resolve(); // 刷新视图
        }
      });
    }
  };

})();
