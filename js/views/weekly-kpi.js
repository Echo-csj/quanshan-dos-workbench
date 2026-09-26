/* ============================================
   weekly-kpi.js — 教师周度 KPI（关键绩效指标）
   数据来源：课程表（App.store.schedule）的每周课次
            + 教师管理板块（App.viewData().teachers）的科组映射
   指标：预排周课次 / 请假课次 / 实际周课次（=预排−请假）
         / 预排饱和度（=预排/16）/ 实际饱和度（=实际/16）
   支持：按人工月+周次查看（本周实时 + 历史快照）/ 按科组筛选 / 教师勾选纳入科组聚合
   导出：Excel（XLSX，两张表）/ 图片（canvas 绘制 PNG，零外部依赖）
   ============================================ */

(function() {

  var SUBJECT_GROUPS = ['数学', '英语', '文综', '理综'];
  var BASE = 16; // 16 次课 = 100% 满负荷

  // ---------- 页面状态 ----------
  var _selNames = null;        // 选中教师（name -> bool；null = 全部选中）
  var _artMonth = null;        // 当前所选人工月（YYYY-MM）
  var _weekNo = 1;             // 当前所选周次（1..N）
  var _curWeekStart = null;    // 当前所选周起始日（供 saveSnapshot/archive 使用）
  var _filterGroup = 'all';    // 科组筛选
  var _displayedRows = [];     // 当前展示（受筛选）的按教师行
  var _lastRows = [];          // 导出用：最近一次按教师行
  var _lastGroups = [];        // 导出用：最近一次按科组行
  var _lastWeek = 'export';    // 导出用文件名片段
  var _lastSummary = null;     // 导出用：最近一次校区汇总

  // 教师表筛选状态（仅作用于「按教师」明细表，不影响科组聚合/校区汇总）
  // name：教师姓名模糊匹配；satMin/sunMin/v1v1Min/v1v6Min：对应课次下限（≥）；'' = 不限
  var _filters = { name: '', satMin: '', sunMin: '', v1v1Min: '', v1v6Min: '' };
  var _teacherBaseRows = [];   // 筛选前的「按教师」基础行（受科组筛选/数据源影响，作为筛选输入）
  var _lastIsLive = false;     // 最近一次渲染是否活动周（供局部刷新复渲染教师表）

  // 自动抓取（KPI 选周联动课程表）状态
  var _loadingWeek = null;        // 正在自动抓取的周（防止重复触发）
  var _fetchFailedWeeks = {};     // 抓取失败的周（防无限重试，提供重试按钮）
  var _fetchAttempted = {};       // 已对该周发起过自动抓取（避免重渲染重复触发）
  var _lastRenderedWeek = null;   // 上次渲染的周（区分「切周」与「切筛选」）

  // ---------- 工具 ----------
  // 学科组归一（与 teachers.js canonSubject 保持一致：数学/英语/文综/理综）
  // 统一委托 kpi-engine，确保与数据中心归档口径一致（零回归）
  function canonSubject(s) { return App.kpiEngine.canonSubject(s); }
  function thisMonday() {
    var d = new Date();
    var day = (d.getDay() + 6) % 7; // 周一=0
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }
  function thisSunday() {
    var d = new Date(thisMonday());
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  }
  function pct(v) { if (v == null || isNaN(v)) return '-'; return (v * 100).toFixed(0) + '%'; }

  // 安全读取按天聚合（旧快照/归档可能无 byDay）
  function safeByDay(row, day) {
    return (row && row.byDay && row.byDay[day]) || { pre: 0, pre1v1: 0, pre1v6: 0 };
  }

  // 展示「total (a+b)」；total 或拆分字段缺失（旧数据）时降级展示，零回归。
  function fmtBreakdown(total, a, b) {
    if (total == null) return '—';
    if (a == null || b == null) return String(total);
    return total + ' (' + a + '+' + b + ')';
  }

  // HTML/屏幕用饱和度配色（CSS 变量）
  function satColor(v) {
    if (v == null || isNaN(v)) return 'var(--text-muted)';
    if (v > 1) return 'var(--bad)';       // 超饱和（>100%）
    if (v >= 0.75) return 'var(--ok)';    // 饱满
    if (v >= 0.5) return 'var(--warn)';   // 中等
    return 'var(--text-muted)';           // 偏低
  }
  // canvas 用饱和度配色（十六进制）
  var SAT_HEX = { bad: '#EF4444', ok: '#16A34A', warn: '#F59E0B', low: '#6B7280' };
  function satHex(v) {
    if (v == null || isNaN(v)) return SAT_HEX.low;
    if (v > 1) return SAT_HEX.bad;
    if (v >= 0.75) return SAT_HEX.ok;
    if (v >= 0.5) return SAT_HEX.warn;
    return SAT_HEX.low;
  }

  function buildGroupMap() {
    var tchAll = (App.viewData && App.viewData().teachers) || [];
    return App.kpiEngine.buildGroupMap(tchAll);
  }

  function readSchedule() {
    var d = App.store.get('schedule') || {};
    return {
      weekStartDate: d.weekStartDate || null,
      weekEndDate: d.weekEndDate || null,
      teachers: (d.teachers && d.teachers.length) ? d.teachers.slice() : []
    };
  }

  // 取某周的课程表：优先 schedules 多周存档；其次活动 schedule 恰为该周；否则 null
  // 这样任意已存档周都能在 KPI 视图实时重算（而非只读归档）
  function scheduleForWeek(weekStart) {
    var map = App.store.get('schedules') || {};
    if (map[weekStart]) return map[weekStart];
    var s = App.store.get('schedule') || {};
    if (s.weekStartDate === weekStart) return s;
    return null;
  }

  // 选择状态（以教师姓名为键；null = 全部选中）
  // 是否可自动抓取：已登录（sync 状态 ok）且已配置抓取服务
  function canAutoFetch() {
    if (!(App.sync && App.sync.getStatus && App.sync.getStatus() === 'ok')) return false;
    if (!(typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.COURSE_FETCH_WORKER_URL)) return false;
    return true;
  }

  // 自动抓取指定周并写入 schedules[W] 缓存；完成后重渲染 KPI（仅当仍在该周）
  async function autoFetchWeek(weekStart) {
    _loadingWeek = weekStart;
    renderLoading(weekStart);
    try {
      await App.views.schedule.fetchWeek(weekStart);
      _loadingWeek = null;
      if (_curWeekStart === weekStart) render();
    } catch (e) {
      _loadingWeek = null;
      _fetchFailedWeeks[weekStart] = true;
      App.util.toast('自动抓取失败：' + ((e && e.message) || e), 'bad');
      if (_curWeekStart === weekStart) render(); // 重渲染为失败态（带重试按钮）
    }
  }
  function retryFetch(weekStart) {
    delete _fetchFailedWeeks[weekStart];
    autoFetchWeek(weekStart);
  }

  // 加载态：提示正在自动抓取
  function renderLoading(weekStart) {
    var container = document.getElementById('view-container');
    if (!container) return;
    container.innerHTML = '<div class="page-head"><h1 class="page-title">教师周度 KPI</h1></div>'
      + '<div class="card" style="padding:28px;color:var(--text-muted)">正在自动从课程表抓取 <b>' + App.util.escapeHtml(weekStart)
      + '</b> 周数据并实时计算 KPI…（首次抓取需数秒）</div>';
  }
  // 无数据态：根据是否可重试给出不同提示
  function renderNoData(weekStart, canRetry) {
    var container = document.getElementById('view-container');
    if (!container) return;
    var hint = canRetry
      ? '该周暂无课程表数据，自动抓取失败。'
      : '该周暂无课程表数据。登录后在本视图选择该周将自动从课程表抓取；也可先到「课程表」手动设置并保存该周。';
    var btn = canRetry
      ? ' <button class="btn btn-secondary btn-sm" onclick="App.views.weeklyKpi.retryFetch(\'' + weekStart + '\')">重试抓取</button>'
      : '';
    container.innerHTML = '<div class="page-head"><h1 class="page-title">教师周度 KPI</h1></div>'
      + '<div class="card" style="padding:24px;color:var(--text-muted)">' + App.util.escapeHtml(hint) + btn + '</div>';
  }

  function syncSel(teachers) {
    var cur = {};
    (teachers || []).forEach(function (t) {
      var n = t.name || '';
      cur[n] = (_selNames && _selNames[n] === false) ? false : true;
    });
    _selNames = cur;
  }
  function isSel(name) { return _selNames ? (_selNames[name] !== false) : true; }
  function setSel(name, val) { if (!_selNames) _selNames = {}; _selNames[name] = val; }

  // ---------- 教师表筛选 ----------
  // 可筛选字段：
  //   教师姓名（name）：对 r.name 做不区分大小写的子串模糊匹配
  //   周六课次 / 周日课次（satMin / sunMin）：对预排按天课次 r.byDay['周六'|'周日'].pre 取下限 ≥
  //   1V1课次 / 1V6课次（v1v1Min / v1v6Min）：对预排分类课次 r.pre1v1 / r.pre1v6 取下限 ≥
  // 任一条件为空（''）即视为「不限」。所有条件以 AND 组合。
  function applyFilters(rows) {
    var f = _filters || {};
    var name = (f.name || '').trim().toLowerCase();
    function num(v) { return (v === '' || v == null) ? null : Number(v); }
    var satMin = num(f.satMin), sunMin = num(f.sunMin), v1v1Min = num(f.v1v1Min), v1v6Min = num(f.v1v6Min);
    return (rows || []).filter(function (r) {
      if (name && (r.name || '').toLowerCase().indexOf(name) < 0) return false;
      var byDay = r.byDay || {};
      var sat = (byDay['周六'] && byDay['周六'].pre) || 0;
      var sun = (byDay['周日'] && byDay['周日'].pre) || 0;
      if (satMin != null && !(sat >= satMin)) return false;
      if (sunMin != null && !(sun >= sunMin)) return false;
      if (v1v1Min != null && !((r.pre1v1 || 0) >= v1v1Min)) return false;
      if (v1v6Min != null && !((r.pre1v6 || 0) >= v1v6Min)) return false;
      return true;
    });
  }

  // 筛选输入实时刷新：仅重渲染「按教师」表卡片（保持输入框焦点），并同步导出源与计数
  function onFilterInput() {
    function v(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    _filters = { name: v('kpi-filter-name'), satMin: v('kpi-filter-sat'), sunMin: v('kpi-filter-sun'), v1v1Min: v('kpi-filter-v1v1'), v1v6Min: v('kpi-filter-v1v6') };
    var filtered = applyFilters(_teacherBaseRows);
    _displayedRows = filtered;        // 勾选 idx 映射以筛选后展示行
    _lastRows = filtered;             // 导出以当前展示（筛选后）为准
    var wrap = document.getElementById('kpi-teacher-table-wrap');
    if (wrap) wrap.innerHTML = renderTeacherTable(filtered, _lastIsLive, _teacherBaseRows.length > 0 && filtered.length === 0);
    var cnt = document.getElementById('kpi-filter-count');
    if (cnt) cnt.textContent = '匹配 ' + filtered.length + ' / ' + _teacherBaseRows.length + ' 位教师';
  }

  function resetFilters() {
    _filters = { name: '', satMin: '', sunMin: '', v1v1Min: '', v1v6Min: '' };
    render();
  }

  // 计算每位教师 KPI（受科组筛选；selected 由 _selNames 决定）
  // 委托 kpi-engine，确保与数据中心归档口径一致（零回归）
  function computeRows(filterGroup, schOverride) {
    var sch = schOverride || readSchedule();
    var tchAll = (App.viewData && App.viewData().teachers) || [];
    return App.kpiEngine.computeRows(sch, tchAll, { filterGroup: filterGroup, selNames: _selNames });
  }

  // 按科组聚合（仅统计已勾选教师）：科组周课次 / 16 / 科组教师数
  function computeGroups(rows) { return App.kpiEngine.computeGroups(rows); }

  // 校区汇总（基于已勾选教师的所有科组聚合）
  function computeCampusSummary(groups) { return App.kpiEngine.computeCampusSummary(groups); }

  // ---------- 快照（历史留存，按 weekStart 归档）----------
  function getSnapshots() { return App.store.get('kpiSnapshots') || {}; }

  function saveSnapshot() {
    var sch = scheduleForWeek(_curWeekStart);   // 用当前所选周的课程表（活动周或历史存档周）
    if (!sch || !sch.weekStartDate) { App.util.toast('请先在「课程表」设置并保存该周', 'warn'); return; }
    var rows = computeRows('all', sch);     // 存全量（含 selected 标记），查看时再按筛选显示
    var groups = computeGroups(rows);
    var summary = computeCampusSummary(groups);
    var wk = sch.weekStartDate;
    var snaps = getSnapshots();
    snaps[wk] = {
      weekStart: wk,
      weekEnd: sch.weekEndDate || thisSunday(),
      rows: rows,
      groups: groups,
      summary: summary,
      createdAt: new Date().toISOString()
    };
    App.store.set('kpiSnapshots', snaps);
    render();
    App.util.toast('已保存 ' + wk + ' 周 KPI 快照', 'ok');
  }

  function deleteSnapshot(wk) {
    var snaps = getSnapshots();
    if (!snaps[wk]) { render(); return; }
    App.util.modal({
      title: '删除 KPI 快照',
      content: '将删除 ' + wk + ' 周的 KPI 快照，此操作不可恢复。',
      confirmText: '删除',
      onConfirm: function (close) {
        var s = getSnapshots();
        delete s[wk];
        App.store.set('kpiSnapshots', s);
        render();
        close();
        App.util.toast('已删除该周快照', 'ok');
      }
    });
  }

  // 归档当前查看的周（活动周或历史存档周）到周度数据中心（weeklyData），便于锁定/月度汇总
  function archiveToDataCenter() {
    if (!App.weeklyData) { App.util.toast('数据中心模块未加载', 'bad'); return; }
    var sch = scheduleForWeek(_curWeekStart);
    if (!sch || !sch.weekStartDate) { App.util.toast('请先在「课程表」设置并保存该周', 'warn'); return; }
    var teachers = (App.viewData && App.viewData().teachers) || [];
    var wk = App.weeklyCycle.resolveWeek(_artMonth, _weekNo);
    if (!wk) { App.util.toast('周次无效', 'bad'); return; }
    var rec = App.kpiEngine.computeRecord(sch, teachers, wk.start, wk.end, _artMonth, _weekNo, {
      dataSource: 'live', includeRoster: true, selNames: null
    });
    if (!rec) { App.util.toast('计算失败', 'bad'); return; }
    App.weeklyData.upsert(rec);
    App.util.toast('已归档 ' + rec.weekStart + ' 周到数据中心（来源：课程表）', 'ok');
  }

  // ---------- 渲染 ----------
  // 首次进入时，默认选中「当前日期所属人工月 + 当前周次」
  function ensureSelection() {
    if (_artMonth && _weekNo) return;
    var cur = App.weeklyCycle.artMonthOfDate(new Date());
    _artMonth = cur.artMonthId;
    _weekNo = cur.weekNo;
  }

  function render() {
    var container = document.getElementById('view-container');
    if (!container) return;
    var U = App.util;

    ensureSelection();
    var wk = App.weeklyCycle.resolveWeek(_artMonth, _weekNo);
    if (!wk) {
      container.innerHTML = '<div class="page-head"><h1 class="page-title">教师周度 KPI</h1></div>' +
        '<div style="padding:24px;color:var(--text-muted)">所选周次无效</div>';
      return;
    }
    var weekStart = wk.start, weekEnd = wk.end;
    _curWeekStart = weekStart;

    var sch = scheduleForWeek(weekStart);
    // 仅「正在加载」或「上次抓取失败」直接展示对应状态；其余情况走原快照/归档/空态路径（零回归）
    if (_loadingWeek === weekStart) { renderLoading(weekStart); _lastRenderedWeek = weekStart; return; }
    if (_fetchFailedWeeks[weekStart]) { renderNoData(weekStart, true); _lastRenderedWeek = weekStart; return; }
    _lastRenderedWeek = weekStart;

    var isLive = !!sch;     // 该周有课程表存档（活动周或历史周）即可实时重算
    var activeWeekStart = (App.store.get('schedule') || {}).weekStartDate;
    var isActiveWeek = !!(sch && sch.weekStartDate === activeWeekStart);
    var snap = isLive ? null : (getSnapshots()[weekStart] || null);

    var rows, groups, summary, sourceText;
    if (isLive) {
      syncSel(App.viewData().teachers); // 选框以教师管理板块名册为准（与 computeRows 名册一致）
      rows = computeRows(_filterGroup, sch);
      groups = computeGroups(rows);
      summary = computeCampusSummary(computeGroups(computeRows('all', sch)));
      sourceText = '数据来源：课程表（' + weekStart + ' ~ ' + weekEnd + '）' + (isActiveWeek ? '' : '（历史周·课程表存档）');
    } else if (snap) {
      rows = (snap.rows || []).filter(function (r) {
        return (_filterGroup === 'all') || (r.group === _filterGroup);
      });
      groups = (_filterGroup === 'all') ? (snap.groups || []) : (snap.groups || []).filter(function (g) { return g.group === _filterGroup; });
      summary = snap.summary || computeCampusSummary(groups);
      var when = snap.createdAt ? new Date(snap.createdAt).toLocaleString('zh-CN') : '未知';
      sourceText = '数据来源：KPI 快照（保存于 ' + when + '）';
    } else {
      // 尝试从周度数据中心反查该周归档（只读，不依赖手动快照；数据随整档同步）
      var dc = (App.weeklyData && App.weeklyData.get) ? App.weeklyData.get(weekStart) : null;
      if (dc && dc.kpiByTeacher && dc.kpiByTeacher.length) {
        rows = (dc.kpiByTeacher || []).filter(function (r) {
          return (_filterGroup === 'all') || (r.group === _filterGroup);
        });
        groups = (_filterGroup === 'all') ? (dc.kpiByGroup || [])
          : (dc.kpiByGroup || []).filter(function (g) { return g.group === _filterGroup; });
        summary = dc.campusSummary || computeCampusSummary(groups);
        var dcWhen = dc.updatedAt || dc.createdAt;
        var dcWhenText = dcWhen ? new Date(dcWhen).toLocaleString('zh-CN') : '未知';
        sourceText = '数据来源：周度数据中心归档（' + (dc.weekLabel || (weekStart + ' ~ ' + weekEnd)) +
          '，来源：' + (dc.dataSource || '未知') + (dc.locked ? '，已锁定' : '') + '，更新于 ' + dcWhenText + '）';
      } else {
        // 无快照、无归档：若为「首次选中该周」且已登录/已配置，则自动从课程表抓取该周数据；否则保持零回归空态
        if (canAutoFetch() && !_fetchAttempted[weekStart]) {
          _fetchAttempted[weekStart] = true;
          autoFetchWeek(weekStart); // 异步：抓回后写 schedules[W] 缓存并重渲染
          return;
        }
        rows = []; groups = [];
        summary = computeCampusSummary(groups);
        sourceText = '当前所选周次（' + weekStart + ' ~ ' + weekEnd + '）暂无数据：请先在「课程表」设置该周并保存，或保存该周 KPI 快照';
      }
    }

    _teacherBaseRows = rows;          // 筛选前基础行（科组筛选/数据源已生效）
    _lastIsLive = isLive;
    var filtered = applyFilters(rows); // 教师表筛选（仅作用明细表）
    _displayedRows = filtered;        // 勾选 idx 映射以筛选后展示行为准
    _lastRows = filtered;             // 导出以当前展示（筛选后）为准
    _lastGroups = groups;
    _lastSummary = summary;
    _lastWeek = weekStart + '_' + weekEnd;

    var html = '';
    html += '<div class="page-head"><h1 class="page-title">教师周度 KPI</h1>';
    html += '<p class="page-sub">教师每周关键绩效指标（课次与饱和度）· 基准：每周 ' + BASE + ' 次课 = 100% 满负荷</p></div>';

    // 工具栏：左侧 人工月 + 周次 + 科组筛选，右侧操作
    html += '<div class="teacher-toolbar">';
    html += '<div class="teacher-filters">';
    html += App.components.monthWeekPicker.html({
      month: _artMonth,
      week: _weekNo,
      months: App.weeklyCycle.recentMonths(12),
      monthCb: 'App.views.weeklyKpi.onMonthChange(this.value)',
      weekCb: 'App.views.weeklyKpi.onWeekChange(this.value)'
    });
    html += '<select class="form-input form-input-sm" id="kpi-group" onchange="App.views.weeklyKpi.onFilterChange(this.value)">';
    html += '<option value="all"' + (_filterGroup === 'all' ? ' selected' : '') + '>全部科组</option>';
    SUBJECT_GROUPS.forEach(function (sg) {
      html += '<option value="' + sg + '"' + (_filterGroup === sg ? ' selected' : '') + '>' + sg + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div class="teacher-actions">';
    if (isLive) {
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.weeklyKpi.selectAll(true)">全选</button>';
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.weeklyKpi.selectAll(false)">全不选</button>';
      html += '<button class="btn btn-secondary btn-sm" onclick="App.views.weeklyKpi.editSchedule()">' + U.svgIcon('edit', 14) + ' 编辑此周课程表</button>';
      html += '<button class="btn btn-secondary btn-sm" onclick="App.views.weeklyKpi.saveSnapshot()">' + U.svgIcon('save', 14) + ' 保存本周快照</button>';
      html += '<button class="btn btn-secondary btn-sm" onclick="App.views.weeklyKpi.archiveToDataCenter()">' + U.svgIcon('database', 14) + ' 归档到数据中心</button>';
    } else if (snap) {
      html += '<button class="btn btn-ghost btn-sm" onclick="App.views.weeklyKpi.deleteSnapshot(\'' + weekStart + '\')">删除该周快照</button>';
    }
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.weeklyKpi.exportImage()">' + U.svgIcon('image', 14) + ' 导出图片</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.weeklyKpi.exportXLSX()">' + U.svgIcon('download', 14) + ' 导出表格</button>';
    html += '</div>';
    html += '</div>';

    html += '<p class="form-hint" style="margin-bottom:14px">' + U.escapeHtml(sourceText)
      + ' · 当前周度范围：' + U.escapeHtml(weekStart) + ' ~ ' + U.escapeHtml(weekEnd)
      + (isLive ? (isActiveWeek ? '（调整课表请点上方「编辑此周课程表」）' : '（历史周·课程表存档，点上方「编辑此周课程表」可直接改并存）') : '') + '</p>';

    // 教师表筛选条（仅作用于「按教师」明细表；科组聚合/校区汇总不受影响）
    var hasBase = rows.length > 0;
    html += '<div class="kpi-filter-bar">';
    html += '<div class="kpi-filter-row">';
    html += '<div class="kpi-filter-item"><label class="kpi-filter-label">教师姓名</label>'
      + '<input type="text" id="kpi-filter-name" class="form-input form-input-sm" placeholder="模糊匹配姓名" value="' + U.escapeHtml(_filters.name) + '" oninput="App.views.weeklyKpi.onFilterInput()"></div>';
    html += '<div class="kpi-filter-item"><label class="kpi-filter-label">周六课次 ≥</label>'
      + '<input type="number" id="kpi-filter-sat" class="form-input form-input-sm kpi-filter-num" min="0" step="1" placeholder="不限" value="' + U.escapeHtml(_filters.satMin) + '" oninput="App.views.weeklyKpi.onFilterInput()"></div>';
    html += '<div class="kpi-filter-item"><label class="kpi-filter-label">周日课次 ≥</label>'
      + '<input type="number" id="kpi-filter-sun" class="form-input form-input-sm kpi-filter-num" min="0" step="1" placeholder="不限" value="' + U.escapeHtml(_filters.sunMin) + '" oninput="App.views.weeklyKpi.onFilterInput()"></div>';
    html += '<div class="kpi-filter-item"><label class="kpi-filter-label">1V1课次 ≥</label>'
      + '<input type="number" id="kpi-filter-v1v1" class="form-input form-input-sm kpi-filter-num" min="0" step="1" placeholder="不限" value="' + U.escapeHtml(_filters.v1v1Min) + '" oninput="App.views.weeklyKpi.onFilterInput()"></div>';
    html += '<div class="kpi-filter-item"><label class="kpi-filter-label">1V6课次 ≥</label>'
      + '<input type="number" id="kpi-filter-v1v6" class="form-input form-input-sm kpi-filter-num" min="0" step="1" placeholder="不限" value="' + U.escapeHtml(_filters.v1v6Min) + '" oninput="App.views.weeklyKpi.onFilterInput()"></div>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.weeklyKpi.resetFilters()"' + (hasBase ? '' : ' disabled') + '>清除筛选</button>';
    html += '</div>';
    html += '<div class="kpi-filter-meta"><span id="kpi-filter-count">匹配 ' + filtered.length + ' / ' + rows.length + ' 位教师</span>'
      + '<span class="kpi-filter-tip">姓名模糊匹配；课次为「预排」口径下限（≥）。输入即时刷新「按教师」表，不影响科组聚合与导出之外的汇总。</span></div>';
    html += '</div>';

    html += '<div id="kpi-teacher-table-wrap">' + renderTeacherTable(filtered, isLive, hasBase && filtered.length === 0) + '</div>';
    html += renderGroupTable(groups, summary);

    container.innerHTML = html;
  }

  function renderTeacherTable(rows, isLive, noMatch) {
    var U = App.util;
    function fmtMaybe(v) { return v == null ? '—' : v; }
    var html = '';
    html += '<div class="card" style="margin-bottom:18px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('users', 18) + '按教师</h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">勾选「选」决定该教师是否纳入科组汇总 · 课次展示为「合计（1V1+1V6）」</span></div>';
    if (!rows.length) {
      if (noMatch) {
        html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">无匹配结果：当前筛选条件下没有符合的教师。请调整上方筛选条件，或点「清除筛选」恢复全部。</div>';
      } else {
        html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">暂无教师课次数据' + (isLive ? '（请先在「课程表」导入 / 填写并保存）' : '') + '</div>';
      }
    } else {
      html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:920px"><thead><tr>';
      if (isLive) html += '<th style="width:44px">选</th>';
      ['教师', '科组', '预排周课次(1V1+1V6)', '请假课次(1V1+1V6)', '实际周课次(1V1+1V6)', '周六课次', '周日课次', '1V1课次', '1V6课次', '预排饱和度', '实际饱和度'].forEach(function (h) { html += '<th>' + h + '</th>'; });
      html += '</tr></thead><tbody>';
      rows.forEach(function (r, idx) {
        var sat = safeByDay(r, '周六'), sun = safeByDay(r, '周日');
        var hasByDay = !!(r.byDay);
        html += '<tr>';
        if (isLive) {
          html += '<td><input type="checkbox" ' + (r.selected ? 'checked' : '') + ' onchange="App.views.weeklyKpi.toggleTeacher(' + idx + ', this.checked)"></td>';
        }
        html += '<td>' + U.escapeHtml(r.name) + '</td>';
        html += '<td>' + U.escapeHtml(r.group) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(r.pre, r.pre1v1, r.pre1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(r.leave, r.leave1v1, r.leave1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(r.actual, r.actual1v1, r.actual1v6) + '</td>';
        html += '<td class="mono">' + (hasByDay ? sat.pre : '—') + '</td>';
        html += '<td class="mono">' + (hasByDay ? sun.pre : '—') + '</td>';
        html += '<td class="mono">' + fmtMaybe(r.pre1v1) + '</td>';
        html += '<td class="mono">' + fmtMaybe(r.pre1v6) + '</td>';
        html += '<td class="mono" style="color:' + satColor(r.preSat) + ';font-weight:600">' + pct(r.preSat) + '</td>';
        html += '<td class="mono" style="color:' + satColor(r.actualSat) + ';font-weight:600">' + pct(r.actualSat) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  function renderGroupTable(groups, summary) {
    var U = App.util;
    function fmtMaybe(v) { return v == null ? '—' : v; }
    // 从 groups 聚合出校区维度的类型/日期合计（供汇总行展示）
    var campusHasByDay = groups.length && groups[0].byDay;
    var campusSat = 0, campusSun = 0, campus1v1 = 0, campus1v6 = 0;
    if (campusHasByDay) {
      groups.forEach(function (g) {
        if (g.byDay) {
          campusSat += (g.byDay['周六'] && g.byDay['周六'].pre) || 0;
          campusSun += (g.byDay['周日'] && g.byDay['周日'].pre) || 0;
        }
        campus1v1 += (g.pre1v1 || 0);
        campus1v6 += (g.pre1v6 || 0);
      });
    }
    var html = '';
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + U.svgIcon('bar-chart-2', 18) + '按科组</h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">科组饱和度 = 科组周课次 / ' + BASE + ' / 科组教师数（仅统计已勾选教师）</span></div>';
    if (!groups.length) {
      html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">暂无科组数据</div>';
    } else {
      html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:920px"><thead><tr>';
      ['科组', '教师数', '预排周课次(1V1+1V6)', '请假课次(1V1+1V6)', '实际周课次(1V1+1V6)', '周六课次', '周日课次', '1V1课次', '1V6课次', '预排饱和度', '实际饱和度'].forEach(function (h) { html += '<th>' + h + '</th>'; });
      html += '</tr></thead><tbody>';
      groups.forEach(function (g) {
        var sat = safeByDay(g, '周六'), sun = safeByDay(g, '周日');
        var hasByDay = !!(g.byDay);
        html += '<tr>';
        html += '<td>' + U.escapeHtml(g.group) + '</td>';
        html += '<td class="mono">' + g.teachers + '</td>';
        html += '<td class="mono">' + fmtBreakdown(g.pre, g.pre1v1, g.pre1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(g.leave, g.leave1v1, g.leave1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(g.actual, g.actual1v1, g.actual1v6) + '</td>';
        html += '<td class="mono">' + (hasByDay ? sat.pre : '—') + '</td>';
        html += '<td class="mono">' + (hasByDay ? sun.pre : '—') + '</td>';
        html += '<td class="mono">' + fmtMaybe(g.pre1v1) + '</td>';
        html += '<td class="mono">' + fmtMaybe(g.pre1v6) + '</td>';
        html += '<td class="mono" style="color:' + satColor(g.preSat) + ';font-weight:600">' + pct(g.preSat) + '</td>';
        html += '<td class="mono" style="color:' + satColor(g.actualSat) + ';font-weight:600">' + pct(g.actualSat) + '</td>';
        html += '</tr>';
      });
      if (summary && summary.teachers) {
        html += '<tr style="font-weight:600;background:#EEF2FF;border-top:2px solid #4F46E5">';
        html += '<td>' + U.escapeHtml(summary.label) + '</td>';
        html += '<td class="mono">' + summary.teachers + '</td>';
        html += '<td class="mono">' + fmtBreakdown(summary.pre, summary.pre1v1, summary.pre1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(summary.leave, summary.leave1v1, summary.leave1v6) + '</td>';
        html += '<td class="mono">' + fmtBreakdown(summary.actual, summary.actual1v1, summary.actual1v6) + '</td>';
        html += '<td class="mono">' + (campusHasByDay ? campusSat : '—') + '</td>';
        html += '<td class="mono">' + (campusHasByDay ? campusSun : '—') + '</td>';
        html += '<td class="mono">' + (campusHasByDay ? campus1v1 : '—') + '</td>';
        html += '<td class="mono">' + (campusHasByDay ? campus1v6 : '—') + '</td>';
        html += '<td class="mono" style="color:' + satColor(summary.preSat) + '">' + pct(summary.preSat) + '</td>';
        html += '<td class="mono" style="color:' + satColor(summary.actualSat) + '">' + pct(summary.actualSat) + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  // ---------- 交互 ----------
  function onMonthChange(v) { _artMonth = v; _weekNo = 1; render(); }
  function onWeekChange(v) { _weekNo = parseInt(v, 10) || 1; render(); }
  function onFilterChange(v) { _filterGroup = v; render(); }
  function toggleTeacher(idx, val) {
    var r = _displayedRows[idx];
    if (!r) return;
    setSel(r.name, val);
    render();
  }
  function selectAll(val) {
    var sch = readSchedule();
    syncSel(sch.teachers);
    (sch.teachers || []).forEach(function (t) { setSel(t.name || '', val); });
    render();
  }

  // 从 KPI 视图直接跳转到课程表并载入当前所选周（活动周或历史存档周）进行编辑
  // 复用课程表成熟编辑器：switchWeek 把该周装载进活动编辑态，再导航过去；保存后回 KPI 即重算
  function editSchedule() {
    if (!_curWeekStart) { App.util.toast('请先选择周次', 'warn'); return; }
    if (App.views.schedule && App.views.schedule.switchWeek) {
      App.views.schedule.switchWeek(_curWeekStart); // 历史周从 schedules 载入；当前周本就是活动周（无 schedules 命中时 no-op，仍可导航）
    }
    if (App.router && App.router.navigate) {
      App.router.navigate('/schedule');
      App.util.toast('已切换到「课程表」并载入该周，改完保存即可在 KPI 重算', 'ok');
    } else if (App.views.schedule && App.views.schedule.render) {
      App.views.schedule.render();
    }
  }

  // ---------- 导出：Excel ----------
  function exportXLSX() {
    if (typeof XLSX === 'undefined') { App.util.toast('表格组件未加载，无法导出', 'bad'); return; }
    var rows = _lastRows || [], groups = _lastGroups || [], summary = _lastSummary;
    if (!rows.length) { App.util.toast('暂无可导出的数据', 'warn'); return; }
    function fmtMaybe(v) { return v == null ? '—' : v; }
    var wb = XLSX.utils.book_new();
    var aoa1 = [['教师', '科组', '预排周课次（1V1+1V6）', '请假课次（1V1+1V6）', '实际周课次（1V1+1V6）', '周六课次', '周日课次', '1V1课次', '1V6课次', '预排饱和度', '实际饱和度']];
    rows.forEach(function (r) {
      var sat = safeByDay(r, '周六'), sun = safeByDay(r, '周日');
      var hasByDay = !!(r.byDay);
      aoa1.push([
        r.name, r.group,
        fmtBreakdown(r.pre, r.pre1v1, r.pre1v6),
        fmtBreakdown(r.leave, r.leave1v1, r.leave1v6),
        fmtBreakdown(r.actual, r.actual1v1, r.actual1v6),
        hasByDay ? sat.pre : '—',
        hasByDay ? sun.pre : '—',
        fmtMaybe(r.pre1v1), fmtMaybe(r.pre1v6),
        pct(r.preSat), pct(r.actualSat)
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa1), '按教师');
    var aoa2 = [['科组', '教师数', '预排周课次（1V1+1V6）', '请假课次（1V1+1V6）', '实际周课次（1V1+1V6）', '周六课次', '周日课次', '1V1课次', '1V6课次', '预排饱和度', '实际饱和度']];
    groups.forEach(function (g) {
      var sat = safeByDay(g, '周六'), sun = safeByDay(g, '周日');
      var hasByDay = !!(g.byDay);
      aoa2.push([
        g.group, g.teachers,
        fmtBreakdown(g.pre, g.pre1v1, g.pre1v6),
        fmtBreakdown(g.leave, g.leave1v1, g.leave1v6),
        fmtBreakdown(g.actual, g.actual1v1, g.actual1v6),
        hasByDay ? sat.pre : '—',
        hasByDay ? sun.pre : '—',
        fmtMaybe(g.pre1v1), fmtMaybe(g.pre1v6),
        pct(g.preSat), pct(g.actualSat)
      ]);
    });
    if (summary && summary.teachers) {
      var campusHasByDay = groups.length && groups[0].byDay;
      var campusSat = 0, campusSun = 0, campus1v1 = 0, campus1v6 = 0;
      if (campusHasByDay) {
        groups.forEach(function (g) {
          if (g.byDay) {
            campusSat += (g.byDay['周六'] && g.byDay['周六'].pre) || 0;
            campusSun += (g.byDay['周日'] && g.byDay['周日'].pre) || 0;
          }
          campus1v1 += (g.pre1v1 || 0);
          campus1v6 += (g.pre1v6 || 0);
        });
      }
      aoa2.push([
        summary.label, summary.teachers,
        fmtBreakdown(summary.pre, summary.pre1v1, summary.pre1v6),
        fmtBreakdown(summary.leave, summary.leave1v1, summary.leave1v6),
        fmtBreakdown(summary.actual, summary.actual1v1, summary.actual1v6),
        campusHasByDay ? campusSat : '—',
        campusHasByDay ? campusSun : '—',
        campusHasByDay ? campus1v1 : '—',
        campusHasByDay ? campus1v6 : '—',
        pct(summary.preSat), pct(summary.actualSat)
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa2), '按科组');
    XLSX.writeFile(wb, '教师周度KPI_' + (_lastWeek || 'export') + '.xlsx');
    App.util.toast('已导出 Excel', 'ok');
  }

  // ---------- 导出：图片（canvas 绘制，零外部依赖）----------
  function exportImage() {
    var rows = _lastRows || [], groups = _lastGroups || [], summary = _lastSummary;
    if (!rows.length) { App.util.toast('暂无可导出的数据', 'warn'); return; }

    var scale = 2;
    var W = 1200, pad = 30;
    var fontStack = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif';

    function fmtMaybe(v) { return v == null ? '—' : v; }
    var teacherRows = rows.map(function (r) {
      var sat = safeByDay(r, '周六'), sun = safeByDay(r, '周日');
      var hasByDay = !!(r.byDay);
      return {
        name: r.name, group: r.group,
        pre: fmtBreakdown(r.pre, r.pre1v1, r.pre1v6),
        leave: fmtBreakdown(r.leave, r.leave1v1, r.leave1v6),
        actual: fmtBreakdown(r.actual, r.actual1v1, r.actual1v6),
        sat: hasByDay ? sat.pre : '—',
        sun: hasByDay ? sun.pre : '—',
        v1v1: fmtMaybe(r.pre1v1), v1v6: fmtMaybe(r.pre1v6),
        preSat: r.preSat, actualSat: r.actualSat
      };
    });
    var teacherCols = [
      { label: '教师', w: 140, key: 'name' }, { label: '科组', w: 80, key: 'group' },
      { label: '预排周课次', w: 130, key: 'pre' }, { label: '请假课次', w: 130, key: 'leave' }, { label: '实际周课次', w: 130, key: 'actual' },
      { label: '周六课次', w: 90, key: 'sat' }, { label: '周日课次', w: 90, key: 'sun' },
      { label: '1V1课次', w: 90, key: 'v1v1' }, { label: '1V6课次', w: 90, key: 'v1v6' },
      { label: '预排饱和度', w: 120, pct: true, key: 'preSat' }, { label: '实际饱和度', w: 120, pct: true, key: 'actualSat' }
    ];

    var groupRows = groups.map(function (g) {
      var sat = safeByDay(g, '周六'), sun = safeByDay(g, '周日');
      var hasByDay = !!(g.byDay);
      return {
        group: g.group, teachers: g.teachers,
        pre: fmtBreakdown(g.pre, g.pre1v1, g.pre1v6),
        leave: fmtBreakdown(g.leave, g.leave1v1, g.leave1v6),
        actual: fmtBreakdown(g.actual, g.actual1v1, g.actual1v6),
        sat: hasByDay ? sat.pre : '—',
        sun: hasByDay ? sun.pre : '—',
        v1v1: fmtMaybe(g.pre1v1), v1v6: fmtMaybe(g.pre1v6),
        preSat: g.preSat, actualSat: g.actualSat
      };
    });
    var groupCols = [
      { label: '科组', w: 150, key: 'group' }, { label: '教师数', w: 96, num: true, key: 'teachers' },
      { label: '预排周课次', w: 130, key: 'pre' }, { label: '请假课次', w: 130, key: 'leave' }, { label: '实际周课次', w: 130, key: 'actual' },
      { label: '周六课次', w: 90, key: 'sat' }, { label: '周日课次', w: 90, key: 'sun' },
      { label: '1V1课次', w: 90, key: 'v1v1' }, { label: '1V6课次', w: 90, key: 'v1v6' },
      { label: '预排饱和度', w: 120, pct: true, key: 'preSat' }, { label: '实际饱和度', w: 120, pct: true, key: 'actualSat' }
    ];

    // 汇总行：字段名与 groupCols 一致
    var summaryRow = null;
    if (summary && summary.teachers) {
      var campusHasByDay = groups.length && groups[0].byDay;
      var campusSat = 0, campusSun = 0, campus1v1 = 0, campus1v6 = 0;
      if (campusHasByDay) {
        groups.forEach(function (g) {
          if (g.byDay) {
            campusSat += (g.byDay['周六'] && g.byDay['周六'].pre) || 0;
            campusSun += (g.byDay['周日'] && g.byDay['周日'].pre) || 0;
          }
          campus1v1 += (g.pre1v1 || 0);
          campus1v6 += (g.pre1v6 || 0);
        });
      }
      summaryRow = {
        group: summary.label, teachers: summary.teachers,
        pre: fmtBreakdown(summary.pre, summary.pre1v1, summary.pre1v6),
        leave: fmtBreakdown(summary.leave, summary.leave1v1, summary.leave1v6),
        actual: fmtBreakdown(summary.actual, summary.actual1v1, summary.actual1v6),
        sat: campusHasByDay ? campusSat : '—',
        sun: campusHasByDay ? campusSun : '—',
        v1v1: campusHasByDay ? campus1v1 : '—',
        v1v6: campusHasByDay ? campus1v6 : '—',
        preSat: summary.preSat, actualSat: summary.actualSat
      };
    }
    function tableH(count, hasSummary) { return 22 + 44 + Math.max(count, 1) * 34 + (hasSummary ? 34 : 0) + 10; }
    var t1h = tableH(rows.length, false), t2h = tableH(groups.length, true);
    var H = pad + 58 + 28 + 16 + t1h + 20 + t2h + pad;

    var canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // 背景
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    // 标题
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 24px ' + fontStack;
    ctx.fillText('教师周度 KPI · 课次饱和度分析', pad, pad + 26);
    // 副标题
    ctx.fillStyle = '#6B7280';
    ctx.font = '400 13px ' + fontStack;
    ctx.fillText('周度范围：' + (_lastWeek || '') + '　·　基准：每周 ' + BASE + ' 次课 = 100%　·　生成于 ' + new Date().toLocaleString('zh-CN'), pad, pad + 50);

    var y = pad + 58 + 28 + 16;
    y = drawTable(ctx, pad, y, '按教师', teacherCols, teacherRows, false, null);
    y += 20;
    drawTable(ctx, pad, y, '按科组', groupCols, groupRows, true, summaryRow);

    canvas.toBlob(function (blob) {
      if (!blob) { App.util.toast('图片生成失败', 'bad'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '教师周度KPI_' + (_lastWeek || 'export') + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      App.util.toast('已导出图片', 'ok');
    });
  }

  // 在 (x, y) 绘制一张带标题的表格，返回绘制结束后的 y（已含底部留白）
  function drawTable(ctx, x, y, title, cols, rows, isGroup, summary) {
    var fontStack = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif';
    var headerH = 44, rowH = 34;
    var tableW = 0; cols.forEach(function (c) { tableW += c.w; });
    var rowsH = (rows.length ? rows.length * rowH : rowH) + (summary ? rowH : 0);
    var totalH = headerH + rowsH;
    var top = y;

    // 标题
    ctx.fillStyle = '#111827';
    ctx.font = '700 16px ' + fontStack;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, x, y + 16);
    y += 22;

    // 表头
    ctx.fillStyle = '#4F46E5';
    ctx.fillRect(x, y, tableW, headerH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 13px ' + fontStack;
    ctx.textBaseline = 'middle';
    var hx = x;
    cols.forEach(function (c) {
      ctx.textAlign = c.num || c.pct ? 'right' : 'left';
      ctx.fillText(c.label, c.num || c.pct ? (hx + c.w - 12) : (hx + 12), y + headerH / 2);
      hx += c.w;
    });
    y += headerH;

    // 数据行
    if (!rows.length) {
      ctx.fillStyle = '#F3F4F6';
      ctx.fillRect(x, y, tableW, rowH);
      ctx.fillStyle = '#9CA3AF';
      ctx.font = '400 12px ' + fontStack;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('暂无数据', x + 12, y + rowH / 2);
      y += rowH;
    } else {
      rows.forEach(function (r, ri) {
        ctx.fillStyle = (ri % 2 === 0) ? '#FFFFFF' : '#F8F9FB';
        ctx.fillRect(x, y, tableW, rowH);
        var rx = x;
        ctx.font = '400 13px ' + fontStack;
        ctx.textBaseline = 'middle';
        cols.forEach(function (c) {
          var val, color = null;
          if (c.pct) { val = pct(r[c.key]); color = satHex(r[c.key]); }
          else if (c.num) { val = (r[c.key] != null ? r[c.key] : ''); }
          else { val = r[c.key]; }
          ctx.fillStyle = color || '#1F2937';
          ctx.textAlign = c.num || c.pct ? 'right' : 'left';
          ctx.fillText(String(val), c.num || c.pct ? (rx + c.w - 12) : (rx + 12), y + rowH / 2);
          rx += c.w;
        });
        y += rowH;
      });
    }

    // 汇总行
    if (summary) {
      ctx.fillStyle = '#EEF2FF';
      ctx.fillRect(x, y, tableW, rowH);
      ctx.strokeStyle = '#4F46E5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y + 0.5);
      ctx.lineTo(x + tableW - 0.5, y + 0.5);
      ctx.stroke();
      ctx.lineWidth = 1;
      var sx = x;
      ctx.font = '600 13px ' + fontStack;
      ctx.textBaseline = 'middle';
      cols.forEach(function (c) {
        var val, color = null;
        if (c.pct) { val = pct(summary[c.key]); color = satHex(summary[c.key]); }
        else if (c.num) { val = (summary[c.key] != null ? summary[c.key] : ''); }
        else { val = summary.label || '校区汇总'; }
        ctx.fillStyle = color || '#1F2937';
        ctx.textAlign = c.num || c.pct ? 'right' : 'left';
        ctx.fillText(String(val), c.num || c.pct ? (sx + c.w - 12) : (sx + 12), y + rowH / 2);
        sx += c.w;
      });
      y += rowH;
    }

    // 外框 + 内部分隔线
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 21.5, tableW, totalH); // 标题下方起始
    // 列分隔线（浅）
    var cx = x;
    ctx.strokeStyle = '#F0F1F3';
    for (var i = 0; i < cols.length - 1; i++) {
      cx += cols[i].w;
      ctx.beginPath();
      ctx.moveTo(cx, top + 22 + headerH);
      ctx.lineTo(cx, top + 22 + totalH);
      ctx.stroke();
    }

    return y + 10;
  }

  // ---------- 路由 + 对外 ----------
  App.router.register('/weekly-kpi', function () { render(); });

  App.views = App.views || {};
  App.views.weeklyKpi = {
    onMonthChange: onMonthChange,
    onWeekChange: onWeekChange,
    onFilterChange: onFilterChange,
    onFilterInput: onFilterInput,
    resetFilters: resetFilters,
    toggleTeacher: toggleTeacher,
    selectAll: selectAll,
    editSchedule: editSchedule,
    saveSnapshot: saveSnapshot,
    deleteSnapshot: deleteSnapshot,
    archiveToDataCenter: archiveToDataCenter,
    exportImage: exportImage,
    exportXLSX: exportXLSX,
    retryFetch: retryFetch
  };

})();
