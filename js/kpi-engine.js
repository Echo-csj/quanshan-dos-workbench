/* ============================================
   kpi-engine.js — 教师周度 KPI 纯计算引擎（无 DOM / 无 store）
   被 weekly-kpi.js（实时查看）与 weekly-data.js（数据中心归档）共用，
   确保两个入口的 KPI 口径完全一致（零回归）。
   同时 module.exports 供 Node 测试复用。
   ============================================ */

(function (root) {

  var BASE = 16; // 16 次课 = 100% 满负荷
  var SUBJECT_GROUPS = ['数学', '英语', '文综', '理综'];
  var DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

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

  // 课程类型判断（与课程表模块约定一致）：
  //   - 单元格值含「泉山+年级/班级」→ 1V6 班课
  //   - 其余非空、非休息、非请假 → 1V1 个课（学生姓名+年级）
  //   - 返回 null 表示不计课次（休息/空）
  function classTypeOf(v) {
    var base = String(v || '').replace(/\[请假\]/g, '').trim();
    if (!base || base === '休息') return null;
    if (base.indexOf('泉山') >= 0) return '1v6';
    return '1v1';
  }

  // 从 classes 键（如「周一-08:00-10:00」）提取星期
  function classDayOf(key) {
    var idx = String(key || '').indexOf('-');
    return idx >= 0 ? key.slice(0, idx) : key;
  }

  function emptyByDay() {
    var o = {};
    DAYS.forEach(function (d) { o[d] = { pre: 0, pre1v1: 0, pre1v6: 0 }; });
    return o;
  }

  // schedule: { weekStartDate, weekEndDate, teachers:[{name, subject, classes}] }
  // teachers: 教师管理板块教师名册（权威来源，决定科组归属与科组教师数）
  // opts: { filterGroup:'all'|组名, selNames:{name->bool}|null（null=全选）, weekEnd:'YYYY-MM-DD'|null }
  // 规则：科组教师数以教师管理板块为准；课程表缺失该老师数据时，该老师当周课次计为 0（仍计入科组教师数）。
  // 新增：按课程类型拆分 1V1/1V6，并按星期聚合（用于 KPI 视图展示）。
  // 周度口径（2026-09-26）：若 opts.weekEnd 给定，仅计入「截至该周结束（周日）时点在职」的科组教师，
  //       使饱和度分母严格等于当周实际在岗教师（已离职/未入职者不计入），与 weekRoster / 数据中心一致。
  function computeRows(schedule, teachers, opts) {
    opts = opts || {};
    var filterGroup = opts.filterGroup || 'all';
    var selNames = opts.selNames || null;
    var weekEnd = opts.weekEnd || null;
    var sch = schedule || {};
    var tchList = teachers || [];
    // 周度过滤：仅保留截至 weekEnd 时点在职的科组教师（修复饱和度分母）
    if (weekEnd) {
      var Util = (root && root.App && root.App.teachersUtil);
      tchList = tchList.filter(function (t) {
        return !Util || Util.isActiveAt(t, weekEnd);
      });
    }
    var groupMap = buildGroupMap(teachers);
    // 课程表教师按姓名索引，用于左连接到教师管理名册（缺失即计 0）
    var schedByName = {};
    (sch.teachers || []).forEach(function (t) { if (t && t.name) schedByName[t.name] = t; });
    var rows = [];
    tchList.forEach(function (t) {
      var name = t.name || '（未命名）';
      var subj = groupMap[name] || canonSubject(t.subjectGroup) || '未分组';
      if (SUBJECT_GROUPS.indexOf(subj) < 0) return; // 仅纳入有科组归属的教师（教师管理板块为准）
      if (filterGroup && filterGroup !== 'all' && subj !== filterGroup) return;
      var st = schedByName[name];                 // 该周课程表数据（可能缺失）
      var classes = (st && st.classes) || {};
      var pre = 0, pre1v1 = 0, pre1v6 = 0;
      var leave = 0, leave1v1 = 0, leave1v6 = 0;
      var byDay = emptyByDay();
      Object.keys(classes).forEach(function (k) {
        var v = String(classes[k] || '').trim();
        if (isRest(v)) return;             // 空 / 休息 不计入预排
        var typ = classTypeOf(v);          // '1v1' | '1v6' | null
        var d = classDayOf(k);
        pre++;
        if (typ === '1v1') { pre1v1++; }
        else if (typ === '1v6') { pre1v6++; }
        if (byDay[d]) {
          byDay[d].pre++;
          if (typ === '1v1') byDay[d].pre1v1++;
          else if (typ === '1v6') byDay[d].pre1v6++;
        }
        if (isLeave(v)) {                  // 请假课次（仍先计入预排，再计请假）
          leave++;
          if (typ === '1v1') leave1v1++;
          else if (typ === '1v6') leave1v6++;
        }
      });
      var actual = pre - leave;
      var actual1v1 = pre1v1 - leave1v1;
      var actual1v6 = pre1v6 - leave1v6;
      var selected = selNames ? (selNames[name] !== false) : true;
      rows.push({
        name: name, group: subj, selected: selected,
        pre: pre, pre1v1: pre1v1, pre1v6: pre1v6,
        leave: leave, leave1v1: leave1v1, leave1v6: leave1v6,
        actual: actual, actual1v1: actual1v1, actual1v6: actual1v6,
        byDay: byDay,
        preSat: pre / BASE, actualSat: actual / BASE
      });
    });
    return rows;
  }

  // 按科组聚合（仅统计 selected 教师）：同步拆分 1V1/1V6 与按天聚合。
  function computeGroups(rows) {
    var groups = {};
    (rows || []).forEach(function (r) {
      if (!r.selected) return;
      if (!groups[r.group]) {
        groups[r.group] = {
          group: r.group, teachers: 0,
          pre: 0, pre1v1: 0, pre1v6: 0,
          leave: 0, leave1v1: 0, leave1v6: 0,
          actual: 0, actual1v1: 0, actual1v6: 0,
          byDay: emptyByDay()
        };
      }
      var g = groups[r.group];
      g.teachers++;
      g.pre += r.pre;
      g.pre1v1 += (r.pre1v1 || 0);
      g.pre1v6 += (r.pre1v6 || 0);
      g.leave += r.leave;
      g.leave1v1 += (r.leave1v1 || 0);
      g.leave1v6 += (r.leave1v6 || 0);
      g.actual += r.actual;
      g.actual1v1 += (r.actual1v1 || 0);
      g.actual1v6 += (r.actual1v6 || 0);
      if (r.byDay) {
        DAYS.forEach(function (d) {
          var rd = r.byDay[d], gd = g.byDay[d];
          if (rd) {
            gd.pre += (rd.pre || 0);
            gd.pre1v1 += (rd.pre1v1 || 0);
            gd.pre1v6 += (rd.pre1v6 || 0);
          }
        });
      }
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      return {
        group: g.group, teachers: g.teachers,
        pre: g.pre, pre1v1: g.pre1v1, pre1v6: g.pre1v6,
        leave: g.leave, leave1v1: g.leave1v1, leave1v6: g.leave1v6,
        actual: g.actual, actual1v1: g.actual1v1, actual1v6: g.actual1v6,
        byDay: g.byDay,
        preSat: g.teachers ? g.pre / BASE / g.teachers : 0,
        actualSat: g.teachers ? g.actual / BASE / g.teachers : 0
      };
    });
  }

  // 校区汇总（基于已勾选教师的所有科组聚合）
  function computeCampusSummary(groups) {
    var summary = { label: '校区汇总', teachers: 0, pre: 0, leave: 0, actual: 0, preSat: 0, actualSat: 0 };
    (groups || []).forEach(function (g) {
      summary.teachers += g.teachers;
      summary.pre += g.pre;
      summary.leave += (g.leave || 0);
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
    // 数据中心 KPI 同样按 weekEnd 过滤名册，与实时视图 / weekRoster 同一口径（零回归）
    var rows = computeRows(schedule, teachers, { filterGroup: 'all', selNames: opts.selNames || null, weekEnd: weekEnd });
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
        if (!t || !t.name) return false;
        if (Util && !Util.isActiveAt(t, weekEnd)) return false;           // 非当周在职排除
        return SUBJECT_GROUPS.indexOf(canonSubject(t.subjectGroup)) >= 0;  // 仅科组教师（与 KPI 分母一致）
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
    DAYS: DAYS,
    canonSubject: canonSubject,
    buildGroupMap: buildGroupMap,
    classTypeOf: classTypeOf,
    classDayOf: classDayOf,
    computeRows: computeRows,
    computeGroups: computeGroups,
    computeCampusSummary: computeCampusSummary,
    computeRecord: computeRecord
  };

  if (root && (root.App = root.App || {})) { root.App.kpiEngine = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
