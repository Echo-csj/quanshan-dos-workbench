/* ============================================
   store.js — 数据层
   localStorage 读写 + 订阅 + 导入/导出
   ============================================ */

window.App = window.App || {};

(function() {
  const STORAGE_KEY = 'zyg_workbench_v1';
  let _data = null;
  let _listeners = [];
  let _saveTimer = null;

  // --- Default Data Structure ---
  function getDefaultData() {
    return {
      meta: { version: 1, owner: 'DOS-泉山', updatedAt: new Date().toISOString() },
      settings: {
        weekStart: 1,       // 周一为起始日
        reminders: true,
        theme: 'light',
        remindBackup: true, // 每月提醒导出备份
        tasksArchiveDays: 30, // 已完成事项超过该天数自动归档
        tasksView: { // 事项看板视图设置（持久化）
          mode: 'kanban',          // kanban | list | date | priority
          density: 'standard',     // compact | standard | comfortable
          filters: { status: [], priority: [], source: [] }, // 空数组 = 不过滤
          sortBy: 'dueDate',       // dueDate | priority | createdAt | title
          sortDir: 'asc',          // asc | desc
          search: '',              // 搜索关键字（标题/负责人/备注）
          expanded: {},            // 分组/列 展开状态，key -> bool
          columnLimit: 10          // 每列/每组前 N 条折叠
        },
        // —— 粘贴提取规则引擎（用户可配置，完全替换旧硬编码智能解析）——
        defaultRuleId: 'rule_default',
        extractionRules: [
          {
            id: 'rule_default',
            name: '通用群消息',
            enabled: true,
            isDefault: true,
            triggers: [],                 // 触发关键词（空 = 兜底规则，自动匹配失败时使用）
            lineDelimiter: '\\n',         // 输入按换行拆分为行（半结构化，默认换行）
            rowDelimiter: '',             // 行内字段分隔符（如 | 或逗号；留空 = 按整行智能提取）
            fields: {
              title:    { key:'title',    label:'事项',    enabled:true,  required:true,  method:'remainder' },
              dueDate:  { key:'dueDate',  label:'截止日期', enabled:true,  required:false, method:'auto',
                          formats:['YMD','MD_CN','MD_DOT','MD_HAO','WEEKDAY','RELATIVE','RANGE'], rangeLatest:true },
              time:     { key:'time',     label:'时间',     enabled:true,  required:false, method:'auto' },
              assignee: { key:'assignee', label:'负责人',   enabled:true,  required:false, method:'auto',
                          markers:['at','colon','parens','dash','role'] },
              priority: { key:'priority', label:'优先级',   enabled:true,  required:false, method:'auto',
                          keywords:['紧急','加急','特急','尽快','重要','高优'] }
            },
            lineFilters: {
              skipReply: true,            // 收到回复 / 回复：之后整段跳过
              skipSectionHeaders: true,   // 👉一、/ 一、章节名词 等顶级标题
              skipNegative: true,         // 否定式告诫：不见…不…
              skipEmailLines: true,       // 抄送/邮件发送/主送 等（无日期才跳过）
              skipPreface: true,          // 另有几项事项说明 / 以下是安排 等引出句
              skipNotice: true,           // 以上是/现将/特此/各位/大家/注意/任务如下 等通知行
              groupBackfill: true         // 以上N项 + 日期 → 批量回填截止日
            }
          },
          {
            id: 'rule_template',
            name: '任务表格模板',
            enabled: true,
            isDefault: false,
            triggers: ['|', '任务表', '任务清单', '事项表', '工作表'], // 含「|」即优先选用（模板表格式）
            lineDelimiter: '\\n',
            rowDelimiter: '|',            // 行内以 | 分隔字段（兼容全角 ｜）
            headerTokens: ['事项', '任务', '标题', '名称', '内容', '工作'],
            fields: {
              title:    { key:'title',    label:'事项',     enabled:true,  required:true,  method:'column', col:0 },
              assignee: { key:'assignee', label:'负责人',   enabled:true,  required:false, method:'column', col:1 },
              dueDate:  { key:'dueDate',  label:'截止日期', enabled:true,  required:false, method:'column', col:2 },
              time:     { key:'time',     label:'时间',     enabled:true,  required:false, method:'column', col:3 },
              priority: { key:'priority', label:'优先级',   enabled:true,  required:false, method:'column', col:4 }
            },
            lineFilters: {
              skipReply: false, skipSectionHeaders: false, skipNegative: false,
              skipEmailLines: false, skipPreface: false, skipNotice: false, groupBackfill: false
            }
          }
        ]
      },
      timeline: {
        fixedNodes: [
          { id: 'mon-group', title: '集团会议', weekday: 1, time: '', type: 'fixed', reminder: true, note: '周一参加集团会议' },
          { id: 'tue-decompose', title: '事项拆解/下发/跟进', weekday: 2, time: '', type: 'fixed', reminder: true, note: '周二上午：拆解集团会议精神，下发事项，跟进完成情况' },
          { id: 'tue-super', title: '主管会', weekday: 2, time: '09:30', type: 'fixed', reminder: true, note: '周二上午召开主管会，向下布置工作' },
          { id: 'tue-edu', title: '教务会', weekday: 2, time: '14:00', type: 'fixed', reminder: true, note: '周二下午召开教务会，对接教学部与客服部' },
          { id: 'tue-cs-check', title: '客服部检查当周课表', weekday: 2, time: '', type: 'fixed', reminder: true, note: '当周周二：客服部检查当周课表' },
          { id: 'thu-lock', title: '教务锁定课表', weekday: 4, time: '', type: 'fixed', reminder: true, note: '当周周四：教务锁定课表' },
          { id: 'thu-teacher-view', title: '老师查看课表', weekday: 4, time: '', type: 'fixed', reminder: false, note: '锁定后老师查看课表并确认' },
          { id: 'sun-report', title: 'DOS 周报', weekday: 0, time: '', type: 'fixed', reminder: true, note: '周日完成 DOS 周报填写与上报' },
          { id: 'month-prearrange', title: '完成次月预排', weekday: 3, which: 'last', type: 'monthly', reminder: true, note: '当月最后一周周三完成次月预排' },
          { id: 'month-schedule', title: '排课月度收尾', weekday: null, time: '', type: 'monthly', cron: 'last-week-of-month', reminder: true, note: '每月最后一周完成排课相关收尾与上报' }
        ],
        customNodes: []
      },
      reports: {
        // 月度数据快照：key = 'YYYY-MM'，由报表导入自动写入
        monthly: {},
        // 导入日志
        imports: []
      },
      projects: {},
      tasks: [],
      hr: {
        // 教学部人事数据：周度入离职记录
        // weekly key = 'YYYY-Www' (ISO周), value = { weekLabel, year, month, hireCount, leaveCount, note, createdAt }
        weekly: {},
        // 期初在职人数（用于计算离职率分母）
        baseHeadcount: null,
        // 期初设定日期
        baseDate: null
      }
    };
  }

  // --- Load from localStorage ---
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        _data = JSON.parse(raw);
        // Merge with defaults for any missing fields
        const def = getDefaultData();
        _data = deepMerge(def, _data);
      } else {
        _data = getDefaultData();
      }
    } catch (e) {
      console.warn('Store load failed, using defaults:', e);
      _data = getDefaultData();
    }
    return _data;
  }

  // --- Save to localStorage (debounced) ---
  function save() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      try {
        _data.meta.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_data));
        notifyListeners();
      } catch (e) {
        console.error('Store save failed:', e);
        // 可能超5MB限制
        alert('数据保存失败，可能超出存储上限（5MB）。请尝试导出后清理旧数据。');
      }
    }, 200);
  }

  // --- Get value by dot-path ---
  function get(path) {
    if (!_data) load();
    if (!path) return _data;
    return path.split('.').reduce(function(obj, key) {
      return obj && obj[key] !== undefined ? obj[key] : undefined;
    }, _data);
  }

  // --- Set value by dot-path ---
  function set(path, value) {
    if (!_data) load();
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce(function(obj, key) {
      if (obj[key] === undefined) obj[key] = {};
      return obj[key];
    }, _data);
    target[lastKey] = value;
    save();
    return value;
  }

  // --- Push to array at path ---
  function push(path, item) {
    var arr = get(path);
    if (!Array.isArray(arr)) arr = [];
    arr.push(item);
    set(path, arr);
    return arr;
  }

  // --- Remove from array by predicate ---
  function remove(path, predicate) {
    var arr = get(path);
    if (!Array.isArray(arr)) return [];
    var filtered = arr.filter(function(item, i) {
      return !predicate(item, i);
    });
    set(path, filtered);
    return filtered;
  }

  // --- Update item in array ---
  function update(path, id, updates) {
    var arr = get(path);
    if (!Array.isArray(arr)) return arr;
    var index = arr.findIndex(function(item) { return item.id === id; });
    if (index === -1) return arr;
    arr[index] = Object.assign({}, arr[index], updates);
    set(path, arr);
    return arr;
  }

  // --- Find item in array ---
  function find(path, predicate) {
    var arr = get(path);
    if (!Array.isArray(arr)) return undefined;
    return arr.find(predicate);
  }

  // --- Subscribe to changes ---
  function subscribe(fn) {
    if (typeof fn === 'function') _listeners.push(fn);
    return function() {
      _listeners = _listeners.filter(function(f) { return f !== fn; });
    };
  }

  function notifyListeners() {
    _listeners.forEach(function(fn) {
      try { fn(_data); } catch (e) { console.error('Listener error:', e); }
    });
  }

  // --- Export / Import JSON ---
  function exportJSON() {
    if (!_data) load();
    _data.meta.lastBackupAt = new Date().toISOString();
    var blob = new Blob([JSON.stringify(_data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'workbench-backup-' + App.util.formatDate(new Date(), 'YYYYMMDD') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_data)); } catch (e) {}
  }

  function importJSON(file, callback) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var imported = JSON.parse(e.target.result);
        _data = deepMerge(getDefaultData(), imported);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_data));
        notifyListeners();
        if (callback) callback(null, _data);
      } catch (err) {
        if (callback) callback(err);
      }
    };
    reader.onerror = function() { if (callback) callback(new Error('文件读取失败')); };
    reader.readAsText(file);
  }

  // --- Reset to defaults ---
  function reset() {
    _data = getDefaultData();
    localStorage.removeItem(STORAGE_KEY);
    save();
    return _data;
  }

  // --- Deep merge helper ---
  function deepMerge(target, source) {
    Object.keys(source).forEach(function(key) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        deepMerge(target[key], source[key]);
      } else {
        target[key] = JSON.parse(JSON.stringify(source[key]));
      }
    });
    return target;
  }

  // --- Generate unique ID ---
  function uid(prefix) {
    prefix = prefix || 'id';
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // Public API
  App.store = {
    get: get,
    set: set,
    push: push,
    remove: remove,
    update: update,
    find: find,
    subscribe: subscribe,
    exportJSON: exportJSON,
    importJSON: importJSON,
    reset: reset,
    uid: uid,
    getData: function() { if (!_data) load(); return _data; },
    refresh: load
  };

})();
