/* ============================================
   month-week-picker.js — 月份 + 周次 联动筛选器（复用组件）
   仅生成 HTML 片段（两种 <select>），联动由调用方在 onMonthChange 后整页重渲染实现，
   与现有 weekly-kpi 等页面的渲染风格一致（form-input / form-input-sm）。
   依赖：App.weeklyCycle
   ============================================ */

(function (root) {
  var App = root.App = root.App || {};

  // 人工月下拉 options HTML
  function monthOptionsHtml(months, selected) {
    return (months || []).map(function (m) {
      return '<option value="' + m + '"' + (m === selected ? ' selected' : '') + '>' +
        App.weeklyCycle.monthLabel(m) + '</option>';
    }).join('');
  }

  // 周次下拉 options HTML（周数随所选人工月动态变化）
  function weekOptionsHtml(artMonthId, selectedWeek) {
    var ws = App.weeklyCycle.weeksOf(artMonthId);
    return ws.map(function (w) {
      return '<option value="' + w.weekNo + '"' + (w.weekNo === selectedWeek ? ' selected' : '') + '>' +
        App.weeklyCycle.weekLabel(w.weekNo, w.start, w.end) + '</option>';
    }).join('');
  }

  // 便捷：一段完整两段 select 的 HTML
  // opts: { month, week, months, monthCb, weekCb }
  //   monthCb / weekCb 为 inline onchange 回调字符串，如 "App.views.x.onMonthChange(this.value)"
  function html(opts) {
    opts = opts || {};
    var months = opts.months || App.weeklyCycle.recentMonths(12);
    var month = opts.month || months[0];
    var week = opts.week || 1;
    var mCb = opts.monthCb || '';
    var wCb = opts.weekCb || '';
    return '<select class="form-input form-input-sm" onchange="' + mCb + '">' +
        monthOptionsHtml(months, month) + '</select>' +
      '<select class="form-input form-input-sm" onchange="' + wCb + '">' +
        weekOptionsHtml(month, week) + '</select>';
  }

  var picker = {
    monthOptionsHtml: monthOptionsHtml,
    weekOptionsHtml: weekOptionsHtml,
    html: html
  };

  App.components = App.components || {};
  App.components.monthWeekPicker = picker;
  if (typeof module !== 'undefined' && module.exports) { module.exports = picker; }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
