/* ============================================
   data.js — 数据看板 v2
   标签页：① 导入/录入  ② 基准值对标  ③ 环比·同比趋势  ④ 人事数据
   ============================================ */

(function() {

  var TYPE_META = {
    dos:         { name: 'DOS 周报', icon: 'bar-chart-2', desc: '提取「数据统计表」关键指标：完成率、饱和度、单位周均、续费/推荐率等' },
    satisfaction:{ name: '五项满意度', icon: 'star', desc: '按班主任汇总，提取结课/退费/停课/续费/推荐 人数率+单科率，直接对标基准值' },
    yoy:         { name: '同比环比报表', icon: 'trending-up', desc: '提取「总表」多月数据+同比列，自动生成环比/同比趋势' }
  };

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
    App.router.navigate('/data/import');
  });
  App.router.register('/data/:tab', function(params) {
    var container = document.getElementById('view-container');
    if (!container) return;
    var tab = (params && params.tab) || 'import';
    if (['import', 'baseline', 'trend', 'hr'].indexOf(tab) < 0) tab = 'import';

    var html = '';
    html += '<div class="page-head"><h1 class="page-title">数据看板</h1>';
    html += '<p class="page-sub">报表一键导入 · 基准值对标红绿灯 · 环比/同比趋势 · 人事数据</p></div>';

    // Tabs
    html += '<div class="tabs" style="margin-bottom:18px">';
    html += tabBtn('import', '📥 导入 / 录入', tab);
    html += tabBtn('baseline', '🎯 基准值对标', tab);
    html += tabBtn('trend', '📈 环比 · 同比趋势', tab);
    html += tabBtn('hr', '👥 人事数据', tab);
    html += '</div>';

    if (tab === 'import') html += renderImport();
    else if (tab === 'baseline') html += renderBaseline();
    else if (tab === 'trend') html += renderTrend();
    else html += renderHR();

    container.innerHTML = html;
    bindImport();
    if (tab === 'baseline') bindBaseline();
    if (tab === 'trend') bindTrend();
    if (tab === 'hr') bindHR();
  });

  function tabBtn(id, label, active) {
    return '<button class="tab ' + (active === id ? 'active' : '') + '" onclick="App.router.navigate(\'/data/' + id + '\')">' + label + '</button>';
  }

  /* ---------------- ① 导入 / 录入 ---------------- */
  function renderImport() {
    var reports = App.store.get('reports') || { monthly: {}, imports: [] };
    var html = '';

    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('upload', 18) + '一键导入报表（自动提取数据）</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">选择对应报表文件，系统将自动解析 Excel 并提取指标，写入「基准值对标」与「环比/同比趋势」。支持 .xlsx / .xls。</p>';
    html += '<div class="import-grid">';
    Object.keys(TYPE_META).forEach(function(t) {
      var m = TYPE_META[t];
      html += '<div class="import-card" onclick="App.views.data.startImport(\'' + t + '\')">';
      html += '<div class="import-card-icon">' + App.util.svgIcon(m.icon, 22) + '</div>';
      html += '<div class="import-card-name">' + m.name + '</div>';
      html += '<div class="import-card-desc">' + m.desc + '</div>';
      html += '<div class="import-card-btn">选择文件导入</div>';
      html += '</div>';
    });
    html += '</div></div>';

    // 手动补录
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('edit', 18) + '手动补录本月关键指标</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">没有 Excel 时，可直接录入当前月份的关键指标，用于基准值对标。</p>';
    var curMonth = App.util.formatDate(new Date(), 'YYYY-MM');
    html += '<div class="form-row">';
    html += fld('月生产完成率', 'm_production', '0.95');
    html += fld('月饱和度', 'm_saturation', '0.78');
    html += '</div><div class="form-row">';
    html += fld('续费单科率', 'm_renewal', '0.12');
    html += fld('退费单科率', 'm_refund', '0.02');
    html += '</div><div class="form-row">';
    html += fld('停课人数率', 'm_suspend', '0.06');
    html += fld('推荐人数率', 'm_recommend', '0.08');
    html += '</div>';
    html += '<button class="btn btn-primary" onclick="App.views.data.manualSubmit()">保存到 ' + curMonth + '</button>';
    html += '<div id="manual-result"></div></div>';

    // 导入日志
    var imports = (reports.imports || []);
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('clock', 18) + '导入记录</h3></div>';
    if (!imports.length) {
      html += '<div class="empty-state" style="padding:24px"><p>暂无导入记录，导入报表后将显示在此</p></div>';
    } else {
      html += '<table class="data-table"><thead><tr><th>时间</th><th>类型</th><th>月份</th><th>文件</th></tr></thead><tbody>';
      imports.slice(0, 12).forEach(function(im) {
        var tn = (TYPE_META[im.type] && TYPE_META[im.type].name) || im.type;
        html += '<tr><td class="mono" style="font-size:12px">' + App.util.formatDate(new Date(im.date), 'MM-DD HH:mm') + '</td>';
        html += '<td>' + tn + '</td><td class="mono" style="font-size:12px">' + (im.months || []).join('、') + '</td>';
        html += '<td style="font-size:12px;color:var(--text-muted)">' + App.util.truncate(im.fileName || '', 24) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  function fld(label, id, ph) {
    return '<div class="form-group"><label class="form-label">' + label + '</label><input class="form-input" id="' + id + '" type="number" step="0.001" placeholder="' + ph + '"></div>';
  }

  /* ---------------- ② 基准值对标 ---------------- */
  function renderBaseline() {
    var reports = App.store.get('reports') || { monthly: {} };
    var months = Object.keys(reports.monthly || {}).sort();
    var html = '';

    if (!months.length) {
      html += '<div class="empty-state" style="padding:50px"><h4>暂无数据</h4><p>请先在「导入 / 录入」中导入报表或手动补录，才能进行基准值对标。</p><button class="btn btn-primary btn-sm" onclick="App.router.navigate(\'/data/import\')">去导入</button></div>';
      return html;
    }

    var sel = months[months.length - 1];
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">';
    html += '<label class="form-label" style="margin:0">对标月份</label>';
    html += '<select id="baseline-month" class="form-input" style="width:auto;min-width:160px">';
    months.forEach(function(mk) {
      html += '<option value="' + mk + '"' + (mk === sel ? ' selected' : '') + '>' + reports.monthly[mk].label + '（' + mk + '）</option>';
    });
    html += '</select></div>';

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

    var counts = { ok: 0, warn: 0, bad: 0 };
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
        counts[lvl || 'neutral']++;
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

    // 五项满意度明细（若有）
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

  /* ---------------- ③ 环比 · 同比趋势 ---------------- */
  function renderTrend() {
    var reports = App.store.get('reports') || { monthly: {} };
    var months = Object.keys(reports.monthly || {}).sort();
    var html = '';

    if (months.length < 1) {
      html += '<div class="empty-state" style="padding:50px"><h4>暂无数据</h4><p>导入「同比环比报表」或「DOS周报」后，这里会展示指标的趋势与环比/同比。</p><button class="btn btn-primary btn-sm" onclick="App.router.navigate(\'/data/import\')">去导入</button></div>';
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
    body += '<p style="font-size:11px;color:var(--text-faint);margin-top:10px">环比 = 与上一月比较；同比 = 与去年同期（或报表「同比」列）比较。绿色表示该指标朝「达标」方向变动，红色为偏离。</p>';
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

  /* ---------------- 交互绑定 ---------------- */
  var pendingType = null;
  function ensureFileInput() {
    var inp = document.getElementById('report-file-input');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.id = 'report-file-input';
      inp.accept = '.xlsx,.xls';
      inp.style.display = 'none';
      inp.addEventListener('change', function(e) {
        var f = e.target.files && e.target.files[0];
        if (f) handleFile(f);
        inp.value = '';
      });
      document.body.appendChild(inp);
    }
    return inp;
  }

  function bindImport() {
    // 无额外绑定（卡片用 onclick 触发 startImport）
  }

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

  function startImport(type) {
    pendingType = type;
    var inp = ensureFileInput();
    inp.click();
  }

  function handleFile(file) {
    if (!pendingType) return;
    App.util.toast('正在解析「' + (TYPE_META[pendingType] ? TYPE_META[pendingType].name : '') + '」…', 'ok');
    App.importer.parse(file, pendingType, function(err, result) {
      if (err) { App.util.toast('解析失败：' + err.message, 'bad'); return; }
      showPreview(result, file.name);
    });
  }

  function showPreview(result, fileName) {
    var html = '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">共提取 <strong>' + result.snapshots.length + '</strong> 个月度数据，确认后写入看板：</div>';
    html += '<div style="max-height:46vh;overflow:auto">';
    result.snapshots.forEach(function(s) {
      html += '<div style="padding:10px 12px;background:var(--surface-2);border-radius:var(--radius-sm);margin-bottom:8px">';
      html += '<div style="font-weight:600;font-size:13px;margin-bottom:6px">' + s.label + ' <span class="tag tag-neutral" style="font-size:10px">' + s.type + '</span></div>';
      if (s.metrics) {
        var keys = Object.keys(s.metrics).filter(function(k) { return App.importer.metric(k); });
        if (keys.length) {
          html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
          keys.forEach(function(k) {
            html += '<span class="tag tag-accent" style="font-size:11px">' + App.importer.metric(k).label + '：' + fmtMetric(k, s.metrics[k]) + '</span>';
          });
          html += '</div>';
        }
      }
      if (s.satisfaction && s.satisfaction.totals) {
        var t = s.satisfaction.totals;
        html += '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">班主任 ' + (s.satisfaction.byHead ? s.satisfaction.byHead.length : 0) + ' 人 · 在读 ' + (t.reading != null ? t.reading : '-') + ' · 续费单科率 ' + fmtMetric('renewalRateSubjectMonth', t.rates && t.rates.renewalRateSubjectMonth) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    App.util.modal({
      title: '确认导入数据',
      content: html,
      confirmText: '确认导入',
      onConfirm: function(close) {
        var saved = App.importer.commit(result, fileName);
        close();
        App.util.toast('已导入 ' + saved.length + ' 个月度数据', 'ok');
        App.router.resolve();
      }
    });
  }

  function manualSubmit() {
    var curMonth = App.util.formatDate(new Date(), 'YYYY-MM');
    var map = {
      productionRateMonth: 'm_production',
      saturationMonth: 'm_saturation',
      renewalRateSubjectMonth: 'm_renewal',
      refundRateSubjectMonth: 'm_refund',
      suspendRatePersonMonth: 'm_suspend',
      recommendRatePersonMonth: 'm_recommend'
    };
    var metrics = {};
    var any = false;
    Object.keys(map).forEach(function(k) {
      var v = parseFloat(document.getElementById(map[k]).value);
      if (!isNaN(v)) { metrics[k] = v; any = true; }
    });
    if (!any) { App.util.toast('请至少填写一项', 'warn'); return; }
    var reports = App.store.get('reports') || { monthly: {}, imports: [] };
    if (!reports.monthly) reports.monthly = {};
    var snap = reports.monthly[curMonth] || { month: curMonth, label: curMonth.slice(0, 4) + '年' + parseInt(curMonth.slice(5), 10) + '月' };
    snap.metrics = Object.assign(snap.metrics || {}, metrics);
    snap.importedAt = new Date().toISOString();
    reports.monthly[curMonth] = snap;
    App.store.set('reports', reports);
    document.getElementById('manual-result').innerHTML = '<div style="margin-top:10px;padding:10px;background:var(--surface-2);border-radius:var(--radius-sm);font-size:13px;color:var(--ok)">✓ 已保存到 ' + curMonth + '，可在「基准值对标」查看红绿灯。</div>';
    App.util.toast('已保存', 'ok');
  }

  /* ---------------- ④ 人事数据（教学部入离职） ---------------- */
  function getHRData() {
    return App.store.get('hr') || { weekly: {}, baseHeadcount: null, baseDate: null };
  }

  function getISOWeek(d) {
    // 返回 { year, week, month, key: 'YYYY-Www', label: 'YYYY年第Ww周' }
    var date = new Date(d.valueOf());
    date.setHours(0, 0, 0, 0);
    // Thursday determines the year
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    var jan4 = new Date(date.getFullYear(), 0, 4);
    var week = 1 + Math.round(((date.getTime() - jan4.getTime()) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
    var year = date.getFullYear();
    var month = new Date(d).getMonth() + 1;
    return {
      year: year,
      week: week,
      month: month,
      key: year + '-W' + String(week).padStart(2, '0'),
      label: year + '年第' + week + '周',
      monthKey: year + '-' + String(month).padStart(2, '0')
    };
  }

  function generateWeekOptions() {
    var now = new Date();
    var options = '';
    // 生成本年+去年共约60周的选项
    for (var offset = 0; offset < 60; offset++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset * 7);
      var w = getISOWeek(d);
      options += '<option value="' + w.key + '">' + w.label + ' (' + w.monthKey.slice(5) + '月)</option>';
    }
    return options;
  }

  function renderHR() {
    var hr = getHRData();
    var weeks = Object.keys(hr.weekly || {}).sort().reverse();
    var html = '';

    // ---- 汇总卡片 ----
    html += '<div class="hr-summary-grid">';

    // 本月汇总
    var monthSum = calcPeriodSummary('month');
    html += hrSummaryCard('📅 本月汇总', monthSum, 'month');

    // 本季度汇总
    var quarterSum = calcPeriodSummary('quarter');
    html += hrSummaryCard('📊 本季度汇总', quarterSum, 'quarter');

    // 本年度汇总
    var yearSum = calcPeriodSummary('year');
    html += hrSummaryCard('🏆 本年度汇总', yearSum, 'year');

    html += '</div>';

    // ---- 周度录入表单 ----
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('edit', 18) + '周度入离职录入</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">选择统计周，录入该周教学部入职人数与离职人数。系统将自动汇总为月度/季度/年度数据。</p>';

    // 期初在职人数设置
    html += '<div style="background:var(--surface-2);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
    html += '<span style="font-size:12px;font-weight:600;color:var(--text-secondary)">期初在职人数</span>';
    html += '<input type="number" id="hr-base-headcount" class="form-input" style="width:100px" min="0" placeholder="如 25" value="' + (hr.baseHeadcount != null ? hr.baseHeadcount : '') + '">';
    html += '<span style="font-size:11px;color:var(--text-faint)">（用于计算离职率分母）</span>';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.data.saveBaseHeadcount()">保存</button>';
    if (hr.baseHeadcount != null) {
      html += '<span class="tag tag-ok" style="margin-left:auto">当前：' + hr.baseHeadcount + ' 人</span>';
    }
    html += '</div>';

    // 周度录入
    var nowWeek = getISOWeek(new Date());
    html += '<div class="form-row">';
    html += '<div class="form-group"><label class="form-label">统计周期</label>';
    html += '<select id="hr-week-select" class="form-input">' + generateWeekOptions() + '</select></div>';
    html += '</div><div class="form-row">';
    html += fld('入职人数', 'hr-hire', '0');
    html += fld('离职人数', 'hr-leave', '0');
    html += '</div><div class="form-group">';
    html += '<label class="form-label">备注（可选）</label>';
    html += '<input class="form-input" id="hr-note" type="text" placeholder="如：张三离职、李四入职等"></div>';
    html += '<div style="display:flex;gap:8px;margin-top:4px">';
    html += '<button class="btn btn-primary" onclick="App.views.data.submitHRWeek()">保存周记录</button>';
    html += '<span id="hr-submit-result"></span>';
    html += '</div></div>';

    // ---- 历史记录表格 ----
    html += '<div class="card"><div class="card-header" style="display:flex;align-items:center;justify-content:space-between">';
    html += '<h3 class="card-title">' + App.util.svgIcon('clock', 18) + '历史周记录</h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">共 ' + weeks.length + ' 条记录</span></div>';

    if (!weeks.length) {
      html += '<div class="empty-state" style="padding:40px"><p>暂无周度入离职记录，录入后将在此显示并自动汇总。</p></div>';
    } else {
      html += '<table class="data-table"><thead><tr><th>统计周</th><th>月份</th><th>入职人数</th><th>离职人数</th><th>备注</th><th>操作</th></tr></thead><tbody>';
      weeks.forEach(function(wk) {
        var rec = hr.weekly[wk];
        if (!rec) return;
        html += '<tr><td class="mono" style="font-size:12px;font-weight:600">' + rec.weekLabel + '</td>';
        html += '<td class="mono" style="font-size:12px">' + rec.monthKey + '</td>';
        html += '<td class="mono" style="color:var(--ok);font-weight:600">+' + (rec.hireCount || 0) + '</td>';
        html += '<td class="mono" style="color:var(--bad);font-weight:600">-' + (rec.leaveCount || 0) + '</td>';
        html += '<td style="font-size:12px;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (rec.note || '-') + '</td>';
        html += '<td><button class="btn btn-ghost btn-sm" onclick="App.views.data.deleteHRWeek(\'' + wk + '\')" style="color:var(--bad)">删除</button></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // ---- 月度汇总明细 ----
    if (weeks.length > 0) {
      html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('bar-chart-2', 18) + '月度自动汇总明细</h3></div>';
      var monthGroups = groupByMonth(hr.weekly);
      var monthKeys = Object.keys(monthGroups).sort().reverse();
      html += '<table class="data-table"><thead><tr><th>月份</th><th>入职总人数</th><th>离职总人数</th><th>月度离职率</th><th>周记录数</th></tr></thead><tbody>';
      monthKeys.forEach(function(mk) {
        var g = monthGroups[mk];
        var rate = calcMonthlyRate(mk, g.totalLeave);
        html += '<tr><td class="mono" style="font-size:12px;font-weight:600">' + mk + '</td>';
        html += '<td class="mono" style="color:var(--ok);font-weight:600">+' + g.totalHire + '</td>';
        html += '<td class="mono" style="color:var(--bad);font-weight:600">-' + g.totalLeave + '</td>';
        html += '<td class="mono" style="font-weight:600">' + (rate != null ? (rate * 100).toFixed(2) + '%' : '<span style="color:var(--text-faint)">需设期初人数</span>') + '</td>';
        html += '<td class="mono" style="font-size:12px;color:var(--text-muted)">' + g.count + ' 周</td></tr>';
      });
      html += '</tbody></table>';
      html += '<p style="font-size:11px;color:var(--text-faint);margin-top:10px">月度离职率 = 当月离职总人数 ÷ （月底在职人数 + 当月离职总人数）。季度/年度离职率为各月度离职率之和。</p>';
      html += '</div>';
    }

    return html;
  }

  function hrSummaryCard(title, data, period) {
    var rateHtml = data.rate != null
      ? '<div class="hr-rate ' + (data.rate <= 0.03 ? 'rate-ok' : data.rate <= 0.05 ? 'rate-warn' : 'rate-bad') + '">' + (data.rate * 100).toFixed(2) + '%</div>'
      : '<div class="hr-rate rate-na">—</div>';
    var periodLabel = period === 'month' ? '月度' : period === 'quarter' ? '季度' : '年度';
    return '<div class="hr-summary-card"><div class="hr-summary-title">' + title + '</div>' +
      '<div class="hr-summary-body">' +
        '<div class="hr-stat"><div class="hr-stat-label">入职总人数</div><div class="hr-stat-value hire">+' + data.totalHire + '</div></div>' +
        '<div class="hr-stat"><div class="hr-stat-label">离职总人数</div><div class="hr-stat-value leave">-' + data.totalLeave + '</div></div>' +
        '<div class="hr-stat"><div class="hr-stat-label">' + periodLabel + '离职率</div>' + rateHtml + '</div>' +
      '</div></div>';
  }

  function calcPeriodSummary(period) {
    var hr = getHRData();
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var quarter = Math.ceil(month / 3);

    var totalHire = 0, totalLeave = 0, totalRate = 0;

    Object.keys(hr.weekly || {}).forEach(function(wk) {
      var rec = hr.weekly[wk];
      if (!rec) return;
      var include = false;
      if (period === 'month') { include = parseInt(rec.monthKey.slice(5), 10) === month && parseInt(rec.monthKey.slice(0, 4), 10) === year; }
      else if (period === 'quarter') {
        var q = Math.ceil(parseInt(rec.monthKey.slice(5), 10) / 3);
        include = q === quarter && parseInt(rec.monthKey.slice(0, 4), 10) === year;
      }
      else { include = parseInt(rec.monthKey.slice(0, 4), 10) === year; }
      if (include) {
        totalHire += (rec.hireCount || 0);
        totalLeave += (rec.leaveCount || 0);
      }
    });

    // 离职率计算
    if (period === 'month') {
      var curMonthKey = year + '-' + String(month).padStart(2, '0');
      totalRate = calcMonthlyRate(curMonthKey, totalLeave);
    } else {
      // 季度/年度：累加各月离职率
      var monthGroups = groupByMonth(hr.weekly);
      var targetMonths = [];
      if (period === 'quarter') {
        for (var m = (quarter - 1) * 3 + 1; m <= quarter * 3; m++) targetMonths.push(year + '-' + String(m).padStart(2, '0'));
      } else {
        for (var ym = 1; ym <= 12; ym++) targetMonths.push(year + '-' + String(ym).padStart(2, '0'));
      }
      targetMonths.forEach(function(mk) {
        if (monthGroups[mk]) totalRate += (calcMonthlyRate(mk, monthGroups[mk].totalLeave) || 0);
      });
    }

    return { totalHire: totalHire, totalLeave: totalLeave, rate: totalRate };
  }

  // 月底在职人数 = 期初在职人数 + 截至该月底所有周度净变动（入职-离职）的累计
  function calcEndingHeadcount(monthKey) {
    var hr = getHRData();
    if (hr.baseHeadcount == null) return null;
    var base = hr.baseHeadcount;
    Object.keys(hr.weekly || {}).forEach(function(wk) {
      var rec = hr.weekly[wk];
      if (!rec) return;
      if (rec.monthKey <= monthKey) base += (rec.hireCount || 0) - (rec.leaveCount || 0);
    });
    return base;
  }

  // 月度离职率 = 当月离职总人数 ÷ (月底在职人数 + 当月离职总人数)
  function calcMonthlyRate(monthKey, leaveCount) {
    var hr = getHRData();
    if (hr.baseHeadcount == null) return null;
    var ending = calcEndingHeadcount(monthKey);
    if (ending == null) return null;
    var denom = ending + leaveCount;
    if (denom <= 0) return null;
    return leaveCount / denom;
  }

  function groupByMonth(weekly) {
    var groups = {};
    Object.keys(weekly || {}).forEach(function(wk) {
      var rec = weekly[wk];
      if (!rec) return;
      var mk = rec.monthKey;
      if (!groups[mk]) groups[mk] = { totalHire: 0, totalLeave: 0, count: 0 };
      groups[mk].totalHire += (rec.hireCount || 0);
      groups[mk].totalLeave += (rec.leaveCount || 0);
      groups[mk].count++;
    });
    return groups;
  }

  function bindHR() {
    // 周选择器默认选中最新一周
    var sel = document.getElementById('hr-week-select');
    if (sel) {
      var nowWeek = getISOWeek(new Date());
      // 尝试匹配
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === nowWeek.key) { sel.selectedIndex = i; break; }
      }
    }
  }

  function submitHRWeek() {
    var sel = document.getElementById('hr-week-select');
    var hireInput = document.getElementById('hr-hire');
    var leaveInput = document.getElementById('hr-leave');
    var noteInput = document.getElementById('hr-note');

    if (!sel || !hireInput || !leaveInput) return;

    var weekKey = sel.value;
    var hire = parseInt(hireInput.value, 10);
    var leave = parseInt(leaveInput.value, 10);

    if (isNaN(hire) || isNaN(leave)) { App.util.toast('请输入有效数字', 'warn'); return; }
    if (hire < 0 || leave < 0) { App.util.toast('人数不能为负数', 'warn'); return; }

    // 解析 weekKey -> year, week, month
    var parts = weekKey.match(/(\d{4})-W(\d{2})/);
    if (!parts) return;
    var wy = parseInt(parts[1], 10);
    var ww = parseInt(parts[2], 10);
    // 根据 year + week 推算大致月份
    var jan4 = new Date(wy, 0, 4);
    var firstDay = jan4.getDay() || 7; // Monday=1 ... Sunday=7
    var firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - (firstDay - 1));
    var weekDate = new Date(firstMonday);
    weekDate.setDate(firstMonday.getDate() + (ww - 1) * 7);
    var monthVal = weekDate.getMonth() + 1;
    var monthKey = wy + '-' + String(monthVal).padStart(2, '0');

    var wInfo = getISOWeek(weekDate);
    var hr = getHRData();
    if (!hr.weekly) hr.weekly = {};

    hr.weekly[weekKey] = {
      weekLabel: wInfo.label,
      year: wy,
      month: monthVal,
      monthKey: monthKey,
      hireCount: hire,
      leaveCount: leave,
      note: noteInput ? noteInput.value.trim() : '',
      createdAt: new Date().toISOString()
    };

    App.store.set('hr', hr);

    // 清空输入
    hireInput.value = '';
    leaveInput.value = '';
    if (noteInput) noteInput.value = '';

    var resEl = document.getElementById('hr-submit-result');
    if (resEl) resEl.innerHTML = '<span style="color:var(--ok);font-size:12px;font-weight:500;margin-left:8px">✓ 已保存 ' + wInfo.label + '（入职+' + hire + ' 离职-' + leave + '）</span>';

    App.util.toast('已保存 ' + wInfo.label, 'ok');
    setTimeout(function() { App.router.resolve(); }, 300);
  }

  function saveBaseHeadcount() {
    var input = document.getElementById('hr-base-headcount');
    if (!input) return;
    var val = parseInt(input.value, 10);
    if (isNaN(val) || val < 0) { App.util.toast('请输入有效的期初在职人数', 'warn'); return; }
    var hr = getHRData();
    hr.baseHeadcount = val;
    hr.baseDate = new Date().toISOString();
    App.store.set('hr', hr);
    App.util.toast('已设置期初在职人数：' + val + ' 人', 'ok');
    setTimeout(function() { App.router.resolve(); }, 300);
  }

  function deleteHRWeek(weekKey) {
    var hr = getHRData();
    if (hr.weekly && hr.weekly[weekKey]) {
      var label = hr.weekly[weekKey].weekLabel || weekKey;
      App.util.modal({
        title: '确认删除',
        content: '确定删除「' + label + '」的入离职记录？此操作不可撤销。',
        confirmText: '删除',
        confirmClass: 'btn-danger',
        onConfirm: function(close) {
          delete hr.weekly[weekKey];
          App.store.set('hr', hr);
          close();
          App.util.toast('已删除 ' + label, 'ok');
          setTimeout(function() { App.router.resolve(); }, 300);
        }
      });
    }
  }
  App.views = App.views || {};
  App.views.data = {
    startImport: startImport,
    manualSubmit: manualSubmit,
    submitHRWeek: submitHRWeek,
    saveBaseHeadcount: saveBaseHeadcount,
    deleteHRWeek: deleteHRWeek
  };

})();
