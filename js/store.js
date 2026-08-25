/* ============================================
   store.js — 数据层
   localStorage 读写 + 订阅 + 导入/导出
   ============================================ */

window.App = window.App || {};

(function() {
  const STORAGE_KEY = 'zyg_workbench_v1';
  const RESEARCH_TIMELINE_FLAG = 'zyg_research_timeline_v1';
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
          { id: 'month-schedule', title: '排课月度收尾', weekday: null, time: '', type: 'monthly', cron: 'last-week-of-month', reminder: true, note: '每月最后一周完成排课相关收尾与上报' },
          // —— 教研时间轴（来自《校区教研流程与标准_可编辑版.xlsx》）——
          { id: 'jy-meeting', title: '教研会议执行', weekday: 3, time: '', type: 'fixed', reminder: true, note: '全体老师：磨课（说课→导入→讲解→练习→总结，30-40分钟模拟真实课堂）+点评+反思；学员问题讨论；每月最后一次教研讨论方向、制定下月计划' },
          { id: 'jy-mail', title: '两项邮件反馈', weekday: 3, time: '', type: 'fixed', reminder: true, note: '①磨课人员发磨课反思邮件（发教研负责人，抄送组长/叶栖桐/王静静/DOS/SD）②教研负责人发送教研反馈邮件（发组内所有老师及跨校区教研老师，抄送组长/叶栖桐/王静静/DOS/SD/总部稽核）' },
          { id: 'jy-submit', title: '提交次周教研资料', weekday: 5, time: '17:00', type: 'fixed', reminder: true, note: '磨课和示范课讲义、其它教研资料（知识点/题目练习等）；形式：企业微信群；教研人员提交' },
          { id: 'jy-review', title: '负责人审核', weekday: 5, time: '21:00', type: 'fixed', reminder: true, note: '数学：李梦鸽 / 英语：叶栖桐 / 文综：李悦 / 理综：王湛文；当天审核，需修改的给具体建议' },
          { id: 'jy-remind', title: '发布教研提醒+打印准备', weekday: 0, time: '', type: 'fixed', reminder: true, note: '按统一模板在企业微信群内发教研提醒（回复收到、及时调整）；参与磨课老师把资料打印准备好；数学：李梦鸽 / 英语：叶栖桐 / 文综：李悦 / 理综：王湛文' },
          { id: 'jy-print', title: '打印讲义与表单', weekday: 0, time: '', type: 'fixed', reminder: true, note: '根据教研人数提前一天打印讲义；磨课老师打印磨课评分表、磨课记录表；教研人员' },
          { id: 'jy-handout', title: '修改后讲义发群', weekday: 1, time: '20:00', type: 'fixed', reminder: true, note: '修改后讲义发学科组群，组内老师提前学习；讲义制作老师' },
          { id: 'jy-feedback', title: '校区上周教研反馈汇报', weekday: 3, time: '', type: 'fixed', reminder: true, note: '叶栖桐：汇总各组教研情况、评价完成质量、给改进建议与后期方向；PPT 主管会汇报（PPT 周二 20:00 前发出）' },
          { id: 'jy-month-plan', title: '月度教研计划', weekday: 5, which: 'last', type: 'monthly', reminder: true, time: '20:00', note: '邮件发下月月度教研计划给组内所有老师，抄送组长/叶栖桐/王静静/DOS/SD/总部稽核；数学：李梦鸽 / 英语：叶栖桐 / 文综：李悦 / 理综：王湛文' },
          { id: 'jy-month-meet', title: '教研员月度会议', weekday: null, cron: 'last-week-of-month', type: 'monthly', reminder: true, note: '叶栖桐：讨论校区教研问题、优化校区教研；会议记录人邮件发组长/叶栖桐/王静静/DOS/SD' },
          { id: 'jy-month-dir', title: '方向与月计划制定', weekday: 3, which: 'last', type: 'monthly', reminder: true, note: '每月最后一次教研：讨论后续教研方向、制定下月计划（学生/老师/考试三方面）；邮件抄送组长/叶栖桐/王静静/DOS/SD/总部稽核' },
          { id: 'jy-month-task', title: '教研员任务发送', weekday: 5, which: 'last', type: 'monthly', reminder: true, time: '20:00', note: '初级：语文李心甜，语文王婧怡；中级：语文李悦，地理徐硕阳，物理王湛文，英语郭岩' }
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
      // 一次性把《校区教研流程与标准》的教研节点并入时间轴（幂等，不覆盖已有节点）
      try {
        if (!localStorage.getItem(RESEARCH_TIMELINE_FLAG)) {
          var added = mergeResearchTimelineNodes();
          localStorage.setItem(RESEARCH_TIMELINE_FLAG, '1');
          if (added > 0) save();
        }
      } catch (e2) { /* 忽略合并异常，避免影响正常加载 */ }
    } catch (e) {
      console.warn('Store load failed, using defaults:', e);
      _data = getDefaultData();
    }
    return _data;
  }

  // 将默认教研时间轴节点（id 以 'jy-' 开头）并入当前 fixedNodes；幂等，已存在则跳过
  function mergeResearchTimelineNodes() {
    var jy = (getDefaultData().timeline.fixedNodes || []).filter(function(n) {
      return n.id && n.id.indexOf('jy-') === 0;
    });
    if (!_data.timeline) _data.timeline = {};
    if (!Array.isArray(_data.timeline.fixedNodes)) _data.timeline.fixedNodes = [];
    var have = {};
    _data.timeline.fixedNodes.forEach(function(n) { if (n.id) have[n.id] = true; });
    var added = 0;
    jy.forEach(function(n) {
      if (!have[n.id]) { _data.timeline.fixedNodes.push(JSON.parse(JSON.stringify(n))); added++; }
    });
    return added;
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
    refresh: load,
    // 获取默认数据结构（供同步/迁移等场景读取内置标准节点）
    getDefaultData: getDefaultData,
    // 手动把教研时间轴节点合并进当前数据（幂等，供「设置 → 同步教研时间轴」调用）
    mergeResearchTimeline: function() {
      var added = mergeResearchTimelineNodes();
      save();
      return added;
    }
  };

})();
