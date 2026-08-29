/* ============================================
   linked-kezu.js — 联动数据·最佳科组排名 / 科组生产预测（仅个人工作台）
   数据来源：analytics_snapshot.kezu（数据分析工作台「推送分析到个人台」下发）
   口径与数据分析台「核心看板」完全一致：
     · 排名：bestkezu_score（评比汇总·季度/全年排名）+ bestkezu（科组月度明细横向对比）
     · 预测：bestkezu（参考月单科数/课时/周数）+ kezuActual（周度实际达成）
            + weekly（1V1人数/1v1月生产课时，已在快照）+ C（云端同步，本地可调）
   刷新：与现有联动数据共用同一快照、同一 dos:linked-update 事件
   ============================================ */
(function () {
  var App = window.App || (window.App = {});
  App.views = App.views || {};

  /* ---------- 工具（移植自 campus-analytics，保持口径一致） ---------- */
  function fmt(v, digits) {
    if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v === 'number') {
      if (Math.abs(v) >= 10000) return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
      return v.toLocaleString('zh-CN', { maximumFractionDigits: digits == null ? 2 : digits });
    }
    return String(v);
  }
  function pct(v) {
    if (v == null) return '—';
    var p = Math.round(v * 10000) / 100;
    var s = p.toFixed(2);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s + '%';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function isNum(v) { return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && /^[-\d.]+$/.test(v.trim()) && !isNaN(+v)); }
  var RATE_COL = /^(结课率|停课率|退费率|续费率|离职率|合格率|优秀率|进步率)$/;
  function scoreCell(v, header) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { if (RATE_COL.test(header) && v > 0 && v <= 1) return pct(v); return fmt(v); }
    var s = String(v).trim();
    if (isNum(s)) { var n = +s; if (RATE_COL.test(header) && n > 0 && n <= 1) return pct(n); return fmt(n); }
    return esc(s);
  }
  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : (parseFloat(x) || 0); }

  /* ---------- 人工月 / 周 日期助手（移植 aggregate.js + app.js） ---------- */
  function manualLastDay(Y, m) {
    var L = new Date(Y, m, 0);
    var dw = L.getDay() === 0 ? 7 : L.getDay();
    if (dw <= 2) return new Date(L.getFullYear(), L.getMonth(), L.getDate() - dw);
    return new Date(L.getFullYear(), L.getMonth(), L.getDate() + (7 - dw));
  }
  function manualMonthOf(date) {
    var Y = date.getFullYear(), m = date.getMonth() + 1;
    var ML = manualLastDay(Y, m);
    if (date <= ML) {
      var pY = Y, pm0 = m - 1; if (pm0 < 1) { pm0 = 12; pY = Y - 1; }
      var prevML = manualLastDay(pY, pm0);
      if (date > prevML) return { year: Y, month: m };
      return { year: pY, month: pm0 };
    }
    var nY = Y, nm = m + 1; if (nm > 12) { nm = 1; nY = Y + 1; }
    return { year: nY, month: nm };
  }
  function manualMonthWeekCount(Y, m) {
    var pY = Y, pm0 = m - 1; if (pm0 < 1) { pm0 = 12; pY = Y - 1; }
    var prevML = manualLastDay(pY, pm0);
    var MS = new Date(prevML.getFullYear(), prevML.getMonth(), prevML.getDate() + 1);
    var ML = manualLastDay(Y, m);
    var diff = Math.round((ML - MS) / 86400000);
    return (diff + 1) / 7;
  }
  function currentManualWeek(date) {
    var mm = manualMonthOf(date);
    var pY = mm.year, pm0 = mm.month - 1; if (pm0 < 1) { pm0 = 12; pY = mm.year - 1; }
    var prevML = manualLastDay(pY, pm0);
    var MS = new Date(prevML.getFullYear(), prevML.getMonth(), prevML.getDate() + 1);
    var dayDiff = Math.round((date - MS) / 86400000);
    return { year: mm.year, month: mm.month, week: Math.floor(dayDiff / 7) + 1 };
  }
  function predMonth(y, m) { var mm = m + 1, yy = y; if (mm > 12) { mm = 1; yy += 1; } return { year: yy, month: mm }; }

  /* ---------- 快照数据访问 ---------- */
  function kezuDetail(snap) { return (snap.kezu && snap.kezu.detail) || []; }
  function kezuScoreRecs(snap) { return (snap.kezu && snap.kezu.score) || []; }
  function kezuActualRecs(snap) { return (snap.kezu && snap.kezu.actual) || []; }
  function kezuFlat(rec) { return Object.assign({ year: rec.year, month: rec.month, subject: rec.dimension }, rec.values || {}); }

  function kezuMonths(snap) {
    var set = {};
    kezuDetail(snap).forEach(function (r) { if (r.year && r.month) set[r.year * 12 + r.month] = { year: r.year, month: r.month }; });
    return Object.values(set).sort(function (a, b) { return (a.year - b.year) || (a.month - b.month); });
  }
  function loadMonth(snap, y, m) {
    var recs = kezuDetail(snap).filter(function (r) { return r.year === y && r.month === m; });
    if (!recs.length) return null;
    return recs.map(function (r) { var v = r.values || {}; return { name: r.dimension || '未命名', s: num(v.subjects), h: num(v.hours), w: num(v.weeks) || 4 }; });
  }
  function dataSourceProd(snap, y, m) {
    var hist = snap.monthlyHistory || [];
    var rec = hist.find(function (r) { return r.year === y && r.month === m; });
    if (!rec) { var mo = snap.latestByStream && snap.latestByStream.monthly; if (mo && mo.year === y && mo.month === m) rec = mo; }
    if (!rec) return null;
    var v = rec.values && rec.values.v1MonthProduced;
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  /* ---------- 科组生产指标核心算法（与核心看板 computeKezuTarget 一致） ---------- */
  function computeKezuTarget(depts, C) {
    var S = depts.reduce(function (a, d) { return a + (d.s || 0); }, 0);
    var H = depts.reduce(function (a, d) { return a + (d.h || 0); }, 0);
    var rows = depts.map(function (d) {
      var w = d.w > 0 ? d.w : 4;
      var a = S > 0 ? d.s / S : 0;
      var b = H > 0 ? d.h / H : 0;
      var predA = a * C;
      var predB = b * C;
      var avg = (predA + predB) / 2;
      var wAvg = d.s > 0 ? avg / d.s / w : 0;
      return { name: d.name, s: d.s, h: d.h, w: w, a: a, b: b, predA: predA, predB: predB, avg: avg, wAvg: wAvg };
    });
    var denom = rows.reduce(function (a, r) { return a + (r.s || 0) * r.w; }, 0);
    var meanW = rows.reduce(function (x, r) { return x + r.wAvg; }, 0) / (rows.length || 1);
    var sum0 = meanW * denom;
    var lower = denom > 0 ? C / denom : 0;
    var upper = denom > 0 ? (C + 30) / denom : 0;
    var commonW = meanW;
    var adjNote;
    if (denom <= 0) adjNote = '单科数×周数合计为 0，无法计算。';
    else if (sum0 < C) { commonW = lower; adjNote = '四科组预测之和（' + fmt(sum0) + '）＜ C，已上调共同周平均至区间下界，使之和达到 C。'; }
    else if (sum0 > C + 30) { commonW = upper; adjNote = '四科组预测之和（' + fmt(sum0) + '）＞ C+30，已压回区间上界。'; }
    else { adjNote = '四科组预测之和（' + fmt(sum0) + '）已落在 [C, C+30] 区间内，共同周平均取四科组均值。'; }
    var sumFinal = commonW * denom;
    var completion = C > 0 ? sumFinal / C : 0;
    var achieved = '未达标';
    if (completion >= 1.25) achieved = 'G3';
    else if (completion >= 1.10) achieved = 'G2';
    else if (completion >= 1.00) achieved = 'G1';
    var Gcfg = { G1: 1.00, G2: 1.10, G3: 1.25 };
    rows.forEach(function (r) {
      r.final = commonW * r.s * r.w;
      r.weekly = r.w > 0 ? r.final / r.w : 0;
      var share = (r.s * r.w) / (denom || 1);
      r.G1 = (C * Gcfg.G1) * share;
      r.G2 = (C * Gcfg.G2) * share;
      r.G3 = (C * Gcfg.G3) * share;
    });
    return { S: S, H: H, rows: rows, meanW: meanW, sum0: sum0, lower: lower, upper: upper, commonW: commonW, adjNote: adjNote, sumFinal: sumFinal, completion: completion, achieved: achieved, Gcfg: Gcfg };
  }

  /* ---------- 评分块 / 最佳科组 banner（移植） ---------- */
  function kezuScoreBlockHTML(block, rank) {
    var header = block.header || [];
    if (!header.length) return '';
    var rows = block.rows.map(function (r) { return header.map(function (_, i) { return (i < r.length ? r[i] : null); }); });
    var totalIdx = -1;
    if (rank) {
      var tot = header.map(function (h, i) { return (/总分/.test(h) ? i : -1); }).filter(function (i) { return i >= 0; });
      if (tot.length === 1 && !header.some(function (h) { return /名次/.test(h); })) totalIdx = tot[0];
    }
    if (totalIdx >= 0) {
      var sc = function (row) { var v = row[totalIdx]; return isNum(v) ? +v : -Infinity; };
      rows = rows.slice().sort(function (a, b) { return sc(b) - sc(a); });
    }
    var h = '<div class="lk-table-wrap"><table><thead><tr>';
    header.forEach(function (hd, i) { h += '<th class="' + (i === 0 ? '' : 'num') + '">' + esc(hd) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function (row, ri) {
      var win = totalIdx >= 0 && ri === 0 && isNum(row[totalIdx]);
      h += '<tr' + (win ? ' class="winner"' : '') + '>';
      row.forEach(function (v, i) {
        if (i === 0) h += '<td>' + (win ? '<span class="badge-best">最佳</span> ' : '') + esc(v == null ? '' : v) + '</td>';
        else h += '<td class="num">' + scoreCell(v, header[i]) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }
  function kezuBestBanner(rating) {
    if (!rating || !rating.blocks) return '';
    var blk = rating.blocks.find(function (b) { return b.header && b.header[0] === '科组' && b.header.some(function (h) { return /全年总分/.test(h); }); });
    if (!blk || !blk.rows.length) return '';
    var tIdx = blk.header.findIndex(function (h) { return /全年总分/.test(h); });
    var rIdx = blk.header.findIndex(function (h) { return /全年名次/.test(h); });
    var best = null;
    blk.rows.forEach(function (r) { var v = r[tIdx]; if (isNum(v)) { if (!best || +v > best.score) best = { name: r[0], score: +v, rank: rIdx >= 0 ? r[rIdx] : '' }; } });
    if (!best) return '';
    return '<div class="bk-best-banner"><span class="badge-best">年度最佳科组</span> <b>' + esc(best.name) + '</b>　全年总分 ' + fmt(best.score) + (best.rank !== '' && best.rank != null ? '　名次 ' + esc(best.rank) : '') + '</div>';
  }

  /* ---------- 科组季度聚合（横向对比·季度模式用） ---------- */
  function kezuQuarter(rs) {
    var byKey = {};
    rs.forEach(function (r) {
      var key = r.subject + '|' + r.quarter;
      (byKey[key] = byKey[key] || []).push(r);
    });
    var out = [];
    Object.keys(byKey).forEach(function (key) {
      var g = byKey[key];
      var parts = key.split('|');
      var subj = parts[0], q = parts[1];
      var sum = function (k) { return g.reduce(function (a, r) { return a + (r[k] || 0); }, 0); };
      var n = g.length;
      var totalHours = sum('hours'), totalWeeks = sum('weeks');
      var avgSubjects = n ? sum('subjects') / n : 0;
      var xf = sum('xufei'), jk = sum('jieke'), tf = sum('tuifei'), tk = sum('tingke'), qt = sum('quit');
      var last = g.slice().sort(function (a, b) { return b.month - a.month; })[0];
      var lastTeachers = last.teachers || 0;
      out.push({
        subject: subj, quarter: +q, totalHours: totalHours, totalWeeks: totalWeeks,
        avgSubjects: Math.round(avgSubjects * 10) / 10,
        quarterWeekAvg: (totalWeeks && avgSubjects) ? totalHours / totalWeeks / avgSubjects : null,
        xf: xf, jk: jk, tf: tf, tk: tk, qt: qt,
        xufeiRate: avgSubjects ? xf / avgSubjects : null,
        jiekeRate: avgSubjects ? jk / avgSubjects : null,
        tuifeiRate: (tf + avgSubjects) ? tf / (tf + avgSubjects) : null,
        tingkeRate: (tk + avgSubjects) ? tk / (tk + avgSubjects) : null,
        quitRate: (qt + lastTeachers) ? qt / (qt + lastTeachers) : null,
        teachers: lastTeachers
      });
    });
    return out.sort(function (a, b) { return a.subject.localeCompare(b.subject) || (a.quarter - b.quarter); });
  }

  /* ---------- 横向对比 ---------- */
  var KEZU_CMP_DIMS = [
    { k: 'hours', l: '课时', kind: 'num', d: 0 },
    { k: 'subjects', l: '单科数', kind: 'num', d: 1 },
    { k: 'weekAvg', l: '周平均', kind: 'num', d: 2 },
    { k: 'xufeiRate', l: '续费率', kind: 'rate' },
    { k: 'jiekeRate', l: '结课率', kind: 'rate' },
    { k: 'tuifeiRate', l: '退费率', kind: 'rate' },
    { k: 'tingkeRate', l: '停课率', kind: 'rate' },
    { k: 'quitRate', l: '离职率', kind: 'rate' }
  ];
  function kezuCmpVal(rec, dim, isQuarter) {
    if (!rec) return null;
    if (isQuarter) {
      if (dim === 'hours') return rec.totalHours != null ? rec.totalHours : null;
      if (dim === 'subjects') return rec.avgSubjects != null ? rec.avgSubjects : null;
      if (dim === 'weekAvg') return rec.quarterWeekAvg != null ? rec.quarterWeekAvg : null;
    } else {
      if (dim === 'hours') return rec.hours != null ? rec.hours : null;
      if (dim === 'subjects') return rec.subjects != null ? rec.subjects : null;
      if (dim === 'weekAvg') return rec.weekAvg != null ? rec.weekAvg : null;
    }
    if (['xufeiRate', 'jiekeRate', 'tuifeiRate', 'tingkeRate', 'quitRate'].indexOf(dim) >= 0) return rec[dim] != null ? rec[dim] : null;
    return null;
  }
  function renderCompare(snap, rootId) {
    var stored = kezuDetail(snap).map(kezuFlat);
    var wrap = document.getElementById(rootId);
    if (!wrap) return;
    if (!stored.length) { wrap.innerHTML = '<div class="lk-empty">还没有最佳科组月度数据（需在数据分析台上传含科组明细的文件并推送）。</div>'; return; }
    var years = Array.from(new Set(stored.map(function (r) { return r.year; }))).sort(function (a, b) { return b - a; });
    var h = '<div class="lk-cmp-toolbar">';
    h += '<label>年份</label><select id="cmpYear">' + years.map(function (y) { return '<option value="' + y + '">' + y + ' 年</option>'; }).join('') + '</select>';
    h += '<label>对比模式</label><div class="seg" id="cmpMode"><button type="button" data-m="month" class="active">月度横向对比</button><button type="button" data-m="quarter">季度横向对比</button></div>';
    h += '<label>对比维度</label><select id="cmpDim">' + KEZU_CMP_DIMS.map(function (d) { return '<option value="' + d.k + '">' + d.l + '</option>'; }).join('') + '</select>';
    h += '</div>';
    h += '<div id="cmpTableWrap"></div>';
    wrap.innerHTML = h;

    function draw() {
      var year = +document.getElementById('cmpYear').value;
      var mode = document.getElementById('cmpMode').dataset.m;
      var dim = document.getElementById('cmpDim').value;
      var dimMeta = KEZU_CMP_DIMS.find(function (d) { return d.k === dim; });
      var recs = stored.filter(function (r) { return r.year === year; });
      var subjects = Array.from(new Set(recs.map(function (r) { return r.subject; }))).sort(function (a, b) { return a.localeCompare(b); });
      var isQuarter = mode === 'quarter';
      var periods, pLabel, matrix;
      if (!isQuarter) {
        periods = Array.from(new Set(recs.map(function (r) { return r.month; }))).sort(function (a, b) { return a - b; });
        pLabel = function (m) { return m + '月'; };
        var mMap = {};
        recs.forEach(function (r) { (mMap[r.subject] = mMap[r.subject] || {})[r.month] = r; });
        matrix = {};
        subjects.forEach(function (s) { matrix[s] = {}; periods.forEach(function (m) { matrix[s][m] = mMap[s] ? mMap[s][m] : null; }); });
      } else {
        var qAgg = kezuQuarter(recs);
        periods = Array.from(new Set(qAgg.map(function (q) { return q.quarter; }))).sort(function (a, b) { return a - b; });
        pLabel = function (q) { return 'Q' + q; };
        var qMap = {};
        qAgg.forEach(function (q) { (qMap[q.subject] = qMap[q.subject] || {})[q.quarter] = q; });
        matrix = {};
        subjects.forEach(function (s) { matrix[s] = {}; periods.forEach(function (q) { matrix[s][q] = qMap[s] ? qMap[s][q] : null; }); });
      }
      var avgLabel = isQuarter ? '季均' : '月均';
      var unit = dimMeta.kind === 'rate' ? '（%）' : '';
      var th = '<div class="lk-table-wrap"><table><thead><tr>';
      th += '<th>' + (isQuarter ? '科组 \\ 季度' : '科组 \\ 月份') + '</th>';
      periods.forEach(function (p) { th += '<th class="num">' + pLabel(p) + '</th>'; });
      th += '<th class="num">' + avgLabel + '</th>';
      th += '</tr></thead><tbody>';
      if (!subjects.length) {
        th += '<tr><td colspan="' + (periods.length + 2) + '" class="lk-empty">该年暂无科组数据</td></tr>';
      } else {
        subjects.forEach(function (subj) {
          th += '<tr><td>' + esc(subj) + '</td>';
          var sumV = 0, cnt = 0;
          periods.forEach(function (p) {
            var rec = matrix[subj][p];
            var v = kezuCmpVal(rec, dim, isQuarter);
            if (v != null) { sumV += v; cnt++; }
            if (v == null) th += '<td class="num lk-muted">—</td>';
            else if (dimMeta.kind === 'rate') th += '<td class="num">' + pct(v) + '</td>';
            else th += '<td class="num">' + fmt(v, dimMeta.d) + '</td>';
          });
          var avg = cnt ? sumV / cnt : null;
          th += '<td class="num" style="font-weight:600">' + (avg == null ? '—' : (dimMeta.kind === 'rate' ? pct(avg) : fmt(avg, dimMeta.d))) + '</td>';
          th += '</tr>';
        });
      }
      th += '</tbody></table></div>';
      th += '<div class="preview-note">' + (isQuarter
        ? '季度横向对比：同一科组跨各季度的「' + dimMeta.l + unit + '」对比，数据来自季度聚合（课时累加、单科数取月均、周平均/各率按口径重算），<b>不含任何月度明细</b>。末列「' + avgLabel + '」为该年所列各季度的算术平均。'
        : '月度横向对比：同一科组跨各月份的「' + dimMeta.l + unit + '」对比，数据来自科组月度明细，<b>不含任何季度汇总</b>。末列「' + avgLabel + '」为该年所列各月份的算术平均。') + '</div>';
      document.getElementById('cmpTableWrap').innerHTML = th;
    }

    document.getElementById('cmpYear').addEventListener('change', draw);
    document.getElementById('cmpDim').addEventListener('change', draw);
    Array.prototype.forEach.call(document.querySelectorAll('#cmpMode button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#cmpMode button'), function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        document.getElementById('cmpMode').dataset.m = b.dataset.m;
        draw();
      });
    });
    document.getElementById('cmpMode').dataset.m = 'month';
    draw();
  }

  /* ---------- 排名板块 ---------- */
  function renderRank(snap) {
    var scoreRecs = kezuScoreRecs(snap);
    var detail = kezuDetail(snap);
    var h = '<div class="lk-section"><div class="lk-section-head"><div class="lk-section-title">🏆 最佳科组排名</div>' +
      '<div class="lk-section-sub">同源：数据分析工作台·核心看板（评比汇总 + 科组月度明细）· 口径一致</div></div>';
    if (!scoreRecs.length && !detail.length) {
      h += '<div class="lk-empty">暂无最佳科组数据。请在数据分析工作台上传含「最佳科组评比汇总(Sheet5) / 科组月度明细」的全量文件，点击「推送分析到个人台」后查看排名与横向对比。</div></div>';
      return { html: h };
    }
    if (scoreRecs.length) {
      var years = scoreRecs.map(function (r) { return r.year; }).filter(function (y) { return y; }).sort(function (a, b) { return b - a; });
      var yr = years[0];
      h += '<div class="lk-cmp-toolbar" style="margin-bottom:12px"><label>年份</label><select id="kezuRankYr">' +
        years.map(function (y) { return '<option value="' + y + '"' + (y === yr ? ' selected' : '') + '>' + y + '年</option>'; }).join('') + '</select>' +
        '<span class="preview-note" style="margin-left:8px">数据来源：最佳科组评比汇总（季度排名 / 全年累计排名）。含「总分」的评分表按总分降序并标记最佳科组。</span></div>';
      h += '<div id="kezuRankResult"></div>';
    } else {
      h += '<div class="preview-note" style="margin-bottom:12px">⚠ 当前仅有科组月度明细，缺少「最佳科组评比汇总」(Sheet5)，暂无法呈现季度/全年排名；下方为可用的横向对比数据。</div>';
    }
    if (detail.length) {
      h += '<div class="lk-sub-h">科组横向对比（同项目 · 跨时间）</div><div id="kezuCmpDashWrap"></div>';
    }
    h += '</div>';
    return { html: h };
  }
  function drawRank(snap) {
    var sel = document.getElementById('kezuRankYr');
    if (!sel) return;
    var y = parseInt(sel.value, 10);
    var rec = kezuScoreRecs(snap).find(function (r) { return r.year === y; }) || kezuScoreRecs(snap)[0];
    var score = rec ? (rec.values || {}) : {};
    var rating = score.rating;
    var h = '';
    var banner = kezuBestBanner(rating);
    if (banner) h += banner;
    if (rating && rating.blocks && rating.blocks.length) {
      var rankBlocks = rating.blocks.filter(function (b) { return b.title && /排名/.test(b.title); });
      if (rankBlocks.length) {
        var cnNums = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
        rankBlocks.forEach(function (b, idx) {
          var canRank = b.header.filter(function (hh) { return /总分/.test(hh); }).length === 1 && !b.header.some(function (hh) { return /名次/.test(hh); });
          var totCol = b.header.findIndex(function (hh) { return /总分/.test(hh); });
          var usable = totCol >= 0 ? b.rows.some(function (r) { return isNum(r[totCol]) && +r[totCol] > 0; }) : b.rows.some(function (r) { return r[1] != null && r[1] !== '' && isNum(r[1]); });
          var blockTitle = (b.title || '').replace(/^[一二三四五六七八九十]、/, cnNums[idx + 1] + '、');
          h += '<div class="lk-sub-h">' + esc(blockTitle) + '</div>';
          if (!b.rows.length || !usable) h += '<div class="preview-note">（该排名暂无数据）</div>';
          else h += kezuScoreBlockHTML(b, canRank);
        });
      } else {
        h += '<div class="lk-empty">该年评比数据中暂无排名信息。</div>';
      }
    } else {
      h += '<div class="lk-empty">该年评比数据中暂无排名信息。</div>';
    }
    var resEl = document.getElementById('kezuRankResult');
    if (resEl) resEl.innerHTML = h;
  }

  /* ---------- 科组生产预测 ---------- */
  function actualSummary(snap, py, pm, uptoWeek) {
    var actuals = kezuActualRecs(snap).filter(function (r) { return r.year === py && r.month === pm; });
    var campusActual = 0, campusSched = 0, hasData = false;
    actuals.forEach(function (r) {
      var w = +r.week || 0;
      if (uptoWeek == null || w <= uptoWeek) {
        campusActual += num(r.values && r.values.produced);
        campusSched += num(r.values && r.values.scheduled);
        hasData = true;
      }
    });
    return { campusActual: campusActual, campusSched: campusSched, hasData: hasData };
  }
  function kezuTargetWideTableHTML(res, actuals, campusC) {
    var rows = res.rows.map(function (r) { return { name: r.name, s: r.s, w: r.w || 0, weekly: r.weekly || 0, final: r.final || 0 }; });
    var bySubj = {};
    actuals.forEach(function (r) { (bySubj[r.dimension] = bySubj[r.dimension] || []).push(r); });
    rows.forEach(function (r) {
      var list = (bySubj[r.name] || []).slice().sort(function (a, b) { return (a.week - b.week); });
      r._list = list; r._sched = 0; r._prod = 0;
      list.forEach(function (rec) { r._sched += num(rec.values && rec.values.scheduled); r._prod += num(rec.values && rec.values.produced); });
    });
    var maxW = Math.max.apply(null, rows.map(function (r) { return r.w; }).concat([0]));
    if (!maxW) return '<div class="preview-note">最佳科组缺少周数数据，无法生成周度汇总表。</div>';
    var wkIdx = [];
    for (var i = 1; i <= maxW; i++) {
      var weekTgt = 0, weekSched = 0, weekProd = 0;
      rows.forEach(function (r) {
        var rec = (r._list || []).find(function (x) { return x.week === i; });
        if (i <= r.w) weekTgt += r.weekly;
        weekSched += rec ? num(rec.values.scheduled) : 0;
        weekProd += rec ? num(rec.values.produced) : 0;
      });
      wkIdx.push({ weekTgt: weekTgt, weekSched: weekSched, weekProd: weekProd });
    }
    var campusSched = 0, campusProd = 0;
    rows.forEach(function (r) { campusSched += r._sched; campusProd += r._prod; });
    var campusFinal = res.sumFinal || 0;
    var campusCVal = (typeof campusC === 'number' && isFinite(campusC)) ? campusC : campusFinal;
    var campusPreRate = campusCVal > 0 ? campusSched / campusCVal : null;
    var campusActRate = campusFinal > 0 ? campusProd / campusFinal : null;
    var h = '<div class="lk-table-wrap"><table><thead>';
    var head = '<tr><th rowspan="2">科组</th>';
    for (var j = 1; j <= maxW; j++) head += '<th class="num" colspan="4">W' + j + '</th>';
    head += '<th class="num" rowspan="2">月度预排</th><th class="num" rowspan="2">月度实际</th><th class="num" rowspan="2">月度预排<br>完成率</th><th class="num" rowspan="2">月度实际<br>完成率</th></tr>';
    var sub = '<tr>';
    for (var k = 1; k <= maxW; k++) sub += '<th class="num">指标</th><th class="num">预排</th><th class="num">实际</th><th class="num">完成率</th>';
    sub += '</tr>';
    h += head + sub + '</thead><tbody>';
    rows.forEach(function (r) {
      var tr = '<tr><td>' + esc(r.name) + '</td>';
      for (var i2 = 1; i2 <= maxW; i2++) {
        var rec = (r._list || []).find(function (x) { return x.week === i2; });
        var hasWeek = i2 <= r.w;
        var tgt = hasWeek ? r.weekly : 0;
        var sched = rec ? num(rec.values.scheduled) : 0;
        var prod = rec ? num(rec.values.produced) : 0;
        var wkRate = tgt > 0 ? prod / tgt : null;
        tr += '<td class="num">' + (hasWeek ? fmt(tgt, 1) : '<span class="lk-muted">—</span>') + '</td>' +
          '<td class="num">' + (sched > 0 ? fmt(sched, 1) : '<span class="lk-muted">—</span>') + '</td>' +
          '<td class="num" style="font-weight:600">' + (prod > 0 ? fmt(prod, 1) : '<span class="lk-muted">—</span>') + '</td>' +
          '<td class="num">' + (wkRate == null ? '<span class="lk-muted">—</span>' : pct(wkRate)) + '</td>';
      }
      var preRate = r.final > 0 ? r._sched / r.final : null;
      var actRate = r.final > 0 ? r._prod / r.final : null;
      tr += '<td class="num">' + (r._sched > 0 ? fmt(r._sched, 1) : '<span class="lk-muted">—</span>') + '</td>' +
        '<td class="num" style="font-weight:600">' + (r._prod > 0 ? fmt(r._prod, 1) : '<span class="lk-muted">—</span>') + '</td>' +
        '<td class="num">' + (preRate == null ? '<span class="lk-muted">—</span>' : pct(preRate)) + '</td>' +
        '<td class="num">' + (actRate == null ? '<span class="lk-muted">—</span>' : pct(actRate)) + '</td></tr>';
      h += tr;
    });
    var tfoot = '<tr><td class="total-label">校区总计</td>';
    for (var i3 = 1; i3 <= maxW; i3++) {
      var wi = wkIdx[i3 - 1];
      var wkRate2 = wi.weekTgt > 0 ? wi.weekProd / wi.weekTgt : null;
      tfoot += '<td class="num">' + fmt(wi.weekTgt, 1) + '</td>' +
        '<td class="num">' + fmt(wi.weekSched, 1) + '</td>' +
        '<td class="num" style="font-weight:600">' + fmt(wi.weekProd, 1) + '</td>' +
        '<td class="num">' + (wkRate2 == null ? '<span class="lk-muted">—</span>' : pct(wkRate2)) + '</td>';
    }
    tfoot += '<td class="num" style="font-weight:600">' + (campusSched > 0 ? fmt(campusSched, 1) : '<span class="lk-muted">—</span>') + '</td>' +
      '<td class="num" style="font-weight:600">' + (campusProd > 0 ? fmt(campusProd, 1) : '<span class="lk-muted">—</span>') + '</td>' +
      '<td class="num">' + (campusPreRate == null ? '<span class="lk-muted">—</span>' : pct(campusPreRate)) + '</td>' +
      '<td class="num">' + (campusActRate == null ? '<span class="lk-muted">—</span>' : pct(campusActRate)) + '</td></tr>';
    h += '</tbody><tfoot>' + tfoot + '</tfoot></table></div>';
    h += '<div class="preview-note">月度预排完成率 = 月度预排 ÷ 月度生产指标；校区总计 = 校区月度预排 ÷ 校区生产指标 C。</div>';
    return h;
  }

  function renderForecast(snap, weekly) {
    var months = kezuMonths(snap);
    var h = '<div class="lk-section"><div class="lk-section-head"><div class="lk-section-title">📊 科组生产预测（下月指标）</div>' +
      '<div class="lk-section-sub">底层逻辑：用已完成月份（参考月）的最佳科组数据，预测下个月的生产指标 · 口径与核心看板一致</div></div>';
    if (!months.length) {
      h += '<div class="lk-empty">暂无最佳科组月度明细。请在数据分析工作台上传科组月度数据并推送后查看预测。</div></div>';
      return { html: h };
    }
    // C 初始值：云端同步（snap.kezu.C）> 本地记忆 > 默认 1000
    var C0 = (snap.kezu && typeof snap.kezu.C === 'number') ? snap.kezu.C : null;
    try { var lc = localStorage.getItem('dos_kezu_target_C'); if (lc != null && lc !== '') { var n = parseFloat(lc); if (isFinite(n) && n >= 0) C0 = n; } } catch (e) {}
    if (C0 == null) C0 = 1000;
    var defY = months[months.length - 1].year, defM = months[months.length - 1].month;
    var ys = Array.from(new Set(months.map(function (m) { return m.year; })));
    h += '<div class="lk-cmp-toolbar" style="margin-bottom:12px">' +
      '<label>校区生产指标（总盘 C）</label><input type="number" id="dtC" class="lk-input mono" min="0" step="any" value="' + C0 + '">' +
      '<label>参考月份（已完成月）</label><select id="dtMonthSel" class="lk-input">' +
      months.map(function (m) { return '<option value="' + m.year + '-' + m.month + '"' + (m.year === defY && m.month === defM ? ' selected' : '') + '>' + m.year + ' 年 ' + m.month + ' 月</option>'; }).join('') +
      '</select>' +
      '<label>预测月份</label><input type="text" id="dtPred" class="lk-input" readonly>' +
      '</div>';
    h += '<div id="dtConsist" class="preview-note"></div>';
    h += '<div id="dtResult"></div>';
    h += '</div>';
    return { html: h };
  }
  function drawForecast(snap, weekly) {
    var cEl = document.getElementById('dtC');
    var mEl = document.getElementById('dtMonthSel');
    var pEl = document.getElementById('dtPred');
    var consEl = document.getElementById('dtConsist');
    var resEl = document.getElementById('dtResult');
    if (!cEl || !mEl || !pEl || !resEl) return;
    var C = parseFloat(cEl.value) || 0;
    try { localStorage.setItem('dos_kezu_target_C', String(C)); } catch (e) {}
    var parts = mEl.value.split('-');
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    var depts = loadMonth(snap, y, m);
    if (!depts) {
      pEl.value = ''; consEl.innerHTML = '';
      resEl.innerHTML = '<div class="lk-empty">「最佳科组」' + y + ' 年 ' + m + ' 月 暂无数据，无法预测。请切换到有数据的参考月份。</div>';
      return;
    }
    var pm = predMonth(y, m);
    var predWeeks = manualMonthWeekCount(pm.year, pm.month);
    depts.forEach(function (d) { d.w = predWeeks; });
    pEl.value = pm.year + ' 年 ' + pm.month + ' 月';
    var res = computeKezuTarget(depts, C);
    var latestV1 = (function () {
      var rs = (snap.latestByStream && snap.latestByStream.weekly && snap.latestByStream.weekly.values) || null;
      return rs && rs.v1Students != null ? num(rs.v1Students) : null;
    })();
    var src = dataSourceProd(snap, y, m);
    var consistHtml;
    if (src == null) consistHtml = '<span class="lk-tag warn">数据源无该月周报</span> <span class="preview-note">「1v1 月生产课时」校验需上传该月 DOS 周报。</span>';
    else { var diff = res.H - src, ok = Math.abs(diff) < 1; consistHtml = '最佳科组课时合计 <b>' + fmt(res.H) + '</b>　vs　数据源 1v1 月生产课时 <b>' + fmt(src) + '</b>　<span class="lk-tag ' + (ok ? 'ok' : 'warn') + '">' + (ok ? '✓ 一致' : '⚠ 不一致') + '</span>'; }
    consEl.innerHTML = consistHtml;

    var today = new Date();
    var cw = currentManualWeek(today);
    var reportWeek = 0;
    if (cw.year === pm.year && cw.month === pm.month) {
      reportWeek = (today.getDay() === 0) ? cw.week : Math.max(1, cw.week - 1);
    } else {
      var pmEnd = manualLastDay(pm.year, pm.month);
      if (today > pmEnd) reportWeek = currentManualWeek(pmEnd).week;
    }
    var done = actualSummary(snap, pm.year, pm.month, reportWeek);
    var whole = actualSummary(snap, pm.year, pm.month, null);
    var campusActual = done.campusActual;
    var campusSched = whole.campusSched;
    var hasData = whole.hasData;
    var actRate = res.sumFinal > 0 ? campusActual / res.sumFinal : 0;
    var gapG1 = C - campusSched;
    var gapG2 = C * 1.10 - campusSched;
    var gapG3 = C * 1.25 - campusSched;
    var gapText = function (v) { return v <= 0 ? '<span class="lk-tag ok">已达成</span>' : '<span class="num" style="font-weight:600">' + fmt(v) + '</span>'; };
    var weekLabel = reportWeek > 0 ? (pm.month + '月第' + reportWeek + '周完成率') : '本周完成率';

    var h = '<div class="lk-stat-grid" style="margin:6px 0 14px">' +
      '<div class="lk-stat-card"><div class="k">校区生产指标 C</div><div class="v">' + fmt(C) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">当前1V1人数</div><div class="v">' + (latestV1 != null ? fmt(latestV1) + ' 人' : '<span class="lk-muted">—</span>') + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G2 指标</div><div class="v" style="color:#7c3aed">' + fmt(C * 1.10) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G3 指标</div><div class="v" style="color:var(--accent)">' + fmt(C * 1.25) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">' + weekLabel + '</div><div class="v" style="color:var(--accent)">' + (hasData ? pct(actRate) : '<span class="lk-muted">—</span>') + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G1 差距课时</div><div class="v">' + (hasData ? gapText(gapG1) : '<span class="lk-muted">—</span>') + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G2 差距课时</div><div class="v">' + (hasData ? gapText(gapG2) : '<span class="lk-muted">—</span>') + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G3 差距课时</div><div class="v">' + (hasData ? gapText(gapG3) : '<span class="lk-muted">—</span>') + '</div></div>' +
      '</div>';

    var maxW = Math.max.apply(null, res.rows.map(function (r) { return r.w; }).concat([0]));
    var actuals = kezuActualRecs(snap).filter(function (r) { return r.year === pm.year && r.month === pm.month; });
    var trackTable = maxW > 0 ? kezuTargetWideTableHTML(res, actuals, C) : '<div class="preview-note">最佳科组缺少周数数据，无法生成周度汇总表。</div>';
    var hasTrack = maxW > 0 && actuals.length > 0;
    h += '<div class="lk-section-h-flex"><div class="lk-sub-h">科组月度汇总（按周展开）</div>' +
      (hasTrack ? '<span class="preview-note">含周度实际达成跟踪（来自联动快照 kezuActual）</span>' : '') + '</div>';
    h += trackTable;
    resEl.innerHTML = h;
  }

  /* ---------- 快照拉取（与联动数据共用同一快照源） ---------- */
  function pickSnapshot(rows) {
    var snap = null;
    (rows || []).forEach(function (r) {
      if (r && r.kind === 'analytics_snapshot' && r.payload) snap = r.payload;
    });
    return snap;
  }
  function fetchSnapshot(cb) {
    if (!window.App.sync || !App.sync.readShared) { cb(new Error('同步模块未加载，请先登录')); return; }
    App.sync.readShared().then(function (rows) { cb(null, pickSnapshot(rows)); })
      .catch(function (e) { cb(e); });
  }
  function noDataHTML(kind) {
    return '<div class="lk-empty">暂无' + kind + '。请在「数据分析工作台」上传对应数据并点击「推送分析到个人台」，本工作台登录同一账号后即自动同步。</div>';
  }

  /* ---------- 对外渲染入口（两个板块各自独立挂载） ---------- */
  var _rankMounted = null, _fcMounted = null;

  function bindRank(snap) {
    var yrSel = document.getElementById('kezuRankYr');
    if (yrSel) { yrSel.addEventListener('change', function () { drawRank(snap); }); drawRank(snap); }
    if (document.getElementById('kezuCmpDashWrap')) renderCompare(snap, 'kezuCmpDashWrap');
  }
  function bindForecast(snap, weekly) {
    var cEl = document.getElementById('dtC');
    var mEl = document.getElementById('dtMonthSel');
    if (cEl) cEl.addEventListener('input', function () { drawForecast(snap, weekly); });
    if (mEl) mEl.addEventListener('change', function () { drawForecast(snap, weekly); });
    drawForecast(snap, weekly);
  }

  function mountRank(container) {
    if (!container) return;
    _rankMounted = container;
    container.innerHTML = '<div class="lk-loading">正在拉取联动数据…</div>';
    fetchSnapshot(function (err, snap) {
      if (err) { container.innerHTML = '<div class="lk-empty">拉取失败：' + ((err && err.message) || err) + '</div>'; return; }
      if (!snap) { container.innerHTML = noDataHTML('最佳科组数据'); return; }
      container.innerHTML = renderRank(snap).html;
      bindRank(snap);
    });
  }
  function mountForecast(container) {
    if (!container) return;
    _fcMounted = container;
    container.innerHTML = '<div class="lk-loading">正在拉取联动数据…</div>';
    fetchSnapshot(function (err, snap) {
      if (err) { container.innerHTML = '<div class="lk-empty">拉取失败：' + ((err && err.message) || err) + '</div>'; return; }
      if (!snap) { container.innerHTML = noDataHTML('科组生产数据'); return; }
      var weekly = (snap.latestByStream && snap.latestByStream['weekly'] && snap.latestByStream['weekly'].values) || null;
      container.innerHTML = renderForecast(snap, weekly).html;
      bindForecast(snap, weekly);
    });
  }

  // 合并渲染（两板块同页，可选）
  function render(rootEl, snap, weekly) {
    if (!rootEl) return;
    rootEl.innerHTML = '<div class="lk-kezu-wrap">' + renderRank(snap).html + renderForecast(snap, weekly).html + '</div>';
    bindRank(snap);
    bindForecast(snap, weekly);
  }

  // 登录 / 云端更新时自动刷新（无论停留在哪个板块）
  window.addEventListener('dos:linked-update', function () {
    if (_rankMounted) mountRank(_rankMounted);
    if (_fcMounted) mountForecast(_fcMounted);
  });

  App.views.linkedKezu = { renderRank: mountRank, renderForecast: mountForecast, render: render };
})();
