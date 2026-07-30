/* ============================================
   timeline.js — 时间轴视图
   周/月工作节律时间线
   ============================================ */

(function() {

  App.router.register('/timeline', function() {
    var container = document.getElementById('view-container');
    if (!container) return;

    var now = new Date();
    var todayWeekday = now.getDay();

    var data = App.store.getData();
    var fixedNodes = (data.timeline && data.timeline.fixedNodes) || [];
    var customNodes = (data.timeline && data.timeline.customNodes) || [];
    var allNodes = fixedNodes.concat(customNodes);

    // Tab 切换状态
    var viewMode = localStorage.getItem('timeline_view') || 'week';

    var weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    var html = '';

    // --- 视图切换 Tabs ---
    html += '<div class="tabs">';
    html += '<button class="tab ' + (viewMode === 'week' ? 'active' : '') + '" onclick="App.views.timeline.switchView(\'week\')">📅 周视图</button>';
    html += '<button class="tab ' + (viewMode === 'month' ? 'active' : '') + '" onclick="App.views.timeline.switchView(\'month\')">📆 月视图</button>';
    html += '</div>';

    if (viewMode === 'week') {
      html += renderWeekView(now, allNodes, weekdayNames, todayWeekday);
    } else {
      html += renderMonthView(now, allNodes, fixedNodes);
    }

    container.innerHTML = html;
  });

  function renderWeekView(now, allNodes, weekdayNames, todayWeekday) {
    var html = '';

    // 计算本周起始日（周一）
    var startOfWeek = new Date(now);
    var dayDiff = now.getDay() === 0 ? 6 : now.getDay() - 1;
    startOfWeek.setDate(now.getDate() - dayDiff);

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
      var isToday = dateStr === App.util.formatDate(now, 'YYYY-MM-DD');

      html += '<div class="timeline-day' + (isToday ? ' today' : '') + '">';
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
        html += '<div class="timeline-node ' + nodeClass + '" title="' + (node.note || '') + '">';
        html += '<strong>' + node.title + '</strong>';
        if (node.time) { html += '<span class="mono" style="margin-left:auto;font-size:10px">' + node.time + '</span>'; }
        html += '</div>';
        if (node.note) {
          html += '<p style="font-size:11px;color:var(--text-faint);margin:2px 0 0 8px;line-height:1.4">' + App.util.truncate(node.note, 50) + '</p>';
        }
      });

      // 该日的待办
      var tasks = (App.store.get('tasks') || []).filter(function(t) {
        return t.due === dateStr && t.status !== 'done';
      });
      if (tasks.length > 0) {
        html += '<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border)">';
        html += '<span style="font-size:10px;color:var(--accent);font-weight:600">' + tasks.length + '项待办</span>';
        tasks.slice(0, 3).forEach(function(t) {
          html += '<div style="font-size:11px;color:var(--text-muted);padding:2px 0 2px 8px">· ' + App.util.truncate(t.title, 20) + '</div>';
        });
        if (tasks.length > 3) {
          html += '<div style="font-size:10px;color:var(--text-faint);padding:2px 0 0 8px">+' + (tasks.length - 3) + '...</div>';
        }
        html += '</div>';
      }

      html += '</div>'; // .timeline-day
    }
    html += '</div>'; // .timeline-week

    // 月度节点提示区
    var monthlyNodes = allNodes.filter(function(n) { return n.type === 'monthly'; });
    if (monthlyNodes.length > 0) {
      html += '<div class="card" style="margin-top:18px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('clock', 18) + '月度周期节点</h3></div>';
      monthlyNodes.forEach(function(node) {
        html += '<div class="timeline-node node-monthly" style="margin-bottom:6px">';
        html += '<strong>' + node.title + '</strong>';
        html += '<span style="font-size:11px;color:var(--warn-text);margin-left:8px">' + (node.cron || '') + '</span>';
        html += '</div>';
        if (node.note) {
          html += '<p style="font-size:12px;color:var(--text-muted);margin-top:4px">' + node.note + '</p>';
        }
      });
      html += '</div>';
    }

    return html;
  }

  function renderMonthView(now, allNodes, fixedNodes) {
    var year = now.getFullYear();
    var month = now.getMonth();
    var firstDay = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0);
    var startPad = firstDay.getDay(); // 0=Sunday
    var totalDays = lastDay.getDate();

    var html = '';
    html += '<div style="margin-bottom:16px;text-align:center"><span style="font-size:18px;font-weight:600">' + year + ' 年 ' + (month + 1) + ' 月</span></div>';

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
      var isToday = App.util.formatDate(d, 'YYYY-MM-DD') === App.util.formatDate(now, 'YYYY-MM-DD');
      var dateStr = App.util.formatDate(d, 'YYYY-MM-DD');

      // 找到这天的固定节点（含"最后一周周三"类月度节点）
      var dayFixedNodes = fixedNodes.filter(function(n) {
        if (n.type === 'monthly') {
          if (n.weekday != null && n.weekday === d.getDay() && n.which === 'last') {
            return App.util.isLastWeekOfMonth(d);
          }
          return false;
        }
        return n.weekday === d.getDay();
      });

      // 这天的待办数
      var taskCount = (App.store.get('tasks') || []).filter(function(t) {
        return t.due === dateStr && t.status !== 'done';
      }).length;

      html += '<div style="background:' + (isToday ? 'var(--accent-soft)' : 'var(--bg)') + ';min-height:70px;padding:4px 6px;position:relative">';
      html += '<span style="font-size:12px;font-weight:' + (isToday ? '700;color:var(--accent)' : '500') + '">' + day + '</span>';

      if (dayFixedNodes.length > 0) {
        dayFixedNodes.forEach(function(n) {
          html += '<div style="font-size:9px;background:var(--accent-soft);color:var(--accent-text);padding:1px 4px;border-radius:2px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + n.title + '</div>';
        });
      }

      if (taskCount > 0) {
        html += '<div style="position:absolute;bottom:4px;right:4px;width:16px;height:16px;border-radius:50%;background:var(--accent);color:white;font-size:9px;display:flex;align-items:center;justify-content:center;font-weight:600">' + taskCount + '</div>';
      }

      html += '</div>';
    }

    html += '</div>'; // grid

    // 月度节点列表
    var monthlyNodes = allNodes.filter(function(n) { return n.type === 'monthly'; });
    if (monthlyNodes.length > 0) {
      html += '<div class="card" style="margin-top:18px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('clock', 18) + '月度周期任务</h3></div>';
      monthlyNodes.forEach(function(node) {
        html += '<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">';
        html += '<span class="status-dot warn"></span>';
        html += '<div><strong style="font-size:13px">' + node.title + '</strong>';
        if (node.note) { html += '<p style="font-size:11px;color:var(--text-muted);margin-top:2px">' + node.note + '</p>'; }
        html += '</div>';
        html += '<button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="App.views.timeline.generateMonthlyTasks(\'' + node.id + '\')">生成本月待办</button>';
        html += '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  // 视图切换
  App.views = App.views || {};
  App.views.timeline = {
    switchView: function(mode) {
      localStorage.setItem('timeline_view', mode);
      App.router.resolve();
    },
    shiftWeek: function(dir) {
      // 简化实现：刷新即可显示本周
      if (dir === 0) {
        App.router.resolve();
      } else {
        // TODO: 实现跨周切换
        App.util.toast('跨周切换开发中', 'warn');
      }
    },
    generateMonthlyTasks: function(nodeId) {
      var nodes = App.store.get('timeline.fixedNodes') || [];
      var node = nodes.find(function(n) { return n.id === nodeId; });
      if (!node) return;

      App.store.push('tasks', {
        id: App.store.uid('task'),
        title: node.title + '（' + new Date().getMonth() + 1 + '月）',
        source: '周期任务',
        project: null,
        owner: 'self',
        priority: 'normal',
        due: App.util.formatDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'YYYY-MM-DD'),
        status: 'todo',
        parentId: null,
        children: [],
        note: node.note || '',
        createdAt: new Date().toISOString()
      });

      App.util.toast('已生成月度待办：' + node.title, 'ok');
      App.router.resolve();
    }
  };

})();
