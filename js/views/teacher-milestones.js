/* 教师职业发展关键节点 · 智能提醒引擎
 * 规则：入职满 3 个月 → 转正提醒（生成并签署转正合同）；
 *       入职满 6 个月 / 1 年 / 2 年 / 3 年 → 工龄变化沟通提醒（DOS 与教师沟通）。
 * 系统设计：
 *   - 单一事实来源 = store.teacherMilestones（每条里程碑含 teacherId / type / 触发日期 / 负责人 / 截止 / 状态）
 *   - 生成时同步写入：① 时间轴 timeline.customNodes（按触发日期 absolute 展示）② 待办 tasks（负责人/截止/状态）
 *   - 通过 milestoneId / timelineNodeId / taskId 三方互链，保证「提示内容 / 时间轴记录 / 待办任务」一致且可追踪
 *   - 幂等：按 id 去重；reconcile 负责双向同步（任一处标记完成，其余两处同步）
 */
(function () {
  if (!window.App) window.App = {};
  if (!App.views) App.views = {};
  if (!App.util) App.util = {};

  var esc = function (s) { return App.util.escapeHtml ? App.util.escapeHtml(s) : (s == null ? '' : String(s)); };
  var escA = function (s) { return App.util.escapeAttr ? App.util.escapeAttr(s) : (s == null ? '' : String(s)); };

  // 关键节点定义（顺序即展示顺序由触发日期决定）
  var MS_DEFS = [
    {
      type: 'probation', months: 3, label: '转正提醒', priority: 'high', dueDays: 7,
      title: function (t) { return '【转正】' + t.name + '（' + t.subjectGroup + '）入职满3个月，需生成并签署转正合同'; },
      note: function (t) {
        return '教师 ' + t.name + ' 于 ' + t.entryDate + ' 入职，已满 3 个月试用期。请于截止日前完成转正评估、生成并签署转正合同，并更新人事档案。';
      }
    },
    {
      type: 'tenure_6m', months: 6, label: '入职6个月沟通', priority: 'normal', dueDays: 7,
      title: function (t) { return '【工龄沟通】' + t.name + ' 入职满6个月，建议开展工龄阶段沟通'; },
      note: function (t) {
        return '教师 ' + t.name + ' 入职满 6 个月。DOS 与其沟通近期适应情况、教学成长与下一步目标，记录沟通要点。';
      }
    },
    {
      type: 'tenure_1y', months: 12, label: '入职1年沟通', priority: 'normal', dueDays: 7,
      title: function (t) { return '【工龄沟通】' + t.name + ' 入职满1年，开展年度工龄沟通'; },
      note: function (t) {
        return '教师 ' + t.name + ' 入职满 1 年。回顾一年成长，肯定成效，明确下阶段发展方向与培养计划。';
      }
    },
    {
      type: 'tenure_2y', months: 24, label: '入职2年沟通', priority: 'normal', dueDays: 7,
      title: function (t) { return '【工龄沟通】' + t.name + ' 入职满2年，开展工龄阶段沟通'; },
      note: function (t) {
        return '教师 ' + t.name + ' 入职满 2 年，进入稳定成长期。沟通职业锚定、带教/教研角色承担可能性。';
      }
    },
    {
      type: 'tenure_3y', months: 36, label: '入职3年沟通', priority: 'normal', dueDays: 7,
      title: function (t) { return '【工龄沟通】' + t.name + ' 入职满3年，开展里程碑沟通'; },
      note: function (t) {
        return '教师 ' + t.name + ' 入职满 3 年，关键里程碑。沟通长期发展意向（骨干/管理/专业纵深），并规划下一步。';
      }
    }
  ];

  var MS_COLORS = {
    probation: '#4F46E5',
    tenure_6m: '#0EA5E9',
    tenure_1y: '#10B981',
    tenure_2y: '#F59E0B',
    tenure_3y: '#EF4444'
  };

  var SOURCE = 'teacher-milestone'; // 用于待办/时间轴的来源标识，便于筛选与追踪
  var RELEVANCE_WINDOW_DAYS = 7;    // 里程碑截止后仍视为可处理的宽限天数；超过此窗口的历史节点不再生成/保留，防止历史数据批量生成过期待办
  var SUPPRESS_KEY = 'teacherMilestoneSuppressed'; // settings 下存储「已手动删除/抑制再生」的里程碑 ID 数组

  // ---------- 日期工具 ----------
  function parse(d) { return new Date(d + 'T00:00:00'); }
  function fmt(d) { return App.util.formatDate(d, 'YYYY-MM-DD'); }
  function todayStr() { return fmt(new Date()); }

  function addMonths(dateStr, months) {
    var d = parse(dateStr);
    var y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    var total = y * 12 + m + months;
    var ny = Math.floor(total / 12), nm = total % 12;
    var lastDay = new Date(ny, nm + 1, 0).getDate();
    return fmt(new Date(ny, nm, Math.min(day, lastDay)));
  }
  function addDays(dateStr, days) {
    var d = parse(dateStr);
    d.setDate(d.getDate() + days);
    return fmt(d);
  }

  // ---------- 数据访问 ----------
  // 统一走 App.viewData()：子台返回总台镜像数据，总台返回本地数据

  // 学科组归一：去除「科组/组/教研组/备课组/学科」等后缀并关键词归一，
  // 使「数学」「数学组」「数学科组」「数学教研组」与「数学」视为同一组
  function canonSubject(s) {
    s = String(s || '').trim();
    if (!s) return '';
    s = s.replace(/科组$|教研组$|备课组$|学科组$|组$|学科$/, '');
    if (s.indexOf('数学') >= 0) return '数学';
    if (s.indexOf('英语') >= 0) return '英语';
    if (s.indexOf('文综') >= 0) return '文综';
    if (s.indexOf('理综') >= 0) return '理综';
    return s;
  }

  function getTeachers() {
    var d = App.viewData ? App.viewData() : (App.store.getData ? App.store.getData() : {});
    var teachers = d.teachers || [];
    // 子台只看本科组（与教师管理过滤规则一致）
    if (isSub() && App.subContext && App.subContext.myName) {
      var nm = App.subContext.myName();
      if (nm) teachers = teachers.filter(function(t) { return canonSubject(t.subjectGroup) === canonSubject(nm); });
    }
    return teachers;
  }
  function getMilestones() {
    var d = App.viewData ? App.viewData() : (App.store.getData ? App.store.getData() : {});
    var ms = d.teacherMilestones || [];
    // 子台只看本科组的提醒
    if (isSub() && App.subContext && App.subContext.myName) {
      var nm = App.subContext.myName();
      if (nm) ms = ms.filter(function(m) { return canonSubject(m.subjectGroup) === canonSubject(nm); });
    }
    return ms;
  }
  function teacherKey(t) { return t.id || (t.name + '｜' + t.subjectGroup); }
  function isSub() { return !!(App.isSub && App.isSub()); }

  // ---------- 抑制再生（手动删除的里程碑持久化） ----------
  function getSuppressed() {
    var s = App.store.get('settings') || {};
    var arr = s[SUPPRESS_KEY];
    if (!Array.isArray(arr)) return [];
    return arr.slice();
  }
  function isSuppressed(id) {
    var arr = getSuppressed();
    return arr.indexOf(id) !== -1;
  }
  function addSuppressed(id) {
    var s = App.store.get('settings') || {};
    var arr = s[SUPPRESS_KEY];
    if (!Array.isArray(arr)) arr = [];
    if (arr.indexOf(id) === -1) {
      arr.push(id);
      s[SUPPRESS_KEY] = arr;
      App.store.set('settings', s);
    }
  }
  function removeSuppressed(id) {
    var s = App.store.get('settings') || {};
    var arr = s[SUPPRESS_KEY];
    if (!Array.isArray(arr)) return;
    var idx = arr.indexOf(id);
    if (idx !== -1) {
      arr.splice(idx, 1);
      s[SUPPRESS_KEY] = arr;
      App.store.set('settings', s);
    }
  }

  // ---------- 生成（幂等） ----------
  // 仅在「触发日期 <= 今天」时生成（即对应时间节点已到达），符合"在对应时间节点自动生成提示"
  function generate() {
    if (isSub()) return 0; // 子台不自己生成，读取总台的即可
    var teachers = getTeachers();
    var existing = getMilestones();
    var byId = {};
    existing.forEach(function (m) { byId[m.id] = m; });
    var suppressed = {};
    getSuppressed().forEach(function (id) { suppressed[id] = true; });
    var today = todayStr();
    var created = 0;

    teachers.forEach(function (t) {
      if (!t.entryDate) return;
      MS_DEFS.forEach(function (def) {
        var trigger = addMonths(t.entryDate, def.months);
        if (trigger > today) return; // 节点未到，暂不生成
        var due = addDays(trigger, def.dueDays);
        if (addDays(due, RELEVANCE_WINDOW_DAYS) < today) return; // 已过期太久，不再生成，避免历史数据批量生成过期待办
        var id = 'ms_' + teacherKey(t) + '_' + def.type;
        if (suppressed[id]) return; // 已被用户手动删除并抑制再生
        if (byId[id]) return; // 已存在，幂等跳过

        var m = {
          id: id,
          teacherId: t.id,
          teacherName: t.name,
          subjectGroup: t.subjectGroup,
          type: def.type,
          label: def.label,
          triggerDate: trigger,
          title: def.title(t),
          note: def.note(t),
          status: 'pending',
          owner: 'DOS',
          dueDate: due,
          priority: def.priority,
          createdAt: new Date().toISOString(),
          timelineNodeId: id + '_node',
          taskId: id + '_task'
        };

        // ① 同步写入时间轴（按触发日期 absolute 展示，作为里程碑事件）
        var node = {
          id: m.timelineNodeId,
          title: m.title,
          note: m.note + ' ｜负责人：' + m.owner + ' ｜截止：' + m.dueDate,
          date: trigger,
          type: 'abs',
          color: MS_COLORS[def.type],
          source: SOURCE,
          milestoneId: id,
          teacherId: t.id,
          teacherName: t.name
        };
        App.store.push('timeline.customNodes', node);

        // ② 同步写入待办（负责人 / 截止 / 状态）
        var task = {
          id: m.taskId,
          title: m.title,
          note: m.note,
          status: 'todo',
          priority: def.priority,
          assignee: m.owner,
          dueDate: m.dueDate,
          source: SOURCE,
          scope: 'personal',
          milestoneId: id,
          teacherId: t.id,
          teacherName: t.name,
          createdAt: m.createdAt,
          updatedAt: m.createdAt
        };
        App.store.push('tasks', task);

        existing.push(m);
        byId[id] = m;
        created++;
      });
    });

    if (created > 0) App.store.set('teacherMilestones', existing);
    return created;
  }

  // ---------- 对账（双向同步，保证三者一致） ----------
  function reconcile() {
    var ms = getMilestones();
    if (ms.length === 0) return 0;
    var tasks = App.store.get('tasks') || [];
    var nodes = App.store.get('timeline.customNodes') || [];
    var changed = false;
    var suppressed = {};
    getSuppressed().forEach(function (id) { suppressed[id] = true; });

    var taskIdx = {}; tasks.forEach(function (t, i) { taskIdx[t.id] = i; });
    var nodeIdx = {}; nodes.forEach(function (n, i) { nodeIdx[n.id] = i; });

    ms.forEach(function (m) {
      if (suppressed[m.id]) return; // 被抑制的里程碑不再重建 tasks/nodes，由 cleanup 统一清理
      var ti = taskIdx[m.taskId];
      var ni = nodeIdx[m.timelineNodeId];

      // 任一处完成 → 全部完成
      if (m.status === 'done') {
        if (ti >= 0 && tasks[ti].status !== 'done') { tasks[ti].status = 'done'; changed = true; }
        if (ni >= 0 && !nodes[ni].done) { nodes[ni].done = true; nodes[ni].title = m.title + ' ✅'; changed = true; }
      } else {
        if (ti >= 0 && tasks[ti].status === 'done') { m.status = 'done'; m.doneAt = new Date().toISOString(); changed = true; }
      }

      // 链接缺失 → 重建（防手动删除导致失联）
      if (ti == null) {
        tasks.push({ id: m.taskId, title: m.title, note: m.note, status: m.status === 'done' ? 'done' : 'todo', priority: m.priority, assignee: m.owner, dueDate: m.dueDate, source: SOURCE, scope: 'personal', milestoneId: m.id, teacherId: m.teacherId, teacherName: m.teacherName, createdAt: m.createdAt, updatedAt: new Date().toISOString() });
        changed = true;
      }
      if (ni == null) {
        nodes.push({ id: m.timelineNodeId, title: (m.status === 'done' ? m.title + ' ✅' : m.title), note: m.note + ' ｜负责人：' + m.owner + ' ｜截止：' + m.dueDate, date: m.triggerDate, type: 'abs', color: MS_COLORS[m.type], source: SOURCE, milestoneId: m.id, teacherId: m.teacherId, teacherName: m.teacherName, done: m.status === 'done' });
        changed = true;
      }
    });

    if (changed) {
      App.store.set('teacherMilestones', ms);
      App.store.set('tasks', tasks);
      App.store.set('timeline.customNodes', nodes);
    }
    return changed;
  }

  // ---------- 清理过期太久的待处理里程碑（修正历史数据批量错误） ----------
  function cleanupStaleMilestones() {
    var today = todayStr();
    var cutoff = addDays(today, -RELEVANCE_WINDOW_DAYS);
    // 孤儿时间轴节点的触发日期阈值：due = trigger + 7，故 trigger 早于 cutoff-7 即视为过期
    var nodeTriggerCutoff = addDays(cutoff, -7);

    var suppressed = {};
    getSuppressed().forEach(function (id) { suppressed[id] = true; });

    var ms = getMilestones() || [];
    var removeIds = [];
    var kept = [];
    ms.forEach(function (m) {
      if (suppressed[m.id]) { removeIds.push(m.id); return; } // 被手动删除/抑制的里程碑：彻底清除
      if (m.status !== 'done' && addDays(m.dueDate, RELEVANCE_WINDOW_DAYS) < today) {
        removeIds.push(m.id);
        return;
      }
      kept.push(m);
    });

    var oldTaskCount = 0, oldNodeCount = 0;
    var tasks = (App.store.get('tasks') || []).filter(function (t) {
      oldTaskCount++;
      // 1) 关联到本次清理的里程碑
      if (removeIds.indexOf(t.milestoneId) !== -1) return false;
      // 2) 孤儿节点：source 为教师里程碑、未完成、dueDate 已超窗口
      if (t.source === SOURCE && t.status !== 'done' && t.dueDate && t.dueDate < cutoff) return false;
      return true;
    });

    var nodes = (App.store.get('timeline.customNodes') || []).filter(function (n) {
      oldNodeCount++;
      if (removeIds.indexOf(n.milestoneId) !== -1) return false;
      // 孤儿节点：source 为教师里程碑、未完成、触发日期早于阈值
      if (n.source === SOURCE && !n.done && n.date && n.date < nodeTriggerCutoff) return false;
      return true;
    });

    var removed = oldTaskCount - tasks.length;
    var removedNodes = oldNodeCount - nodes.length;
    if (kept.length === ms.length && removed === 0 && removedNodes === 0) return 0;

    App.store.set('teacherMilestones', kept);
    if (removed) App.store.set('tasks', tasks);
    if (removedNodes) App.store.set('timeline.customNodes', nodes);
    console.log('[teacherMilestones] cleanupStaleMilestones removed', removeIds.length, 'milestones,', removed, 'tasks,', removedNodes, 'nodes');
    return removeIds.length + removed + removedNodes;
  }

  // ---------- 单次确保（应用启动/视图渲染时调用，幂等） ----------
  var ensured = false;
  function ensure() {
    if (ensured) return;
    ensured = true;
    if (isSub()) return; // 子台读取总台的里程碑，不自己生成
    cleanupStaleMilestones();
    generate();
    reconcile();
  }
  function forceCheck() {
    ensured = false;
    ensure();
  }

  // ---------- 标记完成 ----------
  function complete(id) {
    if (isSub()) { App.util.toast('子工作台只读，请在总工作台标记完成', 'warn'); return; }
    var ms = getMilestones();
    var m = ms.find(function (x) { return x.id === id; });
    if (!m) return;
    m.status = 'done';
    m.doneAt = new Date().toISOString();

    var tasks = App.store.get('tasks') || [];
    var t = tasks.find(function (x) { return x.id === m.taskId; });
    if (t) t.status = 'done';

    var nodes = App.store.get('timeline.customNodes') || [];
    var n = nodes.find(function (x) { return x.id === m.timelineNodeId; });
    if (n) { n.done = true; n.title = m.title + ' ✅'; }

    App.store.set('teacherMilestones', ms);
    App.store.set('tasks', tasks);
    App.store.set('timeline.customNodes', nodes);

    if (App.views.teachers && App.views.teachers.render) App.views.teachers.render();
    App.util.toast('已标记完成，并同步更新时间轴与待办', 'ok');
  }

  // ---------- 删除里程碑（持久化抑制再生） ----------
  function deleteMilestone(id, silent) {
    if (isSub()) { App.util.toast('子工作台只读，请在总工作台删除', 'warn'); return; }
    var ms = getMilestones();
    var m = ms.find(function (x) { return x.id === id; });
    if (!m) { if (!silent) App.util.toast('未找到该里程碑', 'warn'); return; }

    // 1) 写入抑制集合，保证 generate/reconcile 后续不会把它复活
    addSuppressed(id);

    // 2) 立即清理该里程碑下的任务、时间轴节点、里程碑记录
    var tasks = (App.store.get('tasks') || []).filter(function (t) { return t.milestoneId !== id; });
    var nodes = (App.store.get('timeline.customNodes') || []).filter(function (n) { return n.milestoneId !== id; });
    var kept = ms.filter(function (x) { return x.id !== id; });

    App.store.set('teacherMilestones', kept);
    App.store.set('tasks', tasks);
    App.store.set('timeline.customNodes', nodes);

    if (!silent) App.util.toast('已删除「' + (m.title || m.label) + '」并抑制再生', 'ok');
    if (App.views.teachers && App.views.teachers.render) App.views.teachers.render();
  }

  function confirmDeleteMilestone(id) {
    var ms = getMilestones();
    var m = ms.find(function (x) { return x.id === id; });
    if (!m) return;
    App.util.modal({
      title: '确认删除里程碑提醒',
      content: '确定删除「' + App.util.escapeHtml(m.title || m.label) + '」？删除后该提醒不会再生。',
      confirmText: '删除', confirmStyle: 'danger',
      onConfirm: function (close) { deleteMilestone(id); close(); }
    });
  }

  // 一次性清理：按教师姓名+节点类型删除所有匹配里程碑（兼容 key 变化导致的重复 ID）
  function deleteByTeacherAndType(teacherName, type) {
    if (isSub()) { App.util.toast('子工作台只读，请在总工作台删除', 'warn'); return 0; }
    var ms = getMilestones();
    var matched = ms.filter(function (m) {
      return m.teacherName === teacherName && m.type === type;
    });
    if (!matched.length) { App.util.toast('未找到匹配的里程碑', 'warn'); return 0; }
    matched.forEach(function (m) { deleteMilestone(m.id, true); });
    App.util.toast('已删除 ' + matched.length + ' 条「' + teacherName + '」的' + (MS_DEFS.find(function(d){ return d.type === type; }) || {}).label + '提醒并抑制再生', 'ok');
    if (App.views.teachers && App.views.teachers.render) App.views.teachers.render();
    return matched.length;
  }

  function findMilestoneByTaskId(taskId) {
    var ms = getMilestones();
    return ms.find(function (m) { return m.taskId === taskId; });
  }

  function pendingCount() {
    ensure();
    return getMilestones().filter(function (m) { return m.status !== 'done'; }).length;
  }

  // ---------- 面板渲染 ----------
  var panelFilter = 'pending';
  var teamMode = false;   // true=团队汇总视图（总台查看所有子工作台的提醒）
  function setFilter(f) { panelFilter = f; if (App.views.teachers && App.views.teachers.render) App.views.teachers.render(); }
  function switchMode(on) { teamMode = !!on; if (App.views.teachers && App.views.teachers.render) App.views.teachers.render(); }

  function panelHtml() {
    ensure();
    var ms = getMilestones().slice();
    ms.sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });
    var filtered = ms.filter(function (m) {
      if (panelFilter === 'pending') return m.status !== 'done';
      if (panelFilter === 'done') return m.status === 'done';
      return true;
    });
    var pending = ms.filter(function (m) { return m.status !== 'done'; }).length;

    var html = '<div class="card ms-card">';
    html += '<div class="ms-head"><div class="ms-title">🎯 教师职业发展关键节点提醒 <span class="ms-count">' + (teamMode ? '团队汇总' : '待处理 ' + pending) + '</span></div>';
    html += '<div class="ms-tools"><div class="ms-filter">';
    if (!isSub() && App.masterHub && App.masterHub.ready && App.masterHub.ready()) {
      html += '<button class="chip' + (teamMode ? ' on' : '') + '" onclick="App.views.teacherMilestones.switchMode(true)">团队汇总</button>';
    }
    html += '<button class="chip' + (!teamMode ? ' on' : '') + '" onclick="App.views.teacherMilestones.switchMode(false)">我的提醒</button>';
    if (!teamMode) {
      [['pending', '待处理'], ['all', '全部'], ['done', '已完成']].forEach(function (p) {
        html += '<button class="chip' + (panelFilter === p[0] ? ' on' : '') + '" onclick="App.views.teacherMilestones.setFilter(\'' + p[0] + '\')">' + p[1] + '</button>';
      });
    }
    html += '</div>';
    if (!isSub() && !teamMode) html += '<button class="btn btn-secondary btn-sm" onclick="App.views.teacherMilestones.checkAndRender()">↻ 重新检查</button>';
    html += '</div></div>';

    if (teamMode) {
      html += '<div id="ms-team-body" class="ms-team-body"><div class="ms-empty muted">正在加载团队数据…</div></div>';
      setTimeout(function () { renderTeamPanel(); }, 0);
    } else if (filtered.length === 0) {
      if (isSub()) {
        html += '<div class="ms-empty muted">子工作台不接收「教师管理」板块的待办与提醒（含转正 / 工龄沟通），相关事项请由总工作台处理。</div>';
      } else {
        html += '<div class="ms-empty muted">暂无' + (panelFilter === 'done' ? '已完成' : (panelFilter === 'all' ? '' : '待处理')) + '的提醒</div>';
      }
    } else {
      html += '<div class="table-card"><table class="teacher-table ms-table"><thead><tr>';
      html += '<th style="width:92px">教师</th><th>关键节点</th><th style="width:104px">触发日期</th><th style="width:104px">截止</th><th style="width:64px">负责人</th><th style="width:76px">状态</th><th style="width:92px">操作</th>';
      html += '</tr></thead><tbody>';
      filtered.forEach(function (m) {
        var overdue = m.status !== 'done' && App.util.isOverdue(m.dueDate);
        html += '<tr' + (overdue ? ' class="overdue-row"' : '') + '>';
        html += '<td><a href="javascript:;" onclick="App.views.teachers.openEdit(\'' + escA(m.teacherId) + '\')" class="ms-teacher">' + esc(m.teacherName) + '</a></td>';
        html += '<td><span class="ms-dot" style="background:' + MS_COLORS[m.type] + '"></span>' + esc(m.label) + (overdue ? ' <span class="ms-overdue">逾期</span>' : '') + '<div class="ms-sub muted">' + esc(m.title) + '</div></td>';
        html += '<td class="mono">' + m.triggerDate + '</td>';
        html += '<td class="mono">' + m.dueDate + '</td>';
        html += '<td>' + esc(m.owner) + '</td>';
        html += '<td>' + (m.status === 'done' ? '<span class="tag status-done">已完成</span>' : '<span class="tag status-todo">待处理</span>') + '</td>';
        html += '<td>';
        if (isSub()) {
          html += '<span class="muted">只读</span>';
        } else if (m.status === 'done') {
          html += '<button class="btn btn-secondary btn-xs" onclick="App.views.teacherMilestones.confirmDeleteMilestone(\'' + escA(m.id) + '\')">删除</button>';
        } else {
          html += '<button class="btn btn-primary btn-xs" onclick="App.views.teacherMilestones.complete(\'' + escA(m.id) + '\')">标记完成</button>';
          html += '<button class="btn btn-ghost btn-xs" style="margin-left:6px" onclick="App.views.teacherMilestones.confirmDeleteMilestone(\'' + escA(m.id) + '\')">删除</button>';
        }
        html += '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<p class="ms-foot muted">' + (isSub()
      ? '子工作台视角：下列提醒来自总工作台，子台只读查看，请在总工作台处理。'
      : (teamMode
        ? '团队汇总展示所有子工作台已同步到云端的转正/工龄提醒；你可点「标注」发送提示，由对应子工作台自行处理。'
        : '每条提醒已自动同步至「时间轴」(按触发日期展示里程碑) 与「待办事项」(含负责人/截止/状态)。标记完成后三处状态保持一致，可全程追踪。')) + '</p>';
    html += '</div>';
    return html;
  }

  function checkAndRender() {
    forceCheck();
    if (App.views.teachers && App.views.teachers.render) App.views.teachers.render();
  }

  // ---------- 团队汇总（总台查看所有子工作台的提醒） ----------
  function renderTeamPanel() {
    var box = document.getElementById('ms-team-body');
    if (!box) return;
    if (!App.masterHub || !App.masterHub.ready || !App.masterHub.ready()) {
      box.innerHTML = '<div class="ms-empty muted">团队汇总需要先登录云端同步（右下角小组件），并已创建组织、纳管子工作台。</div>';
      return;
    }
    App.masterHub.fetchAllMembersData().then(function (members) {
      if (!members || !members.length) {
        box.innerHTML = '<div class="ms-empty muted">还没有子工作台。请先在「子工作台管理」里纳管下属。</div>';
        return;
      }
      var rows = [];
      members.forEach(function (mem) {
        var ms = (mem.data && mem.data.teacherMilestones) || [];
        ms.forEach(function (m) {
          rows.push({ subUserId: mem.userId, subName: mem.name, m: m });
        });
      });
      rows.sort(function (a, b) {
        var pa = a.m.status === 'done' ? 1 : 0, pb = b.m.status === 'done' ? 1 : 0;
        if (pa !== pb) return pa - pb;
        return (a.m.dueDate || '').localeCompare(b.m.dueDate || '');
      });
      var pending = rows.filter(function (r) { return r.m.status !== 'done'; }).length;

      var html = '<div class="ms-team-meta muted">共 ' + members.length + ' 个子工作台 · 汇总 ' + rows.length + ' 条提醒 · 待处理 ' + pending + '</div>';
      if (!rows.length) {
        html += '<div class="ms-empty muted">子工作台暂无教师转正/工龄提醒（或子台尚未登录云端同步上传数据）。</div>';
      } else {
        html += '<div class="table-card"><table class="teacher-table ms-table"><thead><tr>';
        html += '<th style="width:88px">来源</th><th style="width:88px">教师</th><th>关键节点</th><th style="width:100px">触发</th><th style="width:100px">截止</th><th style="width:70px">状态</th><th style="width:92px">操作</th>';
        html += '</tr></thead><tbody>';
        rows.forEach(function (r) {
          var m = r.m;
          var overdue = m.status !== 'done' && App.util.isOverdue(m.dueDate);
          html += '<tr' + (overdue ? ' class="overdue-row"' : '') + '>';
          html += '<td><span class="ms-sub-owner">' + esc(r.subName) + '</span></td>';
          html += '<td>' + esc(m.teacherName) + '</td>';
          html += '<td><span class="ms-dot" style="background:' + (MS_COLORS[m.type] || '#888') + '"></span>' + esc(m.label) + (overdue ? ' <span class="ms-overdue">逾期</span>' : '') + '<div class="ms-sub muted">' + esc(m.title) + '</div></td>';
          html += '<td class="mono">' + (m.triggerDate || '') + '</td>';
          html += '<td class="mono">' + (m.dueDate || '') + '</td>';
          html += '<td>' + (m.status === 'done' ? '<span class="tag status-done">已完成</span>' : '<span class="tag status-todo">待处理</span>') + '</td>';
          html += '<td><button class="btn btn-secondary btn-xs" onclick="App.views.teacherMilestones.teamAnnotate(\'' + escA(r.subUserId) + '\', \'' + escA(m.id) + '\')">标注</button></td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      }
      box.innerHTML = html;
    }).catch(function (e) {
      box.innerHTML = '<div class="ms-empty muted">加载失败：' + esc(e && e.message ? e.message : e) + '</div>';
    });
  }

  function teamAnnotate(subUserId, milestoneId) {
    if (isSub()) { App.util.toast('子工作台不能发送标注', 'warn'); return; }
    if (!App.masterHub || !App.masterHub.sendAnnotation) return;
    App.util.modal({
      title: '发送标注提示',
      content: '<div class="form-group"><label class="form-label">标注内容（子工作台将收到此提示，自行处理）</label>' +
        '<textarea class="form-input" id="ms-anno-note" rows="3" placeholder="如：请尽快完成该教师的转正评估并签署合同"></textarea></div>',
      confirmText: '发送标注',
      onConfirm: function (close) {
        var v = document.getElementById('ms-anno-note').value.trim();
        if (!v) { App.util.toast('请填写标注内容', 'warn'); return; }
        App.masterHub.sendAnnotation(subUserId, 'teacherMilestone', milestoneId, v).then(function (res) {
          if (res && res.ok) close();
        });
      }
    });
  }

  // 应用启动后自动生成（静态前端：在打开教师视图/应用启动时幂等执行）
  // 必须等 sub-context 完成身份识别后再执行，防止子台在「被识别出来前」就按本地数据生成
  if (typeof document !== 'undefined') {
    var boot = function () { try { ensure(); } catch (e) { console.error('[teacherMilestones] ensure failed', e); } };
    var deferBoot = function () {
      if (App.subContext && App.subContext.onReady) {
        App.subContext.onReady(boot);
      } else {
        setTimeout(boot, 0);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', deferBoot);
    else deferBoot();
  }

  // 云端整档覆盖本地后，重新清理可能随同步回来的「历史孤儿过期待办/时间轴节点」，保证零残留。
  // 必要性：启动 ensure() 与 sync.applyRemote() 均为异步、竞态不可控；若 ensure 先跑、applyRemote
  // 后把含 250 条残留的云端副本覆盖回来，ensured 守卫会阻止二次清理 → 用户仍见旧数据。
  // 本监听挂在 applyRemote 之后派发的事件上，确保清理一定跑在「云端数据落地」之后。
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('dos:store-remote-applied', function () {
      if (isSub()) return;            // 子台只读总台镜像，不自行清理
      try {
        var n = cleanupStaleMilestones();
        if (n) {
          reconcile();
          if (App.views.teachers && App.views.teachers.render) App.views.teachers.render();
        }
      } catch (e) { console.error('[teacherMilestones] remote-applied cleanup failed', e); }
    });
  }

  App.views.teacherMilestones = {
    ensure: ensure,
    generate: generate,
    reconcile: reconcile,
    complete: complete,
    deleteMilestone: deleteMilestone,
    confirmDeleteMilestone: confirmDeleteMilestone,
    deleteByTeacherAndType: deleteByTeacherAndType,
    findMilestoneByTaskId: findMilestoneByTaskId,
    pendingCount: pendingCount,
    panelHtml: panelHtml,
    setFilter: setFilter,
    switchMode: switchMode,
    teamAnnotate: teamAnnotate,
    checkAndRender: checkAndRender,
    MS_DEFS: MS_DEFS
  };
})();
