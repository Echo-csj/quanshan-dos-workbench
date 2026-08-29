/* ============================================
   projects.js — 项目组中心
   6大项目组卡片 + checklist + 标准对照
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
      html += '<div class="project-card" onclick="App.router.navigate(\'/projects/' + key + '\')">';
      if (pg.warning) {
        html += '<div class="project-warning" title="' + pg.warning + '">' + App.util.svgIcon('alert-triangle', 16) + '</div>';
      }
      html += '<div class="project-icon" style="background:' + pg.color + '15">' + App.util.svgIcon(pg.icon, 20) + '</div>';
      html += '<div class="project-name">' + pg.name + '</div>';
      html += '<div class="project-desc">' + pg.desc + '</div>';
      html += '</div>';
    });

    html += '</div>';

    // --- 项目组健康度 + 智能催办（本地智能，基于事项看板任务） ---
    html += renderHealthCard();

    // --- 说明 ---
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('info', 18) + '关于项目组</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);line-height:1.8">每个项目组对应一套标准流程与检查清单。点击卡片进入详情查看标准文件、流程检查清单与注意事项。需要跟进的工作事项，请前往「<a href="javascript:App.router.navigate(\'/tasks\')" style="color:var(--accent);cursor:pointer">事项看板</a>」统一管理与流转。</p>';
    html += '</div>';

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

  // --- 项目组健康度 + 智能催办（本地智能 · 数据不出本机） ---
  function renderHealthCard() {
    var U = App.util;
    var tasks = (App.viewData().tasks || []).filter(function (t) { return !t.archived; });
    var pgs = App.projectGroups || {};
    var now = new Date();
    var soon = new Date(now); soon.setDate(soon.getDate() + 3);
    var soonStr = U.formatDate(soon, 'YYYY-MM-DD');

    var rows = [];
    Object.keys(pgs).forEach(function (key) {
      var pg = pgs[key];
      var ts = tasks.filter(function (t) { return t.projGroup === pg.id; });
      if (!ts.length) return;   // 无任务的项目组不显示，避免噪音
      var done = ts.filter(function (t) { return t.status === 'done'; }).length;
      var overdue = ts.filter(function (t) { return t.status !== 'done' && t.dueDate && U.isOverdue(t.dueDate); });
      var dueSoon = ts.filter(function (t) { return t.status !== 'done' && t.dueDate && !U.isOverdue(t.dueDate) && t.dueDate <= soonStr; });
      var health = overdue.length ? 'bad' : (dueSoon.length ? 'warn' : 'ok');
      var rate = ts.length ? Math.round(done / ts.length * 100) : 0;
      rows.push({ pg: pg, total: ts.length, done: done, rate: rate, overdue: overdue, dueSoon: dueSoon, health: health });
    });

    if (!rows.length) {
      // 没有带项目组标签的任务时，也显示卡片并给出提示，让功能可感知
      return '<div class="card" style="margin-bottom:28px">' +
        '<div class="card-header"><h3 class="card-title">' + U.svgIcon('trending-up', 18) + '项目组健康度 · 智能催办</h3>' +
        '<span class="ai-tag-local">本地智能 · 数据不出本机</span></div>' +
        '<div class="ai-insight-notes ai-insight-ok">' + U.svgIcon('info', 14) + ' 暂无带「项目组」标签的任务。请到「事项看板」为任务勾选项目组（如新生/排课/预警/大考/讲义/新师培训），此处将自动生成各项目组的完成率、逾期/临期健康度与催办清单。</div>' +
        '</div>';
    }

    // 按健康度排序：bad 在前
    rows.sort(function (a, b) { return (a.health === 'bad' ? 0 : a.health === 'warn' ? 1 : 2) - (b.health === 'bad' ? 0 : b.health === 'warn' ? 1 : 2); });

    var html = '<div class="card" style="margin-bottom:28px">';
    html += '<div class="card-header"><h3 class="card-title">' + U.svgIcon('trending-up', 18) + '项目组健康度 · 智能催办</h3>';
    html += '<span class="ai-tag-local">本地智能 · 数据不出本机</span></div>';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">基于「事项看板」中带项目组标签的任务实时统计：完成率、逾期、临期。逾期 → 红，临期 → 黄，正常 → 绿。</p>';

    html += '<div class="pg-health-list">';
    rows.forEach(function (r) {
      var pg = r.pg;
      var tone = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' }[r.health];
      html += '<div class="pg-health-item" style="border-left:3px solid ' + pg.color + '">';
      html += '<div class="pg-health-head">';
      html += '<span class="pg-health-dot" style="background:' + tone + '"></span>';
      html += '<span class="pg-health-name">' + U.escapeHtml(pg.name) + '</span>';
      html += '<span class="mono" style="font-size:12px;color:var(--text-muted)">完成 ' + r.done + '/' + r.total + '</span>';
      html += '<span class="mono pg-health-rate" style="color:' + tone + '">' + r.rate + '%</span>';
      html += '<span class="tag ' + (r.overdue.length ? 'tag-bad' : (r.dueSoon.length ? 'tag-warn' : 'tag-ok')) + '">' +
        (r.overdue.length ? '逾期 ' + r.overdue.length : (r.dueSoon.length ? '临期 ' + r.dueSoon.length : '正常')) + '</span>';
      html += '</div>';
      var alerts = [];
      r.overdue.forEach(function (t) { alerts.push('<span class="tag tag-bad">逾期</span> ' + U.escapeHtml(t.title) + (t.assignee ? ' <span class="pg-health-who">@' + U.escapeHtml(t.assignee) + '</span>' : '')); });
      r.dueSoon.forEach(function (t) { alerts.push('<span class="tag tag-warn">临期</span> ' + U.escapeHtml(t.title) + (t.dueDate ? ' <span class="mono">' + U.escapeHtml(t.dueDate) + '</span>' : '')); });
      if (alerts.length) {
        html += '<div class="pg-health-alerts">' + alerts.map(function (s) { return '<div class="pg-health-alert">' + s + '</div>'; }).join('') + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    // 汇总催办名单（按负责人聚合，仅逾期+临期）
    var urgentByWho = {};
    rows.forEach(function (r) {
      r.overdue.concat(r.dueSoon).forEach(function (t) {
        var who = (t.assignee || '未分配').trim();
        (urgentByWho[who] = urgentByWho[who] || []).push(t);
      });
    });
    var whoList = Object.keys(urgentByWho).filter(function (w) { return urgentByWho[w].length; });
    if (whoList.length) {
      html += '<div class="ai-insight-notes" style="margin-top:14px">';
      html += '<div class="ai-insight-k" style="margin-bottom:6px">' + U.svgIcon('alert-circle', 14) + ' 催办建议（按负责人汇总）</div>';
      html += '<ul>';
      whoList.forEach(function (w) {
        html += '<li><strong>' + U.escapeHtml(w) + '</strong>：' + urgentByWho[w].length + ' 项待跟进（' +
          urgentByWho[w].map(function (t) { return U.escapeHtml(U.truncate(t.title, 12)); }).join('、') + '）</li>';
      });
      html += '</ul></div>';
    }

    html += '</div>';
    return html;
  }

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
    }
  };

})();
