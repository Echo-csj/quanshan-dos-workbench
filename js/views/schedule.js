/* ============================================
   schedule.js — 课程表（方案B：教师 × 周分组）
   结构：teachers = [{ name, code, subject, summary, classes:{ "周一-08:00-10:00":"A班[13:00-20:00]"|"休息"|"" } }]
   导入：多选课表截图 → 同一把 DeepSeek 密钥的视觉模型识别 → 可编辑（按教师分块） → 核对后保存
   存储：structured 数据存于 localStorage（App.store.schedule），不存原图
   预留抓取字段：source('screenshot'|'manual'|'fetch')、sourceUrl、fetchedAt（未来接入自动抓取）
   ============================================ */

(function() {

  var DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var DEFAULT_PERIODS = ['08:00-10:00', '10:10-12:10', '12:50-14:50', '15:00-17:00', '17:30-19:30', '19:40-21:40'];

  // 自动抓取相关状态
  var lastFetched = null;     // 最近一次从 shared_link(kind='schedule_fetch') 读到的抓取结果
  var _dismissedKey = null;   // 已忽略的抓取时间戳，避免重复弹横幅
  var _fetchChannel = null;   // 抓取结果共享行的实时订阅
  var _pickerMonth = null;    // 课程表月份选择器的当前人工月（未选则从活动周推导）


  // 把常见星期写法归一到 周一..周日
  function normDay(d) {
    var map = {
      '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四',
      '星期五': '周五', '星期六': '周六', '星期日': '周日', '周天': '周日', '礼拜一': '周一'
    };
    return map[d] || d;
  }

  function thisMonday() {
    var d = new Date();
    var day = (d.getDay() + 6) % 7; // 让周一=0
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }
  function thisSunday() {
    var d = new Date(thisMonday());
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  }
  // 本地日期加 N 天（用于由周一推周日），避免 toISOString 的 UTC 偏移
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  function fmtRange(s, e) {
    if (s && e) return s + ' ~ ' + e;
    return '未设置周范围';
  }

  // 取某月最后一天（YYYY-MM -> YYYY-MM-DD），用于月度模式展示区间
  function lastDayOfMonth(ym) {
    var parts = String(ym).split('-');
    var y = parseInt(parts[0], 10), mo = parseInt(parts[1], 10);
    if (!y || !mo) return null;
    var d = new Date(y, mo, 0); // 下个月第 0 天 = 当月最后一天
    return y + '-' + (mo < 10 ? '0' + mo : '' + mo) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // 读取课表存储（含缺省结构）
  function getSchedule() {
    var d = App.store.get('schedule') || {};
    return {
      updatedAt: d.updatedAt || null,
      source: d.source || '',
      sourceUrl: d.sourceUrl || '',
      fetchedAt: d.fetchedAt || null,
      screenshotsCount: d.screenshotsCount || 0,
      weekStartDate: d.weekStartDate || null,
      weekEndDate: d.weekEndDate || null,
      scheduleMode: d.scheduleMode || 'weekly',
      selMonth: d.selMonth || null,
      periods: (d.periods && d.periods.length) ? d.periods.slice() : DEFAULT_PERIODS.slice(),
      teachers: (d.teachers && d.teachers.length) ? d.teachers.slice() : []
    };
  }

  /* ---------------- 多周并存：周次存档（schedules 映射） ---------------- */
  // 懒迁移：schedules 为空且活动 schedule 已有周起始日时，把当前活动周种子化进 schedules
  function ensureSchedules() {
    var map = App.store.get('schedules');
    if (map && typeof map === 'object' && Object.keys(map).length) return; // 已有数据
    var s = App.store.get('schedule') || {};
    if (s && s.weekStartDate && /^\d{4}-\d{2}-\d{2}$/.test(s.weekStartDate)) {
      var m2 = {}; m2[s.weekStartDate] = s;
      App.store.set('schedules', m2);
    } else {
      App.store.set('schedules', {});
    }
  }

  // 写入/更新某周存档（按 weekStartDate 为键）
  function writeSchedule(data) {
    if (!data || !data.weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.weekStartDate)) return;
    var map = App.store.get('schedules') || {};
    map[data.weekStartDate] = data;
    App.store.set('schedules', map);
  }

  // 所有已存周（按 weekStart 倒序），用于周次切换下拉
  function getScheduleWeeks() {
    var map = App.store.get('schedules') || {};
    var keys = Object.keys(map).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); });
    keys.sort().reverse();
    return keys.map(function (k) {
      var w = map[k];
      var we = w.weekEndDate || '';
      var label = k + ' ~ ' + we;
      if (App.weeklyCycle && App.weeklyCycle.artMonthOfDate) {
        var info = App.weeklyCycle.artMonthOfDate(k);
        if (info) label = '第' + info.weekNo + '周 (' + k.slice(5) + '~' + String(we).slice(5) + ')';
      }
      return { weekStart: k, weekEnd: we, label: label };
    });
  }

  // 为月份+周次选择器构造可用人工月列表：近 12 个月 + 所有存档周所在月 + 当前活动周所在月
  function pickerMonths(data) {
    var set = {};
    (App.weeklyCycle.recentMonths(12) || []).forEach(function (m) { set[m] = true; });
    var map = App.store.get('schedules') || {};
    Object.keys(map).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      var info = App.weeklyCycle.artMonthOfDate(k);
      if (info) set[info.artMonthId] = true;
    });
    if (data && data.weekStartDate) {
      var curInfo = App.weeklyCycle.artMonthOfDate(data.weekStartDate);
      if (curInfo) set[curInfo.artMonthId] = true;
    }
    var months = Object.keys(set).sort().reverse();
    if (!months.length) months = App.weeklyCycle.recentMonths(12);
    return months;
  }

  // 当前选择器应显示的 (month, week, months)
  function currentPickerInfo(data) {
    var months = pickerMonths(data);
    var month = _pickerMonth;
    var week = 1;
    if (data && data.weekStartDate) {
      var curInfo = App.weeklyCycle.artMonthOfDate(data.weekStartDate);
      if (curInfo) {
        if (!month || months.indexOf(month) < 0) month = curInfo.artMonthId;
        if (curInfo.artMonthId === month) week = curInfo.weekNo;
      }
    }
    if (!month || months.indexOf(month) < 0) month = months[0] || App.weeklyCycle.recentMonths(12)[0];
    return { months: months, month: month, week: week };
  }

  // 切换到指定日期范围的周：有存档则载入，无存档则新建空白周（不写入 schedules，保存时才写）
  function switchToWeek(weekStart, weekEnd) {
    var container = document.getElementById('view-container');
    var map = App.store.get('schedules') || {};
    var wd = map[weekStart];
    if (wd) {
      var data = JSON.parse(JSON.stringify(wd));
      App.store.set('schedule', data);
      renderShell(container, data);
      App.util.toast('已切换到 ' + weekStart + ' ~ ' + weekEnd + ' 周课程表', 'ok');
      return;
    }
    var cur = getSchedule();
    var data = {
      updatedAt: null, source: '', sourceUrl: '', fetchedAt: null, screenshotsCount: 0,
      weekStartDate: weekStart, weekEndDate: weekEnd,
      scheduleMode: 'weekly', selMonth: null,
      periods: (cur.periods && cur.periods.length) ? cur.periods.slice() : DEFAULT_PERIODS.slice(),
      teachers: []
    };
    App.store.set('schedule', data);
    renderShell(container, data);
    App.util.toast('该周暂无存档，已新建空白周 ' + weekStart + ' ~ ' + weekEnd + '，填写后保存', 'ok');
  }

  // 新建一个空白周（默认本周一 ~ 本周日）
  function newThisWeek() {
    var container = document.getElementById('view-container');
    var cur = getSchedule();
    var data = {
      updatedAt: null, source: '', sourceUrl: '', fetchedAt: null, screenshotsCount: 0,
      weekStartDate: thisMonday(), weekEndDate: thisSunday(),
      scheduleMode: 'weekly', selMonth: null,
      periods: (cur.periods && cur.periods.length) ? cur.periods.slice() : DEFAULT_PERIODS.slice(),
      teachers: []
    };
    App.store.set('schedule', data);
    renderShell(container, data);
    App.util.toast('已新建一周（本周一 ~ 本周日），填写后保存', 'ok');
  }

  // 切换周次：选中已存周 → 载入编辑器；"新建周" → 新建本周空白周
  function switchWeek(val) {
    if (val === '__new__') { newThisWeek(); return; }
    var map = App.store.get('schedules') || {};
    var wd = map[val];
    if (!wd) return;
    switchToWeek(wd.weekStartDate, wd.weekEndDate || '');
  }

  // 月份+周次选择器回调：切换月份只刷新周次下拉（不改活动周）
  function onPickerMonthChange(v) {
    _pickerMonth = v;
    var container = document.getElementById('view-container');
    renderShell(container, getSchedule());
  }

  // 月份+周次选择器回调：切换周次后解析为真实日期并切换到该周
  function onPickerWeekChange(v) {
    var weekNo = parseInt(v, 10) || 1;
    var info = currentPickerInfo(getSchedule());
    var wk = App.weeklyCycle.resolveWeek(info.month, weekNo);
    if (!wk) { App.util.toast('所选周次无效', 'warn'); return; }
    _pickerMonth = null; // 切换后让选择器跟随活动周自动推导
    switchToWeek(wk.start, wk.end);
  }

  // 删除当前周存档（带确认）
  function deleteWeek() {
    var container = document.getElementById('view-container');
    var cur = getSchedule();
    var ws = cur.weekStartDate;
    if (!ws || !/^\d{4}-\d{2}-\d{2}$/.test(ws)) { App.util.toast('当前没有可删除的周', 'warn'); return; }
    App.util.modal({
      title: '删除当前周课程表',
      content: '将删除「' + ws + ' ~ ' + (cur.weekEndDate || '') + '」这周的课表存档（不可恢复）。该周在 KPI / 数据中心中若已引用，将回退为快照/归档数据。',
      confirmText: '删除',
      onConfirm: function (close) {
        var map = App.store.get('schedules') || {};
        delete map[ws];
        App.store.set('schedules', map);
        if (cur.weekStartDate === ws) {
          var nd = {
            updatedAt: null, source: '', sourceUrl: '', fetchedAt: null, screenshotsCount: 0,
            weekStartDate: null, weekEndDate: null,
            scheduleMode: 'weekly', selMonth: null,
            periods: (cur.periods && cur.periods.length) ? cur.periods.slice() : DEFAULT_PERIODS.slice(),
            teachers: []
          };
          App.store.set('schedule', nd);
          renderShell(container, nd);
        } else {
          renderShell(container, getSchedule());
        }
        App.util.toast('已删除该周存档', 'ok');
        close();
      }
    });
  }

  App.router.register('/schedule', function() {
    var container = document.getElementById('view-container');
    if (!container) return;
    teardownFetchRealtime();
    renderShell(container, getSchedule());
    setupFetchRealtime();
    refreshFetchBanner();
  });

  function renderShell(container, data) {
    var U = App.util;
    data = data || getSchedule();
    var updatedAt = data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN') : '尚未导入';
    var srcInfo = '';
    if (data.source === 'screenshot') srcInfo = ' · 来源：' + (data.screenshotsCount || 0) + ' 张截图';
    else if (data.source === 'fetch') srcInfo = ' · 来源：自动抓取';
    else if (data.source === 'manual') srcInfo = ' · 来源：手动填写';

    var html = '';
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('calendar', 18) + '课程表</h3>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.schedule.importSchedule()">' + U.svgIcon('upload', 14) + '导入课程表</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.schedule.addTeacher()">' + U.svgIcon('user-plus', 14) + '添加教师</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.schedule.saveGrid()">' + U.svgIcon('check', 14) + '保存课程表</button>';
    html += '<button class="btn btn-danger btn-ghost btn-sm" onclick="App.views.schedule.clearGrid()">' + U.svgIcon('trash-2', 14) + '清空</button>';
    if (syncEnabled()) {
      html += '<button class="btn btn-secondary btn-sm" onclick="App.views.schedule.syncNow()">' + U.svgIcon('refresh-cw', 14) + '同步抓取</button>';
    }
    html += '</div></div>';
    // 月份+周次选择器（多周并存）：与 KPI 视图同口径，选择某周后载入或新建空白周
    var pickerInfo = currentPickerInfo(data);
    html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">';
    html += '<label style="font-size:12px;color:var(--text-muted)">月份/周次' +
      App.components.monthWeekPicker.html({
        month: pickerInfo.month,
        week: pickerInfo.week,
        months: pickerInfo.months,
        monthCb: 'App.views.schedule.onPickerMonthChange(this.value)',
        weekCb: 'App.views.schedule.onPickerWeekChange(this.value)'
      }) + '</label>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.schedule.newThisWeek()">' + U.svgIcon('plus', 14) + '新建周</button>';
    html += '<button class="btn btn-danger btn-ghost btn-sm" onclick="App.views.schedule.deleteWeek()">' + U.svgIcon('trash-2', 14) + '删除当前周</button>';
    html += '<span style="font-size:12px;color:var(--text-muted)">（切换月份/周次编辑历史周；「同步抓取」抓的是当前正在查看的周，可在 KPI 视图实时重算）</span>';
    html += '</div>';
    html += '<div id="schedule-fetch-banner"></div>';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">上次更新：' + U.escapeHtml(updatedAt) + U.escapeHtml(srcInfo) + '</p>';
    html += '<p class="form-hint" style="margin-bottom:14px">按教师分块排布（每位教师一行组，周一至周日 7 列、时间节次为行）。导入：选择多张课表截图，由 AI（DeepSeek 视觉模型，复用现有密钥）识别为可编辑课程表；识别后请在网页里核对修正，再点「保存课程表」。无密钥或识别异常时，可直接手动添加教师与节次填写。</p>';

    // 日期选择模式（周度 / 月度）
    var mode = data.scheduleMode || 'weekly';
    var selMonth = data.selMonth || (data.weekStartDate ? data.weekStartDate.slice(0, 7) : new Date().toISOString().slice(0, 7));
    var ws = data.weekStartDate || thisMonday();
    var we = data.weekEndDate || thisSunday();
    var rangeStart = ws, rangeEnd = we;
    if (mode === 'monthly' && selMonth) { rangeStart = selMonth + '-01'; rangeEnd = lastDayOfMonth(selMonth); }

    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:14px;font-size:12px;color:var(--text-muted)">';
    html += '<div class="seg" style="margin-right:4px">';
    html += '<button type="button" class="' + (mode === 'weekly' ? 'active' : '') + '" onclick="App.views.schedule.setScheduleMode(\'weekly\')">周度</button>';
    html += '<button type="button" class="' + (mode === 'monthly' ? 'active' : '') + '" onclick="App.views.schedule.setScheduleMode(\'monthly\')">月度</button>';
    html += '</div>';
    if (mode === 'monthly') {
      html += '<label>月份 <input type="month" class="form-input" data-field="selMonth" value="' + U.escapeAttr(selMonth) + '" style="width:auto;display:inline-block" onchange="App.views.schedule.onMonthChange(this.value)"></label>';
    } else {
      html += '<label>本周一 <input type="date" class="form-input" data-field="weekStartDate" value="' + U.escapeAttr(ws) + '" style="width:auto;display:inline-block"></label>';
      html += '<label>本周日 <input type="date" class="form-input" data-field="weekEndDate" value="' + U.escapeAttr(we) + '" style="width:auto;display:inline-block"></label>';
    }
    html += '<span style="color:var(--text-muted)">（' + U.escapeHtml(fmtRange(rangeStart, rangeEnd)) + '）</span>';
    html += '</div>';

    // 时间节次编辑器
    html += '<div style="margin-bottom:16px"><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">时间节次（点击可改，× 删除）</div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">';
    data.periods.forEach(function (p, i) {
      html += '<span style="display:inline-flex;align-items:center;gap:2px;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--surface-2)">';
      html += '<input class="form-input" data-period-index="' + i + '" value="' + U.escapeAttr(p) + '" style="width:104px;height:auto;padding:2px 4px;font-size:12px;border:none;background:transparent">';
      html += '<button class="btn btn-ghost btn-sm" style="padding:0 5px;line-height:1" onclick="App.views.schedule.removePeriod(' + i + ')">×</button>';
      html += '</span>';
    });
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.schedule.addPeriod()">+ 添加节次</button>';
    html += '</div></div>';


    html += '<div id="schedule-teachers"></div>';
    html += '<input type="file" id="schedule-file" accept="image/*" multiple style="display:none" onchange="App.views.schedule.onFiles(this)">';
    html += '</div>';

    container.innerHTML = html;
    renderTeachers(data.teachers, data.periods);
  }

  function renderTeachers(teachers, periods) {
    var wrap = document.getElementById('schedule-teachers');
    if (!wrap) return;
    var html = '';
    if (!teachers || !teachers.length) {
      html += '<div class="card" style="padding:18px;text-align:center;color:var(--text-muted);font-size:13px">暂无教师课程表，点上方「添加教师」或「导入课程表」开始。</div>';
    } else {
      teachers.forEach(function (t, i) { html += renderTeacherBlock(t, periods, i); });
    }
    wrap.innerHTML = html;
  }

  function renderTeacherBlock(t, periods, index) {
    var U = App.util;
    var html = '';
    html += '<div class="card" style="margin-bottom:16px" data-teacher-index="' + index + '">';
    // 教师信息行
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">';
    html += teacherInput(index, 'name', t.name, '教师姓名', '140px');
    html += teacherInput(index, 'code', t.code, '工号/编码', '110px');
    html += teacherInput(index, 'subject', t.subject, '学科', '110px');
    html += teacherInput(index, 'summary', t.summary, '本周汇总', '200px');
    html += '<button class="btn btn-danger btn-ghost btn-sm" onclick="App.views.schedule.removeTeacher(' + index + ')">' + U.svgIcon('trash-2', 14) + '删除</button>';
    html += '</div>';
    // 课表
    html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:760px"><thead>';
    // 第一行：星期
    html += '<tr><th style="position:sticky;left:0;background:var(--surface);z-index:1;min-width:92px">时间</th>';
    DAYS.forEach(function (d) { html += '<th>' + d + '</th>'; });
    html += '</tr>';
    // 第二行：当天班制（来自源站 .arrange，与时间段正交，不占用格内显示空间）
    html += '<tr style="font-size:11px;color:var(--text-muted)"><th style="position:sticky;left:0;background:var(--surface);font-weight:500;z-index:1">班制</th>';
    DAYS.forEach(function (d) {
      var shift = (t.dayArrange && t.dayArrange[d]) || '';
      if (shift) {
        html += '<td style="text-align:center;padding:3px 4px;white-space:nowrap"><span style="display:inline-block;background:color-mix(in srgb,var(--indigo,#4F46E5) 12%,var(--surface));color:var(--indigo,#4F46E5);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500">' + U.escapeHtml(shift) + '</span></td>';
      } else {
        html += '<td style="text-align:center;padding:3px 4px;color:var(--text-muted);opacity:.4">—</td>';
      }
    });
    html += '</tr>';
    html += '</thead><tbody>';
    periods.forEach(function (p) {
      html += '<tr><td class="mono" style="position:sticky;left:0;background:var(--surface);font-size:12px;white-space:nowrap">' + U.escapeHtml(p) + '</td>';
      DAYS.forEach(function (d) {
        var key = d + '-' + p;
        var val = (t.classes && t.classes[key]) || '';
        html += '<td style="padding:4px;vertical-align:top;min-width:92px">';
        html += '<input class="form-input schedule-cell" data-teacher-index="' + index + '" data-day="' + d + '" data-period="' + U.escapeAttr(p) + '" value="' + U.escapeAttr(val) + '" placeholder="—" style="padding:3px 6px;font-size:12px;height:auto">';
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function teacherInput(idx, field, val, ph, width) {
    var U = App.util;
    return '<input class="form-input" data-teacher-index="' + idx + '" data-field="' + field + '" value="' + U.escapeAttr(val || '') + '" placeholder="' + ph + '" style="width:' + (width || '120px') + ';height:auto;padding:4px 8px;font-size:12px">';
  }

  /* ---------------- 从 DOM 收集数据 ---------------- */
  function collectData() {
    var root = document.getElementById('view-container');
    if (!root) return getSchedule();
    var data = getSchedule();

    var ws = root.querySelector('[data-field="weekStartDate"]');
    var we = root.querySelector('[data-field="weekEndDate"]');
    data.weekStartDate = ws ? ws.value : data.weekStartDate;
    data.weekEndDate = we ? we.value : data.weekEndDate;

    var periods = [];
    root.querySelectorAll('[data-period-index]').forEach(function (inp) {
      periods.push((inp.value || '').trim() || '未命名节次');
    });
    data.periods = periods.length ? periods : DEFAULT_PERIODS.slice();

    var teachers = [];
    root.querySelectorAll('[data-teacher-index]').forEach(function (block) {
      var get = function (f) { var el = block.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; };
      var idxAttr = block.getAttribute('data-teacher-index');
      var idx = idxAttr ? parseInt(idxAttr, 10) : NaN;
      var prev = (!isNaN(idx) && data.teachers && data.teachers[idx]) ? data.teachers[idx] : {};
      var t = { name: get('name').trim(), code: get('code').trim(), subject: get('subject').trim(), summary: get('summary').trim(), classes: {}, dayArrange: prev.dayArrange || {} };
      block.querySelectorAll('.schedule-cell').forEach(function (cell) {
        var d = cell.getAttribute('data-day');
        var p = cell.getAttribute('data-period');
        var v = (cell.value || '').trim();
        if (v) t.classes[d + '-' + p] = v;
      });
      teachers.push(t);
    });
    data.teachers = teachers;
    return data;
  }

  function saveGrid() {
    var data = collectData();
    data.updatedAt = new Date().toISOString();
    if (!data.source) data.source = 'manual';
    App.store.set('schedule', data);
    writeSchedule(data);
    App.util.toast('课程表已保存', 'ok');
    renderShell(document.getElementById('view-container'), getSchedule());
  }

  function addTeacher() {
    var data = collectData();
    data.teachers.push({ name: '', code: '', subject: '', summary: '', classes: {} });
    renderTeachers(data.teachers, data.periods);
  }

  function removeTeacher(idx) {
    var data = collectData();
    if (idx < 0 || idx >= data.teachers.length) return;
    var name = data.teachers[idx].name || ('第' + (idx + 1) + '位教师');
    App.util.modal({
      title: '删除教师课程表',
      content: '将删除「' + App.util.escapeHtml(name) + '」的课程表块（除非已保存可重新导入）。此操作不可恢复。',
      confirmText: '删除',
      onConfirm: function (close) {
        data.teachers.splice(idx, 1);
        renderTeachers(data.teachers, data.periods);
        close();
      }
    });
  }

  function addPeriod() {
    var data = collectData();
    var n = data.periods.length + 1;
    data.periods.push('节次' + n);
    renderTeachers(data.teachers, data.periods);
  }

  function removePeriod(idx) {
    var data = collectData();
    if (idx < 0 || idx >= data.periods.length) return;
    App.util.modal({
      title: '删除时间节次',
      content: '将删除节次「' + App.util.escapeHtml(data.periods[idx]) + '」及其对应列（所有教师的该列内容会一并清除）。',
      confirmText: '删除',
      onConfirm: function (close) {
        var removed = data.periods[idx];
        data.periods.splice(idx, 1);
        data.teachers.forEach(function (t) {
          if (!t.classes) return;
          DAYS.forEach(function (d) { delete t.classes[d + '-' + removed]; });
        });
        renderTeachers(data.teachers, data.periods);
        close();
      }
    });
  }

  function clearGrid() {
    App.util.modal({
      title: '确认清空课程表',
      content: '将清除当前课程表所有内容（除非已保存过可重新导入）。此操作不可恢复。',
      confirmText: '清空',
      onConfirm: function (close) {
        App.store.set('schedule', {
          updatedAt: null, source: '', sourceUrl: '', fetchedAt: null, screenshotsCount: 0,
          weekStartDate: null, weekEndDate: null, periods: DEFAULT_PERIODS.slice(), teachers: []
        });
        renderShell(document.getElementById('view-container'), getSchedule());
        App.util.toast('已清空', 'ok');
        close();
      }
    });
  }

  /* ---------------- 导入流程 ---------------- */
  function importSchedule() {
    var input = document.getElementById('schedule-file');
    if (input) input.click();
  }

  function onFiles(input) {
    var files = Array.prototype.slice.call(input.files || []);
    if (input.value) input.value = ''; // 重置以便重复选同一文件
    if (!files.length) return;

    if (!App.ai || !App.ai.isReady()) {
      App.util.toast('请先在「设置 → AI」配置 DeepSeek Key 并启用（课程表识别依赖视觉模型），也可直接手动填写', 'warn');
      return;
    }

    App.util.toast('正在识别 ' + files.length + ' 张截图，请稍候…');
    readFilesAsDataURLs(files).then(function (urls) {
      var sys = '你是一个课程表识别助手。下面是一张或多张课程表截图，整体按「教师」分组：每位教师占一块，'
        + '块内为周一至周日 7 列、若干时间节次为行的表格，单元格内容是该教师当节课的安排文字（如「A班[13:00-20:00]」「休息」「陪读[15:00-17:00]」或班级名）。'
        + '请合并所有截图，输出一个严格 JSON，不要任何解释或代码块：'
        + '{"weekStartDate":"2026-08-31","weekEndDate":"2026-09-06",'
        + '"periods":["08:00-10:00","10:10-12:10"],'
        + '"teachers":[{"name":"教师姓名","code":"工号/编码","subject":"学科","summary":"本周汇总文字",'
        + '"classes":{"周一-08:00-10:00":"A班[13:00-20:00]","周五-15:00-17:00":"陪读[15:00-17:00]","周三-10:10-12:10":"休息"}}]}。'
        + '规则：1) classes 的键为「星期-节次」格式（如 周一-08:00-10:00）；2) 无课或休息的格子也要写出（值为「休息」或留空字符串）；'
        + '3) periods 为时间节次数组，按出现先后；4) 多张截图请合并进同一份 JSON；5) 只输出 JSON，不要 ``` 包裹。';
      return App.ai.parseImages(sys, urls, { temperature: 0, maxTokens: 6000, timeout: 180000 });
    }).then(function (r) {
      if (!r.ok) { App.util.toast('识别失败：' + (r.error || '未知错误') + '，可手动填写', 'bad'); return; }
      var parsed = extractJSON(r.text);
      if (!parsed || !parsed.teachers || !parsed.teachers.length) {
        App.util.toast('识别结果无法解析为教师分组结构，可手动填写', 'bad'); return;
      }
      var nd = normalizeData(parsed);
      nd.updatedAt = new Date().toISOString();
      nd.source = 'screenshot';
      nd.screenshotsCount = files.length;
      nd.sourceUrl = '';
      nd.fetchedAt = null;
      App.store.set('schedule', nd);
      writeSchedule(nd);
      renderShell(document.getElementById('view-container'), nd);
      App.util.toast('识别完成，请核对后点「保存课程表」', 'ok');
    }).catch(function (e) {
      App.util.toast('识别出错：' + ((e && e.message) || e) + '，可手动填写', 'bad');
    });
  }

  function readFilesAsDataURLs(files) {
    return Promise.all(files.map(function (f) {
      return new Promise(function (res, rej) {
        var rd = new FileReader();
        rd.onload = function () { res(rd.result); };
        rd.onerror = function () { rej(new Error('图片读取失败')); };
        rd.readAsDataURL(f);
      });
    }));
  }

  function extractJSON(text) {
    if (!text) return null;
    var t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try { return JSON.parse(t); } catch (e) { /* ignore */ }
    var m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* ignore */ } }
    return null;
  }

  // 把 AI 返回结构归一到 { weekStartDate, weekEndDate, periods, teachers:[{name,code,subject,summary,classes}] }
  function normalizeData(parsed) {
    var periods = (parsed.periods && parsed.periods.length)
      ? parsed.periods.map(function (p) { return String(p).trim(); })
      : DEFAULT_PERIODS.slice();

    var teachers = [];
    (parsed.teachers || []).forEach(function (t) {
      var classes = {};
      var src = t.classes || {};
      Object.keys(src).forEach(function (k) {
        var idx = k.indexOf('-'); // 星期名不含连字符，按第一个 '-' 切分（节次如 08:00-10:00 含连字符）
        var ad = idx >= 0 ? k.slice(0, idx) : k;
        var ap = idx >= 0 ? k.slice(idx + 1) : '';
        var v = String(src[k] == null ? '' : src[k]).trim();
        if (v) classes[normDay(ad) + '-' + ap] = v;
      });
      teachers.push({
        name: String(t.name || '').trim(),
        code: String(t.code || '').trim(),
        subject: String(t.subject || '').trim(),
        summary: String(t.summary || '').trim(),
        classes: classes
      });
    });

    var ws = /^\d{4}-\d{2}-\d{2}$/.test(parsed.weekStartDate) ? parsed.weekStartDate : null;
    var we = /^\d{4}-\d{2}-\d{2}$/.test(parsed.weekEndDate) ? parsed.weekEndDate : null;
    if (!ws) ws = thisMonday();
    if (!we) we = thisSunday();

    return {
      weekStartDate: ws,
      weekEndDate: we,
      periods: periods,
      teachers: teachers,
      sourceUrl: parsed.sourceUrl || '',
      fetchedAt: parsed.fetchedAt || null
    };
  }

  /* ---------------- 自动抓取（后端 Edge Function → shared_link → 前端拉取） ---------------- */
  function syncEnabled() {
    var s = (App.sync && App.sync.getStatus) ? App.sync.getStatus() : 'disabled';
    return s === 'ok';
  }

  // 从 shared_link(kind='schedule_fetch') 读取最近一次抓取结果
  async function pullFetched() {
    if (!App.sync || !App.sync.readShared) return null;
    try {
      var rows = await App.sync.readShared();
      var row = (rows || []).filter(function (r) { return r && r.kind === 'schedule_fetch'; })[0];
      if (!row) return null;
      var p = row.payload || {};
      var sched = p.schedule;
      if (!sched || !sched.teachers) return null;
      sched._fetchedAt = p.fetchedAt || row.updated_at;
      return sched;
    } catch (e) { return null; }
  }

  async function refreshFetchBanner() {
    var fetched = await pullFetched();
    lastFetched = fetched;
    renderFetchBanner(fetched);
  }

  function renderFetchBanner(fetched) {
    var wrap = document.getElementById('schedule-fetch-banner');
    if (!wrap) return;
    if (!fetched) { wrap.innerHTML = ''; return; }
    var local = App.store.get('schedule') || {};
    var localTs = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
    var fetchedTs = fetched._fetchedAt ? new Date(fetched._fetchedAt).getTime() : 0;
    // 已是最新抓取版本 → 不重复弹
    if (fetchedTs && localTs && fetchedTs <= localTs && local.source === 'fetch') { wrap.innerHTML = ''; return; }
    if (fetched._fetchedAt && fetched._fetchedAt === _dismissedKey) { wrap.innerHTML = ''; return; }

    var U = App.util;
    var when = fetched._fetchedAt ? new Date(fetched._fetchedAt).toLocaleString('zh-CN') : '未知时间';
    var n = (fetched.teachers || []).length;
    var wkLabel = (fetched.weekStartDate ? (fetched.weekStartDate + ' ~ ' + (fetched.weekEndDate || '')) : '本周');
    wrap.innerHTML = '<div class="card" style="margin-bottom:14px;border:1px solid var(--indigo,#4F46E5);background:color-mix(in srgb,var(--indigo,#4F46E5) 7%,var(--surface))">'
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:200px"><div style="font-weight:600">检测到自动抓取的课程表</div>'
      + '<div style="font-size:12px;color:var(--text-muted)">抓取于 ' + U.escapeHtml(when) + ' · ' + n + ' 位教师'
      + ' · 周次：' + U.escapeHtml(wkLabel)
      + (fetched.sourceUrl ? (' · 来源：' + U.escapeHtml(fetched.sourceUrl)) : '') + '</div></div>'
      + '<button class="btn btn-primary btn-sm" onclick="App.views.schedule.applyFetchedFromBanner()">应用抓取结果</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="App.views.schedule.dismissFetchBanner()">忽略</button>'
      + '</div></div>';
  }

  function applyFetched(sched) {
    var data = {
      updatedAt: new Date().toISOString(),
      source: 'fetch',
      sourceUrl: sched.sourceUrl || '',
      fetchedAt: sched._fetchedAt || null,
      screenshotsCount: 0,
      weekStartDate: sched.weekStartDate || null,
      weekEndDate: sched.weekEndDate || null,
      periods: sched.periods || DEFAULT_PERIODS.slice(),
      teachers: sched.teachers || []
    };
    App.store.set('schedule', data);
    writeSchedule(data);
    renderShell(document.getElementById('view-container'), data);
    App.util.toast('已应用抓取的课程表', 'ok');
    var banner = document.getElementById('schedule-fetch-banner');
    if (banner) banner.innerHTML = '';
  }

  function applyFetchedFromBanner() {
    if (lastFetched) applyFetched(lastFetched);
  }
  function dismissFetchBanner() {
    if (lastFetched && lastFetched._fetchedAt) _dismissedKey = lastFetched._fetchedAt;
    var banner = document.getElementById('schedule-fetch-banner');
    if (banner) banner.innerHTML = '';
  }

  // 取当前用户会话 JWT；失败返回空字符串
  async function getSessionJWT() {
    try {
      var sb = (App.sync && App.sync.getClient) ? App.sync.getClient() : null;
      if (sb && sb.auth && sb.auth.getSession) {
        var s = await sb.auth.getSession();
        return (s && s.data && s.data.session && s.data.session.access_token) || '';
      }
    } catch (e) {}
    return '';
  }
  // 尝试刷新会话并返回新 JWT
  async function refreshSessionJWT() {
    try {
      var sb = (App.sync && App.sync.getClient) ? App.sync.getClient() : null;
      if (sb && sb.auth && sb.auth.refreshSession) {
        var r = await sb.auth.refreshSession();
        return (r && r.data && r.data.session && r.data.session.access_token) || '';
      }
    } catch (e) {}
    return '';
  }
  async function doFetch(url, jwt, bodyObj) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
      body: JSON.stringify(bodyObj || {})
    });
  }

  // 触发 fetch-schedule 立即抓取一次（腾讯云 Node 服务，路径反代）
  // 抓取「当前正在查看的周」（含历史周）：从活动 schedule 取 weekStartDate/weekEndDate 传给后端
  // 轮询从 shared_link 拉回抓取结果，并校验周次精确对应（后端可能略有写入延迟）
  async function pullFetchedWithRetry(weekStart, tries, delay) {
    for (var i = 0; i < tries; i++) {
      var s = await pullFetched();
      if (s && s.weekStartDate === weekStart) return s;
      if (i < tries - 1) await new Promise(function (r) { setTimeout(r, delay); });
    }
    return null;
  }

  // 自动抓取指定周课程表（供教师周度 KPI 视图联动）：
  //   POST 后端 fetch-schedule（带 weekStartDate=该周周一，后端 GET 导航到该周）→
  //   后端写回 Supabase shared_link → 前端 pullFetched 拉回 → 仅写入 schedules[W] 缓存。
  // 注意：只写「多周存档」schedules[W]，不改「当前编辑周」(store.schedule)，
  //       课程表模块视图与 KPI 视图互不干扰；两端数据同源、精确对应。
  async function fetchWeek(weekStart) {
    var url = (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.COURSE_FETCH_WORKER_URL) || '';
    if (!url) throw new Error('课表自动抓取尚未配置');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error('周次格式无效');
    var weekEnd = addDays(weekStart, 6);
    var body = { weekStartDate: weekStart, weekEndDate: weekEnd };
    var jwt = await getSessionJWT();
    App.util.toast('正在自动抓取 ' + weekStart + ' 周课程表…');
    var res = await doFetch(url, jwt, body);
    var j = await res.json().catch(function () { return {}; });
    if (res.status === 401) { // access_token 过期，刷新会话重试一次
      var fresh = await refreshSessionJWT();
      if (fresh && fresh !== jwt) {
        res = await doFetch(url, fresh, body);
        j = await res.json().catch(function () { return {}; });
      }
    }
    if (res.status === 401) throw new Error('会话已过期，请重新登录后重试');
    if (!res.ok || (j && j.ok === false)) throw new Error((j && (j.error || j.message)) || ('HTTP ' + res.status));
    var sched = await pullFetchedWithRetry(weekStart, 6, 400);
    if (!sched) throw new Error('抓取结果未回写，请稍后重试');
    writeSchedule(sched); // 仅缓存，不改当前编辑周
    return sched;
  }

  async function syncNow() {
    var url = (window.APP_CONFIG && window.APP_CONFIG.COURSE_FETCH_WORKER_URL) || '';
    if (!url) {
      App.util.toast('课表自动抓取尚未配置，无法触发', 'warn');
      return;
    }
    // 目标周 = 当前查看周（看历史周就抓历史周，看本周就抓本周）
    var cur = App.store.get('schedule') || {};
    var ws = /^\d{4}-\d{2}-\d{2}$/.test(cur.weekStartDate) ? cur.weekStartDate : thisMonday();
    var we = /^\d{4}-\d{2}-\d{2}$/.test(cur.weekEndDate) ? cur.weekEndDate : thisSunday();
    var body = { weekStartDate: ws, weekEndDate: we };
    // 手动触发：用当前登录用户的 Supabase 会话 JWT 鉴权（前端不再下发任何密钥，避免 cron secret 暴露）
    var jwt = await getSessionJWT();
    App.util.toast('正在从源站抓取 ' + ws + ' ~ ' + we + ' 周课程表…');
    try {
      var res = await doFetch(url, jwt, body);
      var j = await res.json().catch(function () { return {}; });
      // 401 可能是 access_token 过期，尝试刷新会话后重试一次
      if (res.status === 401) {
        var fresh = await refreshSessionJWT();
        if (fresh && fresh !== jwt) {
          res = await doFetch(url, fresh, body);
          j = await res.json().catch(function () { return {}; });
        }
      }
      if (res.status === 401) {
        App.util.toast('会话已过期或无效，请退出登录后重新登录再试', 'bad');
        return;
      }
      if (!res.ok || (j && j.ok === false)) {
        App.util.toast('抓取失败：' + ((j && (j.error || j.message)) || res.status), 'bad');
        return;
      }
      await refreshFetchBanner();
      App.util.toast('抓取完成，请核对后点「应用抓取结果」', 'ok');
    } catch (e) {
      App.util.toast('抓取出错：' + ((e && e.message) || e), 'bad');
    }
  }

  // 订阅抓取结果共享行：抓取落地后近实时刷新横幅
  function setupFetchRealtime() {
    if (!syncEnabled()) return;
    var c = App.sync.getClient(); if (!c) return;
    var s = App.sync.getSession && App.sync.getSession();
    var uid = s && s.user ? s.user.id : null;
    if (!uid) return;
    teardownFetchRealtime();
    try {
      _fetchChannel = c.channel('schedule-fetch-realtime:' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_link', filter: 'user_id=eq.' + uid }, function () { refreshFetchBanner(); })
        .subscribe();
    } catch (e) {}
  }
  function teardownFetchRealtime() {
    if (_fetchChannel) {
      try { _fetchChannel.unsubscribe(); } catch (e) {}
      try { var c = App.sync.getClient(); if (c && c.removeChannel) c.removeChannel(_fetchChannel); } catch (e) {}
      _fetchChannel = null;
    }
  }

  /* ---------------- 日期选择模式（周度 / 月度） ---------------- */
  // 切换日期选择模式：保留教师/节次等已编辑内容，仅切换日期选取方式
  function setScheduleMode(mode) {
    if (mode !== 'weekly' && mode !== 'monthly') return;
    var data = collectData(); // 保留当前教师表与节次
    data.scheduleMode = mode;
    if (mode === 'monthly') {
      if (!data.selMonth) {
        data.selMonth = data.weekStartDate ? data.weekStartDate.slice(0, 7) : new Date().toISOString().slice(0, 7);
      }
    } else {
      // 切回周度：清空月度选择（周范围沿用上次/默认，不覆盖既有填写）
      data.selMonth = null;
      if (!data.weekStartDate) data.weekStartDate = thisMonday();
      if (!data.weekEndDate) data.weekEndDate = thisSunday();
    }
    App.store.set('schedule', data);
    renderShell(document.getElementById('view-container'), data);
  }

  // 月度模式下选取某月：仅更新月份与展示区间，不动周度日期与课表内容
  function onMonthChange(val) {
    if (!/^\d{4}-\d{2}$/.test(val)) return;
    var data = collectData();
    data.scheduleMode = 'monthly';
    data.selMonth = val;
    App.store.set('schedule', data);
    renderShell(document.getElementById('view-container'), data);
  }
  /* ---------------- 对外 ---------------- */
  App.views = App.views || {};
  App.views.schedule = {
    importSchedule: importSchedule,
    onFiles: onFiles,
    saveGrid: saveGrid,
    addTeacher: addTeacher,
    removeTeacher: removeTeacher,
    addPeriod: addPeriod,
    removePeriod: removePeriod,
    clearGrid: clearGrid,
    // 自动抓取
    syncNow: syncNow,
    fetchWeek: fetchWeek,
    applyFetchedFromBanner: applyFetchedFromBanner,
    dismissFetchBanner: dismissFetchBanner,
    // 供未来「自动抓取」接入：把抓取/视觉模型返回的 JSON 归一到标准结构
    normalizeImport: normalizeData,
    // 日期选择模式（周度 / 月度）
    setScheduleMode: setScheduleMode,
    onMonthChange: onMonthChange,
    // 多周并存：周次切换 / 删除 / 新建
    switchWeek: switchWeek,
    deleteWeek: deleteWeek,
    newThisWeek: newThisWeek,
    getScheduleWeeks: getScheduleWeeks,
    ensureSchedules: ensureSchedules,
    // 月份+周次选择器回调
    onPickerMonthChange: onPickerMonthChange,
    onPickerWeekChange: onPickerWeekChange,
  };

  // 首次加载即确保 schedules 映射存在（懒迁移活动周）
  ensureSchedules();

})();
