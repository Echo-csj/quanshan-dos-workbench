/* ============================================
   today.js — 今日指挥台
   今天该做什么 + 关键指标概览
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

    // 构建HTML
    var html = '';

    // --- 顶部状态条信息 ---
    html += '<div class="grid-3" style="margin-bottom:24px">';
    html += metricCard('当前日期', App.util.formatDate(now, 'YYYY年MM月DD日'), 'calendar', App.util.getWeekdayName(now));
    html += metricCard('周次', '第' + weekNum + '周', 'clock', App.util.getMonthName(now.getMonth()) + ' 第' + monthWeek + '周');
    var countdownClass = daysToSun <= 2 ? 'urgent' : '';
    html += metricCard('距周报截止', daysToSun === 0 ? '今天！' : daysToSun + ' 天', 'alert-circle', '周日 DOS 周报', countdownClass);
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
    } else {
      html += '<p style="color:var(--text-muted);font-size:13px">今天没有固定的日程安排节点。</p>';
    }
    html += '</div>';

    // --- 快捷操作 ---
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('zap', 18) + '快捷操作</h3></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
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

})();
