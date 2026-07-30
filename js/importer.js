/* ============================================
   importer.js — 报表一键导入 & 自动提取引擎
   基于 SheetJS（本地离线）解析 xlsx/xls
   把报表数据提取为统一月度快照，并映射到基准值
   ============================================ */

window.App = window.App || {};

App.importer = (function() {

  /* ---------- 指标注册表：metricId -> 元数据 + 基准值路径 ---------- */
  // cat/key 对应 App.baseline[cat][key]；为 null 表示暂无基准值（仅展示）
  var METRICS = {
    // 课时生产
    productionRateWeek:  { label: '1V1周生产完成率', cat: '课时生产', key: 'G1', unit: '%', dec: 1 },
    productionRateMonth: { label: '1V1月生产完成率', cat: '课时生产', key: 'G1', unit: '%', dec: 1 },
    saturationWeek:      { label: '周饱和度',       cat: '课时生产', key: '饱和度', unit: '%', dec: 1 },
    saturationMonth:     { label: '月饱和度',       cat: '课时生产', key: '饱和度', unit: '%', dec: 1 },
    unitWeekAvg:         { label: '1V1周单位周平均', cat: '课时生产', key: '周单位周平均', unit: '', dec: 2 },
    unitMonthAvg:        { label: '1V1月单位周平均', cat: '课时生产', key: '月单位周平均', unit: '', dec: 2 },
    singleSubjectRatio:  { label: '单科比(在读单科/在读)', cat: '课时生产', key: '在读单科比', unit: '', dec: 2 },
    // 学员留存
    renewalRatePersonMonth:  { label: '续费人数率(月)', cat: '学员留存', key: '续费人数率', unit: '%', dec: 1 },
    renewalRateSubjectMonth: { label: '续费单科率(月)', cat: '学员留存', key: '续费单科率', unit: '%', dec: 1 },
    recommendRatePersonMonth:{ label: '推荐人数率(月)', cat: '学员留存', key: '推荐人数率', unit: '%', dec: 1 },
    refundRateSubjectMonth:  { label: '退费单科率(月)', cat: '学员留存', key: '退费单科率', unit: '%', dec: 1 },
    suspendRatePersonMonth:  { label: '停课人数率(月)', cat: '学员留存', key: '停课人次率', unit: '%', dec: 1 },
    finishRatePersonMonth:   { label: '结课人数率(月)', cat: '学员留存', key: '结课人数率', unit: '%', dec: 1 },
    finishRateSubjectMonth:  { label: '结课单科率(月)', cat: null, key: null, unit: '%', dec: 1 },
    suspendRateSubjectMonth: { label: '停课单科率(月)', cat: null, key: null, unit: '%', dec: 1 },
    // 基础计数（仅展示）
    teacherCount:    { label: '教师数',     cat: null, key: null, unit: '', dec: 0 },
    campusTotal:     { label: '校区总人数', cat: null, key: null, unit: '', dec: 0 },
    reading1v1:      { label: '1V1在读学员', cat: null, key: null, unit: '', dec: 0 },
    reading1v1Subject:{ label: '1V1在读单科', cat: null, key: null, unit: '', dec: 0 },
    readingTotal:    { label: '在读学员',   cat: null, key: null, unit: '', dec: 0 }
  };

  // 中文标签（DOS周报 / 同比环比 通用）-> metricId
  var LABEL_TO_METRIC = {
    '教师数': 'teacherCount',
    '校区总人数': 'campusTotal',
    '1v1在读学员': 'reading1v1',
    '1v1在读单科': 'reading1v1Subject',
    '单科比': 'singleSubjectRatio',
    '1V1周生产完成率': 'productionRateWeek', '周完成率': 'productionRateWeek',
    '1V1月生产完成率': 'productionRateMonth', '月完成率': 'productionRateMonth',
    '周饱和度': 'saturationWeek', '月饱和度': 'saturationMonth',
    '1v1周单位周平均': 'unitWeekAvg', '1v1月单位周平均': 'unitMonthAvg',
    '1V1月续费人数率': 'renewalRatePersonMonth', '月续费人数率': 'renewalRatePersonMonth', '续费人数率': 'renewalRatePersonMonth',
    '1V1月续费单科率': 'renewalRateSubjectMonth', '月续费单科率': 'renewalRateSubjectMonth', '续费单科率': 'renewalRateSubjectMonth',
    '1V1月推荐人数率': 'recommendRatePersonMonth', '月推荐单科率': 'recommendRatePersonMonth', '推荐单科率': 'recommendRatePersonMonth',
    '月退费单科率': 'refundRateSubjectMonth', '周退费单科率': 'refundRateSubjectMonth', '退费单科率': 'refundRateSubjectMonth',
    '月结课人数率': 'finishRatePersonMonth', '周结课人数率': 'finishRatePersonMonth', '结课人数率': 'finishRatePersonMonth',
    '月结课单科率': 'finishRateSubjectMonth', '周结课单科率': 'finishRateSubjectMonth', '结课单科率': 'finishRateSubjectMonth',
    '月停课人数率': 'suspendRatePersonMonth', '周停课人数率': 'suspendRatePersonMonth', '停课人数率': 'suspendRatePersonMonth',
    '月停课单科率': 'suspendRateSubjectMonth', '周停课单科率': 'suspendRateSubjectMonth', '停课单科率': 'suspendRateSubjectMonth',
    '在读学员': 'readingTotal', '在读单科': 'reading1v1Subject'
  };

  // 五项满意度 率名 -> metricId
  var SAT_RATE_MAP = {
    '结课人数率': 'finishRatePersonMonth',
    '结课单科率': 'finishRateSubjectMonth',
    '退费单科率': 'refundRateSubjectMonth',
    '停课人数率': 'suspendRatePersonMonth',
    '停课单科率': 'suspendRateSubjectMonth',
    '续费人数率': 'renewalRatePersonMonth',
    '续费单科率': 'renewalRateSubjectMonth',
    '推荐人数率': 'recommendRatePersonMonth'
  };

  /* ---------- 工具函数 ---------- */
  function num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    var s = String(v).trim();
    if (s === '' || s === '#DIV/0!' || s === '#REF!' || s === '#VALUE!' || s === '#N/A' || s === '—' || s === '-') return null;
    var n = parseFloat(s.replace(/[,，%％\s]/g, ''));
    return isNaN(n) ? null : n;
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '').replace(/[（）()]/g, '');
  }

  function findSheet(wb, keyword) {
    var k = norm(keyword);
    var hit = wb.SheetNames.find(function(n) { return norm(n).indexOf(k) >= 0; });
    return hit ? wb.Sheets[hit] : null;
  }

  function sheetToRows(ws) {
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) || [];
  }

  function parseYearMonthFromName(name) {
    var y = (name.match(/(\d{4})\s*年/) || [])[1];
    var m = (name.match(/(\d{1,2})\s*月/) || [])[1];
    var year = y ? parseInt(y, 10) : new Date().getFullYear();
    var month = m ? parseInt(m, 10) : (new Date().getMonth() + 1);
    if (month < 1 || month > 12) month = new Date().getMonth() + 1;
    return { year: year, month: month, key: year + '-' + String(month).padStart(2, '0') };
  }

  function monthKey(year, month) {
    return year + '-' + String(month).padStart(2, '0');
  }

  /* ---------- 各报表解析器 ---------- */

  // 1) DOS周报：数据统计表（标签-值对）
  function parseDOS(wb, fileName) {
    var ws = findSheet(wb, '数据统计表') || wb.Sheets[wb.SheetNames[0]];
    var rows = sheetToRows(ws);
    var map = {};
    rows.forEach(function(r) {
      if (r && typeof r[0] === 'string' && r[1] != null && typeof r[1] !== 'string') {
        map[norm(r[0])] = num(r[1]);
      }
    });
    var metrics = {};
    Object.keys(LABEL_TO_METRIC).forEach(function(label) {
      var key = norm(label);
      if (map[key] != null) metrics[LABEL_TO_METRIC[label]] = map[key];
    });
    var ym = parseYearMonthFromName(fileName || '');
    return {
      type: 'DOS周报',
      month: ym.key,
      label: ym.year + '年' + ym.month + '月',
      metrics: metrics,
      raw: map
    };
  }

  // 2) 五项满意度：汇总 sheet
  function parseSatisfaction(wb, fileName) {
    var ws = findSheet(wb, '五项满意度数据汇总') || findSheet(wb, '汇总');
    var rows = sheetToRows(ws);
    if (!rows.length) return null;

    // 定位表头行（首列为“月份”）
    var headerIdx = rows.findIndex(function(r) { return r && norm(r[0]) === '月份'; });
    if (headerIdx < 0) return null;
    var header = rows[headerIdx];

    function col(name) {
      var n = norm(name);
      for (var i = 0; i < header.length; i++) {
        if (header[i] != null && norm(header[i]) === n) return i;
      }
      return -1;
    }
    var c = {
      head: col('班主任'), reading: col('在读人数'), readingSubj: col('在读单科'),
      finishP: col('结课人数'), finishS: col('结课单科'),
      refundP: col('退费人数'), refundS: col('退费单科'),
      suspendP: col('停课人数'), suspendS: col('停课单科'),
      renewP: col('续费人数'), renewS: col('续费单科'),
      recommendP: col('推荐人数')
    };
    // 率列
    var rateCols = {};
    Object.keys(SAT_RATE_MAP).forEach(function(rateName) {
      var idx = col(rateName);
      if (idx >= 0) rateCols[rateName] = idx;
    });

    var byHead = [];
    var totals = null;
    for (var ri = headerIdx + 1; ri < rows.length; ri++) {
      var r = rows[ri];
      if (!r || (r[0] == null && r[c.head] == null)) continue;
      var isTotal = norm(r[0]) === '合计' || norm(r[0]) === '总计';
      var rec = {
        headTeacher: r[c.head] != null ? String(r[c.head]) : (r[0] != null ? String(r[0]) : ''),
        reading: num(r[c.reading]),
        readingSubject: num(r[c.readingSubj]),
        counts: {
          finishP: num(r[c.finishP]), finishS: num(r[c.finishS]),
          refundP: num(r[c.refundP]), refundS: num(r[c.refundS]),
          suspendP: num(r[c.suspendP]), suspendS: num(r[c.suspendS]),
          renewP: num(r[c.renewP]), renewS: num(r[c.renewS]),
          recommendP: num(r[c.recommendP])
        }
      };
      var rates = {};
      Object.keys(rateCols).forEach(function(rn) {
        var v = num(r[rateCols[rn]]);
        if (v != null) rates[SAT_RATE_MAP[rn]] = v;
      });
      rec.rates = rates;
      if (isTotal) totals = rec; else byHead.push(rec);
    }

    var ym = parseYearMonthFromName(fileName || '');
    return {
      type: '五项满意度',
      month: ym.key,
      label: ym.year + '年' + ym.month + '月',
      satisfaction: { totals: totals, byHead: byHead }
    };
  }

  // 3) 同比环比：总表（指标 | 月 | 同比 | 月 ...）
  function parseYoY(wb, fileName) {
    var ws = findSheet(wb, '总表');
    var rows = sheetToRows(ws);
    if (!rows.length) return null;

    // 定位表头行：含“同比”或月份数字
    var headerIdx = rows.findIndex(function(r) {
      if (!r) return false;
      return r.some(function(c) { return c != null && (norm(c) === '同比' || /^\d+月$/.test(String(c).trim())); });
    });
    if (headerIdx < 0) return null;
    var header = rows[headerIdx];

    // 解析列定义
    var monthDefs = [];
    var lastMonth = null;
    for (var i = 0; i < header.length; i++) {
      var h = header[i] != null ? String(header[i]).trim() : '';
      var mm = h.match(/^(\d+)月$/);
      if (mm) {
        lastMonth = { month: parseInt(mm[1], 10), valueCol: i, yoyCol: null };
        monthDefs.push(lastMonth);
      } else if (norm(h) === '同比' || norm(h) === '环比') {
        if (lastMonth) lastMonth.yoyCol = i;
      }
    }
    if (!monthDefs.length) return null;

    var baseYM = parseYearMonthFromName(fileName || '');

    // 解析指标行
    var metricRows = [];
    for (var ri = headerIdx + 1; ri < rows.length; ri++) {
      var r = rows[ri];
      if (!r || typeof r[0] !== 'string') continue;
      var label = norm(r[0]);
      if (label === '' || label === '校区') continue;
      var mid = LABEL_TO_METRIC[label];
      if (!mid && !/完成率|饱和度|单科比|人数率|单科率|在读|教师数|校区总人数/.test(label)) continue;
      metricRows.push({ label: label, mid: mid, row: r });
    }

    // 组装每月快照
    var snapshots = monthDefs.map(function(md) {
      var metrics = {};
      var yoy = {};
      metricRows.forEach(function(mr) {
        var v = num(mr.row[md.valueCol]);
        if (v == null) return;
        var mid = mr.mid || ('raw_' + norm(mr.label));
        metrics[mid] = v;
        if (md.yoyCol != null) {
          var yv = num(mr.row[md.yoyCol]);
          if (yv != null) yoy[mid] = yv;
        }
      });
      return {
        type: '同比环比',
        month: monthKey(baseYM.year, md.month),
        label: baseYM.year + '年' + md.month + '月',
        metrics: metrics,
        yoy: yoy
      };
    });

    return { type: '同比环比', snapshots: snapshots };
  }

  // 4) 主管会周报（部分字段）：生产完成率 / 满意度率 / 离职率 / 教师数
  function parseSupervisor(wb, fileName) {
    var ym = parseYearMonthFromName(fileName || '');
    var metrics = {};

    // 1V1生产数据：取最后一个有完成率的周
    var wsProd = findSheet(wb, '1V1生产数据');
    if (wsProd) {
      var rp = sheetToRows(wsProd);
      var hi = rp.findIndex(function(r) { return r && norm(r[1]) === '项目'; });
      if (hi >= 0) {
        var compCol = -1, unitCol = -1;
        for (var j = 0; j < rp[hi].length; j++) {
          if (norm(rp[hi][j]) === '完成率') compCol = j;
          if (norm(rp[hi][j]) === '单位周均') unitCol = j;
        }
        var lastComp = null, lastUnit = null;
        for (var k = hi + 1; k < rp.length; k++) {
          if (rp[k] && /^[Ww]\d+/.test(String(rp[k][1]))) {
            var cv = num(rp[k][compCol]); if (cv != null) lastComp = cv;
            var uv = num(rp[k][unitCol]); if (uv != null) lastUnit = uv;
          }
        }
        if (lastComp != null) metrics.productionRateWeek = lastComp;
        if (lastUnit != null) metrics.unitWeekAvg = lastUnit;
      }
    }

    // 满意度数据：取最后一个有续费单科率的周
    var wsSat = findSheet(wb, '满意度数据');
    if (wsSat) {
      var rs = sheetToRows(wsSat);
      var si = rs.findIndex(function(r) { return r && norm(r[1]) === '项目'; });
      if (si >= 0) {
        var cols = {};
        ['续费单科率', '结课单科率', '停课单科率', '退费单科率'].forEach(function(n) {
          for (var j2 = 0; j2 < rs[si].length; j2++) if (norm(rs[si][j2]) === norm(n)) cols[n] = j2;
        });
        var last = {};
        for (var k2 = si + 1; k2 < rs.length; k2++) {
          if (rs[k2] && /^[Ww]\d+/.test(String(rs[k2][1]))) {
            Object.keys(cols).forEach(function(n) {
              var v = num(rs[k2][cols[n]]); if (v != null) last[n] = v;
            });
          }
        }
        if (last['续费单科率'] != null) metrics.renewalRateSubjectMonth = last['续费单科率'];
        if (last['结课单科率'] != null) metrics.finishRateSubjectMonth = last['结课单科率'];
        if (last['停课单科率'] != null) metrics.suspendRateSubjectMonth = last['停课单科率'];
        if (last['退费单科率'] != null) metrics.refundRateSubjectMonth = last['退费单科率'];
      }
    }

    // 团队梳理：离职率（取最后一个有值的周）
    var wsTeam = findSheet(wb, '团队梳理');
    if (wsTeam) {
      var rt = sheetToRows(wsTeam);
      var ti = rt.findIndex(function(r) { return r && norm(r[1]) === '项目'; });
      if (ti >= 0) {
        var leaveCol = -1;
        for (var j3 = 0; j3 < rt[ti].length; j3++) if (norm(rt[ti][j3]) === '离职率') leaveCol = j3;
        var lastLeave = null;
        for (var k3 = ti + 1; k3 < rt.length; k3++) {
          if (rt[k3] && /^[Ww]\d+/.test(String(rt[k3][1]))) {
            var v = num(rt[k3][leaveCol]); if (v != null) lastLeave = v;
          }
        }
        if (lastLeave != null) metrics.leaveRate = lastLeave;
      }
    }

    // 教师周度数据：教师数
    var wsTeach = findSheet(wb, '教师周度数据');
    if (wsTeach) {
      var rte = sheetToRows(wsTeach);
      var cnt = rte.filter(function(r) { return r && typeof r[1] === 'string' && r[1].trim() !== '' && r[1] !== '教师'; }).length;
      if (cnt > 0) metrics.teacherCount = cnt;
    }

    return {
      type: '主管会周报',
      month: ym.key,
      label: ym.year + '年' + ym.month + '月（部分字段）',
      metrics: metrics,
      note: '主管会周报为周度明细，已提取：生产完成率、单位周均、各项满意度率、离职率、教师数。其余周度明细可在原表查看。'
    };
  }

  /* ---------- 对外接口 ---------- */

  // 解析入口：根据 type 选择解析器，返回 {type, snapshots:[...]}，不落库
  function parse(file, type, cb) {
    if (typeof XLSX === 'undefined') { cb(new Error('解析库未加载')); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: 'array', cellDates: true });
        var result;
        if (type === 'dos') result = parseDOS(wb, file.name);
        else if (type === 'satisfaction') result = parseSatisfaction(wb, file.name);
        else if (type === 'yoy') result = parseYoY(wb, file.name);
        else if (type === 'supervisor') result = parseSupervisor(wb, file.name);
        else { cb(new Error('未知报表类型')); return; }

        if (!result) { cb(new Error('未能从该报表提取到数据，请确认文件与模板一致')); return; }

        // 统一为 snapshots 数组
        var snapshots = result.snapshots ? result.snapshots : [result];
        if (!snapshots.length) { cb(new Error('未提取到任何数据')); return; }
        cb(null, { type: type, snapshots: snapshots });
      } catch (err) {
        console.error(err);
        cb(new Error('解析失败：' + (err && err.message ? err.message : err)));
      }
    };
    reader.onerror = function() { cb(new Error('文件读取失败')); };
    reader.readAsArrayBuffer(file);
  }

  // 落库：把 snapshots 写入 store.reports.monthly 并记录导入日志
  function commit(result, fileName) {
    var reports = App.store.get('reports') || { monthly: {}, imports: [] };
    if (!reports.monthly) reports.monthly = {};
    if (!reports.imports) reports.imports = [];

    var saved = [];
    result.snapshots.forEach(function(s) {
      var key = s.month;
      var existing = reports.monthly[key] || { month: key };
      existing.month = key;
      existing.label = s.label || existing.label;

      if (s.type === 'DOS周报') existing.dos = s;
      if (s.type === '五项满意度') {
        existing.satisfaction = s.satisfaction;
        if (s.satisfaction && s.satisfaction.totals && s.satisfaction.totals.rates) {
          existing.metrics = Object.assign(existing.metrics || {}, s.satisfaction.totals.rates);
        }
      }
      if (s.type === '同比环比') {
        existing.yoyData = s;
        if (s.metrics) existing.metrics = Object.assign(existing.metrics || {}, s.metrics);
        if (s.yoy) existing.yoy = Object.assign(existing.yoy || {}, s.yoy);
      }
      if (s.type === '主管会周报') existing.supervisor = s;

      // 统一指标池（用于基准值对标）
      if (s.metrics) existing.metrics = Object.assign(existing.metrics || {}, s.metrics);
      existing.importedAt = new Date().toISOString();
      reports.monthly[key] = existing;
      saved.push(key);
    });

    App.store.set('reports', reports);

    reports.imports.unshift({
      date: new Date().toISOString(),
      type: result.type,
      fileName: fileName || '',
      months: saved,
      count: saved.length
    });
    App.store.set('reports', reports);
    return saved;
  }

  // 取指标元数据（含基准值对象）
  function metric(id) {
    var m = METRICS[id];
    if (!m) return null;
    var baseline = (m.cat && m.key) ? (App.baseline[m.cat] && App.baseline[m.cat][m.key]) : null;
    return { id: id, label: m.label, unit: m.unit, dec: m.dec, baseline: baseline };
  }

  function allMetricIds() { return Object.keys(METRICS); }

  // 列出可用于趋势图的指标（有数值且有意义的）
  function trendMetricIds() {
    return [
      'productionRateMonth', 'productionRateWeek', 'saturationMonth', 'saturationWeek',
      'unitMonthAvg', 'unitWeekAvg', 'singleSubjectRatio',
      'renewalRatePersonMonth', 'renewalRateSubjectMonth', 'recommendRatePersonMonth',
      'refundRateSubjectMonth', 'suspendRatePersonMonth', 'finishRatePersonMonth',
      'readingTotal', 'teacherCount'
    ];
  }

  return {
    parse: parse,
    commit: commit,
    metric: metric,
    allMetricIds: allMetricIds,
    trendMetricIds: trendMetricIds,
    METRICS: METRICS,
    SAT_RATE_MAP: SAT_RATE_MAP,
    num: num,
    _parse: { dos: parseDOS, satisfaction: parseSatisfaction, yoy: parseYoY, supervisor: parseSupervisor }
  };

})();
