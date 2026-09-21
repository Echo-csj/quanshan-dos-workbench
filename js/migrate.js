// js/migrate.js — 一次性数据迁移（幂等 + 可回滚）
//
// 背景：历史遗留的时间轴 customNodes 中，有一批标题以【工龄沟通】/【转正】开头的
//      「教师沟通」类节点。它们本应归属「教师里程碑」独立系统（store.teacherMilestones，
//      由 teacher-milestones.js 管理），却被「从时间轴生成」当作普通节律节点转成了待办，
//      导致教师沟通条目反复出现在事项看板（见对话复盘：generateFromTimeline 为通用转换器，
//      不按类目过滤）。
//
// 处理：移除这些 customNodes 及其已生成的待办（source='timeline'），并写入备份以便回滚。
// 幂等：通过 settings.migratedTeacherComm 标记，仅执行一次。
(function () {
  if (!window.App || !App.store) return;

  function isTeacherComm(title) {
    if (!title) return false;
    return /^【(工龄沟通|转正)】/.test(title);
  }

  function backupKey() { return '_migration_backup_teacherComm_v1'; }

  function hasTagLocal(t, tag) { return Array.isArray(t.tags) && t.tags.indexOf(tag) >= 0; }

  // 教师状态结构化迁移：旧 离职/待离职 标签 → status 字段（单一事实来源），并剥离旧标签
  function migrateTeacherStatus(store) {
    var KEY = 'settings.migratedTeacherStatus_r1';
    if (store.get(KEY)) return;
    var teachers = store.get('teachers');
    if (!Array.isArray(teachers)) { store.set(KEY, true); return; }
    // 备份（可回滚）
    store.set('_migration_backup_teacherStatus_r1', {
      ts: new Date().toISOString(),
      teachers: teachers.slice(),
      version: 'r1'
    });
    var changed = 0;
    var next = teachers.map(function (t) {
      var nt = Object.assign({}, t);
      if (!nt.status) {
        if (hasTagLocal(nt, '离职')) nt.status = 'left';
        else if (hasTagLocal(nt, '待离职')) nt.status = 'pending';
        else nt.status = 'active';
        changed++;
      }
      // 状态已由 status 字段统一管理，剥离旧 离职/待离职 标签避免重复展示
      if (Array.isArray(nt.tags)) {
        var before = nt.tags.length;
        nt.tags = nt.tags.filter(function (x) { return x !== '离职' && x !== '待离职'; });
        if (nt.tags.length !== before) changed++;
      }
      return nt;
    });
    store.set('teachers', next);
    store.set(KEY, true);
    if (changed) console.log('[migration:teacherStatus] 已迁移 ' + changed + ' 处（补充 status 字段 / 剥离旧 离职·待离职 标签）');
  }

  // 回滚：恢复迁移前的 teachers（控制台调用 App.restoreTeacherStatusMigration()）
  App.restoreTeacherStatusMigration = function () {
    try {
      var store = App.store;
      var b = store.get('_migration_backup_teacherStatus_r1');
      if (!b) { if (App.util && App.util.toast) App.util.toast('没有可恢复的状态迁移备份', 'warn'); return; }
      if (Array.isArray(b.teachers) && b.teachers.length) store.set('teachers', b.teachers);
      store.set('settings.migratedTeacherStatus_r1', false);
      if (App.util && App.util.toast) App.util.toast('已回滚教师状态迁移（' + (b.teachers ? b.teachers.length : 0) + ' 位）', 'ok');
      console.log('[migration] restored teacherStatus', b);
    } catch (e) {
      console.error('[migration] teacherStatus restore failed', e);
    }
  };

  // 老用户补发「听课安排」提取规则（幂等；与 store.js 种子保持一致）
  var LISTEN_RULE = {
    id: 'rule_listen',
    name: '听课安排',
    enabled: true,
    isDefault: false,
    triggers: ['听课安排'],
    lineDelimiter: '\\n',
    rowDelimiter: '',
    fields: {
      title:    { key: 'title',    label: '事项',   enabled: true, required: true,  method: 'remainder' },
      dueDate:  { key: 'dueDate',  label: '日期',   enabled: true, required: false, method: 'auto',
                  formats: ['WEEKDAY', 'MD_CN', 'MD_DOT', 'MD_HAO', 'YMD', 'RELATIVE', 'RANGE'], rangeLatest: true },
      time:     { key: 'time',     label: '时间',   enabled: true, required: false, method: 'auto' },
      assignee: { key: 'assignee', label: '负责人', enabled: true, required: false, method: 'auto',
                  markers: ['at', 'colon', 'parens', 'role'] },
      priority: { key: 'priority', label: '优先级', enabled: true, required: false, method: 'auto',
                  keywords: ['紧急', '加急', '特急', '尽快', '重要', '高优'] }
    },
    lineFilters: {
      skipReply: true, skipSectionHeaders: true, skipNegative: true,
      skipEmailLines: true, skipPreface: true, skipNotice: true, groupBackfill: false
    }
  };

  function ensureListenRule(store) {
    var rules = store.get('settings.extractionRules');
    if (!Array.isArray(rules)) return;
    if (rules.some(function (r) { return r && r.id === 'rule_listen'; })) return;
    rules.push(LISTEN_RULE);
    store.set('settings.extractionRules', rules);
    console.log('[migration] 已为老用户补充「听课安排」提取规则');
  }

  // 执行清理（_r1 版本：保证使用旧版 migrate.js 的浏览器也能再次清理）
  App.runMigrations = function () {
    try {
      var store = App.store;
      ensureListenRule(store);   // 幂等：老用户补发「听课安排」提取规则
      migrateTeacherStatus(store); // 幂等：旧 离职/待离职 标签 → 结构化 status 字段
      if (store.get('settings.migratedTeacherComm_r1')) return;

      // 数据是否就绪：未加载（三个关键 key 均为 undefined）则本次跳过，等下次 init
      if (store.get('timeline.customNodes') === undefined &&
          store.get('tasks') === undefined &&
          store.get('timeline.fixedNodes') === undefined) {
        return;
      }

      var removedNodes = [];
      var removedTasks = [];

      var nodes = store.get('timeline.customNodes');
      if (Array.isArray(nodes) && nodes.length) {
        var keptNodes = [];
        nodes.forEach(function (n) {
          if (isTeacherComm(n.title)) removedNodes.push(n);
          else keptNodes.push(n);
        });
        if (removedNodes.length) store.set('timeline.customNodes', keptNodes);
      }

      var tasks = store.get('tasks');
      if (Array.isArray(tasks) && tasks.length) {
        var keptTasks = [];
        tasks.forEach(function (t) {
          if (t.source === 'timeline' && isTeacherComm(t.title)) removedTasks.push(t);
          else keptTasks.push(t);
        });
        if (removedTasks.length) store.set('tasks', keptTasks);
      }

      // 始终设置备份键（即使为空），便于排查「迁移是否曾跑过」
      store.set(backupKey(), {
        ts: new Date().toISOString(),
        customNodes: removedNodes,
        tasks: removedTasks,
        version: 'r1'
      });

      if (removedNodes.length || removedTasks.length) {
        var msg = '已清理历史遗留的「教师沟通」类时间轴节点 ' + removedNodes.length +
          ' 个、相关待办 ' + removedTasks.length + ' 条（详见数据备份，可回滚）';
        if (App.util && App.util.toast) App.util.toast(msg, 'ok');
        console.log('[migration:r1] ' + msg, store.get(backupKey()));
      } else {
        console.log('[migration:r1] 无需清理（数据已干净）。备份时间戳已记录。');
      }

      store.set('settings.migratedTeacherComm_r1', true);
    } catch (e) {
      console.error('[migration:r1] teacherComm cleanup failed', e);
    }
  };

  // 回滚：把备份的节点/待办恢复回去（供控制台调用：App.restoreTeacherCommMigration()）
  App.restoreTeacherCommMigration = function () {
    try {
      var store = App.store;
      var b = store.get(backupKey());
      if (!b) { if (App.util && App.util.toast) App.util.toast('没有可恢复的备份', 'warn'); return; }
      if (Array.isArray(b.customNodes) && b.customNodes.length) {
        var nodes = store.get('timeline.customNodes') || [];
        store.set('timeline.customNodes', nodes.concat(b.customNodes));
      }
      if (Array.isArray(b.tasks) && b.tasks.length) {
        var tasks = store.get('tasks') || [];
        store.set('tasks', tasks.concat(b.tasks));
      }
      store.set('settings.migratedTeacherComm_r1', false); // 允许再次清理
      if (App.util && App.util.toast) App.util.toast('已回滚教师沟通清理（' + (b.customNodes.length + b.tasks.length) + ' 项）', 'ok');
      console.log('[migration] restored', b);
    } catch (e) {
      console.error('[migration] restore failed', e);
    }
  };
})();
