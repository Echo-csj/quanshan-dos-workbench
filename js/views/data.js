/* ============================================
   data.js — 数据看板 v3
   标签页：① 基准值对标  ② 环比·同比趋势  ③ 人事数据（联动自动填充）  ④ 联动数据
   说明：报表数据不再需要手动导入/录入，全部由「联动数据」（数据分析工作台推送的快照）自动提取填充。
         import / 手动补录 板块已移除。
   ============================================ */

(function() {

  /* ---------------- 工具 ---------------- */
  function fmtMetric(id, v) {
    var m = App.importer.metric(id);
    if (v == null || isNaN(v)) return '-';
    if (m && m.unit === '%') return (v * 100).toFixed(m.dec) + '%';
    if (m && m.dec > 0) return v.toFixed(m.dec);
    return String(v);
  }

  function judgeLevel(v, baseline) {
    if (!baseline || v == null || isNaN(v)) return null;
    return App.util.judge(v, baseline).level;
  }

  /* ---------------- 路由 ---------------- */
  App.router.register('/data', function() {
    App.router.navigate('/data/baseline');
  });
  App.router.register('/data/:tab', function(params) {
    var container = document.getElementById('view-container');
    if (!container) return;
    var tab = (params && params.tab) || 'baseline';
    if (['baseline', 'trend', 'hr', 'linked'].indexOf(tab) < 0) tab = 'baseline';

    var html = '';
    html += '<div class="page-head"><h1 class="page-title">数据看板</h1>';
    html += '<p class="page-sub">基准值对标红绿灯 · 环比/同比趋势 · 人事数据（联动自动填充） · 联动数据分析台</p></div>';

    // Tabs
    html += '<div class="tabs" style="margin-bottom:18px">';
    html += tabBtn('baseline', '🎯 基准值对标', tab);
    html += tabBtn('trend', '📈 环比 · 同比趋势', tab);
    html += tabBtn('hr', '👥 人事数据', tab);
    html += tabBtn('linked', '🔗 联动数据', tab);
    html += '</div>';

    if (  tab === 'baseline') html += renderBaseline();
    else if (tab === 'trend') html += renderTrend();
    else if (tab === 'hr') html += renderHR();
    else html += '<div id="linked-root"></div>';

    container.innerHTML = html;
    if (tab === 'baseline') bindBaseline();
    if (tab === 'trend') bindTrend();
    if (tab === 'linked' && App.views.linkedData) App.views.linkedData.render(document.getElementById('linked-root'));
  });

  function tabBtn(id, label, active) {
    return '<button class="tab ' + (active === id ? 'active' : '') + '" onclick="App.router.navigate(\'/data/' + id + '\')">' + label + '</button>';
  }

  /* ---------------- ① 基准值对标 ---------------- */
  function renderBaseline() {
    var reports = App.store.get('reports') || { monthly: {} };
    var months = Object.keys(reports.monthly || {}).sort();
    var html = '';

    if (!months.length) {
      html += '<div class="empty-state" style="padding:50px"><h4>暂无数据</h4>' +
        '<p>基准值对标的数据由<b>联动数据</b>自动填充（来源：数据分析工作台·周报快照）。' +
        '若为空，请确认：① 已在数据分析工作台「推送分析到个人台」；② 本工作台已登录同一账号并保持同步。</p>' +
        '<button class="btn btn-primary btn-sm" onclick="App.router.navigate(\'/data/linked\')">前往联动数据</button></div>';
      return html;
    }

    var sel = months[months.length - 1];
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">';
    html += '<label class="form-label" style="margin:0">对标月份</label>';
    html += '<select id="baseline-month" class="form-input" style="width:  auto;min-width:160px">';
    months.forEach(function(mk) {
      html += '<option value="' + mk + '"' + (mk === sel ? ' selected' : '') + '>' + (reports.monthly[mk].label || mk) + '（' + mk + '）</option>';
    });
    html += '</select>';
    html += '<span style="font-size:12px;color:var(--text-faint)">数据自动取自联动快照 · 字段与本看板口径对齐</span>';
    html += '</div>';

    html += '<div id="baseline-body"></div>';
    return html;
  }

  function renderBaselineBody(monthKey) {
    var reports = App.store.get('reports') || { monthly: {} };
    var snap = reports.monthly[monthKey];
    if (!snap) return '<div class="empty-state">无数据</div>';
    var metrics = snap.metrics || {};

    // 收集有基准值的指标
    var items = [];
    App.importer.trendMetricIds().forEach(function(id) {
      var meta = App.importer.metric(id);
      if (!meta || !meta.baseline) return;
      if (metrics[id] == null) return;
      items.push({ id: id, meta: meta, value: metrics[id] });
    });

    var body = '';

    // 汇总
    body += '<div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">';
    body += sumChip('达标', items.filter(function(i){ return judgeLevel(i.value, i.meta.baseline)==='ok'; }).length, 'ok');
    body += sumChip('临界', items.filter(function(i){ return judgeLevel(i.value, i.meta.baseline)==='warn'; }).length, 'warn');
    body += sumChip('异常', items.filter(function(i){ return judgeLevel(i.value, i.meta.baseline)==='bad'; }).length, 'bad');
    body += '</div>';

    if (!items.length) {
      body += '<div class="empty-state" style="padding:30px"><p>该月份未提取到可对标基准值的指标。</p></div>';
    } else {
      body += '<div class="grid-3">';
      items.forEach(function(it) {
        var lvl = judgeLevel(it.value, it.meta.baseline);
        var j = App.util.judge(it.value, it.meta.baseline);
        var baseVal = Array.isArray(it.meta.baseline.value) ? (it.meta.baseline.value[0] * 100).toFixed(0) + '~' + (it.meta.baseline.value[1] * 100).toFixed(0) + '%' : (it.meta.baseline.unit === '%' ? (it.meta.baseline.value * 100).toFixed(1) + '%' : it.meta.baseline.value);
        body += '<div class="metric-card">';
        body += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
        body += '<span style="font-size:12px;color:var(--text-muted)">' + it.meta.label + '</span>';
        body += '<span class="status-dot ' + (lvl || 'neutral') + '"></span>';
        body += '</div>';
        body += '<div class="mono" style="font-size:22px;font-weight:700;margin:6px 0">' + fmtMetric(it.id, it.value) + '</div>';
        body += '<div style="font-size:11px;color:var(--text-faint)">基准 ' + baseVal + ' · ' + j.label + '</div>';
        body += '</div>';
      });
      body += '</div>';
    }

    // 五项满意度明细（若快照附带）
    if (snap.satisfaction && snap.satisfaction.totals) {
      var sat = snap.satisfaction;
      body += '<div class="card" style="margin-top:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('star', 18) + '五项满意度（合计 · 按班主任汇总）</h3></div>';
      if (sat.totals.rates) {
        body += '<div class="grid-4" style="margin-bottom:10px">';
        Object.keys(sat.totals.rates).forEach(function(mid) {
          var meta = App.importer.metric(mid);
          if (!meta) return;
          var lvl = judgeLevel(sat.totals.rates[mid], meta.baseline);
          body += '<div style="padding:10px;background:var(--surface-2);border-radius:var(--radius-sm);border-left:3px solid ' + (lvl === 'ok' ? 'var(--ok)' : lvl === 'warn' ? 'var(--warn)' : lvl === 'bad' ? 'var(--bad)' : 'var(--border)') + '">';
          body += '<div style="font-size:11px;color:var(--text-muted)">' + meta.label + '</div>';
          body += '<div class="mono" style="font-size:18px;font-weight:700">' + fmtMetric(mid, sat.totals.rates[mid]) + '</div>';
          body += '</div>';
        });
        body += '</div>';
      }
      if (sat.byHead && sat.byHead.length) {
        body += '<details><summary style="cursor:pointer;font-size:13px;color:var(--accent)">展开按班主任明细（' + sat.byHead.length + '）</summary>';
        body += '<table class="data-table" style="margin-top:10px"><thead><tr><th>班主任</th><th>在读</th><th>结课人数率</th><th>退费单科率</th><th>停课人数率</th><th>续费单科率</th><th>推荐人数率</th></tr></thead><tbody>';
        sat.byHead.forEach(function(h) {
          body += '<tr><td>' + App.util.truncate(h.headTeacher || '', 10) + '</td><td>' + (h.reading != null ? h.reading : '-') + '</td>';
          body += '<td>' + fmtMetric('finishRatePersonMonth', h.rates && h.rates.finishRatePersonMonth) + '</td>';
          body += '<td>' + fmtMetric('refundRateSubjectMonth', h.rates && h.rates.refundRateSubjectMonth) + '</td>';
          body += '<td>' + fmtMetric('suspendRatePersonMonth', h.rates && h.rates.suspendRatePersonMonth) + '</td>';
          body += '<td>' + fmtMetric('renewalRateSubjectMonth', h.rates && h.rates.renewalRateSubjectMonth) + '</td>';
          body += '<td>' + fmtMetric('recommendRatePersonMonth', h.rates && h.rates.recommendRatePersonMonth) + '</td></tr>';
        });
        body += '</tbody></table></details>';
      }
      body += '</div>';
    }

    return body;
  }

  function sumChip(label, n, level) {
    return '<div class="sum-chip ' + level + '"><span class="sum-num">' + n + '</span><span class="sum-label">' + label + '</span></div>';
  }

  /* ---------------- ② 环比 · 同比趋势 ---------------- */
  function renderTrend() {
    var reports = App.store.get('reports') || { monthly: {} };
    var months = Object.keys(reports.monthly || {}).sort();
    var html = '';

    if (months.length < 1) {
      html += '<div class="empty-state" style="padding:50px"><h4>暂无数据</h4>' +
        '<p>趋势数据由<b>联动数据</b>自动填充（来源：数据分析工作台·周报快照）。' +
        '随着校区按月推送，历史月份会自动累计，环比/同比将逐步可用。</p>' +
        '<button class="btn btn-primary btn-sm" onclick="App.router.navigate(\'/data/linked\')">前往联动数据</button></div>';
      return html;
    }

    // 收集可用指标（在任意月份有值）
    var available = App.importer.trendMetricIds().filter(function(id) {
      return months.some(function(mk) { return reports.monthly[mk].metrics && reports.monthly[mk].metrics[id] != null; });
    });
    var selId = available[0] || App.importer.trendMetricIds()[0];

    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">';
    html += '<label class="form-label" style="margin:0">指标</label>';
    html += '<select id="trend-metric" class="form-input" style="width:auto;min-width:200px">';
    available.forEach(function(id) {
      var m = App.importer.metric(id);
      html += '<option value="' + id + '">' + (m ? m.label : id) + '</option>';
    });
    html += '</select>';
    html += '<span id="trend-baseline-note" style="font-size:12px;color:var(--text-muted)"></span>';
    html += '</div>';

    html += '<div id="trend-body"></div>';
    return html;
  }

  function renderTrendBody(metricId) {
    var reports = App.store.get('reports') || { monthly: {} };
    var months = Object.keys(reports.monthly || {}).sort();
    var meta = App.importer.metric(metricId);
    var body = '';

    var series = months.map(function(mk) {
      var s = reports.monthly[mk];
      var v = s.metrics ? s.metrics[metricId] : null;
      return { month: mk, label: mk.slice(2), value: v, snap: s };
    });

    // 环比 / 同比
    series.forEach(function(d, i) {
      var prev = series[i - 1];
      d.mom = (prev && prev.value != null && d.value != null && prev.value !== 0) ? (d.value - prev.value) / Math.abs(prev.value) : null;
      var yoyRef = null;
      if (d.snap && d.snap.yoy && d.snap.yoy[metricId] != null) yoyRef = d.snap.yoy[metricId];
      if (yoyRef == null) {
        var y = parseInt(d.month.slice(0, 4), 10) - 1, m = d.month.slice(5);
        var pk = y + '-' + m;
        if (reports.monthly[pk] && reports.monthly[pk].metrics && reports.monthly[pk].metrics[metricId] != null) yoyRef = reports.monthly[pk].metrics[metricId];
      }
      d.yoy = (yoyRef != null && d.value != null && yoyRef !== 0) ? (d.value - yoyRef) / Math.abs(yoyRef) : null;
      if (d.value != null && meta && meta.baseline) d.level = App.util.judge(d.value, meta.baseline).level;
    });

    var baseRef = null, baseLabel = '';
    if (meta && meta.baseline) {
      var bv = meta.baseline.value;
      baseRef = Array.isArray(bv) ? bv[0] : bv;
      baseLabel = fmtMetric(metricId, baseRef);
    }

    // 图表
    body += '<div class="card" style="margin-bottom:18px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('trending-up', 18) + (meta ? meta.label : metricId) + ' 月度走势</h3></div>';
    body += App.util.lineChart(series, { unit: meta ? meta.unit : '', dec: meta ? meta.dec : 1, baseline: baseRef, baselineLabel: baseLabel });
    body += '</div>';

    // 表
    body += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('bar-chart-2', 18) + '环比 / 同比明细</h3></div>';
    body += '<table class="data-table"><thead><tr><th>月份</th><th>实际值</th><th>环比</th><th>同比</th><th>基准值</th><th>状态</th></tr></thead><tbody>';
    series.forEach(function(d) {
      var goodDir = meta && meta.baseline ? (meta.baseline.mode === 'gte' ? 1 : meta.baseline.mode === 'lte' ? -1 : 0) : 0;
      body += '<tr><td class="mono" style="font-size:12px">' + d.month + '</td>';
      body += '<td class="mono" style="font-weight:600">' + fmtMetric(metricId, d.value) + '</td>';
      body += '<td>' + deltaCell(d.mom, goodDir) + '</td>';
      body += '<td>' + deltaCell(d.yoy, goodDir) + '</td>';
      body += '<td class="mono" style="font-size:12px;color:var(--text-muted)">' + (baseRef != null ? fmtMetric(metricId, baseRef) : '-') + '</td>';
      body += '<td>' + (d.level ? '<span class="status-dot ' + d.level + '"></span> ' + ({ ok: '达标', warn: '临界', bad: '异常' }[d.level]) : '-') + '</td></tr>';
    });
    body += '</tbody></table>';
    body += '<p style="font-size:11px;color:var(--text-faint);margin-top:10px">环比 = 与上一月比较；同比 = 与同名月份上一年比较。绿色表示该指标朝「达标」方向变动，红色为偏离。当前数据均自动取自联动快照。</p>';
    body += '</div>';
    return body;
  }

  function deltaCell(d, goodDir) {
    if (d == null) return '<span style="color:var(--text-faint)">-</span>';
    var pctStr = (d * 100).toFixed(1) + '%';
    var good = goodDir === 0 ? null : (d > 0 ? goodDir > 0 : goodDir < 0);
    var color = good === null ? 'var(--text-muted)' : (good ? 'var(--ok)' : 'var(--bad)');
    var arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '—');
    return '<span class="mono" style="color:' + color + ';font-weight:600">' + arrow + ' ' + pctStr + '</span>';
  }

  /* ---------------- ③ 人事数据（联动自动填充） ---------------- */
  function getHRData() {
    return App.store.get('hr') || { weekly: {}, baseHeadcount: null, baseDate: null, linked: null };
  }

  function fmtHRNum(v) {
    if (v == null) return '-';
    if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
    return (Math.round(v * 10) / 10).toLocaleString('zh-CN');
  }
  // 千分位取整再除10，规避二进制浮点漂移（如 0.1379*100 漂移）
  function fmtHRpct(v) {
    if (v == null) return '-';
    var p = Math.round(v * 1000) / 10;
    return p.toFixed(1) + '%';
  }
  function hrTone(v, threshold, mode) {
    if (v == null || threshold == null) return '';
    var ok = mode === 'lte' ? (v <= threshold) : (v >= threshold);
    return ok ? 'ok' : 'bad';
  }

  function hrCard(title, value, unit, tone) {
    var valStyle = '';
    if (tone === 'ok') valStyle = 'color:var(--ok)';
    else if (tone === 'bad') valStyle = 'color:var(--bad)';
    else if (tone === 'hire') valStyle = 'color:var(--ok)';
    else if (tone === 'leave') valStyle = 'color:var(--bad)';
    return '<div class="hr-summary-card"><div class="hr-summary-title">' + title + '</div>' +
      '<div class="hr-summary-body"><div class="hr-stat"><div class="hr-stat-label">' + unit + '</div>' +
      '<div class="hr-stat-value" style="' + valStyle + '">' + value + '</div></div></div></div>';
  }

  function renderHR() {
    var hr = getHRData();
    var L = hr.linked;
    var html = '';

    if (!L || !L.generatedAt) {
      html += '<div class="empty-state" style="padding:50px"><h4>暂无人事数据</h4>' +
        '<p>人事数据已改为<b>自动从联动数据提取</b>（来源：数据分析工作台·周报）。请确认：' +
        '① 已在数据分析工作台录入周报并「推送分析到个人台」；② 本工作台已登录同一账号并保持同步。' +
        '数据将在同步后自动填充，无需手动录入。</p>' +
        '<button class="btn btn-primary btn-sm" onclick="App.router.navigate(\'/data/linked\')">前往联动数据</button></div>';
      return html;
    }

    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">';
    html += '<span class="tag tag-ok" style="font-size:12px">🔗 自动联动</span>';
    html += '<span style="font-size:12px;color:var(--text-muted)">数据来源：数据分析工作台·周报 · 快照月份 ' + (L.month || '-') + ' · 更新于 ' + new Date(L.generatedAt).toLocaleString() + '</span>';
    html += '</div>';

    // 人力结构
    html += '<div class="hr-summary-grid">';
    html += hrCard('👥 教师数', fmtHRNum(L.teacherCount), '人', '');
    html += hrCard('⭐ 骨干教师数', fmtHRNum(L.coreTeacherCount), '人', '');
    html += hrCard('🔷 双三老师人数', fmtHRNum(L.doubleThreeCount), '人', '');
    html += hrCard('📐 双三老师占比', fmtHRpct(L.doubleThreeRatio), '', hrTone(L.doubleThreeRatio, 0.5, 'gte'));
    html += hrCard('🏫 校区总人数', fmtHRNum(L.campusTotal), '人', '');
    html += '</div>';

    // 入离职
    html += '<div class="hr-summary-grid" style="margin-top:16px">';
    html += hrCard('➕ 本月入职人数', fmtHRNum(L.entryMonth), '人', 'hire');
    html += hrCard('➖ 本月离职人数', fmtHRNum(L.quitMonth), '人', 'leave');
    html += hrCard('📉 月离职人数率', fmtHRpct(L.quitMonthRate), '', hrTone(L.quitMonthRate, 0.03, 'lte'));
    html += hrCard('📅 周入职人数', fmtHRNum(L.entryWeek), '人', '');
    html += hrCard('📅 周离职人数', fmtHRNum(L.quitWeek), '人', '');
    html += hrCard('🔁 周离职人数率', fmtHRpct(L.quitWeekRate), '', hrTone(L.quitWeekRate, 0.03, 'lte'));
    html += '</div>';

    // 说明
    html += '<div class="card" style="margin-top:18px"><div class="card-header"><h3 class="card-title">说明</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);line-height:1.7">' +
      '· 以上人事指标由<b>联动数据</b>自动提取自「数据分析工作台·周报」，口径与校区统计表一致，无需手动录入。<br>' +
      '· 离职率 / 双三占比等红绿色彩按基准值自动判定（达标绿、偏离红）。<br>' +
      '· 数据随每次同步（登录 / 推送）自动刷新，月份以校区周报快照月份为准；如需查看完整原始字段，请前往「联动数据」标签。</p></div>';

    return html;
  }

  /* ---------------- 交互绑定 ---------------- */
  function bindBaseline() {
    var sel = document.getElementById('baseline-month');
    if (sel) sel.addEventListener('change', function() {
      var body = document.getElementById('baseline-body');
      if (body) body.innerHTML = renderBaselineBody(sel.value);
    });
    var body = document.getElementById('baseline-body');
    if (body) body.innerHTML = renderBaselineBody(sel ? sel.value : null);
  }

  function bindTrend() {
    var sel = document.getElementById('trend-metric');
    if (sel) sel.addEventListener('change', function() {
      var body = document.getElementById('trend-body');
      var meta = App.importer.metric(sel.value);
      var note = document.getElementById('trend-baseline-note');
      if (note && meta && meta.baseline) {
        var bv = meta.baseline.value;
        note.textContent = '基准 ' + (Array.isArray(bv) ? (bv[0] * 100).toFixed(0) + '~' + (bv[1] * 100).toFixed(0) + '%' : fmtMetric(sel.value, bv));
      } else if (note) note.textContent = '（暂无基准值，仅展示趋势）';
      if (body) body.innerHTML = renderTrendBody(sel.value);
    });
    var body = document.getElementById('trend-body');
    if (body && sel) {
      var meta = App.importer.metric(sel.value);
      var note = document.getElementById('trend-baseline-note');
      if (note && meta && meta.baseline) {
        var bv = meta.baseline.value;
        note.textContent = '基准 ' + (Array.isArray(bv) ? (bv[0] * 100).toFixed(0) + '~' + (bv[1] * 100).toFixed(0) + '%' : fmtMetric(sel.value, bv));
      } else if (note) note.textContent = '（暂无基准值，仅展示趋势）';
      body.innerHTML = renderTrendBody(sel.value);
    }
  }

  App.views = App.views || {};
  App.views.data = {};

  // 联动快照回填后，若当前正停留在数据看板的某个标签，自动刷新以显示最新数据
  window.addEventListener('dos:linked-store-updated', function () {
    if (location.hash && location.hash.indexOf('data') !== -1) {
      if (App.router && App.router.resolve) {
        try { App.router.resolve(); } catch (e) {}
      }
    }
  });

})();
