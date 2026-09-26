/* ============================================
   weekly-data.js — 周度数据中心实体（App.weeklyData）
   PK = weekStart（周一 YYYY-MM-DD），关联：schedule（课程表）/ snapshot（KPI 快照）/ teachers（花名册时点）。
   存储于 App.store('weeklyData')：{ weekStart -> record }。
   依赖（运行时）：App.store / App.weeklyCycle / App.kpiEngine / App.viewData / App.teachersUtil。
   ============================================ */

(function (root) {

  var KEY = 'weeklyData'; // store 键

  function _readOnlyGuard() {
    // 子工作台视角：周度数据由总台维护，子台只读（数据经 sub-context 镜像）。
    if (App.isSub && App.isSub()) {
      if (App.util && App.util.toast) App.util.toast('子工作台只读，周度数据由总台维护', 'warn');
      return true;
    }
    return false;
  }

  function _all() {
    // 子工作台：读取总台镜像（weeklyData 已加入 sub-context MIRROR_KEYS，由 loadMaster 拉取）
    if (App.isSub && App.isSub()) {
      var md = (App.subContext && App.subContext.getMasterData) ? App.subContext.getMasterData() : {};
      return (md && md[KEY]) || {};
    }
    return (App.store.get(KEY)) || {};
  }

  // 全部记录（按 weekStart 升序）
  function all() {
    var m = _all();
    return Object.keys(m).map(function (k) { return m[k]; })
      .sort(function (a, b) { return a.weekStart < b.weekStart ? -1 : (a.weekStart > b.weekStart ? 1 : 0); });
  }

  function get(weekStart) { return _all()[weekStart] || null; }

  function upsert(rec) {
    if (_readOnlyGuard()) return null;
    if (!rec || !rec.weekStart) return null;
    var m = _all();
    m[rec.weekStart] = rec;
    App.store.set(KEY, m);
    return rec;
  }

  function remove(weekStart) {
    if (_readOnlyGuard()) return;
    var m = _all();
    if (m[weekStart]) { delete m[weekStart]; App.store.set(KEY, m); }
  }

  // 归档锁定 / 解锁（锁定后不被 compute / 回灌覆盖）
  function lock(weekStart, locked) {
    if (_readOnlyGuard()) return null;
    var r = get(weekStart);
    if (!r) return null;
    r.locked = !!locked;
    return upsert(r);
  }

  // 从当前课程表实时计算某周记录（含 weekEnd 时点在职花名册）
  function computeFromLive(artMonth, weekNo, opts) {
    opts = opts || {};
    var wk = App.weeklyCycle.resolveWeek(artMonth, weekNo);
    if (!wk) return null;
    var sch = App.store.get('schedule') || {};
    var schedule = {
      weekStartDate: sch.weekStartDate || null,
      weekEndDate: sch.weekEndDate || null,
      teachers: (sch.teachers && sch.teachers.length) ? sch.teachers.slice() : []
    };
    var teachers = (App.viewData && App.viewData().teachers) || [];
    return App.kpiEngine.computeRecord(schedule, teachers, wk.start, wk.end, artMonth, weekNo, {
      dataSource: opts.dataSource || 'live',
      includeRoster: true,
      selNames: null
    });
  }

  // 从已有 KPI 快照生成记录（历史回灌 #192 用）：标记 snapshot + 锁定
  function recordFromSnapshot(weekStart, snap, artMonthId, weekNo) {
    if (!snap) return null;
    var weekEnd = snap.weekEnd || '';
    return {
      weekStart: weekStart,
      weekEnd: weekEnd,
      artMonthId: artMonthId,
      weekNo: weekNo,
      weekLabel: '第' + weekNo + '周 (' + String(weekStart).slice(5) + '~' + String(weekEnd).slice(5) + ')',
      dataSource: 'snapshot',
      locked: true,
      kpiByTeacher: snap.rows || [],
      kpiByGroup: snap.groups || [],
      campusSummary: snap.summary || App.kpiEngine.computeCampusSummary(snap.groups || []),
      createdAt: snap.createdAt || new Date().toISOString()
    };
  }

  // 手动补录 / 修正：覆盖 KPI 三件套 + 可选花名册，标记 manual + 锁定
  function saveManual(weekStart, patch) {
    if (_readOnlyGuard()) return null;
    var r = get(weekStart);
    if (!r) return null;
    if (patch && patch.kpiByGroup) r.kpiByGroup = patch.kpiByGroup;
    if (patch && patch.kpiByTeacher) r.kpiByTeacher = patch.kpiByTeacher;
    if (patch && patch.campusSummary) r.campusSummary = patch.campusSummary;
    if (patch && patch.roster) r.roster = patch.roster;
    r.dataSource = 'manual';
    r.locked = true;
    r.updatedAt = new Date().toISOString();
    return upsert(r);
  }

  // 月度汇总重算：跨周去重教师，Σ 预排/实际/请假 及 1V1/1V6、周六周日拆分，饱和度 = Σ / 16 / 去重教师数
  // 返回 { artMonthId, weeks, teachers, pre, actual, leave, preSat, actualSat,
  //        pre1v1, pre1v6, actual1v1, actual1v6, byDay,
  //        groups:[...], byTeacher:[...] }
  // 注意：preSat/actualSat 口径保持不变（校区 = Σ/16/去重教师数；科组 = 科组Σ/16/去重教师数），仅新增拆分字段。
  function monthlySummary(artMonthId) {
    var BASE = (App.kpiEngine && App.kpiEngine.BASE) || 16;
    var recs = all().filter(function (r) { return r.artMonthId === artMonthId; });
    var teacherMap = {};   // name -> 累计（含拆分）
    var groupsMap = {};    // group -> 累计（含拆分）
    var weeks = recs.length;
    var BD_KEYS = ['pre', 'pre1v1', 'pre1v6', 'actual', 'actual1v1', 'actual1v6'];
    function emptyByDay() { return { 周六: { pre: 0, pre1v1: 0, pre1v6: 0, actual: 0, actual1v1: 0, actual1v6: 0 }, 周日: { pre: 0, pre1v1: 0, pre1v6: 0, actual: 0, actual1v1: 0, actual1v6: 0 } }; }
    recs.forEach(function (r) {
      (r.kpiByTeacher || []).forEach(function (t) {
        if (!teacherMap[t.name]) teacherMap[t.name] = {
          name: t.name, group: t.group || '', pre: 0, leave: 0, actual: 0,
          pre1v1: 0, pre1v6: 0, actual1v1: 0, actual1v6: 0, byDay: {}
        };
        var tm = teacherMap[t.name];
        tm.pre += (t.pre || 0); tm.leave += (t.leave || 0); tm.actual += (t.actual || 0);
        tm.pre1v1 += (t.pre1v1 || 0); tm.pre1v6 += (t.pre1v6 || 0);
        tm.actual1v1 += (t.actual1v1 || 0); tm.actual1v6 += (t.actual1v6 || 0);
        if (t.group) tm.group = t.group;
        ['周六', '周日'].forEach(function (d) {
          var bd = (t.byDay && t.byDay[d]) || {};
          if (!tm.byDay[d]) tm.byDay[d] = { pre: 0, pre1v1: 0, pre1v6: 0, actual: 0, actual1v1: 0, actual1v6: 0, leave: 0 };
          var m = tm.byDay[d];
          BD_KEYS.forEach(function (f) { m[f] += (bd[f] || 0); });
          m.leave += (bd.leave || 0);
        });
      });
    });
    var teachersArr = Object.keys(teacherMap).map(function (k) { return teacherMap[k]; });
    var deduped = teachersArr.length;
    var totalPre = 0, totalActual = 0, totalLeave = 0;
    var totalPre1v1 = 0, totalPre1v6 = 0, totalAct1v1 = 0, totalAct1v6 = 0;
    var totalByDay = emptyByDay();
    teachersArr.forEach(function (t) {
      totalPre += t.pre; totalActual += t.actual; totalLeave += t.leave;
      totalPre1v1 += t.pre1v1; totalPre1v6 += t.pre1v6; totalAct1v1 += t.actual1v1; totalAct1v6 += t.actual1v6;
      ['周六', '周日'].forEach(function (d) {
        var bd = t.byDay[d] || {}; BD_KEYS.forEach(function (f) { totalByDay[d][f] += (bd[f] || 0); });
      });
      t.preSat = deduped ? t.pre / BASE : 0;
      t.actualSat = deduped ? t.actual / BASE : 0;
    });
    teachersArr.forEach(function (t) {
      if (!groupsMap[t.group]) groupsMap[t.group] = {
        group: t.group, teachers: 0, pre: 0, leave: 0, actual: 0,
        pre1v1: 0, pre1v6: 0, actual1v1: 0, actual1v6: 0, byDay: emptyByDay()
      };
      var g = groupsMap[t.group];
      g.teachers++; g.pre += t.pre; g.leave += t.leave; g.actual += t.actual;
      g.pre1v1 += t.pre1v1; g.pre1v6 += t.pre1v6; g.actual1v1 += t.actual1v1; g.actual1v6 += t.actual1v6;
      ['周六', '周日'].forEach(function (d) {
        var bd = t.byDay[d] || {}; BD_KEYS.forEach(function (f) { g.byDay[d][f] += (bd[f] || 0); });
      });
    });
    var groupsArr = Object.keys(groupsMap).map(function (k) {
      var g = groupsMap[k];
      return {
        group: g.group, teachers: g.teachers, pre: g.pre, leave: g.leave, actual: g.actual,
        pre1v1: g.pre1v1, pre1v6: g.pre1v6, actual1v1: g.actual1v1, actual1v6: g.actual1v6, byDay: g.byDay,
        preSat: deduped ? g.pre / BASE / deduped : 0,
        actualSat: deduped ? g.actual / BASE / deduped : 0
      };
    });
    return {
      artMonthId: artMonthId,
      weeks: weeks,
      teachers: deduped,
      pre: totalPre, actual: totalActual, leave: totalLeave,
      pre1v1: totalPre1v1, pre1v6: totalPre1v6, actual1v1: totalAct1v1, actual1v6: totalAct1v6,
      byDay: totalByDay,
      preSat: deduped ? totalPre / BASE / deduped : 0,
      actualSat: deduped ? totalActual / BASE / deduped : 0,
      groups: groupsArr,
      byTeacher: teachersArr
    };
  }

  // 数据中心中出现的全部人工月（去重，[新…旧]）
  function monthsAvailable() {
    var seen = {}, arr = [];
    all().forEach(function (r) {
      if (r.artMonthId && !seen[r.artMonthId]) { seen[r.artMonthId] = 1; arr.push(r.artMonthId); }
    });
    return arr.sort().reverse();
  }

  // 历史回灌：将 kpiSnapshots 中尚未在 weeklyData 存在的周，生成记录入库。
  // 已存在的周不覆盖（幂等、避免冲掉手动计算/补录数据）；新记录标记 snapshot + 锁定。
  // 返回 { added, skipped, total }。
  function backfillFromSnapshots() {
    if (_readOnlyGuard()) return { added: 0, skipped: 0, total: 0 };
    var snaps = App.store.get('kpiSnapshots') || {};
    var keys = Object.keys(snaps);
    var added = 0, skipped = 0;
    keys.forEach(function (ws) {
      if (get(ws)) { skipped++; return; }            // 已存在 → 跳过不覆盖
      var snap = snaps[ws];
      var artMonthId = null, weekNo = 0;
      var we = snap && snap.weekEnd;
      if (we && App.weeklyCycle && App.weeklyCycle.artMonthOfDate) {
        var info = App.weeklyCycle.artMonthOfDate(we);  // weekEnd(周日) 反查所属人工月+周次
        if (info) { artMonthId = info.artMonthId; weekNo = info.weekNo; }
      }
      if (!artMonthId) { artMonthId = String(ws || '').slice(0, 7); weekNo = 0; } // 兜底
      upsert(recordFromSnapshot(ws, snap, artMonthId, weekNo));
      added++;
    });
    return { added: added, skipped: skipped, total: keys.length };
  }

  var api = {
    KEY: KEY,
    all: all,
    get: get,
    upsert: upsert,
    remove: remove,
    lock: lock,
    computeFromLive: computeFromLive,
    recordFromSnapshot: recordFromSnapshot,
    saveManual: saveManual,
    monthlySummary: monthlySummary,
    monthsAvailable: monthsAvailable,
    backfillFromSnapshots: backfillFromSnapshots
  };

  if (root && (root.App = root.App || {})) { root.App.weeklyData = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
