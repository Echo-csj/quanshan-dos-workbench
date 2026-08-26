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

  // ---------- 标签体系（可点击编辑；支持自定义）----------
  var TAG_PALETTE = ['跨学科', '离职', '待离职'];
  var TAG_COLORS = {
    '跨学科': '#0EA5E9',
    '离职':   '#9CA3AF',
    '待离职': '#F59E0B'
  };
  // 标签筛选选项：''=全部, '在职'=无离职/待离职标签
  var TAG_FILTERS = ['', '在职', '离职', '待离职', '跨学科'];

  // 表头别名（容错映射）
  var HEADER_MAP = {
    name:        ['姓名', '教师', '老师', '名称'],
    subjectGroup:['学科组', '科组'],
    positionCode:['岗位', '职位', '职务'],
    entryDate:   ['入职日期', '入职', '入职时间', '入职年月'],
    school:      ['毕业院校', '院校', '学校'],
    degree:      ['学历'],
    major:       ['专业'],
    certificates:['证书', '资格证书', '资格']
  };

  // 学历可选项（行内下拉编辑仅此两项，不允许手动输入）
  var DEGREE_OPTIONS = ['本科', '硕士'];

  var SUBJECT_COLORS = {
    '数学': '#4F46E5', '英语': '#0EA5E9', '文综': '#F59E0B', '理综': '#10B981'
  };

  // 视图筛选状态
  var filterSubject = '';
  var filterPos = '';
  var filterTag = '';
  var search = '';

  // 编辑弹窗状态
  var edId = null;
  var edTags = [];

  // 学历行内编辑状态（当前正在编辑的教师 id；null=非编辑态）
  var degEditId = null;

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function getTeachers() { return App.store.get('teachers') || []; }

  function hasTag(t, tag) { return Array.isArray(t.tags) && t.tags.indexOf(tag) >= 0; }

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

  // 学历归一：空→''；本科/硕士原样；其他值原样保留（显示可见，编辑下拉中作为原值兜底项）
  function normDegree(val) {
    if (val == null) return '';
    var s = String(val).trim();
    return s;
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

  // ---------- 学历单元格（非编辑态=纯文本；编辑态=下拉，仅本科/硕士）----------
  function degreeCellHtml(t) {
    if (degEditId === t.id) {
      // 编辑态：下拉选择，选中即保存；blur / Esc 取消（数据不动）
      var cur = t.degree || '';
      var h = '<select id="deg-select" class="form-input form-input-sm degree-select" '
        + 'onchange="App.views.teachers.commitDegreeEdit(\'' + App.util.escapeAttr(t.id) + '\', this.value)" '
        + 'onblur="App.views.teachers.cancelDegreeEdit()" '
        + 'onkeydown="App.views.teachers.degreeKeydown(event)">';
      if (!cur) {
        h += '<option value="" disabled selected>选择学历…</option>';
      } else if (DEGREE_OPTIONS.indexOf(cur) < 0) {
        // Excel 导入的非标准原值：保留展示，仍只能选本科/硕士替换
        h += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '（原值）</option>';
      }
      DEGREE_OPTIONS.forEach(function(d) {
        h += '<option value="' + d + '"' + (cur === d ? ' selected' : '') + '>' + d + '</option>';
      });
      h += '</select>';
      return h;
    }
    // 非编辑态：普通文本（与现有列样式一致）
    return '<span class="degree-text" onclick="App.views.teachers.startDegreeEdit(\'' + App.util.escapeAttr(t.id) + '\', event)" title="点击选择学历">' + esc(t.degree || '—') + '</span>';
  }

  // ---------- 渲染 ----------
  function render() {
    var container = document.getElementById('view-container');
    if (!container) return;
    var teachers = getTeachers();

    // 统计
    var stats = { total: teachers.length, bySubject: {}, byPos: {}, byTag: {} };
    teachers.forEach(function(t) {
      stats.bySubject[t.subjectGroup] = (stats.bySubject[t.subjectGroup] || 0) + 1;
      stats.byPos[t.positionCode] = (stats.byPos[t.positionCode] || 0) + 1;
      (t.tags || []).forEach(function(tag) { stats.byTag[tag] = (stats.byTag[tag] || 0) + 1; });
    });
    stats.byTag['在职'] = teachers.filter(function(t) {
      return !hasTag(t, '离职') && !hasTag(t, '待离职');
    }).length;

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
    html += '<select class="form-input form-input-sm" id="tch-filter-tag" onchange="App.views.teachers.onFilterChange()">';
    html += '<option value="">全部状态</option>';
    html += '<option value="在职"' + (filterTag === '在职' ? ' selected' : '') + '>在职</option>';
    html += '<option value="离职"' + (filterTag === '离职' ? ' selected' : '') + '>离职</option>';
    html += '<option value="待离职"' + (filterTag === '待离职' ? ' selected' : '') + '>待离职</option>';
    html += '<option value="跨学科"' + (filterTag === '跨学科' ? ' selected' : '') + '>跨学科</option>';
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
    html += '<span class="stat-pill"><span class="dot" style="background:#10B981"></span>在职 ' + (stats.byTag['在职'] || 0) + '</span>';
    TAG_PALETTE.forEach(function(tag) {
      if (stats.byTag[tag]) {
        html += '<span class="stat-pill"><span class="dot" style="background:' + (TAG_COLORS[tag] || '#888') + '"></span>' + tag + ' ' + stats.byTag[tag] + '</span>';
      }
    });
    html += '</div>';

    // 表格
    var list = teachers.filter(function(t) {
      if (filterSubject && t.subjectGroup !== filterSubject) return false;
      if (filterPos && t.positionCode !== filterPos) return false;
      if (filterTag) {
        if (filterTag === '在职') {
          if (hasTag(t, '离职') || hasTag(t, '待离职')) return false;
        } else {
          if (!hasTag(t, filterTag)) return false;
        }
      }
      if (search) {
        var q = search.toLowerCase();
        var hay = [t.name, t.school, t.major, t.degree, (t.certificates || []).join(' '), (t.tags || []).join(' '), posName(t.positionCode)].join(' ').toLowerCase();
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
    html += '<th>标签</th>';
    html += '<th>入职日期</th>';
    html += '<th>工龄</th>';
    html += '<th>毕业院校</th>';
    html += '<th>学历</th>';
    html += '<th>专业</th>';
    html += '<th>证书</th>';
    html += '</tr></thead><tbody>';
    if (list.length === 0) {
      html += '<tr><td colspan="11" class="empty-row">无匹配教师</td></tr>';
    } else {
      list.forEach(function(t, i) {
        var sc = SUBJECT_COLORS[t.subjectGroup] || '#888';
        var certs = (t.certificates || []).map(function(c) {
          return '<span class="cert-chip">' + esc(c) + '</span>';
        }).join('') || '<span class="muted">—</span>';
        var posBadge = '<span class="pos-badge" title="' + esc(posName(t.positionCode)) + '">' + esc(t.positionCode || '—') + '</span>';
        var tagBadges = (t.tags || []).map(function(tag) {
          var c = TAG_COLORS[tag] || '#7C3AED';
          return '<span class="tag-badge" style="background:' + c + '1a;color:' + c + ';border:1px solid ' + c + '55">' + esc(tag) + '</span>';
        }).join('') || '<span class="muted">—</span>';
        var isLeave = hasTag(t, '离职');
        var rowCls = isLeave ? ' class="row-leave"' : '';
        html += '<tr' + rowCls + ' style="cursor:pointer" onclick="App.views.teachers.openEdit(\'' + App.util.escapeAttr(t.id) + '\')" title="点击编辑">';
        html += '<td class="mono muted">' + (i + 1) + '</td>';
        html += '<td><strong>' + esc(t.name) + '</strong></td>';
        html += '<td><span class="dot" style="background:' + sc + ';margin-right:4px"></span>' + esc(t.subjectGroup) + '</td>';
        html += '<td>' + posBadge + '</td>';
        html += '<td>' + tagBadges + '</td>';
        html += '<td class="mono">' + esc(t.entryDate || '—') + '</td>';
        html += '<td class="mono">' + App.util.workAge(t.entryDate) + '</td>';
        html += '<td>' + esc(t.school || '—') + '</td>';
        html += '<td class="degree-cell">' + degreeCellHtml(t) + '</td>';
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
    html += '<p class="muted">💡 点击任意教师行可<b>编辑资料</b>（岗位、学历、入职日期、证书、标签），并可删除；点击「学历」单元格可直接行内下拉选择（仅 本科 / 硕士，Esc 或点其他处取消）；标签支持「跨学科 / 离职 / 待离职」及自定义，标记离职的教师整行置灰；上传 Excel 按「姓名 + 学科组」识别——已存在则更新、不存在则新增（已有标签不受影响，Excel 无学历列时不改动已有学历）；岗位列填中文全称（如"中级教研员"）或编码（如 IIR）均可，自动归一为编码；工龄不入库，按入职日期实时计算。</p>';
    html += '</div>';

    container.innerHTML = html;
  }

  // ---------- 筛选 ----------
  function onFilterChange() {
    filterSubject = (document.getElementById('tch-filter-subject') || {}).value || '';
    filterPos = (document.getElementById('tch-filter-pos') || {}).value || '';
    filterTag = (document.getElementById('tch-filter-tag') || {}).value || '';
    render();
  }
  function onSearchChange(v) {
    search = v || '';
    // 防抖
    if (window.__tchSearchTimer) clearTimeout(window.__tchSearchTimer);
    window.__tchSearchTimer = setTimeout(render, 200);
  }

  /* ---------- 学历行内编辑 ---------- */
  function startDegreeEdit(id, ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation(); // 阻止冒泡触发行编辑弹窗
    if (degEditId === id) return; // 已在该单元格编辑中
    degEditId = id;
    render();
    var sel = document.getElementById('deg-select');
    if (sel && sel.focus) { try { sel.focus(); } catch (e) {} }
  }

  function commitDegreeEdit(id, val) {
    if (degEditId !== id) return;
    degEditId = null;
    val = normDegree(val);
    var teachers = getTeachers().slice();
    var idx = teachers.findIndex(function(t) { return t.id === id; });
    if (idx < 0) { render(); return; }
    var old = teachers[idx].degree || '';
    if (old === val) { render(); return; } // 未变化，仅退出编辑态
    teachers[idx] = Object.assign({}, teachers[idx], { degree: val });
    App.store.set('teachers', teachers);
    App.util.toast('学历已保存：' + (val || '（空）'), 'ok');
    render();
  }

  function cancelDegreeEdit() {
    if (degEditId == null) return;
    degEditId = null;
    render(); // 数据未改动，重绘即恢复原文本
  }

  function degreeKeydown(e) {
    if (e && e.key === 'Escape') cancelDegreeEdit();
  }

  /* ---------- 点击编辑教师资料 ---------- */
  function openEdit(id) {
    var t = getTeachers().find(function(x) { return x.id === id; });
    if (!t) { App.util.toast('未找到该教师', 'bad'); return; }
    edId = id;
    edTags = (t.tags || []).slice();

    var html = '';
    html += '<div class="ed-form">';
    html += '<div class="ed-row">';
    html += '<div class="ed-field"><label>姓名</label><input class="form-input" id="ed-name" value="' + esc(t.name) + '"></div>';
    html += '<div class="ed-field"><label>学科组</label><select class="form-input" id="ed-subject">';
    SUBJECT_GROUPS.forEach(function(sg) {
      html += '<option value="' + sg + '"' + (t.subjectGroup === sg ? ' selected' : '') + '>' + sg + '</option>';
    });
    html += '</select></div>';
    html += '</div>';
    html += '<div class="ed-row">';
    html += '<div class="ed-field"><label>岗位</label><select class="form-input" id="ed-pos">';
    Object.keys(POSITION_CODEBOOK).forEach(function(code) {
      html += '<option value="' + code + '"' + (t.positionCode === code ? ' selected' : '') + '>' + code + ' · ' + POSITION_CODEBOOK[code] + '</option>';
    });
    if (t.positionCode && !POSITION_CODEBOOK[t.positionCode]) {
      html += '<option value="' + esc(t.positionCode) + '" selected>' + esc(t.positionCode) + '（未知）</option>';
    }
    html += '</select></div>';
    html += '<div class="ed-field"><label>入职日期</label><input class="form-input" type="date" id="ed-entry" value="' + esc(t.entryDate || '') + '"></div>';
    html += '</div>';
    html += '<div class="ed-row">';
    html += '<div class="ed-field"><label>毕业院校</label><input class="form-input" id="ed-school" value="' + esc(t.school || '') + '"></div>';
    html += '<div class="ed-field"><label>学历</label><select class="form-input" id="ed-degree">';
    html += '<option value=""' + (!t.degree ? ' selected' : '') + '>未填写</option>';
    DEGREE_OPTIONS.forEach(function(d) {
      html += '<option value="' + d + '"' + (t.degree === d ? ' selected' : '') + '>' + d + '</option>';
    });
    if (t.degree && DEGREE_OPTIONS.indexOf(t.degree) < 0) {
      html += '<option value="' + esc(t.degree) + '" selected>' + esc(t.degree) + '（原值）</option>';
    }
    html += '</select></div>';
    html += '<div class="ed-field"><label>专业</label><input class="form-input" id="ed-major" value="' + esc(t.major || '') + '"></div>';
    html += '</div>';
    html += '<div class="ed-field"><label>证书（用 、或 , 分隔多个）</label><input class="form-input" id="ed-certs" value="' + esc((t.certificates || []).join('、')) + '"></div>';
    html += '<div class="ed-field"><label>标签（点击添加/移除，可输入自定义标签后回车）</label><div class="ed-tags" id="ed-tags-wrap"></div></div>';
    html += '</div>';

    App.util.modal({
      title: '编辑教师 · ' + t.name,
      content: html,
      confirmText: '保存',
      onConfirm: function(close) { saveEdit(close); },
      onDelete: function(close) { deleteTeacher(close); },
      deleteText: '删除'
    });

    renderTagChips();
  }

  function renderTagChips() {
    var wrap = document.getElementById('ed-tags-wrap');
    if (!wrap) return;
    var h = '';
    // 已选标签（点击移除）
    edTags.forEach(function(tag) {
      var c = TAG_COLORS[tag] || '#7C3AED';
      h += '<span class="tag-chip sel" style="background:' + c + '1a;color:' + c + ';border:1px solid ' + c + '55" onclick="App.views.teachers.removeTag(\'' + App.util.escapeAttr(tag) + '\')">' + esc(tag) + ' ×</span>';
    });
    // 可选标签（点击添加）
    TAG_PALETTE.forEach(function(tag) {
      if (edTags.indexOf(tag) < 0) {
        var c = TAG_COLORS[tag] || '#7C3AED';
        h += '<span class="tag-chip add" style="color:' + c + ';border:1px dashed ' + c + '66" onclick="App.views.teachers.addTag(\'' + App.util.escapeAttr(tag) + '\')">+ ' + esc(tag) + '</span>';
      }
    });
    h += '<input type="text" class="form-input form-input-sm" id="ed-tag-custom" style="width:110px" placeholder="自定义标签…" onkeydown="App.views.teachers.onTagKey(event)">';
    wrap.innerHTML = h;
  }

  // 标签消毒：剥离引号/尖括号/反引号/反斜杠（onclick 单引号拼接安全），压缩空白并限长
  function sanitizeTag(s) {
    return String(s || '')
      .replace(/['"\\<>`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12);
  }

  function addTag(tag) {
    tag = sanitizeTag(tag);
    if (!tag) return;
    if (edTags.indexOf(tag) < 0) edTags.push(tag);
    renderTagChips();
  }
  function removeTag(tag) {
    edTags = edTags.filter(function(x) { return x !== tag; });
    renderTagChips();
  }
  function onTagKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var input = document.getElementById('ed-tag-custom');
    if (!input) return;
    addTag(input.value);
    input.value = '';
  }

  function saveEdit(close) {
    var teachers = getTeachers().slice();
    var idx = teachers.findIndex(function(t) { return t.id === edId; });
    if (idx < 0) { close(); return; }
    var name = (document.getElementById('ed-name') || {}).value || '';
    var subjectGroup = (document.getElementById('ed-subject') || {}).value || '';
    var positionCode = (document.getElementById('ed-pos') || {}).value || '';
    var entryDate = (document.getElementById('ed-entry') || {}).value || '';
    var school = (document.getElementById('ed-school') || {}).value || '';
    var degree = (document.getElementById('ed-degree') || {}).value || '';
    var major = (document.getElementById('ed-major') || {}).value || '';
    var certsRaw = (document.getElementById('ed-certs') || {}).value || '';
    if (!name.trim() || !subjectGroup) {
      App.util.toast('姓名和学科组不能为空', 'bad');
      return;
    }
    teachers[idx] = Object.assign({}, teachers[idx], {
      name: name.trim(),
      subjectGroup: subjectGroup,
      positionCode: positionCode,
      entryDate: entryDate,
      school: school.trim(),
      degree: degree,
      major: major.trim(),
      certificates: splitCerts(certsRaw),
      tags: edTags.slice()
    });
    App.store.set('teachers', teachers);
    close();
    App.util.toast('已保存', 'ok');
    render();
  }

  function deleteTeacher(close) {
    var t = getTeachers().find(function(x) { return x.id === edId; });
    if (!t) { close(); return; }
    if (!window.confirm('确定删除「' + t.name + '（' + t.subjectGroup + '）」？此操作不可撤销。')) return;
    App.store.set('teachers', getTeachers().filter(function(x) { return x.id !== edId; }));
    close();
    App.util.toast('已删除 ' + t.name, 'ok');
    render();
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
            degree: colIdx.degree == null ? undefined : normDegree(cellVal(row, colIdx.degree)), // 无学历列→undefined（不覆盖已有值）
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
    var map = { name: null, subjectGroup: null, positionCode: null, entryDate: null, school: null, degree: null, major: null, certificates: null };
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
      // 学历：仅当 Excel 提供了学历列才写入（undefined 时不覆盖/不新增键）
      if (p.degree !== undefined) rec.degree = p.degree;
      if (a.action === 'update') {
        var old = teachers[a.idx];
        rec.id = old.id; // 保留原 id
        teachers[a.idx] = Object.assign({}, old, rec); // tags 等未提供字段保留原值
      } else {
        rec.id = App.store.uid('tr');
        rec.tags = []; // Excel 导入默认无标签（在职）
        teachers.push(rec);
      }
    });
    App.store.set('teachers', teachers);
  }

  // ---------- 下载标准模板 ----------
  function downloadTemplate() {
    var wb = XLSX.utils.book_new();
    var header = ['姓名', '学科组', '岗位', '入职日期', '毕业院校', '学历', '专业', '证书'];
    var sample = ['王静静', '数学', 'DOST', '2022-08-16', '安徽农业大学', '硕士', '农业工程', '初中数学、高中生物'];
    var aoa = [header, sample, ['', '', '', '', '', '', '', ''], ['', '（岗位可填编码或中文全称，见"岗位编码"表；学历仅填 本科 / 硕士）', '', '', '', '', '', '']];
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 26 }, { wch: 8 }, { wch: 18 }, { wch: 30 }];
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
    downloadTemplate: downloadTemplate,
    openEdit: openEdit,
    saveEdit: saveEdit,
    deleteTeacher: deleteTeacher,
    addTag: addTag,
    removeTag: removeTag,
    onTagKey: onTagKey,
    startDegreeEdit: startDegreeEdit,
    commitDegreeEdit: commitDegreeEdit,
    cancelDegreeEdit: cancelDegreeEdit,
    degreeKeydown: degreeKeydown
  };

})();
