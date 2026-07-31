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
