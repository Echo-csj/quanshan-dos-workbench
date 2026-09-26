/* ============================================
   weekly-cycle.js — 人工月 / 周次引擎（纯函数，无依赖）
   规则（2026-09-24 锁定）：
     1) 周 = 周一 ~ 周日；人工月最后一天固定为周日（整周 Mon-Sun 切分）。
     2) 自然月最后一天所在周【恒计入下一人工月】。
        => 上一自然月最后一天所在周 = 本人工月第 1 周
        => 本自然月最后一天所在周 = 下一人工月第 1 周（本人工月止于其前一日/周日）
   artMonthId 锚定该月最后一天(周日)所在的自然 YYYY-MM。
   全部使用本地时区（new Date(y,m,d) + 本地 Y-M-D 格式化），避免 toISOString 的 UTC 偏移。
   ============================================ */

(function (root) {

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  // 某日期所在周的周一（周起点）
  function mondayOf(d) {
    var day = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  }
  // 某日期所在周的周日（周终点）
  function sundayOf(d) {
    var day = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - day));
  }

  function lastDayOfMonth(ym) {
    var p = String(ym).split('-');
    return new Date(+p[0], +p[1], 0); // 下月第 0 天 = 当月最后一天
  }

  function prevMonthId(ym) {
    var p = String(ym).split('-');
    var y = +p[0], m = +p[1];
    if (m === 1) { y--; m = 12; } else { m--; }
    return y + '-' + pad(m);
  }
  function nextMonthId(ym) {
    var p = String(ym).split('-');
    var y = +p[0], m = +p[1];
    if (m === 12) { y++; m = 1; } else { m++; }
    return y + '-' + pad(m);
  }

  // 人工月第 1 周周一 = 上一自然月最后一天所在周的周一
  function artMonthStart(ym) {
    return mondayOf(lastDayOfMonth(prevMonthId(ym)));
  }
  // 人工月最后周日 = 本自然月最后一天所在周的周一 - 1 天
  function artMonthEnd(ym) {
    var m = mondayOf(lastDayOfMonth(ym));
    return new Date(m.getFullYear(), m.getMonth(), m.getDate() - 1);
  }

  function weekCount(ym) {
    var s = artMonthStart(ym), e = artMonthEnd(ym);
    return Math.round((e - s) / 86400000 + 1) / 7; // 含首尾整周数，必为整数
  }

  // 人工月的全部周（{weekNo, start, end}），start/end 为 YYYY-MM-DD
  function weeksOf(ym) {
    var s = artMonthStart(ym);
    var n = weekCount(ym);
    var arr = [];
    for (var i = 0; i < n; i++) {
      var st = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i * 7);
      var en = new Date(st.getFullYear(), st.getMonth(), st.getDate() + 6);
      arr.push({ weekNo: i + 1, start: fmt(st), end: fmt(en) });
    }
    return arr;
  }

  // 给定周次返回该周 {weekNo,start,end}
  function resolveWeek(ym, weekNo) {
    var ws = weeksOf(ym);
    return ws[weekNo - 1] || null;
  }

  // 给定日期（Date 或 YYYY-MM-DD）→ 所属人工月与周次
  function artMonthOfDate(d) {
    if (typeof d === 'string') d = parse(d);
    var ym = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    var candidates = [prevMonthId(ym), ym, nextMonthId(ym)];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var s = artMonthStart(c), e = artMonthEnd(c);
      if (d >= s && d <= e) {
        var wno = Math.round((mondayOf(d) - s) / (7 * 86400000)) + 1;
        var st = new Date(s.getFullYear(), s.getMonth(), s.getDate() + (wno - 1) * 7);
        var en = new Date(st.getFullYear(), st.getMonth(), st.getDate() + 6);
        return {
          artMonthId: c, weekNo: wno, weekCount: weekCount(c),
          start: fmt(st), end: fmt(en)
        };
      }
    }
    return null;
  }

  // 最近若干个人工月（含当前月，[当前, 过去…, 未来…]），用于筛选器下拉。
  // 过去月数 = count；未来月数 = futureCount（默认 6，便于提前规划 / 查看下一月，如 10 月）。
  // 当前月始终为数组首位，保证各调用方「默认选中当前月」的语义不变。
  function recentMonths(count, futureCount) {
    count = count || 12;
    futureCount = (typeof futureCount === 'number') ? futureCount : 6;
    var nowInfo = artMonthOfDate(new Date());
    var cur = nowInfo ? nowInfo.artMonthId
      : (new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1));
    var arr = [cur];
    var m = cur;
    for (var i = 1; i < count; i++) { m = prevMonthId(m); arr.push(m); }
    m = cur;
    for (var j = 0; j < futureCount; j++) { m = nextMonthId(m); arr.push(m); }
    return arr;
  }

  // 展示标签
  function monthLabel(ym) {
    var p = String(ym).split('-');
    return p[0] + '年' + (+p[1]) + '月';
  }
  function weekLabel(weekNo, start, end) {
    return '第' + weekNo + '周 (' + String(start).slice(5) + '~' + String(end).slice(5) + ')';
  }

  var engine = {
    fmt: fmt, parse: parse,
    mondayOf: mondayOf, sundayOf: sundayOf,
    lastDayOfMonth: lastDayOfMonth,
    prevMonthId: prevMonthId, nextMonthId: nextMonthId,
    artMonthStart: artMonthStart, artMonthEnd: artMonthEnd,
    weekCount: weekCount, weeksOf: weeksOf, resolveWeek: resolveWeek,
    artMonthOfDate: artMonthOfDate, recentMonths: recentMonths,
    monthLabel: monthLabel, weekLabel: weekLabel
  };

  if (root && (root.App = root.App || {})) { root.App.weeklyCycle = engine; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = engine; }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
