/* ============================================
   linked-data.js — 联动数据看板（仅个人工作台）
   自动提取数据分析工作台通过 shared_link 推送的 analytics_snapshot，
   把「DOS周报·数据统计表」同源数据按类别动态布局展示，并与本看板指标对齐。
   约束：数据分析工作台内容不变，本文件只改动个人工作台数据看板。
   ============================================ */

(function () {
  var App = window.App || (window.App = {});
  App.views = App.views || {};

  /* ---------- 跨系统字段映射：campus-analytics weeklyFields.key -> DOS metricId ---------- */
  // 仅列出 DOS 已定义基准/指标口径的字段；其余字段以「校区原始口径」展示。
  var CAMPUS_TO_DOS = {
    v1WeekRate: 'productionRateWeek',
    v1MonthRate: 'productionRateMonth',
    weekSaturation: 'saturationWeek',
    monthSaturation: 'saturationMonth',
    v1WeekUnitAvg: 'unitWeekAvg',
    v1MonthUnitAvg: 'unitMonthAvg',
    v1Students: 'reading1v1',
    v1Subjects: 'reading1v1Subject',
    subjectRatio: 'singleSubjectRatio',
    xfMonthNumRate: 'renewalRatePersonMonth',
    xfMonthSubjRate: 'renewalRateSubjectMonth',
    tjMonthNumRate: 'recommendRatePersonMonth',
    tfMonthSubjRate: 'refundRateSubjectMonth',
    tkNumRate: 'suspendRatePersonMonth',
    jkMonthNumRate: 'finishRatePersonMonth',
    jkMonthSubjRate: 'finishRateSubjectMonth',
    teacherCount: 'teacherCount',
    campusTotal: 'campusTotal',
  };

  // 仅用于「基准值对标 / 趋势」对标当月数据的口径：排除周度字段，避免把周率混入月度对标。
  // （campus 快照通常只有 weekly 记录，其 values 同时携带「周字段」与「月累计字段」，故需剔除周字段）
  var WEEK_ONLY_CAMPUS_KEYS = { v1WeekRate: 1, weekSaturation: 1, v1WeekUnitAvg: 1 };

  // 顶部「核心指标」大卡：取自与本看板基准值对标一致的口径（src=campus键, label/unit=展示）
  var FEATURES = [
    { src: 'v1MonthRate', label: '1V1月生产完成率', unit: '%' },
    { src: 'monthSaturation', label: '月饱和度', unit: '%' },
    { src: 'xfMonthSubjRate', label: '1V1月续费单科率', unit: '%' },
    { src: 'tfMonthSubjRate', label: '1V1月退费单科率', unit: '%' },
    { src: 'jkMonthNumRate', label: '1V1月结课人数率', unit: '%' },
    { src: 'v1Students', label: '1V1在读学员', unit: '人' },
    { src: 'teacherCount', label: '教师数', unit: '人' }
  ];

  // 分组展示（依校区数据统计表原始章节）：k=campus键, label=展示名, unit=原始单位（兜底格式化）
  var GROUPS = [
    {
      title: '学员概况', items: [
        { k: 'v1Students', label: '1V1在读学员', unit: '人' },
        { k: 'v1Subjects', label: '1V1在读单科', unit: '科' },
        { k: 'v6Students', label: '1V6在读学员数', unit: '人' },
        { k: 'v6Subjects', label: '1V6在读单科', unit: '科' },
        { k: 'subjectRatio', label: '单科比', unit: '' },
        { k: 'campusTotal', label: '校区总人数', unit: '人' },
        { k: 'teacherCount', label: '教师数', unit: '人' },
        { k: 'coreTeacherCount', label: '骨干教师人数', unit: '人' },
        { k: 'doubleThreeCount', label: '双三老师人数', unit: '人' }
      ]
    },
    {
      title: '课时生产', items: [
        { k: 'v1WeekTarget', label: '1V1周目标课时', unit: '课时' },
        { k: 'v1WeekProduced', label: '1V1周生产课时', unit: '课时' },
        { k: 'v1MonthTarget', label: '1V1月目标课时', unit: '课时' },
        { k: 'v1MonthProduced', label: '1V1月生产课时', unit: '课时' },
        { k: 'v6MonthProduced', label: '1V6月生产课时', unit: '课时' },
        { k: 'v1WeekRate', label: '1V1周生产完成率', unit: '%' },
        { k: 'v1MonthRate', label: '1V1月生产完成率', unit: '%' },
        { k: 'schoolWeekAvg', label: '校周均课时', unit: '课时' },
        { k: 'v1WeekUnitAvg', label: '1V1周单位周平均', unit: '' },
        { k: 'v1MonthUnitAvg', label: '1V1月单位周平均', unit: '' },
        { k: 'weekSaturation', label: '周饱和度', unit: '%' },
        { k: 'monthSaturation', label: '月饱和度', unit: '%' }
      ]
    },
    {
      title: '现金与效能', items: [
        { k: 'v1WeekCash', label: '1V1周课时生产现金', unit: '元' },
        { k: 'v1MonthCash', label: '1V1月课时生产现金', unit: '元' },
        { k: 'v6MonthCash', label: '1V6月课时生产现金', unit: '元' },
        { k: 'monthCashTotal', label: '月课时生产总现金', unit: '元' },
        { k: 'v1WeekCashAvg', label: '1V1周课时生产现金均价', unit: '元' },
        { k: 'v1MonthCashAvg', label: '1V1月课时生产现金均价', unit: '元' },
        { k: 'weekEff', label: '周人均效能值', unit: '元' },
        { k: 'monthEff', label: '月人均效能值', unit: '元' }
      ]
    },
    {
      title: '续费 · 推荐', items: [
        { k: 'xfWeekNum', label: '1V1周续费人数', unit: '人' },
        { k: 'xfMonthNum', label: '1V1月续费人数', unit: '人' },
        { k: 'xfWeekNumRate', label: '1V1周续费人数率', unit: '%' },
        { k: 'xfMonthNumRate', label: '1V1月续费人数率', unit: '%' },
        { k: 'xfWeekSubj', label: '1V1周续费单科', unit: '科' },
        { k: 'xfMonthSubj', label: '1V1月续费单科', unit: '科' },
        { k: 'xfWeekSubjRate', label: '1V1周续费单科率', unit: '%' },
        { k: 'xfMonthSubjRate', label: '1V1月续费单科率', unit: '%' },
        { k: 'tjMonthNum', label: '1V1月推荐人数', unit: '人' },
        { k: 'tjMonthNumRate', label: '1V1月推荐人数率', unit: '%' },
        { k: 'tjMonthSubj', label: '1V1月推荐单科', unit: '科' },
        { k: 'tjMonthSubjRate', label: '1V1月推荐单科率', unit: '%' }
      ]
    },
    {
      title: '结课 · 退费 · 停课', items: [
        { k: 'jkWeekNum', label: '1V1周结课人数', unit: '人' },
        { k: 'jkMonthNum', label: '1V1月结课人数', unit: '人' },
        { k: 'jkWeekNumRate', label: '1V1周结课人数率', unit: '%' },
        { k: 'jkMonthNumRate', label: '1V1月结课人数率', unit: '%' },
        { k: 'jkWeekSubj', label: '1V1周结课单科', unit: '科' },
        { k: 'jkMonthSubj', label: '1V1月结课单科', unit: '科' },
        { k: 'jkWeekSubjRate', label: '1V1周结课单科率', unit: '%' },
        { k: 'jkMonthSubjRate', label: '1V1月结课单科率', unit: '%' },
        { k: 'tfWeekNum', label: '1V1周退费人数', unit: '人' },
        { k: 'tfMonthNum', label: '1V1月退费人数', unit: '人' },
        { k: 'tfWeekSubj', label: '1V1周退费单科', unit: '科' },
        { k: 'tfMonthSubj', label: '1V1月退费单科', unit: '科' },
        { k: 'tfWeekSubjRate', label: '1V1周退费单科率', unit: '%' },
        { k: 'tfMonthSubjRate', label: '1V1月退费单科率', unit: '%' },
        { k: 'tkNum', label: '1V1停课人数', unit: '人' },
        { k: 'tkNumRate', label: '1V1停课人数率', unit: '%' }
      ]
    },
    {
      title: '入离职 · 请假', items: [
        { k: 'entryWeek', label: '周入职人数', unit: '人' },
        { k: 'entryMonth', label: '月入职人数', unit: '人' },
        { k: 'quitWeek', label: '周离职人数', unit: '人' },
        { k: 'quitMonth', label: '月离职人数', unit: '人' },
        { k: 'quitWeekRate', label: '周离职人数率', unit: '%' },
        { k: 'quitMonthRate', label: '月离职人数率', unit: '%' },
        { k: 'addClass', label: '1V1加课', unit: '次' },
        { k: 'leaveStudent', label: '1V1学员请假', unit: '次' },
        { k: 'leaveTeacher', label: '1V1老师请假', unit: '次' },
        { k: 'leaveRate', label: '1V1请假率', unit: '%' }
      ]
    }
  ];

  /* ---------- 格式化 ---------- */
  // 用「千分位取整再除10」规避二进制浮点漂移（如 0.0195*100=1.95 但 .toFixed(1) 得 1.9 的 bug）
  function fmtPercent(v) {
    var p = Math.round(v * 1000) / 10;
    return p.toFixed(1) + '%';
  }
  function fmtNum(v) {
    if (v == null) return '-';
    if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
    return (Math.round(v * 100) / 100).toLocaleString('zh-CN');
  }
  function fmtMoney(v) {
    if (v == null) return '-';
    return Math.round(v).toLocaleString('zh-CN') + ' 元';
  }
  function fmtLocal(v, unit) {
    if (v == null) return '-';
    if (unit === '%' || unit === '比') return fmtPercent(v);
    if (unit === '元') return fmtMoney(v);
    return fmtNum(v);
  }

  // 取一个字段的「展示信息」：优先复用 DOS 指标口径（标签/基准/红绿灯）；否则用原始口径
  function cellInfo(campusKey, value, localLabel, localUnit) {
    var dosId = CAMPUS_TO_DOS[campusKey];
    if (dosId && App.importer && App.importer.metric) {
      var m = App.importer.metric(dosId);
      if (m) {
        var disp;
        if (m.unit === '%') disp = fmtPercent(value);
        else if (m.dec > 0) disp = value.toFixed(m.dec);
        else disp = fmtNum(value);
        var level = (m.baseline && App.util && App.util.judge)
          ? App.util.judge(value, m.baseline).level
          : null;
        return { label: m.label, disp: disp, level: level };
      }
    }
    return { label: localLabel, disp: fmtLocal(value, localUnit), level: null };
  }

  /* ---------- 动态布局引擎 ---------- */
  var _observers = [];
  function disconnectObservers() {
    _observers.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
    _observers = [];
  }
  // 根据容器实测宽度，自动计算每行的列数；窄屏少列、宽屏多列，避免空间浪费或溢出
  function applyDynGrid(root) {
    var els = root.querySelectorAll('[data-dyn]');
    els.forEach(function (el) {
      var min = parseFloat(el.getAttribute('data-min')) || 140;
      var gap = parseFloat(el.getAttribute('data-gap')) || 12;
      var max = parseInt(el.getAttribute('data-max')) || 0;
      function layout() {
        var w = el.clientWidth;
        if (!w) return;
        var cols = Math.floor((w - gap) / (min + gap));
        cols = Math.max(1, cols);
        if (max) cols = Math.min(cols, max);
        el.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      }
      layout();
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(layout);
        ro.observe(el);
        _observers.push(ro);
      }
    });
  }

  /* ---------- 渲染 ---------- */
  var _mounted = null;
  function emptyState() {
    return '<div class="empty-state" style="padding:50px">' +
      '<h4>暂无联动数据</h4>' +
      '<p>请先在「数据分析工作台」点击「推送分析到个人台」，并在本工作台登录同一账号。</p>' +
      '</div>';
  }

  function chip(item, value) {
    var info = cellInfo(item.k, value, item.label, item.unit);
    var dot = '<span class="status-dot ' + (info.level || 'neutral') + '"></span>';
    return '<div class="linked-chip">' + dot +
      '<div class="linked-chip-main"><div class="k">' + info.label + '</div>' +
      '<div class="v">' + info.disp + '</div></div></div>';
  }

  /* ---------- 联动快照回写数据看板（自动填充） ---------- */
  // 从 shared_link 行中取出 analytics_snapshot 快照对象
  function extractSnapshot(rows) {
    var snap = null;
    (rows || []).forEach(function (r) {
      if (r && r.kind === 'analytics_snapshot' && r.payload) snap = r.payload;
    });
    return snap;
  }

  // 选择权威数据源：优先月度数据流，否则周报最新一周（其内部已含月度累计指标）
  function pickSource(snap) {
    var lbs = snap.latestByStream || {};
    var monthly = lbs['monthly'];
    if (monthly && monthly.values && monthly.year && monthly.month) return monthly;
    var weekly = lbs['weekly'];
    if (weekly && weekly.values && weekly.year && weekly.month) return weekly;
    return null;
  }

  // 把快照写入 App.store，使「基准值对标 / 环比·同比趋势 / 人事数据」无需手动导入即可填充
  function applySnapshotToStore(snap) {
    if (!snap || !snap.latestByStream) return;
    var src = pickSource(snap);
    if (!src) return;
    var values = src.values || {};
    if (!values || typeof values !== 'object') return;
    var monthKey = src.year + '-' + String(src.month).padStart(2, '0');

    // —— 写入 reports.monthly（供基准值对标 / 趋势） ——
    var reports = App.store.get('reports') || { monthly: {}, imports: [] };
    if (!reports.monthly) reports.monthly = {};
    var metrics = {};
    Object.keys(CAMPUS_TO_DOS).forEach(function (campusKey) {
      if (WEEK_ONLY_CAMPUS_KEYS[campusKey]) return; // 仅对标当月数据，剔除周度字段
      if (values[campusKey] != null && values[campusKey] !== '') metrics[CAMPUS_TO_DOS[campusKey]] = values[campusKey];
    });
    reports.monthly[monthKey] = {
      month: monthKey,
      label: src.year + '年' + src.month + '月',
      metrics: metrics,
      yoy: null,
      campus: true,
      importedAt: snap.generatedAt || new Date().toISOString()
    };
    App.store.set('reports', reports);

    // —— 写入 hr.linked（供人事数据展示） ——
    var hr = App.store.get('hr') || { weekly: {}, baseHeadcount: null, baseDate: null, linked: null };
    if (!hr.weekly) hr.weekly = {};
    hr.linked = {
      month: monthKey,
      teacherCount: values.teacherCount != null ? values.teacherCount : null,
      coreTeacherCount: values.coreTeacherCount != null ? values.coreTeacherCount : null,
      doubleThreeCount: values.doubleThreeCount != null ? values.doubleThreeCount : null,
      doubleThreeRatio: values.doubleThreeRatio != null ? values.doubleThreeRatio : null,
      campusTotal: values.campusTotal != null ? values.campusTotal : null,
      entryWeek: values.entryWeek != null ? values.entryWeek : null,
      entryMonth: values.entryMonth != null ? values.entryMonth : null,
      quitWeek: values.quitWeek != null ? values.quitWeek : null,
      quitMonth: values.quitMonth != null ? values.quitMonth : null,
  quitWeekRate: values.quitWeekRate != null ? values.quitWeekRate : null,
      quitMonthRate: values.quitMonthRate != null ? values.quitMonthRate : null,
      generatedAt: snap.generatedAt || new Date().toISOString()
    };
    App.store.set('hr', hr);
  }

  function buildHTML(snap, weekly) {
    var html = '';
    // 头部
    html += '<div class="linked-head">';
    html += '<div><div class="linked-title">联动数据 · 来自数据分析工作台</div>';
    html += '<div class="linked-sub">同源：DOS周报·数据统计表；字段已与本看板指标口径对齐。';
    html += '快照生成于 ' + new Date(snap.generatedAt).toLocaleString() + ' · 云端记录 ' + (snap.totalRecords || 0) + ' 条</div></div>';
    html += '<button class="btn btn-secondary btn-sm" id="linked-refresh">重新拉取</button>';
    html += '</div>';

    // 顶部核心指标（动态列）
    html += '<div class="linked-summary" data-dyn data-min="150" data-gap="14" data-max="7">';
    FEATURES.forEach(function (f) {
      var v = weekly[f.src];
      var info = cellInfo(f.src, v, f.label, f.unit);
      html += '<div class="linked-feature">' +
        '<div class="lf-top"><span class="lf-label">' + info.label + '</span>' +
        '<span class="status-dot ' + (info.level || 'neutral') + '"></span></div>' +
        '<div class="lf-val">' + info.disp + '</div>' +
        '<div class="lf-sub">联动 · 实时对齐本看板口径</div></div>';
    });
    html += '</div>';

    // 分类卡片（外层动态多列）
    html += '<div class="linked-cats" data-dyn data-min="330" data-gap="16">';
    GROUPS.forEach(function (g) {
      html += '<div class="linked-cat"><div class="linked-cat-title">' + g.title + '</div>';
      html += '<div class="linked-grid" data-dyn data-min="118" data-gap="10">';
      g.items.forEach(function (it) {
        html += chip(it, weekly[it.k]);
      });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function render(container) {
    if (!container) return;
    _mounted = container;
    container.innerHTML = '<div class="linked-loading">正在拉取联动数据…</div>';
    disconnectObservers();
    if (!window.App.sync || !App.sync.readShared) {
      container.innerHTML = '<div class="empty-state">同步模块未加载，请确认已登录。</div>';
      return;
    }
    App.sync.readShared().then(function (rows) {
      var snap = extractSnapshot(rows);
      if (!snap) { container.innerHTML = emptyState(); return; }
      // 回填数据看板（基准值对标 / 趋势 / 人事），即使停留在其它标签也能自动填充
      applySnapshotToStore(snap);
      var weekly = (snap.latestByStream && snap.latestByStream['weekly'] && snap.latestByStream['weekly'].values) || null;
      if (!weekly) {
        container.innerHTML = '<div class="empty-state" style="padding:40px">' +
          '<p>云端快照中未找到「weekly（DOS周报·数据统计表）」数据。请在数据分析工作台确保已录入周报并再次推送。</p></div>';
        return;
      }
      container.innerHTML = buildHTML(snap, weekly);
      var rf = document.getElementById('linked-refresh');
      if (rf) rf.onclick = function () { render(container); };
      applyDynGrid(container);
    }).catch(function (e) {
      container.innerHTML = '<div class="empty-state">拉取失败：' + ((e && e.message) || e) + '</div>';
    });
  }

  // 登录成功 / 云端更新时：无论是否在联动页，都把快照回写数据看板，并广播「已更新」
  window.addEventListener('dos:linked-update', function () {
    if (window.App.sync && App.sync.readShared) {
      App.sync.readShared().then(function (rows) {
        var snap = extractSnapshot(rows);
        if (snap) {
          applySnapshotToStore(snap);
          try { window.dispatchEvent(new Event('dos:linked-store-updated')); } catch (e) {}
        }
      }).catch(function () { });
    }
    if (_mounted) render(_mounted);
  });

  App.views.linkedData = { render: render, applySnapshotToStore: applySnapshotToStore, extractSnapshot: extractSnapshot };
})();
