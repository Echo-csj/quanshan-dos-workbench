/* ============================================
   projects.js — 项目组中心
   6大��目组卡片 + checklist + 标准对照 + 周期任务模板
   ============================================ */

(function() {

  App.router.register('/projects', function() {
    var container = document.getElementById('view-container');
    if (!container) return;

    var html = '';

    // --- 6大项目组卡片网格 ---
    html += '<div class="project-grid" style="margin-bottom:28px">';

    Object.keys(App.projectGroups).forEach(function(key) {
      var pg = App.projectGroups[key];
      // 统计该项目组关联的待办数
      var taskCount = (App.store.get('tasks') || []).filter(function(t) { return t.project === key && t.status !== 'done'; }).length;

      html += '<div class="project-card" onclick="App.router.navigate(\'/projects/' + key + '\')">';
      if (pg.warning) {
        html += '<div class="project-warning" title="' + pg.warning + '">' + App.util.svgIcon('alert-triangle', 16) + '</div>';
      }
      html += '<div class="project-icon" style="background:' + pg.color + '15">' + App.util.svgIcon(pg.icon, 20) + '</div>';
      html += '<div class="project-name">' + pg.name + '</div>';
      html += '<div class="project-desc">' + pg.desc + '</div>';
      if (taskCount > 0) {
        html += '<div style="margin-top:10px"><span class="tag tag-accent" style="font-size:11px">' + taskCount + ' 项进行中</span></div>';
      }
      html += '</div>';
    });

    html += '</div>';

    // --- 快捷操作 ---
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('zap', 18) + '快捷操作</h3></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    html += '<button class="btn btn-secondary" onclick="App.views.projects.generateAllWeekly()">' + App.util.svgIcon('play', 14) + '一键生成本周全部待办</button>';
    html += '</div></div>';

    container.innerHTML = html;
  });

  // --- 项目组详情页 ---
  App.router.register('/projects/:id', function(params) {
    var container = document.getElementById('view-container');
    if (!container) return;

    var pg = App.projectGroups[params.id];
    if (!pg) {
      container.innerHTML = '<div class="empty-state"><h4>项目组不存在</h4><p>请检查 URL 是否正确</p><button class="btn btn-secondary btn-sm" onclick="App.router.navigate(\'/projects\')">← 返回</button></div>';
      return;
    }

    var html = '';

    // 返回按钮
    html += '<button class="btn btn-ghost btn-sm" style="margin-bottom:18px" onclick="App.router.navigate(\'/projects\')">' + App.util.svgIcon('chevron-left', 14) + ' 返回项目组中心</button>';

    // 头部信息
    html += '<div class="card" style="margin-bottom:20px">';
    html += '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">';
    html += '<div class="project-icon" style="background:' + pg.color + '15;width:48px;height:48px;border-radius:var(--radius)">' + App.util.svgIcon(pg.icon, 24) + '</div>';
    html += '<div><h2 style="font-size:20px;font-weight:700">' + pg.name + '</h2><p style="color:var(--text-muted);font-size:13px;margin-top:2px">' + pg.desc + '</p></div>';
    html += '</div>';

    // 标准文件引用
    if (pg.standardFile) {
      var files = Array.isArray(pg.standardFile) ? pg.standardFile : [pg.standardFile];
      html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">';
      html += '<span style="font-size:11px;font-weight:600;color:var(--text-muted)">📄 标准文件：</span>';
      files.forEach(function(f) {
        html += '<span class="tag tag-neutral" style="margin-top:4px;font-size:11px;display:inline-block">' + f + '</span>';
      });
      html += '</div>';
    }

    // ⚠️ 差异提示
    if (pg.warning) {
      html += '<div style="margin-top:12px;padding:10px 12px;background:var(--warn-soft);border-radius:var(--radius-sm);border-left:3px solid var(--warn);font-size:12px;color:var(--warn-text);line-height:1.6">';
      html += '<strong>' + App.util.svgIcon('alert-triangle', 14) + ' 注意：</strong>' + pg.warning;
      html += '</div>';
    }
    html += '</div>';

    // 流程检查清单
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('check-square', 18) + '流程检查清单</h3>';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.projects.saveChecklist(\'' + params.id + '\')">保存进度</button></div>';
    html += '<ul class="checklist" id="checklist-' + params.id + '">';

    // 获取已保存的 checklist 状态
    var savedChecks = App.store.get('projects.' + params.id + '.checks') || {};

    pg.checklist.forEach(function(item, idx) {
      var checked = savedChecks[idx] || false;
      html += '<li class="checklist-item' + (checked ? ' checked' : '') + '">';
      html += '<input type="checkbox" class="checklist-checkbox" data-idx="' + idx + '"' + (checked ? ' checked' : '') + '>';
      html += '<span class="checklist-text">' + item + '</span>';
      html += '</li>';
    });

    html += '</ul></div>';

    // 周期任务模板 — 一键生成待办
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('refresh-cw', 18) + '周期任务模板</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">点击按钮将标准流程中的关键步骤转化为本周待办事项。</p>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary" onclick="App.views.projects.generateTasks(\'' + params.id + '\')">' + App.util.svgIcon('plus', 14) + '生成本周待办</button>';
    html += '<button class="btn btn-secondary" onclick="App.views.tasks.openTaskModal())">手动新建</button>';
    html += '</div></div>';

    // 关联待办列表
    var relatedTasks = (App.store.get('tasks') || []).filter(function(t) { return t.project === params.id; });
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('clipboard', 18) + '关联待办 (' + relatedTasks.length + ')</h3>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.tasks.openTaskModal()">+ 新建</button></div>';

    if (relatedTasks.length > 0) {
      html += '<table class="data-table"><thead><tr><th>事项</th><th>优先级</th><th>截止</th><th>状态</th></tr></thead><tbody>';
      relatedTasks.forEach(function(t) {
        html += '<tr onclick="App.views.tasks.openTaskModal(\'' + t.id + '\')" style="cursor:pointer">';
        html += '<td>' + App.util.truncate(t.title, 35) + '</td>';
        html += '<td><span class="' + (t.priority === 'high' ? 'priority-high' : 'priority-normal') + '">' + App.util.priorityLabel(t.priority) + '</span></td>';
        html += '<td class="mono" style="font-size:12px">' + (t.due || '-') + '</td>';
        html += '<td><span class="tag tag-' + App.util.statusColor(t.status) + '" style="font-size:11px">' + App.util.statusLabel(t.status) + '</span></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<div class="empty-state" style="padding:30px"><p>暂无关联待办，点击上方「生成本周待办」快速创建</p></div>';
    }
    html += '</div>';

    container.innerHTML = html;

    // 绑定 checkbox 事件
    document.querySelectorAll('#checklist-' + params.id + ' .checklist-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var li = this.closest('.checklist-item');
        if (this.checked) {
          li.classList.add('checked');
        } else {
          li.classList.remove('checked');
        }
      });
    });
  });

  // --- Public API ---

  App.views = App.views || {};
  App.views.projects = {
    saveChecklist: function(projectId) {
      var checks = {};
      document.querySelectorAll('#checklist-' + projectId + ' .checklist-checkbox').forEach(function(cb) {
        checks[cb.dataset.idx] = cb.checked;
      });
      App.store.set('projects.' + projectId + '.checks', checks);
      App.util.toast('检查清单进度已保存', 'ok');
    },

    generateTasks: function(projectId) {
      var pg = App.projectGroups[projectId];
      if (!pg) return;

      var now = new Date();
      var dueDate = new Date(now.getTime() + 7 * 86400000); // 默认一周后

      pg.checklist.forEach(function(item) {
        App.store.push('tasks', {
          id: App.store.uid('task'),
          title: '[' + pg.name + '] ' + item,
          source: '项目组模板',
          project: projectId,
          owner: 'self',
          priority: 'normal',
          due: App.util.formatDate(dueDate, 'YYYY-MM-DD'),
          status: 'todo',
          parentId: null,
          children: [],
          note: '由「' + pg.name + '」周期任务模板自动生成',
          createdAt: new Date().toISOString()
        });
      });

      App.util.toast('已生成 ' + pg.checklist.length + ' 项待办（' + pg.name + '）', 'ok');
      App.router.resolve();
    },

    generateAllWeekly: function() {
      var total = 0;
      Object.keys(App.projectGroups).forEach(function(key) {
        var pg = App.projectGroups[key];
        // 每个项目组只生成前3条核心任务作为本周待办
        pg.checklist.slice(0, 3).forEach(function(item) {
          var dueDate = new Date(Date.now() + 5 * 86400000);
          App.store.push('tasks', {
            id: App.store.uid('task'),
            title: '[' + pg.name + '] ' + item,
            source: '周度任务模板',
            project: key,
            owner: 'self',
            priority: 'normal',
            due: App.util.formatDate(dueDate, 'YYYY-MM-DD'),
            status: 'todo',
            parentId: null,
            children: [],
            note: '',
            createdAt: new Date().toISOString()
          });
          total++;
        });
      });
      App.util.toast('已生成 ' + total + ' 项本周待办（6大项目组各取核心3项）', 'ok');
      App.router.navigate('/tasks');
    }
  };

})();
