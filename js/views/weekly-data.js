/* ============================================
   weekly-data.js（视图）— 周度数据中心 + 月度汇总
   功能：
     · 周度数据：列表（PK=weekStart）/ 归档当前周 / 一键历史回灌 / 锁定·解锁 / 删除 / 手动修正 / 导出
     · 月度汇总：跨周去重教师重算 + 科组/校区汇总 + 导出
   依赖：App.weeklyData（实体） / App.kpiEngine / App.weeklyCycle / App.util / XLSX
   ============================================ */

(function () {

  var _tab = 'weeks';            // 'weeks' | 'month'
  var _month = null;             // 当前所选人工月（月度汇总）
  var _manualRows = null;        // 手动修正的临时编辑行
  var _manualWeek = null;        // 正在修正的 weekStart
  var BASE = (App.kpiEngine && App.kpiEngine.BASE) || 16;

  function pct(v) { if (v == null || isNaN(v)) return '-'; return (v * 100).toFixed(0) + '%'; }

  // ---------- 渲染 ----------
  function render() {
    var c = document.getElementById('view-container');
    if (!c) return;
    var U = App.util;
    var isSub = !!(App.isSub && App.isSub());
    var html = '';
    html += '<div class="page-head"><h1 class="page-title">周度数据中心</h1>';
    html += '<p class="page-sub">按「周」归档 KPI 并锁定，支持历史回灌与跨周月度汇总重算 · 基准：每周 ' + BASE + ' 次课 = 100% 满负荷</p></div>';

    // 同步状态条（Option B：总台=云端同步；子台=总台镜像只读）
    var si = syncInfo();
    html += '<div class="wd-syncbar">';
    html += '<span class="sw-dot ' + si[0] + '"></span>';
    html += '<span class="wd-sync-text">' + si[1] + '</span>';
    if (isSub) html += '<span class="wd-readonly-tip">总台数据镜像 · 只读</span>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.weeklyData.syncNow()">' + U.svgIcon('refresh-cw', 14) + ' 立即同步</button>';
    html += '</div>';

    html += '<div class="tabs">';
    html += '<button class="tab' + (_tab === 'weeks' ? ' active' : '') + '" onclick="App.views.weeklyData.onTab(\'weeks\')">周度数据</button>';
    html += '<button class="tab' + (_tab === 'month' ? ' active' : '') + '" onclick="App.views.weeklyData.onTab(\'month\')">月度汇总</button>';
    html += '</div>';

    if (_tab === 'weeks') {
      html += '<div class="teacher-toolbar"><div class="teacher-filters"></div><div class="teacher-actions">';
      if (isSub) {
        html += '<span class="wd-readonly-tip">子工作台只读，归档与回灌请由总台操作</span>';
      } else {
        html += '<button class="btn btn-secondary btn-sm" onclick="App.views.weeklyData.archiveCurrent()">' + U.svgIcon('save', 14) + ' 归档当前周</button>';
        html += '<button class="btn btn-secondary btn-sm" onclick="App.views.weeklyData.backfill()">' + U.svgIcon('download', 14) + ' 一键历史回灌</button>';
      }
      html += '</div></div>';
      html += renderWeeks(isSub);
    } else {
      html += renderMonth();
    }

    c.innerHTML = html;
  }

  // 同步状态条文案/色点：跟随 App.sync.getStatus()
  function syncInfo() {
    var st = (App.sync && App.sync.getStatus) ? App.sync.getStatus() : 'disabled';
    var map = {
      disabled: ['grey', '云端同步未启用（仅本地）'],
      signedout: ['grey', '未登录，仅本地数据'],
      signingin: ['blue', '登录中…'],
      error: ['red', '同步异常，请重试'],
      ok: ['green', '已同步至云端'],
      syncing: ['blue', '同步中…']
    };
    return map[st] || ['grey', '状态未知'];
  }

  // 立即同步：总台→推送+拉取云端并刷新；子台→重新拉取总台镜像并刷新
  function syncNow() {
    if (App.isSub && App.isSub()) {
      if (App.subContext && App.subContext.loadMaster) {
        App.subContext.loadMaster().then(function () {
          App.util.toast('已刷新总台数据', 'ok');
          render();
        }).catch(function () {
          App.util.toast('刷新总台数据失败', 'bad');
        });
      }
      return;
    }
    if (App.sync && App.sync.syncNow) App.sync.syncNow();
  }

  function renderWeeks(isSub) {
    var recs = App.weeklyData.all();
    var html = '';
    html += '<div class="card"><div class="card-header"><h3 class="card-title">周度数据记录</h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">PK = 周一开始日(weekStart) · 来源：实时 / 快照 / 手动 · 锁定后不被覆盖</span></div>';
    if (!recs.length) {
      html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">暂无周度数据。' + (isSub ? '总台尚未归档或回灌任何周次。' : '点击上方「归档当前周」归档实时课程表，或「一键历史回灌」从旧 KPI 快照导入。') + '</div>';
    } else {
      html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:820px"><thead><tr>';
      ['人工月', '周次', '周范围', '来源', '锁定', '教师数', '预排合计', '实际合计', '操作'].forEach(function (h) { html += '<th>' + h + '</th>'; });
      html += '</tr></thead><tbody>';
      recs.forEach(function (r) {
        var srcLabel = { live: '实时', snapshot: '快照', manual: '手动' }[r.dataSource] || r.dataSource;
        var srcCls = { live: 'at-add', snapshot: 'at-update', manual: 'at-skip' }[r.dataSource] || '';
        var cs = r.campusSummary || {};
        html += '<tr>';
        html += '<td class="mono">' + App.util.escapeHtml(App.weeklyCycle.monthLabel(r.artMonthId)) + '</td>';
        html += '<td class="mono">第' + r.weekNo + '周</td>';
        html += '<td class="mono">' + r.weekStart + ' ~ ' + (r.weekEnd || '') + '</td>';
        html += '<td><span class="action-tag ' + srcCls + '">' + srcLabel + '</span></td>';
        html += '<td>' + (r.locked
          ? '<span style="color:var(--ok);font-weight:600">已锁定</span>'
          : '<span style="color:var(--text-muted)">未锁定</span>') + '</td>';
        html += '<td class="mono">' + (cs.teachers || 0) + '</td>';
        html += '<td class="mono">' + (cs.pre || 0) + '</td>';
        html += '<td class="mono">' + (cs.actual || 0) + '</td>';
        html += '<td class="wd-actions">';
        if (isSub) {
          html += '<button class="btn btn-ghost btn-xs" onclick="App.views.weeklyData.exportWeekXLSX(\'' + r.weekStart + '\')">导出</button>';
        } else {
          html += '<button class="btn btn-ghost btn-xs" onclick="App.views.weeklyData.toggleLock(\'' + r.weekStart + '\')">' + (r.locked ? '解锁' : '锁定') + '</button> ';
          html += '<button class="btn btn-ghost btn-xs" onclick="App.views.weeklyData.openManual(\'' + r.weekStart + '\')">修正</button> ';
          html += '<button class="btn btn-ghost btn-xs" onclick="App.views.weeklyData.exportWeekXLSX(\'' + r.weekStart + '\')">导出</button> ';
          html += '<button class="btn btn-ghost btn-xs" onclick="App.views.weeklyData.deleteRecord(\'' + r.weekStart + '\')">删除</button>';
        }
        html += '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  function renderMonth() {
    var months = App.weeklyData.monthsAvailable();
    var recent = App.weeklyCycle.recentMonths(12);
    recent.forEach(function (m) { if (months.indexOf(m) < 0) months.push(m); });
    months.sort().reverse();
    if (!_month || months.indexOf(_month) < 0) _month = months[0];

    var html = '';
    html += '<div class="teacher-toolbar"><div class="teacher-filters">';
    html += '<select class="form-input form-input-sm" id="wd-month" onchange="App.views.weeklyData.onMonthChange(this.value)">';
    months.forEach(function (m) {
      html += '<option value="' + m + '"' + (m === _month ? ' selected' : '') + '>' + App.weeklyCycle.monthLabel(m) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="teacher-actions"><button class="btn btn-primary btn-sm" onclick="App.views.weeklyData.exportMonthXLSX(\'' + _month + '\')">' + App.util.svgIcon('download', 14) + ' 导出月度报表</button></div>';
    html += '</div>';

    var sum = App.weeklyData.monthlySummary(_month);
    html += '<div class="card"><div class="card-header"><h3 class="card-title">月度汇总 · ' + App.util.escapeHtml(App.weeklyCycle.monthLabel(_month)) + '</h3>';
    html += '<span style="font-size:12px;color:var(--text-muted)">跨周去重教师 ' + sum.teachers + ' 人 · 覆盖 ' + sum.weeks + ' 周 · 饱和度 = Σ课次 / 16 / 去重教师数</span></div>';
    if (!sum.weeks) {
      html += '<div style="padding:16px;color:var(--text-muted);font-size:13px">该月暂无周度数据。请先在「周度数据」归档或回灌对应周次。</div>';
    } else {
      html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:680px"><thead><tr>';
      ['科组', '教师数', '预排合计', '实际合计', '请假合计', '预排饱和度', '实际饱和度'].forEach(function (h) { html += '<th>' + h + '</th>'; });
      html += '</tr></thead><tbody>';
      sum.groups.forEach(function (g) {
        html += '<tr>';
        html += '<td>' + App.util.escapeHtml(g.group) + '</td>';
        html += '<td class="mono">' + g.teachers + '</td>';
        html += '<td class="mono">' + g.pre + '</td>';
        html += '<td class="mono">' + g.actual + '</td>';
        html += '<td class="mono">' + g.leave + '</td>';
        html += '<td class="mono" style="font-weight:600">' + pct(g.preSat) + '</td>';
        html += '<td class="mono" style="font-weight:600">' + pct(g.actualSat) + '</td>';
        html += '</tr>';
      });
      html += '<tr style="font-weight:600;background:#EEF2FF;border-top:2px solid #4F46E5">';
      html += '<td>校区汇总</td>';
      html += '<td class="mono">' + sum.teachers + '</td>';
      html += '<td class="mono">' + sum.pre + '</td>';
      html += '<td class="mono">' + sum.actual + '</td>';
      html += '<td class="mono">' + sum.leave + '</td>';
      html += '<td class="mono">' + pct(sum.preSat) + '</td>';
      html += '<td class="mono">' + pct(sum.actualSat) + '</td>';
      html += '</tr>';
      html += '</tbody></table></div>';
    }
    html += '</div>';
    return html;
  }

  // ---------- 交互 ----------
  function onTab(t) { _tab = t; render(); }
  function onMonthChange(v) { _month = v; render(); }

  function archiveCurrent() {
    var sch = App.store.get('schedule') || {};
    if (!sch.weekStartDate) { App.util.toast('请先在「课程表」设置并保存本周', 'warn'); return; }
    var info = App.weeklyCycle.artMonthOfDate(sch.weekStartDate);
    if (!info) { App.util.toast('无法解析当前周', 'bad'); return; }
    var rec = App.weeklyData.computeFromLive(info.artMonthId, info.weekNo, {});
    if (!rec) { App.util.toast('计算失败', 'bad'); return; }
    App.weeklyData.upsert(rec);
    App.util.toast('已归档 ' + rec.weekStart + ' 周（来源：实时课程表）', 'ok');
    render();
  }

  function backfill() {
    var r = App.weeklyData.backfillFromSnapshots();
    App.util.toast('历史回灌完成：新增 ' + r.added + ' · 跳过 ' + r.skipped + '（共 ' + r.total + ' 条快照）', 'ok');
    render();
  }

  function toggleLock(weekStart) {
    var r = App.weeklyData.get(weekStart);
    if (!r) return;
    App.weeklyData.lock(weekStart, !r.locked);
    App.util.toast(r.locked ? '已解锁' : '已锁定', 'ok');
    render();
  }

  function deleteRecord(weekStart) {
    App.util.modal({
      title: '删除周度记录',
      content: '将删除 ' + weekStart + ' 周的周度记录，此操作不可恢复。',
      confirmText: '删除',
      onConfirm: function (close) {
        App.weeklyData.remove(weekStart);
        close();
        App.util.toast('已删除', 'ok');
        render();
      }
    });
  }

  // ---------- 手动修正（#191）----------
  function openManual(weekStart) {
    var r = App.weeklyData.get(weekStart);
    if (!r) { App.util.toast('记录不存在', 'bad'); return; }
    _manualWeek = weekStart;
    _manualRows = (r.kpiByTeacher || []).map(function (t) {
      return { name: t.name, group: t.group, pre: t.pre || 0, actual: t.actual || 0 };
    });
    if (!_manualRows.length) {
      App.util.toast('该周无教师明细，无法修正', 'warn');
      return;
    }
    var html = '';
    html += '<p class="form-hint" style="margin-bottom:10px">逐行修正「预排 / 实际」课次（请假 = 预排 − 实际）。保存后按科组与校区自动重算并锁定为「手动」。</p>';
    html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:420px"><thead><tr><th>教师</th><th>科组</th><th>预排课次</th><th>实际课次</th></tr></thead><tbody>';
    _manualRows.forEach(function (row, i) {
      html += '<tr>';
      html += '<td>' + App.util.escapeHtml(row.name) + '</td>';
      html += '<td>' + App.util.escapeHtml(row.group) + '</td>';
      html += '<td><input class="form-input form-input-sm" style="width:80px" type="number" min="0" value="' + row.pre + '" oninput="App.views.weeklyData.onManualInput(' + i + ',\'pre\',this.value)"></td>';
      html += '<td><input class="form-input form-input-sm" style="width:80px" type="number" min="0" value="' + row.actual + '" oninput="App.views.weeklyData.onManualInput(' + i + ',\'actual\',this.value)"></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    App.util.modal({
      title: '手动修正 · ' + weekStart,
      content: html,
      confirmText: '保存修正',
      onConfirm: function (close) { saveManual(); close(); }
    });
  }

  function onManualInput(idx, field, val) {
    if (!_manualRows || !_manualRows[idx]) return;
    var n = parseInt(val, 10);
    if (isNaN(n) || n < 0) n = 0;
    _manualRows[idx][field] = n;
  }

  function saveManual() {
    if (!_manualWeek || !_manualRows) return;
    var rows = _manualRows.map(function (r) {
      var pre = r.pre || 0, actual = r.actual || 0;
      if (actual > pre) actual = pre;            // 实际不超过预排
      return { name: r.name, group: r.group, pre: pre, leave: pre - actual, actual: actual };
    });
    var groups = App.kpiEngine.computeGroups(rows);
    var summary = App.kpiEngine.computeCampusSummary(groups);
    App.weeklyData.saveManual(_manualWeek, { kpiByTeacher: rows, kpiByGroup: groups, campusSummary: summary });
    App.util.toast('已保存修正（手动·锁定）', 'ok');
    _manualWeek = null; _manualRows = null;
    render();
  }

  // ---------- 导出 XLSX ----------
  function writeWorkbook(filename, sheets) {
    if (typeof XLSX === 'undefined') { App.util.toast('XLSX 库未加载，无法导出', 'bad'); return; }
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
      var ws = XLSX.utils.aoa_to_sheet(s.aoa);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    });
    XLSX.writeFile(wb, filename);
  }

  function exportWeekXLSX(weekStart) {
    var r = App.weeklyData.get(weekStart);
    if (!r) { App.util.toast('记录不存在', 'bad'); return; }
    var tAoa = [['教师', '科组', '预排周课次', '请假课次', '实际周课次', '预排饱和度', '实际饱和度']];
    (r.kpiByTeacher || []).forEach(function (t) {
      tAoa.push([t.name, t.group, t.pre, t.leave, t.actual, pct(t.pre / BASE), pct(t.actual / BASE)]);
    });
    var gAoa = [['科组', '教师数', '预排周课次', '实际周课次', '预排饱和度', '实际饱和度']];
    (r.kpiByGroup || []).forEach(function (g) {
      gAoa.push([g.group, g.teachers, g.pre, g.actual, pct(g.preSat), pct(g.actualSat)]);
    });
    var cs = r.campusSummary || {};
    var sAoa = [['项目', '教师数', '预排周课次', '实际周课次', '预排饱和度', '实际饱和度'],
      ['校区汇总', cs.teachers, cs.pre, cs.actual, pct(cs.preSat), pct(cs.actualSat)]];
    writeWorkbook('周度KPI_' + weekStart + '.xlsx', [
      { name: '按教师', aoa: tAoa }, { name: '按科组', aoa: gAoa }, { name: '校区汇总', aoa: sAoa }
    ]);
  }

  function exportMonthXLSX(artMonthId) {
    var sum = App.weeklyData.monthlySummary(artMonthId);
    if (!sum.weeks) { App.util.toast('该月暂无周度数据', 'warn'); return; }
    var mTitle = App.weeklyCycle.monthLabel(artMonthId);
    var sAoa = [['人工月', '覆盖周数', '去重教师数', 'Σ预排', 'Σ实际', 'Σ请假', '预排饱和度', '实际饱和度'],
      [mTitle, sum.weeks, sum.teachers, sum.pre, sum.actual, sum.leave, pct(sum.preSat), pct(sum.actualSat)]];
    var gAoa = [['科组', '教师数', '预排合计', '实际合计', '请假合计', '预排饱和度', '实际饱和度']];
    sum.groups.forEach(function (g) {
      gAoa.push([g.group, g.teachers, g.pre, g.actual, g.leave, pct(g.preSat), pct(g.actualSat)]);
    });
    var tAoa = [['教师', '科组', 'Σ预排', 'Σ实际', 'Σ请假']];
    sum.byTeacher.forEach(function (t) {
      tAoa.push([t.name, t.group, t.pre, t.actual, t.leave]);
    });
    writeWorkbook('月度汇总_' + artMonthId + '.xlsx', [
      { name: '月度汇总', aoa: sAoa }, { name: '按科组', aoa: gAoa }, { name: '按教师(跨周)', aoa: tAoa }
    ]);
  }

  // ---------- 路由 & 公共 API ----------
  App.router.register('/weekly-data', function () { render(); });

  App.views = App.views || {};
  App.views.weeklyData = {
    render: render,
    onTab: onTab,
    onMonthChange: onMonthChange,
    archiveCurrent: archiveCurrent,
    backfill: backfill,
    toggleLock: toggleLock,
    deleteRecord: deleteRecord,
    openManual: openManual,
    onManualInput: onManualInput,
    exportWeekXLSX: exportWeekXLSX,
    exportMonthXLSX: exportMonthXLSX,
    syncNow: syncNow
  };

})();
