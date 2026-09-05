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
  function fmtRange(s, e) {
    if (s && e) return s + ' ~ ' + e;
    return '未设置周范围';
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
      periods: (d.periods && d.periods.length) ? d.periods.slice() : DEFAULT_PERIODS.slice(),
      teachers: (d.teachers && d.teachers.length) ? d.teachers.slice() : []
    };
  }

  App.router.register('/schedule', function() {
    var container = document.getElementById('view-container');
    if (!container) return;
    renderShell(container, getSchedule());
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
    html += '</div></div>';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">上次更新：' + U.escapeHtml(updatedAt) + U.escapeHtml(srcInfo) + '</p>';
    html += '<p class="form-hint" style="margin-bottom:14px">按教师分块排布（每位教师一行组，周一至周日 7 列、时间节次为行）。导入：选择多张课表截图，由 AI（DeepSeek 视觉模型，复用现有密钥）识别为可编辑课程表；识别后请在网页里核对修正，再点「保存课程表」。无密钥或识别异常时，可直接手动添加教师与节次填写。</p>';

    // 周范围
    var ws = data.weekStartDate || thisMonday();
    var we = data.weekEndDate || thisSunday();
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:14px;font-size:12px;color:var(--text-muted)">';
    html += '<label>本周一 <input type="date" class="form-input" data-field="weekStartDate" value="' + U.escapeAttr(ws) + '" style="width:auto;display:inline-block"></label>';
    html += '<label>本周日 <input type="date" class="form-input" data-field="weekEndDate" value="' + U.escapeAttr(we) + '" style="width:auto;display:inline-block"></label>';
    html += '<span style="color:var(--text-muted)">（' + U.escapeHtml(fmtRange(ws, we)) + '）</span>';
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
    html += '<div style="overflow-x:auto"><table class="data-table" style="min-width:760px"><thead><tr><th style="position:sticky;left:0;background:var(--surface);z-index:1;min-width:92px">时间</th>';
    DAYS.forEach(function (d) { html += '<th>' + d + '</th>'; });
    html += '</tr></thead><tbody>';
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
    root.querySelectorAll('.schedule-teacher').forEach(function (block) {
      var get = function (f) { var el = block.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; };
      var t = { name: get('name').trim(), code: get('code').trim(), subject: get('subject').trim(), summary: get('summary').trim(), classes: {} };
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
    App.util.toast('课程表已保存', 'ok');
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
    // 供未来「自动抓取」接入：把抓取/视觉模型返回的 JSON 归一到标准结构
    normalizeImport: normalizeData
  };

})();
