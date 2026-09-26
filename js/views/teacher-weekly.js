/* ============================================
   teacher-weekly.js — 周度教师（按周维护当周在职 / 新入职 / 离职名单与人数）
   核心需求（2026-09-26）：
     1) 教师周度 KPI 的饱和度分母此前误用「全量当前名册」，导致已离职教师被计入，
        与当周实际在岗人数脱节。本视图按周（周一~周日）推导名册，口径与
        kpi-engine.computeRows(weekEnd) 完全一致（同一 isActiveAt + 同一 SUBJECT_GROUPS 过滤），
        保证「周度教师人数 = 周度 KPI 饱和度分母」。
     2) 提供清晰的当周在职 / 新入职 / 离职三块名单与人数，便于每周核对与维护。
   名册「自动推导」：依据每位教师的入职/状态生效日（statusFrom||entryDate）与离职日（leftAt）
        自动判定当周在职、新入职、离职，无需每周手动维护（与教师管理状态字段打通）。
   ============================================ */

(function () {

  var _artMonth = null;   // 当前所选人工月（YYYY-MM）
  var _weekNo = 1;        // 当前所选周次（1..N）

  // ---------- 工具 ----------
  function statusLabelOf(s) {
    return (App.teachersUtil && App.teachersUtil.statusLabel) ? App.teachersUtil.statusLabel(s) : (s || '在职');
  }
  function ensureSelection() {
    if (_artMonth && _weekNo) return;
    var cur = App.weeklyCycle.artMonthOfDate(new Date());
    _artMonth = cur.artMonthId;
    _weekNo = cur.weekNo;
  }

  // 单块名单面板（当周在职 / 新入职 / 离职）
  function rosterPanel(title, list, kind, hint, metaFn) {
    var U = App.util;
    var html = '<div class="card roster-panel">';
    html += '<div class="card-header"><h3 class="card-title">' + U.svgIcon('users', 18) + U.escapeHtml(title);
    html += '<span class="pill ' + kind + '">' + list.length + ' 人</span></h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">' + U.escapeHtml(hint) + '</span></div>';
    if (!list.length) {
      html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">本周无</div>';
    } else {
      html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:260px"><thead><tr>'
        + '<th>教师</th><th>科组</th><th>备注</th></tr></thead><tbody>';
      list.forEach(function (r) {
        html += '<tr><td>' + U.escapeHtml(r.name) + '</td>'
          + '<td>' + U.escapeHtml(r.group) + '</td>'
          + '<td style="color:var(--text-muted);font-size:13px">' + U.escapeHtml(metaFn(r)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  // ---------- 渲染 ----------
  function render() {
    var container = document.getElementById('view-container');
    if (!container) return;
    var U = App.util;

    ensureSelection();
    var wk = App.weeklyCycle.resolveWeek(_artMonth, _weekNo);
    if (!wk) {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">周度教师</h1></div>'
        + '<div style="padding:24px;color:var(--text-muted)">所选周次无效</div>';
      return;
    }
    var weekStart = wk.start, weekEnd = wk.end;
    var teachers = (App.viewData && App.viewData().teachers) || [];
    var roster = (App.teachersUtil && App.teachersUtil.weekRoster)
      ? App.teachersUtil.weekRoster(teachers, weekStart, weekEnd)
      : { active: [], joined: [], left: [], counts: { active: 0, joined: 0, left: 0 } };

    var html = '';
    html += '<div class="page-head"><h1 class="page-title">周度教师</h1>';
    html += '<p class="page-sub">按周维护当周在职 / 新入职 / 离职教师名单与人数 · 仅统计科组教师（数学·英语·文综·理综），与教师周度 KPI 饱和度分母口径一致</p></div>';

    // 工具栏：人工月 + 周次；右侧跳转
    html += '<div class="teacher-toolbar"><div class="teacher-filters">';
    html += App.components.monthWeekPicker.html({
      month: _artMonth,
      week: _weekNo,
      months: App.weeklyCycle.recentMonths(12),
      monthCb: 'App.views.teacherWeekly.onMonthChange(this.value)',
      weekCb: 'App.views.teacherWeekly.onWeekChange(this.value)'
    });
    html += '</div><div class="teacher-actions">';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.teacherWeekly.gotoKpi()">' + U.svgIcon('bar-chart-2', 14) + ' 查看该周 KPI</button>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.teacherWeekly.gotoTeachers()">' + U.svgIcon('users', 14) + ' 维护教师状态</button>';
    html += '</div></div>';

    html += '<p class="form-hint" style="margin-bottom:14px">当前周度范围：' + U.escapeHtml(weekStart) + ' ~ ' + U.escapeHtml(weekEnd) + '（周一 ~ 周日）</p>';

    // 摘要条：当周在岗人数 = KPI 饱和度分母
    html += '<div class="roster-stat">';
    html += '<span class="n">' + roster.counts.active + '</span>';
    html += '<span class="l">当周在岗教师　=　教师周度 KPI 饱和度计算的分母　·　新入职 ' + roster.counts.joined + ' 人　·　离职 ' + roster.counts.left + ' 人</span>';
    html += '</div>';

    // 三块名单
    html += '<div class="roster-grid">';
    html += rosterPanel('当周在职', roster.active, 'active', '截至本周日（' + weekEnd + '）时点在职', function (r) { return statusLabelOf(r.status); });
    html += rosterPanel('新入职', roster.joined, 'joined', '入职 / 状态生效日落在本周区间内', function (r) { return '入职 ' + (r.statusFrom || '—'); });
    html += rosterPanel('离职', roster.left, 'left', '离职日落在本周区间内', function (r) { return '离职 ' + (r.leftAt || '—'); });
    html += '</div>';

    container.innerHTML = html;
  }

  // ---------- 交互 ----------
  function onMonthChange(v) { _artMonth = v; _weekNo = 1; render(); }
  function onWeekChange(v) { _weekNo = parseInt(v, 10) || 1; render(); }
  function gotoKpi() {
    if (App.views && App.views.weeklyKpi && App.views.weeklyKpi.setWeek) {
      App.views.weeklyKpi.setWeek(_artMonth, _weekNo);
    }
    if (App.router && App.router.navigate) App.router.navigate('/weekly-kpi');
  }
  function gotoTeachers() {
    if (App.router && App.router.navigate) App.router.navigate('/teachers');
  }

  // ---------- 路由 + 对外 ----------
  App.router.register('/teacher-weekly', function () { render(); });

  App.views = App.views || {};
  App.views.teacherWeekly = {
    onMonthChange: onMonthChange,
    onWeekChange: onWeekChange,
    gotoKpi: gotoKpi,
    gotoTeachers: gotoTeachers
  };

})();
