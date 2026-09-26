/* ============================================
   kpi-table.js — 教师周度 KPI 与周度数据中心「共享表格渲染」
   单一事实来源：两处（教师周度 KPI 页 / 周度数据中心明细）的「按教师 / 按科组」表
   使用完全一致的列结构、配色、拆分（1V1/1V6/周六/周日）展示，杜绝分叉。
   依赖：App.util（svgIcon/escapeHtml）、App.kpiEngine.BASE。
   暴露：App.views.kpiTable.{ fmtMaybe, fmtBreakdown, safeByDay, satColor, pct,
                             renderTeacherKpiTable, renderGroupKpiTable }
   ============================================ */

(function () {
  App.views = App.views || {};

  var BASE = (App.kpiEngine && App.kpiEngine.BASE) || 16;

  // ---------- 共享辅助（与 kpi-engine 口径一致）----------
  function fmtMaybe(v) { return v == null ? '—' : v; }

  // 展示「total (a+b)」；total 或拆分字段缺失（旧数据）时降级展示，零回归。
  function fmtBreakdown(total, a, b) {
    if (total == null) return '—';
    if (a == null || b == null) return String(total);
    return total + ' (' + a + '+' + b + ')';
  }

  // 安全读取按天聚合（旧快照/归档可能无 byDay，或字段不全）
  function safeByDay(row, day) {
    return (row && row.byDay && row.byDay[day]) ||
      { pre: 0, pre1v1: 0, pre1v6: 0, actual: 0, actual1v1: 0, actual1v6: 0, leave: 0 };
  }

  // 屏幕用饱和度配色（CSS 变量），与 weekly-kpi 完全一致
  function satColor(v) {
    if (v == null || isNaN(v)) return 'var(--text-muted)';
    if (v > 1) return 'var(--bad)';        // 超饱和（>100%）
    if (v >= 0.75) return 'var(--ok)';     // 饱满
    if (v >= 0.5) return 'var(--warn)';    // 中等
    return 'var(--text-muted)';            // 偏低
  }

  function pct(v) { if (v == null || isNaN(v)) return '-'; return (v * 100).toFixed(0) + '%'; }

  // 按教师明细表（11 列：教师/科组/预排/请假/实际(均 1V1+1V6)/周六/周日/1V1/1V6/预排饱和度/实际饱和度）
  // opts.selectable=true 时在最前加「选」勾选列（用于教师周度 KPI 实时周纳入/剔除科组汇总）
  // opts.toggleExpr(idx) 返回该勾选框的 onchange 表达式字符串（如 "App.views.weeklyKpi.toggleTeacher(0, this.checked)"）
  function renderTeacherKpiTable(rows, opts) {
    opts = opts || {};
    var U = App.util;
    var selectable = !!opts.selectable;
    var title = opts.title || '按教师';
    var html = '';
    html += '<div class="card" style="margin-bottom:18px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('users', 18) + title + '</h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">' +
      (selectable ? '勾选「选」决定该教师是否纳入科组汇总 · ' : '') +
      '课次展示为「合计（1V1+1V6）」' + (selectable ? '' : ' · 旧数据缺拆分时降级显示') + '</span></div>';
    if (!rows || !rows.length) {
      html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">暂无教师课次数据' +
        (opts.emptyHint || '') + '</div>';
    } else {
      html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:920px"><thead><tr>';
      if (selectable) html += '<th style="width:44px">选</th>';
      ['教师', '科组', '预排周课次(1V1+1V6)', '请假课次(1V1+1V6)', '实际周课次(1V1+1V6)', '周六课次', '周日课次', '1V1课次', '1V6课次', '预排饱和度', '实际饱和度'].forEach(function (h) { html += '<th>' + h + '</th>'; });
      html += '</tr></thead><tbody>';
      rows.forEach(function (r, idx) {
        var sat = safeByDay(r, '周六'), sun = safeByDay(r, '周日');
        var hasByDay = !!(r.byDay);
        html += '<tr>';
        if (selectable) {
          html += '<td><input type="checkbox" ' + (r.selected ? 'checked' : '') + ' onchange="' + (opts.toggleExpr ? opts.toggleExpr(idx) : '') + '"></td>';
        }
        html += '<td>' + U.escapeHtml(r.name) + '</td>';
        html += '<td>' + U.escapeHtml(r.group) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(r.pre, r.pre1v1, r.pre1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(r.leave, r.leave1v1, r.leave1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(r.actual, r.actual1v1, r.actual1v6) + '</td>';
        html += '<td class="mono">' + (hasByDay ? sat.pre : '—') + '</td>';
        html += '<td class="mono">' + (hasByDay ? sun.pre : '—') + '</td>';
        html += '<td class="mono">' + fmtMaybe(r.pre1v1) + '</td>';
        html += '<td class="mono">' + fmtMaybe(r.pre1v6) + '</td>';
        html += '<td class="mono" style="color:' + satColor(r.preSat) + ';font-weight:600">' + pct(r.preSat) + '</td>';
        html += '<td class="mono" style="color:' + satColor(r.actualSat) + ';font-weight:600">' + pct(r.actualSat) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  // 按科组表（11 列）+ 校区汇总行（自带 card 包裹）
  // 校区汇总行的 1V1/1V6/周六/周日 拆分：优先读 summary 自带字段（computeCampusSummary 已聚合）；
  // 若 summary 缺失（兼容旧快照/归档），则实时从 groups 派生，保证展示一致、零回归。
  function renderGroupKpiTable(groups, summary, opts) {
    opts = opts || {};
    var U = App.util;
    var title = opts.title || '按科组';
    var html = '';
    html += '<div class="card" style="margin-bottom:18px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('bar-chart-2', 18) + title + '</h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">科组饱和度 = 科组周课次 / ' + BASE + ' / 科组教师数' +
      (opts.onlySelected ? '（仅统计已勾选教师）' : '') + '</span></div>';
    if (!groups || !groups.length) {
      html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">暂无科组数据</div>';
    } else {
      html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:920px"><thead><tr>';
      ['科组', '教师数', '预排周课次(1V1+1V6)', '请假课次(1V1+1V6)', '实际周课次(1V1+1V6)', '周六课次', '周日课次', '1V1课次', '1V6课次', '预排饱和度', '实际饱和度'].forEach(function (h) { html += '<th>' + h + '</th>'; });
      html += '</tr></thead><tbody>';
      groups.forEach(function (g) {
        var sat = safeByDay(g, '周六'), sun = safeByDay(g, '周日');
        var hasByDay = !!(g.byDay);
        html += '<tr>';
        html += '<td>' + U.escapeHtml(g.group) + '</td>';
        html += '<td class="mono">' + g.teachers + '</td>';
        html += '<td class="mono">' + fmtBreakdown(g.pre, g.pre1v1, g.pre1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(g.leave, g.leave1v1, g.leave1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(g.actual, g.actual1v1, g.actual1v6) + '</td>';
        html += '<td class="mono">' + (hasByDay ? sat.pre : '—') + '</td>';
        html += '<td class="mono">' + (hasByDay ? sun.pre : '—') + '</td>';
        html += '<td class="mono">' + fmtMaybe(g.pre1v1) + '</td>';
        html += '<td class="mono">' + fmtMaybe(g.pre1v6) + '</td>';
        html += '<td class="mono" style="color:' + satColor(g.preSat) + ';font-weight:600">' + pct(g.preSat) + '</td>';
        html += '<td class="mono" style="color:' + satColor(g.actualSat) + ';font-weight:600">' + pct(g.actualSat) + '</td>';
        html += '</tr>';
      });
      if (summary) {
        var cs = summary || {};
        var csPre1v1 = cs.pre1v1, csPre1v6 = cs.pre1v6, csAct1v1 = cs.actual1v1, csAct1v6 = cs.actual1v6;
        var csSat = safeByDay(cs, '周六'), csSun = safeByDay(cs, '周日');
        if (cs.pre1v1 == null) {
          // 兼容旧快照/归档：summary 无拆分字段时从 groups 实时派生
          csPre1v1 = 0; csPre1v6 = 0; csAct1v1 = 0; csAct1v6 = 0;
          var cSat = { pre: 0 }, cSun = { pre: 0 };
          groups.forEach(function (g) {
            csPre1v1 += (g.pre1v1 || 0); csPre1v6 += (g.pre1v6 || 0);
            csAct1v1 += (g.actual1v1 || 0); csAct1v6 += (g.actual1v6 || 0);
            if (g.byDay) {
              cSat.pre += ((g.byDay['周六'] && g.byDay['周六'].pre) || 0);
              cSun.pre += ((g.byDay['周日'] && g.byDay['周日'].pre) || 0);
            }
          });
          csSat = cSat; csSun = cSun;
        }
        html += '<tr style="font-weight:600;background:#EEF2FF;border-top:2px solid #4F46E5">';
        html += '<td>' + U.escapeHtml(cs.label || '校区汇总') + '</td>';
        html += '<td class="mono">' + (cs.teachers || 0) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(cs.pre, csPre1v1, csPre1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(cs.leave, cs.leave1v1, cs.leave1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(cs.actual, csAct1v1, csAct1v6) + '</td>';
        html += '<td class="mono">' + csSat.pre + '</td>';
        html += '<td class="mono">' + csSun.pre + '</td>';
        html += '<td class="mono">' + fmtMaybe(csPre1v1) + '</td>';
        html += '<td class="mono">' + fmtMaybe(csPre1v6) + '</td>';
        html += '<td class="mono" style="color:' + satColor(cs.preSat) + ';font-weight:600">' + pct(cs.preSat) + '</td>';
        html += '<td class="mono" style="color:' + satColor(cs.actualSat) + ';font-weight:600">' + pct(cs.actualSat) + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  App.views.kpiTable = {
    fmtMaybe: fmtMaybe,
    fmtBreakdown: fmtBreakdown,
    safeByDay: safeByDay,
    satColor: satColor,
    pct: pct,
    renderTeacherKpiTable: renderTeacherKpiTable,
    renderGroupKpiTable: renderGroupKpiTable
  };

  // 同时导出（供 Node 测试独立 require 视图模块时可靠取用；浏览器中 module 未定义，跳过）
  if (typeof module !== 'undefined') module.exports = App.views.kpiTable;

})();
