/* ============================================
   today.js — 今日指挥台
   聚合：今日/本周节律节点 + 我的待办(逾期标红) + 周报草稿 + 备份提醒
   ============================================ */

(function() {

  var todayFilter = 'all'; // 辨别筛选：all | core | alert

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

    // 今日工作（辨别筛选：核心工作 / 重要提示）
    html += buildTodayWorkHtml(now, todayNodes);

    // 今日黄历（宜 / 忌 / 今日提示）
    html += almanacHtml();

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

  /* ---------------- 今日工作：辨别筛选（核心工作 / 重要提示） ---------------- */

  // 分类单个任务：'core'(核心工作) | 'alert'(重要提示) | 'other'(未来远期待办) | null(已完成/归档)
  function classifyTask(t, todayStr, soonStr) {
    if (!t || t.status === 'done' || t.archived) return null;
    var due = t.dueDate;
    if (due && App.util.isOverdue(due)) return 'alert';                // 已逾期
    if (due === todayStr) return 'core';                               // 今日到期
    if (due && soonStr && due > todayStr && due <= soonStr) return 'alert'; // 临近截止(未来 1~3 天)
    if (t.status === 'doing' || t.status === 'review') return 'core';  // 进行中 / 审阅中
    if (t.priority === 'urgent' || t.priority === 'high') return 'core'; // 紧急 / 高优
    if (!due) return 'core';                                           // 无截止日期待办（含手动新建）→ 待推进
    return 'other';                                                    // 未来 >3 天普通待办
  }

  // 读待处理教师发展里程碑（直接读 store，避免对 teacher-milestones 加载顺序依赖）
  function getPendingMilestones() {
    var ms = App.store.get('teacherMilestones') || [];
    return ms.filter(function (m) { return m.status !== 'done'; });
  }

  function taskItemHtml(t, kind) {
    var U = App.util;
    var overdue = t.status !== 'done' && t.dueDate && U.isOverdue(t.dueDate);
    var dueToday = t.dueDate && !overdue && t.dueDate === U.formatDate(new Date(), 'YYYY-MM-DD');
    var badgeMap = { core: ['tw-badge-core', '核心'], alert: ['tw-badge-alert', '提示'], other: ['tw-badge-other', '待办'] };
    var b = badgeMap[kind] || badgeMap.other;
    var dueCls = overdue ? ' tw-due-overdue' : (dueToday ? ' tw-due-today' : '');
    var html = '<div class="tw-item" onclick="App.views.tasks.editTask(\'' + U.escapeAttr(t.id) + '\')">';
    html += '<span class="tw-badge ' + b[0] + '">' + b[1] + '</span>';
    if (t.scope === 'team') html += '<span class="tw-badge tw-badge-team">团队</span>';
    html += '<span class="tag priority-' + (t.priority || 'normal') + '">' + U.priorityLabel(t.priority) + '</span>';
    html += '<span class="tw-title">' + U.escapeHtml(t.title || '未命名任务') + '</span>';
    if (t.assignee) html += '<span class="tw-assignee">' + U.escapeHtml(t.assignee) + '</span>';
    html += '<span class="tw-right">';
    if (t.dueDate) html += '<span class="mono tw-due' + dueCls + '">' + U.escapeHtml(t.dueDate) + '</span>';
    html += '<span class="tag ' + (overdue ? 'tag-bad' : 'tag-neutral') + '">' + U.statusLabel(t.status) + '</span>';
    html += '</span></div>';
    return html;
  }

  function nodeTipItemHtml(node) {
    var U = App.util;
    var html = '<div class="tw-item tw-node-item">';
    html += '<span class="tw-badge tw-badge-node">节律</span>';
    html += '<span class="tw-title">' + U.escapeHtml(node.title) + '</span>';
    if (node.time) html += '<span class="tag tag-accent mono">' + U.escapeHtml(node.time) + '</span>';
    html += '<span class="tw-right"><span class="tag tag-accent">今日安排</span></span>';
    html += '</div>';
    return html;
  }

  function milestoneTipItemHtml(m) {
    var U = App.util;
    var overdue = U.isOverdue(m.dueDate);
    var html = '<div class="tw-item tw-ms-item">';
    html += '<span class="tw-badge tw-badge-ms">发展</span>';
    html += '<span class="tw-title">' + U.escapeHtml(m.teacherName) + ' · ' + U.escapeHtml(m.label) + '</span>';
    html += '<span class="tw-right"><span class="mono tw-due' + (overdue ? ' tw-due-overdue' : '') + '">' + U.escapeHtml(m.dueDate) + '</span>';
    html += '<span class="tag ' + (overdue ? 'tag-bad' : 'tag-warn') + '">待处理</span></span>';
    html += '</div>';
    return html;
  }

  function buildTodayWorkHtml(now, todayNodes) {
    var U = App.util;
    var todayStr = U.formatDate(now, 'YYYY-MM-DD');
    var soon = new Date(now); soon.setDate(soon.getDate() + 3);
    var soonStr = U.formatDate(soon, 'YYYY-MM-DD');

    var tasks = (App.store.get('tasks') || []).filter(function (t) { return !t.archived; });
    var milestones = getPendingMilestones();

    var core = [], alert = [], other = [];
    tasks.forEach(function (t) {
      var k = classifyTask(t, todayStr, soonStr);
      if (k === 'core') core.push(t);
      else if (k === 'alert') alert.push(t);
      else if (k === 'other') other.push(t);
    });
    function sortByDue(a, b) {
      var pa = a.priority === 'urgent' ? 0 : (a.priority === 'high' ? 1 : (a.priority === 'normal' ? 2 : 3));
      var pb = b.priority === 'urgent' ? 0 : (b.priority === 'high' ? 1 : (b.priority === 'normal' ? 2 : 3));
      if (pa !== pb) return pa - pb;
      return (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99');
    }
    core.sort(sortByDue); alert.sort(sortByDue); other.sort(sortByDue);

    var overdueCount = tasks.filter(function (t) { return t.status !== 'done' && t.dueDate && U.isOverdue(t.dueDate); }).length;
    var alertCount = alert.length + todayNodes.length + milestones.length;

    var html = '<div class="card tw-card" style="margin-bottom:20px">';
    html += '<div class="card-header"><h3 class="card-title">' + U.svgIcon('target', 18) + '今日工作</h3>';
    html += '<div style="display:flex;gap:8px">';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.openTaskModal()">' + U.svgIcon('plus', 14) + '新建任务</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.router.navigate(\'/tasks\')">查看看板 →</button>';
    html += '</div></div>';

    // 辨别筛选 tab
    html += '<div class="tw-tabs">';
    [['all', '全部', core.length + alert.length + other.length + milestones.length],
     ['core', '核心工作', core.length],
     ['alert', '重要提示', alertCount]].forEach(function (p) {
      html += '<button class="tw-tab' + (todayFilter === p[0] ? ' active' : '') + '" onclick="App.views.today.setTodayFilter(\'' + p[0] + '\')">' + p[1] + ' <span class="tw-tab-count">' + p[2] + '</span></button>';
    });
    html += '</div>';

    // 统计 chips
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">';
    html += statChip('核心工作', core.length, 'var(--accent)');
    html += statChip('重要提示', alertCount, 'var(--warn)');
    html += statChip('逾期', overdueCount, overdueCount ? 'var(--bad)' : 'var(--ok)');
    html += '</div>';

    // 列表
    var items = [];
    if (todayFilter === 'core') {
      core.forEach(function (t) { items.push(taskItemHtml(t, 'core')); });
    } else if (todayFilter === 'alert') {
      todayNodes.forEach(function (n) { items.push(nodeTipItemHtml(n)); });
      milestones.forEach(function (m) { items.push(milestoneTipItemHtml(m)); });
      alert.forEach(function (t) { items.push(taskItemHtml(t, 'alert')); });
    } else {
      core.forEach(function (t) { items.push(taskItemHtml(t, 'core')); });
      alert.forEach(function (t) { items.push(taskItemHtml(t, 'alert')); });
      other.forEach(function (t) { items.push(taskItemHtml(t, 'other')); });
      milestones.forEach(function (m) { items.push(milestoneTipItemHtml(m)); });
    }

    if (items.length === 0) {
      var emptyText = todayFilter === 'core' ? '暂无核心工作，可点右上角「新建任务」添加。'
        : (todayFilter === 'alert' ? '暂无重要提示，节奏平稳。' : '今日暂无待办，可点「新建任务」添加。');
      html += '<p class="tw-empty">' + emptyText + '</p>';
    } else {
      html += '<div class="tw-list">' + items.join('') + '</div>';
    }

    html += '</div>';
    return html;
  }

  /* ---------------- 今日黄历（宜 / 忌 / 今日提示） ---------------- */
  var ALMANAC_BY_WEEKDAY = {
    0: { yi: ['完成 DOS 周报并上报', '复盘本周数据与下周安排'], ji: ['拖延周报上报', '临时安排新会议'] },
    1: { yi: ['对齐集团会议精神', '规划本周工作重点'], ji: ['排满全天课程', '跳过会议要点记录'] },
    2: { yi: ['拆解并下发事项', '召开主管会 / 教务会', '检查当周课表'], ji: ['跳过课表检查', '漏对接客服部'] },
    3: { yi: ['磨课教研与反思', '推进次月预排'], ji: ['忽略教研反馈', '拖延预排课表'] },
    4: { yi: ['锁定课表', '提醒老师确认课表'], ji: ['临时改动已锁课表', '漏看老师确认反馈'] },
    5: { yi: ['提交教研资料', '负责人审核教研资料'], ji: ['拖延周末周报准备', '漏发教研提醒'] },
    6: { yi: ['整理讲义与表单', '复盘本周待办'], ji: ['安排正式会议', '积压未结事项'] }
  };

  function computeLunar(now) {
    try {
      if (typeof Solar === 'undefined') return null;
      var l = Solar.fromDate(now).getLunar();
      return {
        lunarDate: l.getMonthInChinese() + '月' + l.getDayInChinese(),
        yearGanZhi: l.getYearInGanZhi(),
        shengXiao: l.getYearShengXiao(),
        monthGanZhi: l.getMonthInGanZhi(),
        dayGanZhi: l.getDayInGanZhi(),
        jieQi: l.getJieQi() || '',
        yi: l.getDayYi() || [],
        ji: l.getDayJi() || [],
        festivals: l.getFestivals() || []
      };
    } catch (e) { return null; }
  }

  function almanac() {
    var U = App.util;
    var now = new Date();
    var wd = now.getDay();
    var base = ALMANAC_BY_WEEKDAY[wd] || ALMANAC_BY_WEEKDAY[1];
    var lunar = computeLunar(now);
    var todayStr = U.formatDate(now, 'YYYY-MM-DD');
    var soon = new Date(now); soon.setDate(soon.getDate() + 3);
    var soonStr = U.formatDate(soon, 'YYYY-MM-DD');

    var tasks = (App.store.get('tasks') || []).filter(function (t) { return !t.archived; });
    var overdue = tasks.filter(function (t) { return t.status !== 'done' && t.dueDate && U.isOverdue(t.dueDate); });
    var dueToday = tasks.filter(function (t) { return t.status !== 'done' && t.dueDate === todayStr; });
    var dueSoon = tasks.filter(function (t) { return t.status !== 'done' && t.dueDate && t.dueDate > todayStr && t.dueDate <= soonStr; });
    var msPending = getPendingMilestones();

    var data = App.store.getData();
    var fixedNodes = (data.timeline && data.timeline.fixedNodes) || [];
    var todayNodes = fixedNodes.filter(function (n) {
      if (n.type === 'monthly') return false;
      return n.weekday === wd;
    });

    var tips = [];
    if (lunar) tips.push('工作节奏：宜 ' + base.yi.join('、') + '；忌 ' + base.ji.join('、'));
    if (overdue.length) tips.push(overdue.length + ' 条任务已逾期，建议优先处理');
    if (dueToday.length) tips.push(dueToday.length + ' 条任务今日到期，注意按时收口');
    if (dueSoon.length) tips.push('未来 3 天还有 ' + dueSoon.length + ' 条任务截止');
    if (msPending.length) tips.push(msPending.length + ' 条教师发展提醒待处理');
    if (todayNodes.length) tips.push('今日固定安排：' + todayNodes.map(function (n) { return n.title; }).join('、'));
    if (!tips.length) tips.push('今日无特别提醒，可按计划稳步推进');

    return {
      dateLabel: U.formatDate(now, 'YYYY年MM月DD日') + ' ' + U.getWeekdayName(now),
      weekLabel: '第 ' + U.getWeekNumber(now) + ' 周',
      yi: (lunar && lunar.yi.length) ? lunar.yi : base.yi,
      ji: (lunar && lunar.ji.length) ? lunar.ji : base.ji,
      lunar: lunar,
      businessYi: base.yi,
      businessJi: base.ji,
      tips: tips,
      overdue: overdue.length,
      dueToday: dueToday.length,
      dueSoon: dueSoon.length,
      msPending: msPending.length
    };
  }

  function almanacHtml() {
    var U = App.util;
    var a = almanac();
    var html = '<div class="card almanac" style="margin-bottom:20px">';
    html += '<div class="card-header"><h3 class="card-title">' + U.svgIcon('book-open', 18) + '今日黄历</h3>';
    html += '<span class="almanac-date">' + U.escapeHtml(a.dateLabel) + ' · ' + U.escapeHtml(a.weekLabel) + '</span></div>';
    if (a.lunar) {
      html += '<div class="almanac-lunar">';
      html += '<span class="almanac-lunar-main">' + U.escapeHtml(a.lunar.yearGanZhi) + '年 · 生肖' + U.escapeHtml(a.lunar.shengXiao) + '</span>';
      html += '<span class="almanac-lunar-sub">农历 ' + U.escapeHtml(a.lunar.lunarDate) + ' · ' + U.escapeHtml(a.lunar.dayGanZhi) + '日</span>';
      if (a.lunar.jieQi) html += '<span class="almanac-lunar-jq">节气：' + U.escapeHtml(a.lunar.jieQi) + '</span>';
      if (a.lunar.festivals && a.lunar.festivals.length) html += '<span class="almanac-lunar-jq">' + U.escapeHtml(a.lunar.festivals.join('、')) + '</span>';
      html += '</div>';
    }
    html += '<div class="almanac-grid">';
    html += '<div class="almanac-col almanac-yi"><div class="almanac-head"><span class="almanac-tag almanac-tag-yi">宜</span></div>';
    html += '<ul class="almanac-list">' + a.yi.map(function (s) { return '<li>' + U.escapeHtml(s) + '</li>'; }).join('') + '</ul></div>';
    html += '<div class="almanac-col almanac-ji"><div class="almanac-head"><span class="almanac-tag almanac-tag-ji">忌</span></div>';
    html += '<ul class="almanac-list">' + a.ji.map(function (s) { return '<li>' + U.escapeHtml(s) + '</li>'; }).join('') + '</ul></div>';
    html += '</div>';
    html += '<div class="almanac-tips"><span class="almanac-tips-label">今日提示</span>';
    html += '<ul class="almanac-tips-list">' + a.tips.map(function (s) { return '<li>' + U.escapeHtml(s) + '</li>'; }).join('') + '</ul></div>';
    html += '</div>';
    return html;
  }

  function setTodayFilter(f) {
    todayFilter = f;
    App.router.resolve();
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
    generateWeeklyReport: generateWeeklyReport,
    classifyTask: classifyTask,
    almanac: almanac,
    setTodayFilter: setTodayFilter,
    getPendingMilestones: getPendingMilestones
  };

})();
