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
  function getTeachers() { return App.store.get('teachers') || []; }
  function getMilestones() { return App.store.get('teacherMilestones') || []; }
  function teacherKey(t) { return t.id || (t.name + '｜' + t.subjectGroup); }

  // ---------- 生成（幂等） ----------
  // 仅在「触发日期 <= 今天」时生成（即对应时间节点已到达），符合"在对应时间节点自动生成提示"
  function generate() {
    var teachers = getTeachers();
    var existing = getMilestones();
    var byId = {};
    existing.forEach(function (m) { byId[m.id] = m; });
    var today = todayStr();
    var created = 0;

    teachers.forEach(function (t) {
      if (!t.entryDate) return;
      MS_DEFS.forEach(function (def) {
        var trigger = addMonths(t.entryDate, def.months);
        if (trigger > today) return; // 节点未到，暂不生成
        var id = 'ms_' + teacherKey(t) + '_' + def.type;
        if (byId[id]) return; // 已存在，幂等跳过

        var due = addDays(trigger, def.dueDays);
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

    var taskIdx = {}; tasks.forEach(function (t, i) { taskIdx[t.id] = i; });
    var nodeIdx = {}; nodes.forEach(function (n, i) { nodeIdx[n.id] = i; });

    ms.forEach(function (m) {
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
        tasks.push({ id: m.taskId, title: m.title, note: m.note, status: m.status === 'done' ? 'done' : 'todo', priority: m.priority, assignee: m.owner, dueDate: m.dueDate, source: SOURCE, milestoneId: m.id, teacherId: m.teacherId, teacherName: m.teacherName, createdAt: m.createdAt, updatedAt: new Date().toISOString() });
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

  // ---------- 单次确保（应用启动/视图渲染时调用，幂等） ----------
  var ensured = false;
  function ensure() {
    if (ensured) return;
    ensured = true;
    generate();
    reconcile();
  }
  function forceCheck() {
    ensured = false;
    ensure();
  }

  // ---------- 标记完成 ----------
  function complete(id) {
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

  function pendingCount() {
    ensure();
    return getMilestones().filter(function (m) { return m.status !== 'done'; }).length;
  }

  // ---------- 面板渲染 ----------
  var panelFilter = 'pending';
  function setFilter(f) { panelFilter = f; if (App.views.teachers && App.views.teachers.render) App.views.teachers.render(); }

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
    html += '<div class="ms-head"><div class="ms-title">🎯 教师职业发展关键节点提醒 <span class="ms-count">待处理 ' + pending + '</span></div>';
    html += '<div class="ms-tools"><div class="ms-filter">';
    [['pending', '待处理'], ['all', '全部'], ['done', '已完成']].forEach(function (p) {
      html += '<button class="chip' + (panelFilter === p[0] ? ' on' : '') + '" onclick="App.views.teacherMilestones.setFilter(\'' + p[0] + '\')">' + p[1] + '</button>';
    });
    html += '</div><button class="btn btn-secondary btn-sm" onclick="App.views.teacherMilestones.checkAndRender()">↻ 重新检查</button></div></div>';

    if (filtered.length === 0) {
      html += '<div class="ms-empty muted">暂无' + (panelFilter === 'done' ? '已完成' : (panelFilter === 'all' ? '' : '待处理')) + '的提醒</div>';
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
        html += '<td>' + (m.status === 'done' ? '<span class="muted">已同步</span>' : '<button class="btn btn-primary btn-xs" onclick="App.views.teacherMilestones.complete(\'' + escA(m.id) + '\')">标记完成</button>') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<p class="ms-foot muted">每条提醒已自动同步至「时间轴」(按触发日期展示里程碑) 与「待办事项」(含负责人/截止/状态)。标记完成后三处状态保持一致，可全程追踪。</p>';
    html += '</div>';
    return html;
  }

  function checkAndRender() {
    forceCheck();
    if (App.views.teachers && App.views.teachers.render) App.views.teachers.render();
  }

  // 应用启动后自动生成（静态前端：在打开教师视图/应用启动时幂等执行）
  if (typeof document !== 'undefined') {
    var boot = function () { try { ensure(); } catch (e) { console.error('[teacherMilestones] ensure failed', e); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
    else setTimeout(boot, 0);
  }

  App.views.teacherMilestones = {
    ensure: ensure,
    generate: generate,
    reconcile: reconcile,
    complete: complete,
    pendingCount: pendingCount,
    panelHtml: panelHtml,
    setFilter: setFilter,
    checkAndRender: checkAndRender,
    MS_DEFS: MS_DEFS
  };
})();
