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
