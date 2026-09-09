/* ============================================
   linked-kezu.js — 联动数据·最佳科组排名 / 科组生产预测（仅个人工作台）
   设计原则：个人工作台是数据工作台的「纯展示端」，不二次推导任何业务指标。
   所有计算（周数、预测算法、按周汇总、一致性校验、统计卡、季度聚合）均由
   数据分析工作台 js/kezu-compute.js 在「推送分析到个人台」时一次性算好，
   打包进快照 snap.kezu.linked；本文件只把下发的数值/数据填进模板。
   —— 可以算错，但不可以与数据工作台不一致。
   ============================================ */
(function () {
  var App = window.App || (window.App = {});
  App.views = App.views || {};

  /* ---------- 格式化助手（纯展示，不改业务口径） ---------- */
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
  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : (parseFloat(x) || 0); }
  function isNum(v) { return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && /^[-\d.]+$/.test(v.trim()) && !isNaN(+v)); }
  var RATE_COL = /^(结课率|停课率|退费率|续费率|离职率|合格率|优秀率|进步率)$/;
  function scoreCell(v, header) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { if (RATE_COL.test(header) && v > 0 && v <= 1) return pct(v); return fmt(v); }
    var s = String(v).trim();
    if (isNum(s)) { var n = +s; if (RATE_COL.test(header) && n > 0 && n <= 1) return pct(n); return fmt(n); }
    return esc(s);
  }

  /* ---------- 评分块 / 最佳科组 banner（纯模板：排序 + 转义，不重算业务指标） ---------- */
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

  /* ---------- 数据访问（只读原始快照；业务计算已在数据工作台完成） ---------- */
  function kezuDetail(snap) { return (snap.kezu && snap.kezu.detail) || []; }
  function kezuScoreRecs(snap) { return (snap.kezu && snap.kezu.score) || []; }
  function kezuActualRecs(snap) { return (snap.kezu && snap.kezu.actual) || []; }
  function kezuFlat(rec) { return Object.assign({ year: rec.year, month: rec.month, subject: rec.dimension }, rec.values || {}); }
  function linked(snap) { return (snap.kezu && snap.kezu.linked) || null; }

  function noModelHTML(kind) {
    return '<div class="lk-empty">当前联动快照未包含「' + (kind || '科组') + '」预计算模型。请在<b>数据分析工作台</b>重新点击「推送分析到个人台」（需部署含 kezu-compute.js 的版本），本工作台登录同一账号后自动同步。</div>';
  }

  /* ============================================================
     科组生产预测（纯模板：消费数据工作台算好的 forecast 模型）
     ============================================================ */
  // 把数据工作台算好的「按月汇总宽表模型」（纯数值）渲染成 HTML，不重算任何数值
  function renderWideTable(wide) {
    if (!wide || !wide.maxW) return '<div class="preview-note">最佳科组缺少周数数据，无法生成周度汇总表。</div>';
    var rows = wide.rows;
    var head = '<tr><th rowspan="2">科组</th>';
    for (var i = 1; i <= wide.maxW; i++) head += '<th class="num" colspan="4">W' + i + '</th>';
    head += '<th class="num" rowspan="2">月度预排</th><th class="num" rowspan="2">月度实际</th><th class="num" rowspan="2">月度预排<br>完成率</th><th class="num" rowspan="2">月度实际<br>完成率</th></tr>';
    var sub = '<tr>';
    for (var k = 1; k <= wide.maxW; k++) sub += '<th class="num">指标</th><th class="num">预排</th><th class="num">实际</th><th class="num">完成率</th>';
    sub += '</tr>';
    var h = '<div class="lk-table-wrap"><table><thead>' + head + sub + '</thead><tbody>';
    rows.forEach(function (r) {
      var tr = '<tr><td>' + esc(r.name) + '</td>';
      r.perWeek.forEach(function (pw) {
        var tgtF = pw.hasWeek ? fmt(pw.tgt, 1) : '<span class="lk-muted">—</span>';
        var schedF = pw.sched > 0 ? fmt(pw.sched, 1) : '<span class="lk-muted">—</span>';
        var prodF = pw.prod > 0 ? fmt(pw.prod, 1) : '<span class="lk-muted">—</span>';
        var rateF = pw.rate == null ? '<span class="lk-muted">—</span>' : pct(pw.rate);
        tr += '<td class="num">' + tgtF + '</td><td class="num">' + schedF + '</td><td class="num" style="font-weight:600">' + prodF + '</td><td class="num">' + rateF + '</td>';
      });
      var preF = r.preRate == null ? '<span class="lk-muted">—</span>' : pct(r.preRate);
      var actF = r.actRate == null ? '<span class="lk-muted">—</span>' : pct(r.actRate);
      tr += '<td class="num">' + (r.sched > 0 ? fmt(r.sched, 1) : '<span class="lk-muted">—</span>') + '</td>' +
        '<td class="num" style="font-weight:600">' + (r.prod > 0 ? fmt(r.prod, 1) : '<span class="lk-muted">—</span>') + '</td>' +
        '<td class="num">' + preF + '</td><td class="num">' + actF + '</td></tr>';
      h += tr;
    });
    var tfoot = '<tr><td class="total-label">校区总计</td>';
    wide.wkIdx.forEach(function (wi) {
      var wkRate = wi.weekTgt > 0 ? wi.weekProd / wi.weekTgt : null;
      tfoot += '<td class="num">' + fmt(wi.weekTgt, 1) + '</td><td class="num">' + fmt(wi.weekSched, 1) + '</td><td class="num" style="font-weight:600">' + fmt(wi.weekProd, 1) + '</td><td class="num">' + (wkRate == null ? '<span class="lk-muted">—</span>' : pct(wkRate)) + '</td>';
    });
    var cPre = wide.campusPreRate == null ? '<span class="lk-muted">—</span>' : pct(wide.campusPreRate);
    var cAct = wide.campusActRate == null ? '<span class="lk-muted">—</span>' : pct(wide.campusActRate);
    tfoot += '<td class="num" style="font-weight:600">' + (wide.campusSched > 0 ? fmt(wide.campusSched, 1) : '<span class="lk-muted">—</span>') + '</td>' +
      '<td class="num" style="font-weight:600">' + (wide.campusProd > 0 ? fmt(wide.campusProd, 1) : '<span class="lk-muted">—</span>') + '</td>' +
      '<td class="num">' + cPre + '</td><td class="num">' + cAct + '</td></tr>';
    h += '</tbody><tfoot>' + tfoot + '</tfoot></table></div>';
    h += '<div class="preview-note">月度预排完成率 = 月度预排 ÷ 月度生产指标；校区总计 = 校区月度预排 ÷ 校区生产指标 C。</div>';
    return h;
  }

  function statCardsHTML(st) {
    var gapText = function (v) { return v <= 0 ? '<span class="lk-tag ok">已达成</span>' : '<span class="num" style="font-weight:600">' + fmt(v) + '</span>'; };
    return '<div class="lk-stat-grid" style="margin:6px 0 14px">' +
      '<div class="lk-stat-card"><div class="k">校区生产指标 C</div><div class="v">' + fmt(st.C) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">当前1V1人数</div><div class="v">' + (st.v1 != null ? fmt(st.v1) + ' 人' : '<span class="lk-muted">—</span>') + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G2 指标</div><div class="v" style="color:#7c3aed">' + fmt(st.G2) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G3 指标</div><div class="v" style="color:var(--accent)">' + fmt(st.G3) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">' + esc(st.weekLabel) + '</div><div class="v" style="color:var(--accent)">' + (st.hasData ? pct(st.actRate) : '<span class="lk-muted">—</span>') + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G1 差距课时</div><div class="v">' + gapText(st.gapG1) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G2 差距课时</div><div class="v">' + gapText(st.gapG2) + '</div></div>' +
      '<div class="lk-stat-card"><div class="k">校区生产 G3 差距课时</div><div class="v">' + gapText(st.gapG3) + '</div></div>' +
      '</div>';
  }

  function renderForecast(snap) {
    var L = linked(snap);
    var h = '<div class="lk-section"><div class="lk-section-head"><div class="lk-section-title">📊 科组生产预测（下月指标）</div>' +
      '<div class="lk-section-sub">底层逻辑：用已完成月份（参考月）的最佳科组数据，预测下个月的生产指标 · 口径与核心看板一致（计算由数据分析工作台统一完成）</div></div>';
    if (!L) { h += noModelHTML('科组生产预测'); return { html: h }; }
    if (!L.months.length) { h += '<div class="lk-empty">暂无最佳科组月度明细。请在数据分析工作台上传科组月度数据并推送后查看预测。</div></div>'; return { html: h }; }
    var C0 = L.C;
    var defY = L.months[L.months.length - 1].year, defM = L.months[L.months.length - 1].month;
    var defKey = defY + '-' + defM;
    h += '<div class="lk-cmp-toolbar" style="margin-bottom:12px">' +
      '<label>校区生产指标（总盘 C）</label><span id="dtC" class="lk-input lk-readonly mono" style="display:inline-flex;align-items:center;min-width:96px;background:var(--surface-2);cursor:default">' +
      (C0 != null ? fmt(C0) : '<span class="lk-muted">未同步</span>') + '</span>' +
      '<span class="lk-tag ok">自动同步</span>' +
      '<label>参考月份（已完成月）</label><select id="dtMonthSel" class="lk-input">' +
      L.months.map(function (m) { return '<option value="' + m.year + '-' + m.month + '"' + (m.year === defY && m.month === defM ? ' selected' : '') + '>' + m.year + ' 年 ' + m.month + ' 月</option>'; }).join('') +
      '</select>' +
      '<label>预测月份</label><input type="text" id="dtPred" class="lk-input" readonly>' +
      '</div>';
    h += '<div id="dtConsist" class="preview-note"></div>';
    h += '<div id="dtResult"></div>';
    h += '</div>';
    return { html: h, defKey: defKey };
  }
  function drawForecast(snap) {
    var L = linked(snap); if (!L) return;
    var mEl = document.getElementById('dtMonthSel');
    var pEl = document.getElementById('dtPred');
    var consEl = document.getElementById('dtConsist');
    var resEl = document.getElementById('dtResult');
    if (!mEl || !pEl || !resEl) return;
    var f = L.forecast[mEl.value];
    if (!f) { pEl.value = ''; if (consEl) consEl.innerHTML = ''; resEl.innerHTML = '<div class="lk-empty">该参考月份暂无预测数据。</div>'; return; }
    if (f.noC) {
      pEl.value = ''; if (consEl) consEl.innerHTML = '';
      resEl.innerHTML = '<div class="lk-empty">' +
        '<p><b>校区生产指标 C 尚未从数据分析台同步。</b></p>' +
        '<p>请按以下顺序排查：</p>' +
        '<ol style="text-align:left;display:inline-block;margin:8px 0;line-height:1.8">' +
        '<li>在「数据分析台 → 核心看板 → 科组生产预测」的<b>校区生产指标（总盘 C）</b>输入框中填写数字；</li>' +
        '<li>点击数据分析台右下角的<b>「推送分析到个人台」</b>（需含 kezu-compute.js 的版本）；</li>' +
        '<li>在本页点击右上角的<b>「查看联动数据」</b>确认快照已更新，或刷新本页面。</li>' +
        '</ol></div>';
      return;
    }
    pEl.value = f.predYear + ' 年 ' + f.predMonth + ' 月';
    if (consEl) consEl.innerHTML = f.consistHTML || '';
    var h = statCardsHTML(f.stat);
    // —— 科组参考月单科及课时 / 科组G1·G2·G3目标（与核心看板口径一致；数据来自联动模型 f.model）——
    if (f.model && f.model.rows && f.model.rows.length) {
      var Gc = f.model.Gcfg || { G1: 1.00, G2: 1.10, G3: 1.25 };
      h += '<div class="lk-sub-h">科组参考月单科及课时（来自最佳科组）</div>';
      h += '<div class="preview-note">单科数 / 课时取自参考月「最佳科组」；周数为预测月自然周数。可在数据分析台「科组生产指标」中编辑后重新推送。</div>';
      h += '<div class="lk-table-wrap"><table><thead><tr><th>科组名称</th><th class="num">单科数</th><th class="num">上月课时</th><th class="num">周数</th></tr></thead><tbody>';
      f.model.rows.forEach(function (r) {
        h += '<tr><td>' + esc(r.name) + '</td><td class="num">' + fmt(r.s) + '</td><td class="num">' + fmt(r.h) + '</td><td class="num">' + fmt(r.w) + '</td></tr>';
      });
      h += '</tbody><tfoot><tr><td class="total-label">校区总计</td><td class="num">' + fmt(f.model.S) + '</td><td class="num">' + fmt(f.model.H) + '</td><td class="num">—</td></tr></tfoot></table></div>';
      h += '<div class="lk-sub-h">科组G1 / G2 / G3目标</div>';
      h += '<div class="preview-note">完成率 = 四科组预测之和 / C；100%→G1，110%→G2，125%→G3。各档总盘 = C × 档位，按单科占比分解到每科组。</div>';
      h += '<div class="lk-table-wrap"><table><thead><tr><th>科组</th><th class="num">单科数</th><th class="num">G1 目标（100%）</th><th class="num">G2 目标（110%）</th><th class="num">G3 目标（125%）</th></tr></thead><tbody>';
      f.model.rows.forEach(function (r) {
        h += '<tr><td>' + esc(r.name) + '</td><td class="num">' + fmt(r.s) + '</td><td class="num">' + fmt(r.G1) + '</td><td class="num">' + fmt(r.G2) + '</td><td class="num">' + fmt(r.G3) + '</td></tr>';
      });
      h += '</tbody><tfoot><tr><td class="total-label">校区总计</td><td class="num">' + fmt(f.model.S) + '</td><td class="num">' + fmt(f.C * Gc.G1) + '</td><td class="num">' + fmt(f.C * Gc.G2) + '</td><td class="num">' + fmt(f.C * Gc.G3) + '</td></tr></tfoot></table></div>';
    }
    var maxW = f.wide ? f.wide.maxW : 0;
    var actuals = kezuActualRecs(snap).filter(function (r) { return r.year === f.predYear && r.month === f.predMonth; });
    var trackTable = maxW > 0 ? renderWideTable(f.wide) : '<div class="preview-note">最佳科组缺少周数数据，无法生成周度汇总表。</div>';
    var hasTrack = maxW > 0 && actuals.length > 0;
    h += '<div class="lk-section-h-flex"><div class="lk-sub-h">科组月度汇总（按周展开）</div>' +
      (hasTrack ? '<span class="preview-note">含周度实际达成跟踪（来自联动快照 kezuActual）</span>' : '') + '</div>';
    h += trackTable;
    resEl.innerHTML = h;
  }

  /* ============================================================
     最佳科组排名（消费原始 score 数据做纯模板，不重算业务指标）
     ============================================================ */
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

  /* ============================================================
     科组横向对比（消费原始 detail + 数据工作台预算的季度聚合，纯模板）
     ============================================================ */
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
    var L = linked(snap);
    var detail = kezuDetail(snap).map(kezuFlat);
    var wrap = document.getElementById(rootId);
    if (!wrap) return;
    if (!L || !L.compare || !Object.keys(L.compare.byYear).length) { wrap.innerHTML = noModelHTML('科组横向对比'); return; }
    var years = Object.keys(L.compare.byYear).map(Number).sort(function (a, b) { return b - a; });
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
      var c = L.compare.byYear[year];
      var isQuarter = mode === 'quarter';
      var recs = isQuarter ? c.quarterAgg : detail.filter(function (r) { return r.year === year; });
      var subjects = c.subjects;
      var periods, pLabel, matrix;
      if (!isQuarter) {
        periods = c.months.slice();
        pLabel = function (m) { return m + '月'; };
        var mMap = {};
        recs.forEach(function (r) { (mMap[r.subject] = mMap[r.subject] || {})[r.month] = r; });
        matrix = {};
        subjects.forEach(function (s) { matrix[s] = {}; periods.forEach(function (m) { matrix[s][m] = mMap[s] ? mMap[s][m] : null; }); });
      } else {
        periods = Array.from(new Set(recs.map(function (r) { return r.quarter; }))).filter(function (q) { return q != null; }).sort(function (a, b) { return a - b; });
        pLabel = function (q) { return 'Q' + q; };
        var qMap = {};
        recs.forEach(function (r) { (qMap[r.subject] = qMap[r.subject] || {})[r.quarter] = r; });
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
        ? '季度横向对比：同一科组跨各季度的「' + dimMeta.l + unit + '」对比，数据来自数据分析工作台季度聚合（课时累加、单科数取月均、周平均/各率按口径重算），<b>不含任何月度明细</b>。末列「' + avgLabel + '」为该年所列各季度的算术平均。'
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

  /* ---------- 快照拉取（与联动数据共用同一快照源） ---------- */
  function pickSnapshot(rows) {
    var snap = null;
    (rows || []).forEach(function (r) { if (r && r.kind === 'analytics_snapshot' && r.payload) snap = r.payload; });
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
  function bindForecast(snap) {
    var mEl = document.getElementById('dtMonthSel');
    if (mEl) mEl.addEventListener('change', function () { drawForecast(snap); });
    drawForecast(snap);
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
      container.innerHTML = renderForecast(snap).html;
      bindForecast(snap);
    });
  }

  function render(rootEl, snap) {
    if (!rootEl) return;
    rootEl.innerHTML = '<div class="lk-kezu-wrap">' + renderRank(snap).html + renderForecast(snap).html + '</div>';
    bindRank(snap);
    bindForecast(snap);
  }

  window.addEventListener('dos:linked-update', function () {
    if (_rankMounted) mountRank(_rankMounted);
    if (_fcMounted) mountForecast(_fcMounted);
  });

  App.views.linkedKezu = { renderRank: mountRank, renderForecast: mountForecast, render: render };
})();

