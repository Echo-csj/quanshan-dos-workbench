/* ============================================
   today.js — 今日指挥台
   聚合：今日/本周节律节点 + 我的待办(逾期标红) + 周报草稿 + 备份提醒
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
    var U = App.util;

    var data = App.store.getData();
    var fixedNodes = (data.timeline && data.timeline.fixedNodes) || [];
    var tasks = App.store.get('tasks') || [];

    // 今日固定节点
    var todayNodes = fixedNodes.filter(function(n) {
      if (n.type === 'monthly') {
        if (n.weekday != null && n.weekday === todayWeekday) {
          if (n.which === 'last') return U.isLastWeekOfMonth(now);
          if (n.cron === 'last-week-of-month') return U.isLastWeekOfMonth(now);
        }
        return false;
      }
      return n.weekday === todayWeekday;
    });

    // 本周节点（今天 → 周日）
    var weekNodes = getWeekNodes(fixedNodes, now);

    // 待办统计
    var todoTasks = tasks.filter(function(t) { return t.status === 'todo'; });
    var doingTasks = tasks.filter(function(t) { return t.status === 'doing'; });
    var reviewTasks = tasks.filter(function(t) { return t.status === 'review'; });
    var overdueTasks = tasks.filter(function(t) { return t.status !== 'done' && t.dueDate && isOverdue(t.dueDate); });

    var html = '';

    // 数据备份提醒 banner
    html += backupBannerHtml();

    // 顶部状态条
    html += '<div class="grid-3" style="margin-bottom:24px">';
    html += metricCard('当前日期', U.formatDate(now, 'YYYY年MM月DD日'), 'calendar', U.getWeekdayName(now));
    html += metricCard('周次', '第' + weekNum + '周', 'clock', U.getMonthName(now.getMonth()) + ' 第' + monthWeek + '周');
    var cdClass = daysToSun <= 2 ? ' urgent' : '';
    html += metricCard('距周报截止', daysToSun === 0 ? '今天！' : daysToSun + ' 天', 'alert-circle', '周日 DOS 周报', cdClass);
    html += '</div>';

    // 我的待办
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('clipboard', 18) + '我的待办</h3>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.router.navigate(\'/tasks\')">查看看板 →</button></div>';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">';
    html += statChip('待办', todoTasks.length, 'var(--text-muted)');
    html += statChip('进行中', doingTasks.length, 'var(--accent)');
    html += statChip('审阅中', reviewTasks.length, 'var(--warn)');
    html += statChip('逾期', overdueTasks.length, overdueTasks.length ? 'var(--bad)' : 'var(--ok)');
    html += '</div>';
    if (overdueTasks.length) {
      html += '<div style="display:flex;flex-direction:column;gap:6px">';
      overdueTasks.slice(0, 5).forEach(function(t) {
        html += '<div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 8px;background:var(--bad-soft);border-radius:var(--radius-sm)">';
        html += '<span class="tag priority-' + (t.priority || 'normal') + '">' + U.priorityLabel(t.priority) + '</span>';
        html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + U.escapeHtml(t.title || '未命名任务') + '</span>';
        html += '<span class="mono" style="color:var(--bad);font-size:11px">' + U.escapeHtml(t.dueDate) + '</span>';
        html += '</div>';
      });
      if (overdueTasks.length > 5) html += '<div style="font-size:11px;color:var(--text-faint)">…还有 ' + (overdueTasks.length - 5) + ' 条逾期任务</div>';
      html += '</div>';
    } else {
      html += '<p style="font-size:13px;color:var(--text-muted)">暂无逾期任务，保持得不错。</p>';
    }
    html += '</div>';

    // 今天该做什么
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('sun', 18) + '今天该做什么</h3>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.today.generateWeeklyReport()">' + U.svgIcon('clipboard', 14) + '周报草稿</button></div>';
    if (todayNodes.length > 0) {
      html += '<div style="display:flex;flex-direction:column;gap:10px">';
      todayNodes.forEach(function(node) {
        html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--accent-soft);border-radius:var(--radius);border-left:3px solid var(--accent)">';
        html += '<span style="font-weight:600;color:var(--accent-text);font-size:14px">' + U.escapeHtml(node.title) + '</span>';
        if (node.time) { html += '<span class="tag tag-accent mono">' + U.escapeHtml(node.time) + '</span>'; }
        html += '</div>';
        if (node.note) {
          html += '<p style="font-size:12px;color:var(--text-muted);margin-left:4px;padding-left:16px;border-left:2px solid var(--border)">' + U.escapeHtml(node.note) + '</p>';
        }
      });
      html += '</div>';
    } else {
      html += '<p style="color:var(--text-muted);font-size:13px">今天没有固定的日程安排节点。</p>';
    }
    html += '</div>';

    // 本周关键节点
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('calendar', 18) + '本周关键节点</h3></div>';
    if (weekNodes.length) {
      html += '<div style="display:flex;flex-direction:column;gap:8px">';
      weekNodes.forEach(function(item) {
        var n = item.node;
        var d = new Date(now); d.setDate(d.getDate() + (item.weekday - todayWeekday));
        var isToday = item.weekday === todayWeekday;
        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface-2);border-radius:var(--radius-sm);border-left:3px solid ' + (isToday ? 'var(--accent)' : 'var(--border)') + '">';
        html += '<span class="mono" style="font-size:11px;color:var(--text-muted);width:64px">' + U.formatDate(d, 'MM-DD') + ' ' + U.getWeekdayName(d) + '</span>';
        html += '<span style="font-weight:500;font-size:13px;flex:1">' + U.escapeHtml(n.title) + '</span>';
        if (n.time) html += '<span class="tag tag-accent mono">' + U.escapeHtml(n.time) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<p style="font-size:13px;color:var(--text-muted)">本周剩余时间暂无固定节律节点。</p>';
    }
    html += '</div>';

    // 快捷操作
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + U.svgIcon('zap', 18) + '快捷操作</h3></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    html += '<button class="btn btn-secondary" onclick="App.router.navigate(\'/data\')">' + U.svgIcon('bar-chart-2', 14) + '录入数据</button>';
    html += '<button class="btn btn-secondary" onclick="App.router.navigate(\'/timeline\')">' + U.svgIcon('calendar', 14) + '查看时间轴</button>';
    html += '<button class="btn btn-secondary" onclick="App.router.navigate(\'/projects\')">' + U.svgIcon('folder', 14) + '项目组中心</button>';
    html += '<button class="btn btn-primary" onclick="App.views.today.generateWeeklyReport()">' + U.svgIcon('clipboard', 14) + '生成周报草稿</button>';
    html += '</div></div>';

    container.innerHTML = html;
  });

  /* ---------------- 周报草稿 ---------------- */
  function generateWeeklyReport() {
    var U = App.util;
    var now = new Date();
    var data = App.store.getData();
    var tasks = data.tasks || [];

    // 本周一 ~ 周日 区间
    var weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - ((now.getDay() + 6) % 7));
    var weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    var ws = weekStart.getTime();
    var we = weekEnd.getTime() + 86400000;

    var doneThisWeek = tasks.filter(function(t) {
      if (t.status !== 'done') return false;
      var u = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
      return u >= ws && u < we;
    });
    var doingCount = tasks.filter(function(t) { return t.status === 'doing' || t.status === 'review'; }).length;

    // 最新月报
    var monthly = (data.reports && data.reports.monthly) || {};
    var monthKeys = Object.keys(monthly).sort();
    var latestKey = monthKeys[monthKeys.length - 1];
    var latest = latestKey ? monthly[latestKey] : null;

    // 人事（本月）
    var hr = data.hr || {};
    var wk = hr.weekly || {};
    var curMonth = U.formatDate(now, 'YYYY-MM');
    var hire = 0, leave = 0;
    Object.keys(wk).forEach(function(k) {
      if (k.indexOf(curMonth) === 0 && wk[k]) { hire += (wk[k].hireCount || 0); leave += (wk[k].leaveCount || 0); }
    });

    var B = App.baseline || {};
    var base = {
      production: (B['课时生产'] && B['课时生产']['G0']) ? B['课时生产']['G0'].value : 0.90,
      saturation: (B['课时生产'] && B['课时生产']['饱和度']) ? B['课时生产']['饱和度'].value : 0.75,
      renewal: (B['学员留存'] && B['学员留存']['续费单科率']) ? B['学员留存']['续费单科率'].value : [0.08, 0.20],
      refund: (B['学员留存'] && B['学员留存']['退费单科率']) ? B['学员留存']['退费单科率'].value : 0.02,
      suspend: (B['学员留存'] && B['学员留存']['停课人次率']) ? B['学员留存']['停课人次率'].value : 0.08
    };

    var lines = [];
    lines.push('【泉山校区 DOS 周报】' + U.formatDate(now, 'YYYY') + '年第' + U.getWeekNumber(now) + '周（' + U.formatDate(weekStart, 'MM.DD') + ' - ' + U.formatDate(weekEnd, 'MM.DD') + '）');
    lines.push('');
    lines.push('一、本周完成事项（' + doneThisWeek.length + '项）');
    if (doneThisWeek.length) doneThisWeek.forEach(function(t) { lines.push('  · ' + (t.title || '未命名任务') + (t.assignee ? ('（' + t.assignee + '）') : '')); });
    else lines.push('  （无记录，可在事项看板补充）');
    lines.push('');
    lines.push('二、进行中 / 待跟进（' + doingCount + '项）');
    lines.push('  详见「事项看板」，重点关注逾期与本周截止任务。');
    lines.push('');
    lines.push('三、关键节律');
    getWeekNodes((data.timeline && data.timeline.fixedNodes) || [], now).forEach(function(item) {
      var d = new Date(now); d.setDate(d.getDate() + (item.weekday - now.getDay()));
      lines.push('  · ' + U.formatDate(d, 'MM-DD') + ' ' + U.getWeekdayName(d) + '：' + item.node.title);
    });
    lines.push('');
    lines.push('四、教学数据（最新月报 ' + (latestKey || '无') + '）');
    if (latest && latest.dos && latest.dos.metrics) {
      var m = latest.dos.metrics;
      pushMetric(lines, m.productionRateMonth, '生产完成率', base.production);
      pushMetric(lines, m.saturationMonth, '饱和度', base.saturation);
      pushMetric(lines, m.renewalRateSubjectMonth, '续费单科率', base.renewal);
      pushMetric(lines, m.refundRateSubjectMonth, '退费单科率', base.refund);
      pushMetric(lines, m.suspendRatePersonMonth, '停课人次率', base.suspend);
    } else {
      lines.push('  （暂无月报数据，请在「数据看板」录入）');
    }
    lines.push('');
    lines.push('五、人事数据（' + curMonth + '）');
    lines.push('  · 入职 ' + hire + ' 人，离职 ' + leave + ' 人（详见数据看板-人事数据）');
    lines.push('');
    lines.push('—— 自动生成于 ' + U.formatDate(now, 'YYYY-MM-DD HH:mm') + '，可在周报模板中补充微调。');

    var text = lines.join('\n');
    var bodyHtml = '<div style="font-size:12px;color:var(--text-faint);margin-bottom:10px">已按本周完成事项、关键节律、最新月报与人事数据自动汇总，复制后可在周报模板中微调。</div>';
    bodyHtml += '<textarea id="weekly-report-text" class="form-input" style="width:100%;height:320px;font-family:var(--font-mono);font-size:12px;line-height:1.6" readonly>' + U.escapeHtml(text) + '</textarea>';

    U.modal({
      title: '📝 周报草稿',
      content: bodyHtml,
      showCancel: false,
      confirmText: '复制全文',
      onConfirm: function(close) {
        copyText(text);
        U.toast('已复制到剪贴板', 'ok');
        close();
      }
    });
  }

  function pushMetric(lines, val, label, base) {
    if (val == null) return;
    var baseStr = Array.isArray(base) ? ((base[0] * 100) + '%~' + (base[1] * 100) + '%') : ((base * 100) + '%');
    lines.push('  · ' + label + '：' + (val * 100).toFixed(1) + '%（基准 ' + baseStr + '）');
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
    } catch (e) {
      App.util.toast('复制失败，请手动选择文本复制', 'warn');
    }
  }

  /* ---------------- 备份提醒 ---------------- */
  function backupBannerHtml() {
    var data = App.store.getData();
    if (!(data.settings && data.settings.remindBackup !== false)) return '';
    var lastExport = data.meta && data.meta.lastBackupAt;
    var thisMonth = App.util.formatDate(new Date(), 'YYYY-MM');
    var lastMonth = lastExport ? App.util.formatDate(new Date(lastExport), 'YYYY-MM') : null;
    if (lastMonth === thisMonth) return '';
    var first = !lastExport;
    var msg = first
      ? '首次使用建议：先导出一份数据备份到本地/云盘，防止浏览器清理导致数据丢失。'
      : '本月（' + thisMonth + '）尚未导出数据备份，建议导出一次以防丢失。';
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:20px;background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(--radius);font-size:13px;color:var(--accent-text)">'
      + App.util.svgIcon('download', 18)
      + '<span style="flex:1">' + msg + '</span>'
      + '<button class="btn btn-primary btn-sm" onclick="App.store.exportJSON(); App.router.resolve();">导出备份</button>'
      + '</div>';
  }

  /* ---------------- 工具 ---------------- */
  function getWeekNodes(nodes, now) {
    var result = [];
    var todayWd = now.getDay();
    var endWd = (todayWd === 0) ? 0 : 7;
    nodes.forEach(function(n) {
      if (n.type === 'monthly') {
        if (App.util.isLastWeekOfMonth(now)) {
          if (n.weekday != null && n.weekday >= todayWd && n.weekday <= endWd) {
            result.push({ node: n, weekday: n.weekday });
          } else if (n.weekday == null) {
            result.push({ node: n, weekday: 6 });
          }
        }
        return;
      }
      if (n.weekday != null && n.weekday >= todayWd && n.weekday <= endWd) {
        result.push({ node: n, weekday: n.weekday });
      }
    });
    result.sort(function(a, b) { return a.weekday - b.weekday; });
    return result;
  }

  function isOverdue(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr + 'T23:59:59');
    return d.getTime() < Date.now();
  }

  function statChip(label, count, color) {
    return '<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--surface-2);border-radius:var(--radius);font-size:13px">'
      + '<span style="font-weight:700;font-size:16px;color:' + color + '">' + count + '</span>'
      + '<span style="color:var(--text-muted)">' + label + '</span></div>';
  }

  function metricCard(label, value, icon, sub, extraClass) {
    var ec = extraClass ? ' ' + extraClass : '';
    return '<div class="metric-card' + ec + '"><div><div class="metric-value">' + value + '</div><div class="metric-label">' + label + '</div>' + (sub ? '<div class="metric-delta">' + sub + '</div>' : '') + '</div><div style="color:var(--text-faint)">' + App.util.svgIcon(icon, 22) + '</div></div>';
  }

  /* ---------------- 对外 ---------------- */
  App.views = App.views || {};
  App.views.today = {
    generateWeeklyReport: generateWeeklyReport
  };

})();
