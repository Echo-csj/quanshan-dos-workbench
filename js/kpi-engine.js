/* ============================================
   kpi-engine.js — 教师周度 KPI 纯计算引擎（无 DOM / 无 store）
   被 weekly-kpi.js（实时查看）与 weekly-data.js（数据中心归档）共用，
   确保两个入口的 KPI 口径完全一致（零回归）。
   同时 module.exports 供 Node 测试复用。
   ============================================ */

(function (root) {

  var BASE = 16; // 16 次课 = 100% 满负荷
  var SUBJECT_GROUPS = ['数学', '英语', '文综', '理综'];

  // 学科组归一（数学/英语/文综/理综）
  function canonSubject(s) {
    s = String(s || '').trim();
    if (!s) return '';
    s = s.replace(/科组$|教研组$|备课组$|学科组$|组$|学科$/, '');
    if (s.indexOf('数学') >= 0) return '数学';
    if (s.indexOf('英语') >= 0) return '英语';
    if (s.indexOf('文综') >= 0) return '文综';
    if (s.indexOf('理综') >= 0) return '理综';
    return s;
  }

  // 教师姓名 → 学科组 映射
  function buildGroupMap(teachers) {
    var m = {};
    (teachers || []).forEach(function (t) { if (t && t.name) m[t.name] = canonSubject(t.subjectGroup); });
    return m;
  }

  function isRest(v) { return v == null || String(v).trim().length === 0 || String(v).trim() === '休息'; }
  function isLeave(v) { return String(v).indexOf('[请假]') >= 0; }

  // schedule: { weekStartDate, weekEndDate, teachers:[{name, subject, classes}] }
  // opts: { filterGroup:'all'|组名, selNames:{name->bool}|null（null=全选） }
  function computeRows(schedule, teachers, opts) {
    opts = opts || {};
    var filterGroup = opts.filterGroup || 'all';
    var selNames = opts.selNames || null;
    var sch = schedule || {};
    var groupMap = buildGroupMap(teachers);
    var rows = [];
    (sch.teachers || []).forEach(function (t) {
      var name = t.name || '（未命名）';
      var subj = groupMap[name] || canonSubject(t.subject) || '未分组';
      if (filterGroup && filterGroup !== 'all' && subj !== filterGroup) return;
      var classes = t.classes || {};
      var pre = 0, leave = 0;
      Object.keys(classes).forEach(function (k) {
        var v = String(classes[k] || '').trim();
        if (isRest(v)) return;             // 空 / 休息 不计入预排
        pre++;
        if (isLeave(v)) leave++;           // 请假课次
      });
      var actual = pre - leave;
      var selected = selNames ? (selNames[name] !== false) : true;
      rows.push({
        name: name, group: subj, pre: pre, leave: leave, actual: actual,
        preSat: pre / BASE, actualSat: actual / BASE, selected: selected
      });
    });
    return rows;
  }

  // 按科组聚合（仅统计 selected 教师）
  function computeGroups(rows) {
    var groups = {};
    (rows || []).forEach(function (r) {
      if (!r.selected) return;
      if (!groups[r.group]) groups[r.group] = { group: r.group, teachers: 0, pre: 0, actual: 0 };
      groups[r.group].teachers++;
      groups[r.group].pre += r.pre;
      groups[r.group].actual += r.actual;
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      return {
        group: g.group, teachers: g.teachers, pre: g.pre, actual: g.actual,
        preSat: g.teachers ? g.pre / BASE / g.teachers : 0,
        actualSat: g.teachers ? g.actual / BASE / g.teachers : 0
      };
    });
  }

  // 校区汇总（基于已勾选教师的所有科组聚合）
  function computeCampusSummary(groups) {
    var summary = { label: '校区汇总', teachers: 0, pre: 0, actual: 0, preSat: 0, actualSat: 0 };
    (groups || []).forEach(function (g) {
      summary.teachers += g.teachers;
      summary.pre += g.pre;
      summary.actual += g.actual;
    });
    if (summary.teachers) {
      summary.preSat = summary.pre / BASE / summary.teachers;
      summary.actualSat = summary.actual / BASE / summary.teachers;
    }
    return summary;
  }

  // 完整周记录（数据中心实体）。
  // schedule/teachers 为原始数据；weekStart/weekEnd/artMonthId/weekNo 标识该周。
  // opts: { dataSource, locked, selNames, includeRoster }
  //   includeRoster=true 时额外生成「weekEnd 时点在职」的教师花名册（按 week_end 时点判定）。
  function computeRecord(schedule, teachers, weekStart, weekEnd, artMonthId, weekNo, opts) {
    opts = opts || {};
    var rows = computeRows(schedule, teachers, { filterGroup: 'all', selNames: opts.selNames || null });
    var groups = computeGroups(rows);
    var summary = computeCampusSummary(groups);
    var rec = {
      weekStart: weekStart,
      weekEnd: weekEnd,
      artMonthId: artMonthId,
      weekNo: weekNo,
      weekLabel: '第' + weekNo + '周 (' + String(weekStart).slice(5) + '~' + String(weekEnd).slice(5) + ')',
      dataSource: opts.dataSource || 'live',
      locked: !!opts.locked,
      kpiByTeacher: rows,
      kpiByGroup: groups,
      campusSummary: summary,
      createdAt: new Date().toISOString()
    };
    if (opts.includeRoster && weekEnd) {
      var Util = (root && root.App && root.App.teachersUtil);
      var roster = (teachers || []).filter(function (t) {
        return t && t.name && (!Util || Util.isActiveAt(t, weekEnd));
      }).map(function (t) {
        return {
          name: t.name,
          group: canonSubject(t.subjectGroup),
          status: (t.status || 'active'),
          statusFrom: (t.statusFrom || t.entryDate || ''),
          leftAt: (t.leftAt || '')
        };
      });
      rec.roster = roster;
      rec.rosterCount = roster.length;
    }
    return rec;
  }

  var api = {
    BASE: BASE,
    SUBJECT_GROUPS: SUBJECT_GROUPS,
    canonSubject: canonSubject,
    buildGroupMap: buildGroupMap,
    computeRows: computeRows,
    computeGroups: computeGroups,
    computeCampusSummary: computeCampusSummary,
    computeRecord: computeRecord
  };

  if (root && (root.App = root.App || {})) { root.App.kpiEngine = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
