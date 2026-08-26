/* ============================================
   teachers.js — 教师管理
   花名册展示（岗位英文编码 / 工龄动态 / 证书 chips）
   + Excel 上传批量更新（字段映射容错 → 预览差异 → 确认 upsert）
   + 标准模板下载（含岗位编码对照表）
   主键 = name + subjectGroup（无工号）
   ============================================ */

(function() {

  // ---------- 岗位编码对照表（code → 中文全称）----------
  var POSITION_CODEBOOK = {
    DOST: '教学校长实习生',
    TRM:  '学科组长',
    TRMT: '学科组长实习生',
    TRS:  '学科带头人',
    TR:   '教师',
    GPS2: '管培生',
    JIR:  '初级教研员',
    IIR:  '中级教研员',
    AIR:  '高级教研员'
  };
  // 反向：中文全称 → code（上传时把中文岗位归一为编码）
  var POSITION_NAME_TO_CODE = {};
  Object.keys(POSITION_CODEBOOK).forEach(function(k) { POSITION_NAME_TO_CODE[POSITION_CODEBOOK[k]] = k; });

  var SUBJECT_GROUPS = ['数学', '英语', '文综', '理综'];

  // 表头别名（容错映射）
  var HEADER_MAP = {
    name:        ['姓名', '教师', '老师', '名称'],
    subjectGroup:['学科组', '科组'],
    positionCode:['岗位', '职位', '职务'],
    entryDate:   ['入职日期', '入职', '入职时间', '入职年月'],
    school:      ['毕业院校', '院校', '学校'],
    major:       ['专业'],
    certificates:['证书', '资格证书', '资格']
  };

  var SUBJECT_COLORS = {
    '数学': '#4F46E5', '英语': '#0EA5E9', '文综': '#F59E0B', '理综': '#10B981'
  };

  // 视图筛选状态
  var filterSubject = '';
  var filterPos = '';
  var search = '';

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function getTeachers() { return App.store.get('teachers') || []; }

  function posName(code) { return POSITION_CODEBOOK[code] || code || ''; }

  // 把任意岗位值归一为英文编码
  function normPos(val) {
    if (val == null) return '';
    var s = String(val).trim();
    if (!s) return '';
    if (POSITION_CODEBOOK[s]) return s;                  // 已是编码
    if (POSITION_NAME_TO_CODE[s]) return POSITION_NAME_TO_CODE[s]; // 中文全称 → 编码
    for (var k in POSITION_NAME_TO_CODE) { if (s.indexOf(k) >= 0) return POSITION_NAME_TO_CODE[k]; }
    return s; // 未知 → 原样返回（预览会标黄）
  }

  function splitCerts(val) {
    if (val == null) return [];
    var s = String(val).trim();
    if (!s || s === '无' || s === '无证书' || s === '-' || s === '—') return [];
    return s.split(/[,，、|\/]/).map(function(x) { return x.trim(); }).filter(Boolean);
  }

  function parseEntryDate(val) {
    if (val == null || val === '') return '';
    if (val instanceof Date) return val.getFullYear() + '-' + pad2(val.getMonth() + 1) + '-' + pad2(val.getDate());
    var s = String(val).trim();
    var m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    return s;
  }

  function esc(s) { return App.util.escapeHtml(s == null ? '' : s); }

  // ---------- 渲染 ----------
  function render() {
    var container = document.getElementById('view-container');
    if (!container) return;
    var teachers = getTeachers();

    // 统计
    var stats = { total: teachers.length, bySubject: {}, byPos: {} };
    teachers.forEach(function(t) {
      stats.bySubject[t.subjectGroup] = (stats.bySubject[t.subjectGroup] || 0) + 1;
      stats.byPos[t.positionCode] = (stats.byPos[t.positionCode] || 0) + 1;
    });

    var html = '';
    html += '<div class="page-head"><h1 class="page-title">教师管理</h1>';
    html += '<p class="page-sub">花名册 · 岗位英文编码 · 工龄动态计算 · 支持 Excel 批量更新</p></div>';

    // 工具栏
    html += '<div class="teacher-toolbar">';
    html += '<div class="teacher-filters">';
    html += '<select class="form-input form-input-sm" id="tch-filter-subject" onchange="App.views.teachers.onFilterChange()">';
    html += '<option value="">全部学科组</option>';
    SUBJECT_GROUPS.forEach(function(sg) {
      html += '<option value="' + sg + '"' + (filterSubject === sg ? ' selected' : '') + '>' + sg + ' (' + (stats.bySubject[sg] || 0) + ')</option>';
    });
    html += '</select>';
    html += '<select class="form-input form-input-sm" id="tch-filter-pos" onchange="App.views.teachers.onFilterChange()">';
    html += '<option value="">全部岗位</option>';
    Object.keys(POSITION_CODEBOOK).forEach(function(code) {
      html += '<option value="' + code + '"' + (filterPos === code ? ' selected' : '') + '>' + code + ' · ' + POSITION_CODEBOOK[code] + ' (' + (stats.byPos[code] || 0) + ')</option>';
    });
    html += '</select>';
    html += '<input type="text" class="form-input form-input-sm" id="tch-search" placeholder="搜索姓名/院校/专业/证书…" value="' + esc(search) + '" oninput="App.views.teachers.onSearchChange(this.value)">';
    html += '</div>';
    html += '<div class="teacher-actions">';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.teachers.downloadTemplate()">' + App.util.svgIcon('download', 15) + ' 下载模板</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="document.getElementById(\'tch-file-input\').click()">' + App.util.svgIcon('upload', 15) + ' 上传 Excel 更新</button>';
    html += '<input type="file" id="tch-file-input" accept=".xlsx,.xls" style="display:none" onchange="App.views.teachers.handleFile(this)">';
    html += '</div>';
    html += '</div>';

    // 统计条
    html += '<div class="teacher-stats">';
    html += '<span class="stat-pill">共 <b>' + stats.total + '</b> 人</span>';
    SUBJECT_GROUPS.forEach(function(sg) {
      var c = SUBJECT_COLORS[sg] || '#888';
      html += '<span class="stat-pill"><span class="dot" style="background:' + c + '"></span>' + sg + ' ' + (stats.bySubject[sg] || 0) + '</span>';
    });
    html += '</div>';

    // 表格
    var list = teachers.filter(function(t) {
      if (filterSubject && t.subjectGroup !== filterSubject) return false;
      if (filterPos && t.positionCode !== filterPos) return false;
      if (search) {
        var q = search.toLowerCase();
        var hay = [t.name, t.school, t.major, (t.certificates || []).join(' '), posName(t.positionCode)].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    // 按入职日期升序（老→新）
    list.sort(function(a, b) { return (a.entryDate || '').localeCompare(b.entryDate || ''); });

    html += '<div class="card table-card">';
    html += '<table class="teacher-table">';
    html += '<thead><tr>';
    html += '<th style="width:40px">#</th>';
    html += '<th>姓名</th>';
    html += '<th>学科组</th>';
    html += '<th>岗位</th>';
    html += '<th>入职日期</th>';
    html += '<th>工龄</th>';
    html += '<th>毕业院校</th>';
    html += '<th>专业</th>';
    html += '<th>证书</th>';
    html += '</tr></thead><tbody>';
    if (list.length === 0) {
      html += '<tr><td colspan="9" class="empty-row">无匹配教师</td></tr>';
    } else {
      list.forEach(function(t, i) {
        var sc = SUBJECT_COLORS[t.subjectGroup] || '#888';
        var certs = (t.certificates || []).map(function(c) {
          return '<span class="cert-chip">' + esc(c) + '</span>';
        }).join('') || '<span class="muted">—</span>';
        var posBadge = '<span class="pos-badge" title="' + esc(posName(t.positionCode)) + '">' + esc(t.positionCode || '—') + '</span>';
        html += '<tr>';
        html += '<td class="mono muted">' + (i + 1) + '</td>';
        html += '<td><strong>' + esc(t.name) + '</strong></td>';
        html += '<td><span class="dot" style="background:' + sc + ';margin-right:4px"></span>' + esc(t.subjectGroup) + '</td>';
        html += '<td>' + posBadge + '</td>';
        html += '<td class="mono">' + esc(t.entryDate || '—') + '</td>';
        html += '<td class="mono">' + App.util.workAge(t.entryDate) + '</td>';
        html += '<td>' + esc(t.school || '—') + '</td>';
        html += '<td>' + esc(t.major || '—') + '</td>';
        html += '<td class="cert-cell">' + certs + '</td>';
        html += '</tr>';
      });
    }
    html += '</tbody></table>';
    html += '</div>';

    // 说明
    html += '<div class="teacher-help">';
    html += '<p><b>岗位编码对照</b>：';
    Object.keys(POSITION_CODEBOOK).forEach(function(code) {
      html += '<span class="codebook-item"><b>' + code + '</b> ' + POSITION_CODEBOOK[code] + '</span>';
    });
    html += '</p>';
    html += '<p class="muted">💡 上传 Excel 可批量更新：系统按「姓名 + 学科组」识别——已存在则更新、不存在则新增；岗位列填中文全称（如"中级教研员"）或编码（如 IIR）均可，自动归一为编码；工龄不入库，按入职日期实时计算。</p>';
    html += '</div>';

    container.innerHTML = html;
  }

  // ---------- 筛选 ----------
  function onFilterChange() {
    filterSubject = (document.getElementById('tch-filter-subject') || {}).value || '';
    filterPos = (document.getElementById('tch-filter-pos') || {}).value || '';
    render();
  }
  function onSearchChange(v) {
    search = v || '';
    // 防抖
    if (window.__tchSearchTimer) clearTimeout(window.__tchSearchTimer);
    window.__tchSearchTimer = setTimeout(render, 200);
  }

  // ---------- Excel 解析 → 预览 ----------
  function handleFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    input.value = ''; // 允许重复选同文件
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: 'array', cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) { App.util.toast('未找到工作表', 'bad'); return; }
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) || [];
        if (rows.length < 2) { App.util.toast('表格无数据行', 'bad'); return; }
        var headerRow = (rows[0] || []).map(function(c) { return c == null ? '' : String(c).trim(); });
        var colIdx = resolveColumns(headerRow);
        var parsed = [];
        for (var ri = 1; ri < rows.length; ri++) {
          var row = rows[ri];
          if (!row || row.every(function(c) { return c == null || String(c).trim() === ''; })) continue;
          var name = cellVal(row, colIdx.name);
          var subjectGroup = cellVal(row, colIdx.subjectGroup);
          if (!name || !subjectGroup) { parsed.push({ _skip: true, _reason: '缺姓名或学科组', row: ri + 1, name: name || '', subjectGroup: subjectGroup || '' }); continue; }
          parsed.push({
            name: String(name).trim(),
            subjectGroup: String(subjectGroup).trim(),
            positionCode: normPos(cellVal(row, colIdx.positionCode)),
            entryDate: parseEntryDate(cellVal(row, colIdx.entryDate)),
            school: (cellVal(row, colIdx.school) || '').toString().trim(),
            major: (cellVal(row, colIdx.major) || '').toString().trim(),
            certificates: splitCerts(cellVal(row, colIdx.certificates)),
            row: ri + 1
          });
        }
        showPreview(parsed);
      } catch (err) {
        App.util.toast('解析失败：' + (err.message || err), 'bad');
      }
    };
    reader.onerror = function() { App.util.toast('文件读取失败', 'bad'); };
    reader.readAsArrayBuffer(file);
  }

  function cellVal(row, idx) { return (idx == null || idx < 0) ? null : (row[idx] == null ? null : row[idx]); }

  // 表头别名 → 字段列下标
  function resolveColumns(headerRow) {
    var map = { name: null, subjectGroup: null, positionCode: null, entryDate: null, school: null, major: null, certificates: null };
    Object.keys(HEADER_MAP).forEach(function(field) {
      for (var i = 0; i < headerRow.length; i++) {
        var h = headerRow[i];
        if (!h) continue;
        if (HEADER_MAP[field].some(function(alias) { return h.indexOf(alias) >= 0; })) {
          if (map[field] === null) map[field] = i;
          break;
        }
      }
    });
    return map;
  }

  // 计算差异
  function diffRows(parsed) {
    var existing = getTeachers();
    var keyOf = function(t) { return (t.name || '') + '||' + (t.subjectGroup || ''); };
    var index = {};
    existing.forEach(function(t, i) { index[keyOf(t)] = i; });
    var actions = [];
    parsed.forEach(function(p) {
      if (p._skip) { actions.push({ action: 'skip', reason: p._reason, p: p }); return; }
      var k = keyOf(p);
      if (index[k] != null) {
        actions.push({ action: 'update', idx: index[k], p: p, old: existing[index[k]] });
      } else {
        actions.push({ action: 'add', p: p });
      }
    });
    return actions;
  }

  function showPreview(parsed) {
    var actions = diffRows(parsed);
    var counts = { add: 0, update: 0, skip: 0 };
    actions.forEach(function(a) { counts[a.action]++; });

    if (counts.add + counts.update === 0) {
      App.util.toast('没有可导入的数据（' + counts.skip + ' 行被跳过）', 'bad');
      return;
    }

    var html = '';
    html += '<div class="preview-summary">';
    html += '<span class="ps-add">新增 <b>' + counts.add + '</b></span>';
    html += '<span class="ps-update">更新 <b>' + counts.update + '</b></span>';
    if (counts.skip) html += '<span class="ps-skip">跳过 <b>' + counts.skip + '</b></span>';
    html += '</div>';
    html += '<div class="preview-note muted">按「姓名 + 学科组」识别：已存在→更新，不存在→新增。确认后将立即生效。</div>';
    html += '<table class="preview-table"><thead><tr><th>#</th><th>姓名</th><th>学科组</th><th>岗位</th><th>入职</th><th>动作</th></tr></thead><tbody>';
    actions.forEach(function(a, i) {
      var p = a.p || {};
      var cls = a.action;
      var label = a.action === 'add' ? '新增' : (a.action === 'update' ? '更新' : '跳过');
      if (a.action === 'skip') label += '<br><small class="muted">' + esc(a.reason || '') + '</small>';
      var posWarn = (p.positionCode && !POSITION_CODEBOOK[p.positionCode]) ? ' <small class="warn">未知岗位</small>' : '';
      html += '<tr class="row-' + cls + '">';
      html += '<td class="mono muted">' + (i + 1) + '</td>';
      html += '<td>' + esc(p.name) + '</td>';
      html += '<td>' + esc(p.subjectGroup) + '</td>';
      html += '<td>' + esc(p.positionCode || '—') + posWarn + '</td>';
      html += '<td class="mono">' + esc(p.entryDate || '—') + '</td>';
      html += '<td><span class="action-tag at-' + cls + '">' + label + '</span></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    App.util.modal({
      title: '确认批量更新教师信息',
      content: html,
      confirmText: '确认导入（新增 ' + counts.add + ' · 更新 ' + counts.update + '）',
      onConfirm: function(close) {
        applyUpsert(actions);
        close();
        App.util.toast('已更新：新增 ' + counts.add + ' · 更新 ' + counts.update, 'ok');
        render();
      }
    });
  }

  function applyUpsert(actions) {
    var teachers = getTeachers().slice();
    actions.forEach(function(a) {
      if (a.action === 'skip') return;
      var p = a.p;
      var rec = {
        name: p.name,
        subjectGroup: p.subjectGroup,
        positionCode: p.positionCode,
        entryDate: p.entryDate,
        school: p.school,
        major: p.major,
        certificates: p.certificates
      };
      if (a.action === 'update') {
        var old = teachers[a.idx];
        rec.id = old.id; // 保留原 id
        teachers[a.idx] = Object.assign({}, old, rec);
      } else {
        rec.id = App.store.uid('tr');
        teachers.push(rec);
      }
    });
    App.store.set('teachers', teachers);
  }

  // ---------- 下载标准模板 ----------
  function downloadTemplate() {
    var wb = XLSX.utils.book_new();
    var header = ['姓名', '学科组', '岗位', '入职日期', '毕业院校', '专业', '证书'];
    var sample = ['王静静', '数学', 'DOST', '2022-08-16', '安徽农业大学', '农业工程', '初中数学、高中生物'];
    var aoa = [header, sample, ['', '', '', '', '', '', ''], ['', '（岗位可填编码或中文全称，见"岗位编码"表）', '', '', '', '', '']];
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, '教师信息');

    // 岗位编码对照表
    var cbAoa = [['编码', '中文全称']];
    Object.keys(POSITION_CODEBOOK).forEach(function(code) { cbAoa.push([code, POSITION_CODEBOOK[code]]); });
    var cbWs = XLSX.utils.aoa_to_sheet(cbAoa);
    cbWs['!cols'] = [{ wch: 10 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, cbWs, '岗位编码');

    XLSX.writeFile(wb, '教师信息模板_' + App.util.formatDate(new Date(), 'YYYYMMDD') + '.xlsx');
    App.util.toast('模板已下载', 'ok');
  }

  // ---------- 路由 ----------
  App.router.register('/teachers', function() { render(); });

  // ---------- 公共 API ----------
  App.views = App.views || {};
  App.views.teachers = {
    render: render,
    onFilterChange: onFilterChange,
    onSearchChange: onSearchChange,
    handleFile: handleFile,
    downloadTemplate: downloadTemplate
  };

})();
