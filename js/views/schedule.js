/* ============================================
   schedule.js — 课程表（方案A：多截图 + DeepSeek 视觉识别）
   导入：多选课表截图 → 同一把 DeepSeek 密钥的视觉模型识别 → 可编辑周网格 → 核对后保存
   存储：structured grid 存于 localStorage（App.store.schedule），不存原图
   ============================================ */

(function() {

  var DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var DEFAULT_PERIODS = ['第1节', '第2节', '第3节', '第4节', '第5节', '第6节', '第7节', '第8节'];
  var currentScreenshotCount = 0;

  // 把常见星期写法归一到 周一..周日
  function normDay(d) {
    var map = {
      '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四',
      '星期五': '周五', '星期六': '周六', '星期日': '周日', '周天': '周日', '礼拜一': '周一'
    };
    return map[d] || d;
  }

  App.router.register('/schedule', function() {
    var container = document.getElementById('view-container');
    if (!container) return;
    var data = App.store.get('schedule') || {};
    currentScreenshotCount = data.screenshotsCount || 0;
    renderShell(container, data.grid);
  });

  function renderShell(container, grid) {
    var U = App.util;
    var data = App.store.get('schedule') || {};
    var updatedAt = data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN') : '尚未导入';
    var srcInfo = data.screenshotsCount ? (' · 来源：' + data.screenshotsCount + ' 张截图') : '';

    var html = '';
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + U.svgIcon('calendar', 18) + '课程表</h3>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.schedule.importSchedule()">' + U.svgIcon('upload', 14) + '导入课程表</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.schedule.addRow()">' + U.svgIcon('plus', 14) + '添加节次</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.schedule.saveGrid()">' + U.svgIcon('check', 14) + '保存课程表</button>';
    html += '<button class="btn btn-danger btn-ghost btn-sm" onclick="App.views.schedule.clearGrid()">' + U.svgIcon('trash-2', 14) + '清空</button>';
    html += '</div></div>';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">上次更新：' + U.escapeHtml(updatedAt) + U.escapeHtml(srcInfo) + '</p>';
    html += '<p class="form-hint" style="margin-bottom:14px">导入：选择多张课表截图，由 AI（DeepSeek 视觉模型，复用现有密钥）识别为可编辑课程表；识别后请在网页里核对修正，再点「保存课程表」。无密钥或识别异常时，可直接手动填写。</p>';
    html += '<div id="schedule-grid-wrap"></div>';
    html += '<input type="file" id="schedule-file" accept="image/*" multiple style="display:none" onchange="App.views.schedule.onFiles(this)">';
    html += '</div>';

    container.innerHTML = html;
    renderGrid(grid);
  }

  function renderGrid(grid) {
    var wrap = document.getElementById('schedule-grid-wrap');
    if (!wrap) return;
    var U = App.util;
    var days = DAYS;
    var periods = (grid && grid.periods && grid.periods.length) ? grid.periods : DEFAULT_PERIODS.slice();
    var cells = (grid && grid.cells) ? grid.cells : {};

    var html = '<div style="overflow-x:auto"><table class="data-table" style="min-width:780px"><thead><tr><th style="position:sticky;left:0;background:var(--surface);z-index:1;min-width:64px">节次</th>';
    days.forEach(function (d) { html += '<th>' + d + '</th>'; });
    html += '</tr></thead><tbody>';
    periods.forEach(function (p) {
      html += '<tr><td class="mono" style="position:sticky;left:0;background:var(--surface);font-size:12px;white-space:nowrap">' + U.escapeHtml(p) + '</td>';
      days.forEach(function (d) {
        var key = d + '-' + p;
        var c = cells[key] || {};
        html += '<td style="padding:4px;vertical-align:top;min-width:96px">';
        html += cellInput(d, p, 'course', c.course, '课程');
        html += cellInput(d, p, 'teacher', c.teacher, '教师');
        html += cellInput(d, p, 'room', c.room, '教室');
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  function cellInput(day, period, field, val, ph) {
    var U = App.util;
    return '<input class="form-input schedule-cell" data-day="' + day + '" data-period="' + U.escapeAttr(period) + '" data-field="' + field + '" value="' + U.escapeAttr(val || '') + '" placeholder="' + ph + '" style="padding:3px 6px;font-size:12px;margin-bottom:3px;height:auto">';
  }

  // 从当前表单收集网格（按渲染顺序自然得出 periods）
  function collectGrid() {
    var inputs = document.querySelectorAll('#schedule-grid-wrap .schedule-cell');
    var periods = [];
    var cells = {};
    inputs.forEach(function (inp) {
      var d = inp.getAttribute('data-day');
      var p = inp.getAttribute('data-period');
      var f = inp.getAttribute('data-field');
      var v = inp.value;
      if (periods.indexOf(p) === -1) periods.push(p);
      var key = d + '-' + p;
      if (!cells[key]) cells[key] = { course: '', teacher: '', room: '' };
      cells[key][f] = v;
    });
    return { days: DAYS.slice(), periods: periods, cells: cells };
  }

  function saveGrid() {
    var grid = collectGrid();
    App.store.set('schedule', {
      updatedAt: new Date().toISOString(),
      source: currentScreenshotCount ? 'screenshot' : 'manual',
      screenshotsCount: currentScreenshotCount,
      grid: grid
    });
    App.util.toast('课程表已保存', 'ok');
  }

  function addRow() {
    var grid = collectGrid();
    grid.periods.push('第' + (grid.periods.length + 1) + '节');
    renderGrid(grid);
  }

  function clearGrid() {
    App.util.modal({
      title: '确认清空课程表',
      content: '将清除当前课程表所有内容（除非已保存过可重新导入）。此操作不可恢复。',
      confirmText: '清空',
      onConfirm: function (close) {
        App.store.set('schedule', { updatedAt: null, source: '', screenshotsCount: 0, grid: null });
        currentScreenshotCount = 0;
        renderShell(document.getElementById('view-container'), null);
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
      var sys = '你是一个课程表识别助手。下面是一张或多张课程表截图（可能按星期分段，如「周一至周三」「周四至周日」）。'
        + '请把它们合并识别为完整的一周（周一至周日）课程表，只输出一个严格 JSON，不要任何解释或代码块：'
        + '{"days":["周一","周二","周三","周四","周五","周六","周日"],"periods":["第1节","第2节"],'
        + '"cells":{"周一-第1节":{"course":"课程名","teacher":"教师","room":"教室"},"周二-第3节":{"course":"","teacher":"","room":""}}}。'
        + '规则：1) 每格对应一个节次某一天的一门课；2) 没有课的格子 course 留空字符串；3) periods 按节次先后顺序排列；'
        + '4) 若多张截图，请把所有天的课程合并进同一份 JSON（用 周一..周日 作 days）；5) 只输出 JSON，不要 ``` 包裹。';
      return App.ai.parseImages(sys, urls, { temperature: 0, maxTokens: 4000, timeout: 120000 });
    }).then(function (r) {
      if (!r.ok) { App.util.toast('识别失败：' + (r.error || '未知错误') + '，可手动填写', 'bad'); return; }
      var parsed = extractJSON(r.text);
      if (!parsed || !parsed.cells) { App.util.toast('识别结果无法解析，可手动填写', 'bad'); return; }
      var grid = normalizeGrid(parsed);
      currentScreenshotCount = files.length;
      renderGrid(grid);
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

  // 把 AI 返回结构归一到 { days:周一..周日, periods, cells }
  function normalizeGrid(parsed) {
    var srcCells = parsed.cells || {};
    var lookup = {};
    Object.keys(srcCells).forEach(function (k) {
      var idx = k.lastIndexOf('-');
      var ad = idx >= 0 ? k.slice(0, idx) : k;
      var ap = idx >= 0 ? k.slice(idx + 1) : '';
      lookup[normDay(ad) + '-' + ap] = srcCells[k];
    });

    var periods = (parsed.periods && parsed.periods.length) ? parsed.periods.slice() : [];
    Object.keys(lookup).forEach(function (k) {
      var p = k.slice(k.indexOf('-') + 1);
      if (periods.indexOf(p) === -1) periods.push(p);
    });

    var normCells = {};
    DAYS.forEach(function (d) {
      periods.forEach(function (p) {
        var src = lookup[d + '-' + p];
        normCells[d + '-' + p] = src
          ? { course: src.course || '', teacher: src.teacher || '', room: src.room || '' }
          : { course: '', teacher: '', room: '' };
      });
    });
    return { days: DAYS.slice(), periods: periods, cells: normCells };
  }

  /* ---------------- 对外 ---------------- */
  App.views = App.views || {};
  App.views.schedule = {
    importSchedule: importSchedule,
    onFiles: onFiles,
    saveGrid: saveGrid,
    addRow: addRow,
    clearGrid: clearGrid
  };

})();
