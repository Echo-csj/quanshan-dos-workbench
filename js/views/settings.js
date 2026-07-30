/* ============================================
   settings.js — 设置页面
   基准值配置 / 节点编辑 / 数据导入导出 / 关于
   ============================================ */

(function() {

  App.router.register('/settings', function() {
    var container = document.getElementById('view-container');
    if (!container) return;

    var data = App.store.getData();
    var settings = data.settings || {};
    var meta = data.meta || {};

    var html = '';

    // --- 基本信息 ---
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('info', 18) + '关于工作台</h3></div>';
    html += '<div style="font-size:13px;line-height:2">';
    html += '<div><strong>版本：</strong>v1.0.0 (MVP)</div>';
    html += '<div><strong>负责人：</strong>' + (meta.owner || 'DOS-泉山') + '</div>';
    html += '<div><strong>最后更新：</strong>' + (meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('zh-CN') : '-') + '</div>';
    html += '<div><strong>数据量：</strong>' + ((data.tasks || []).length) + ' 条待办 / ' + ((data.timeline.fixedNodes || []).length) + ' 个时间节点</div>';
    html += '</div></div>';

    // --- 基准值查看 ---
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('target', 18) + '教学数据基准值</h3>';
    html += '<button class="btn btn-ghost btn-sm" onclick="App.views.settings.showBaselineDetail()">查看详情</button></div>';
    html += '<div class="grid-4">';
    var baselineCats = Object.keys(App.baseline);
    baselineCats.forEach(function(cat) {
      var items = Object.keys(App.baseline[cat]);
      html += '<div style="padding:12px;background:var(--surface-2);border-radius:var(--radius-sm)">';
      html += '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:6px">' + cat + '</div>';
      html += '<div style="font-size:11px;color:var(--text-muted)">' + items.length + ' 项指标</div>';
      items.slice(0, 3).forEach(function(key) {
        var item = App.baseline[cat][key];
        var val = Array.isArray(item.value) ? item.value.join('~') : (item.unit === '%' ? (item.value * 100) + '%' : item.value);
        html += '<div style="font-size:11px;color:var(--text-secondary);margin-top:3px">· ' + item.label + ': <span class="mono">' + val + '</span></div>';
      });
      if (items.length > 3) {
        html += '<div style="font-size:11px;color:var(--text-faint);margin-top:3px">... +' + (items.length - 3) + ' 项</div>';
      }
      html += '</div>';
    });
    html += '</div></div>';

    // --- 时间节点管理 ---
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('clock', 18) + '周节律节点</h3></div>';
    html += '<table class="data-table"><thead><tr><th>名称</th><th>类型</th><th>星期</th><th>时间</th><th>提醒</th></tr></thead><tbody>';
    (data.timeline.fixedNodes || []).forEach(function(node) {
      var wdNames = ['日','一','二','三','四','五','六'];
      html += '<tr>';
      html += '<td><strong>' + node.title + '</strong></td>';
      html += '<td><span class="tag tag-' + (node.type === 'monthly' ? 'warn' : 'accent') + '" style="font-size:10px">' + (node.type === 'fixed' ? '固定' : '月度') + '</span></td>';
      html += '<td>' + (node.weekday !== null ? '周' + wdNames[node.weekday] : '-') + '</td>';
      html += '<td class="mono" style="font-size:12px">' + (node.time || '-') + '</td>';
      html += '<td>' + (node.reminder ? '✅' : '❌') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // --- 数据管理 ---
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('database', 18) + '数据管理</h3></div>';
    html += '<div style="display:flex;flex-direction:column;gap:12px">';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-secondary" onclick="App.store.exportJSON()">' + App.util.svgIcon('download', 14) + '导出备份 (JSON)</button>';

    // 导入按钮（隐藏的 file input）
    html += '<label class="btn btn-secondary" style="cursor:pointer">' + App.util.svgIcon('upload', 14) + '导入恢复 (JSON)';
    html += '<input type="file" accept=".json" style="display:none" onchange="App.views.settings.importFile(this)"></label>';

    html += '<button class="btn btn-danger btn-ghost" onclick="App.views.settings.confirmReset()">' + App.util.svgIcon('trash-2', 14) + '重置所有数据</button>';
    html += '</div>';
    html += '<p class="form-hint">导出的 JSON 文件包含所有待办、时间节点、设置等数据。可在不同设备间通过导入/导出同步。</p>';
    html += '</div></div>';

    // --- 示例数据 ---
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('star', 18) + '示例数据</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">首次使用？注入示例数据快速体验全部功能。</p>';
    html += '<button class="btn btn-secondary" onclick="App.views.settings.injectSeedData()">' + App.util.svgIcon('play', 14) + '注入示例数据</button>';
    html += '</div>';

    container.innerHTML = html;
  });

  // --- Public API ---

  App.views = App.views || {};
  App.views.settings = {
    showBaselineDetail: function() {
      var html = '<div style="max-height:60vh;overflow-y:auto">';
      Object.keys(App.baseline).forEach(function(cat) {
        html += '<h4 style="font-size:14px;font-weight:600;color:var(--accent);margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">' + cat + '</h4>';
        html += '<table class="data-table"><thead><tr><th>指标</th><th>基准值</th><th>方向</th><th>计算方式</th><th>备注</th></tr></thead><tbody>';
        Object.keys(App.baseline[cat]).forEach(function(key) {
          var item = App.baseline[cat][key];
          var val = Array.isArray(item.value) ? item.value.join(' ~ ') : (item.unit === '%' ? (item.value * 100) + '%' : item.value);
          var modeLabel = { gte: '≥ 达标', lte: '≤ 控制', range: '区间' };
          html += '<tr><td style="font-weight:500">' + item.label + '</td><td class="mono">' + val + (item.unit || '') + '</td><td><span class="tag tag-accent" style="font-size:10px">' + (modeLabel[item.mode] || item.mode) + '</span></td><td style="font-size:12px;color:var(--text-muted)">' + (item.compute || '-') + '</td><td style="font-size:11px;color:var(--text-faint)">' + (item.note || (item.seasonal ? '含季节浮动规则' : '-')) + '</td></tr>';
        });
        html += '</tbody></table>';
      });
      html += '</div>';

      App.util.modal({
        title: '📊 教学数据基准值详情',
        content: html,
        showCancel: false,
        confirmText: '关闭'
      });
    },

    importFile: function(input) {
      var file = input.files[0];
      if (!file) return;
      App.store.importJSON(file, function(err) {
        if (err) {
          App.util.toast('导入失败：' + err.message, 'bad');
        } else {
          App.util.toast('数据导入成功！页面将刷新...', 'ok');
          setTimeout(function() { location.reload(); }, 1000);
        }
      });
    },

    confirmReset: function() {
      App.util.modal({
        title: '⚠️ 确认重置',
        content: '<p style="color:var(--bad);font-size:13px">此操作将<strong>清除所有数据</strong>（待办、设置、检查清单等），且不可恢复！</p><p class="form-hint" style="margin-top:8px">建议先「导出备份」再重置。</p>',
        confirmText: '确认重置',
        onConfirm: function(close) {
          App.store.reset();
          close();
          App.util.toast('已重置为默认状态', 'ok');
          setTimeout(function() { location.reload(); }, 800);
        }
      });
    },

    injectSeedData: function() {
      var now = new Date();

      // 示例待办
      var seedTasks = [
        { title: '完成7月第4周 DOS 周报填写', source: '周日周报', project: null, owner: 'self', priority: 'high', due: App.util.formatDate(new Date(now.getTime() + (7 - now.getDay()) * 86400000), 'YYYY-MM-DD'), status: 'todo', note: '每周日固定任务' },
        { title: '跟进数学组停课学员回访情况', source: '教务会', project: 'warning', owner: '数学组长', priority: 'high', due: App.util.formatDate(new Date(now.getTime() + 2*86400000), 'YYYY-MM-DD'), status: 'doing', note: '重点关注停课超2周的学员' },
        { title: '审核8月份排课表初稿', source: '主管会', project: 'schedule', owner: 'self', priority: 'normal', due: App.util.formatDate(new Date(now.getFullYear(), now.getMonth(), -now.getDate() + 25), 'YYYY-MM-DD'), status: 'todo', note: '每月最后一周周三前完成次月预排' },
        { title: '新师张老师试听课评估', source: '新师培训', project: 'training', owner: 'self', priority: 'normal', due: App.util.formatDate(new Date(now.getTime() + 3*86400000), 'YYYY-MM-DD'), status: 'following', note: '带教导师：李老师' },
        { title: '暑期班备考计划制定', source: '备考项目组', project: 'exam', owner: '备考组长', priority: 'normal', due: App.util.formatDate(new Date(now.getTime() + 5*86400000), 'YYYY-MM-DD'), status: 'todo', note: '针对8月初模考' },
        { title: '本月讲义检查第二轮', source: '讲义检查', project: 'material', owner: 'self', priority: 'low', due: App.util.formatDate(new Date(now.getTime() + 6*86400000), 'YYYY-MM-DD'), status: 'todo', note: '重点检查四环节完整性' },
        { title: '新生首课回访（王同学、李同学）', source: '新生项目组', project: 'newstudent', owner: 'CC-小王', priority: 'normal', due: App.util.formatDate(new Date(now.getTime() + 1*86400000), 'YYYY-MM-DD'), status: 'todo', note: '2名新学员均在7月27���完成首课' },
        { title: '整理五项满意度月度报表', source: '数据分析', project: null, owner: 'self', priority: 'low', due: App.util.formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 3), 'YYYY-MM-DD'), status: 'todo', note: '从教务系统导出数据后填入' }
      ];

      seedTasks.forEach(function(t) {
        t.id = App.store.uid('task');
        t.parentId = null;
        t.children = [];
        t.createdAt = now.toISOString();
        App.store.push('tasks', t);
      });

      // 示例月度数据（用于基准值对标 + 环比/同比趋势演示）
      var reports = App.store.get('reports') || { monthly: {}, imports: [] };
      if (!reports.monthly) reports.monthly = {};
      var seedMonths = {
        '2026-05': {
          label: '2026年5月', type: 'DOS周报',
          metrics: { productionRateMonth: 0.95, saturationMonth: 0.72, unitMonthAvg: 5.8, singleSubjectRatio: 1.90, renewalRateSubjectMonth: 0.14, refundRateSubjectMonth: 0.018, suspendRatePersonMonth: 0.07, recommendRatePersonMonth: 0.09, finishRatePersonMonth: 0.022, readingTotal: 180, teacherCount: 25 },
          satisfaction: { totals: { reading: 180, rates: { finishRatePersonMonth: 0.02, refundRateSubjectMonth: 0.018, suspendRatePersonMonth: 0.07, renewalRateSubjectMonth: 0.14, recommendRatePersonMonth: 0.09, finishRateSubjectMonth: 0.10, suspendRateSubjectMonth: 0.05 } }, byHead: [] }
        },
        '2026-06': {
          label: '2026年6月', type: 'DOS周报',
          metrics: { productionRateMonth: 1.05, saturationMonth: 0.80, unitMonthAvg: 6.1, singleSubjectRatio: 2.00, renewalRateSubjectMonth: 0.16, refundRateSubjectMonth: 0.022, suspendRatePersonMonth: 0.06, recommendRatePersonMonth: 0.10, finishRatePersonMonth: 0.025, readingTotal: 185, teacherCount: 26 },
          yoy: { productionRateMonth: 0.88, saturationMonth: 0.70, renewalRateSubjectMonth: 0.13, refundRateSubjectMonth: 0.02 },
          satisfaction: { totals: { reading: 185, rates: { finishRatePersonMonth: 0.025, refundRateSubjectMonth: 0.022, suspendRatePersonMonth: 0.06, renewalRateSubjectMonth: 0.16, recommendRatePersonMonth: 0.10, finishRateSubjectMonth: 0.11, suspendRateSubjectMonth: 0.04 } }, byHead: [] }
        },
        '2026-07': {
          label: '2026年7月', type: 'DOS周报',
          metrics: { productionRateMonth: 0.92, saturationMonth: 0.78, unitMonthAvg: 5.9, singleSubjectRatio: 1.95, renewalRateSubjectMonth: 0.15, refundRateSubjectMonth: 0.02, suspendRatePersonMonth: 0.075, recommendRatePersonMonth: 0.11, finishRatePersonMonth: 0.02, readingTotal: 190, teacherCount: 27 },
          yoy: { productionRateMonth: 0.90, saturationMonth: 0.74, renewalRateSubjectMonth: 0.14, refundRateSubjectMonth: 0.019 },
          satisfaction: { totals: { reading: 190, rates: { finishRatePersonMonth: 0.02, refundRateSubjectMonth: 0.02, suspendRatePersonMonth: 0.075, renewalRateSubjectMonth: 0.15, recommendRatePersonMonth: 0.11, finishRateSubjectMonth: 0.105, suspendRateSubjectMonth: 0.045 } }, byHead: [] }
        }
      };
      Object.keys(seedMonths).forEach(function(mk) {
        var s = seedMonths[mk];
        var snap = reports.monthly[mk] || { month: mk };
        snap.month = mk; snap.label = s.label; snap.importedAt = now.toISOString();
        snap.dos = s; snap.satisfaction = s.satisfaction;
        if (s.yoy) snap.yoy = s.yoy;
        snap.metrics = Object.assign(snap.metrics || {}, s.metrics, (s.satisfaction && s.satisfaction.totals && s.satisfaction.totals.rates) ? s.satisfaction.totals.rates : {});
        reports.monthly[mk] = snap;
      });
      App.store.set('reports', reports);

      App.util.toast('已注入 ' + seedTasks.length + ' 条待办 + 3 个月度示例数据', 'ok');
      App.router.resolve();
    }
  };

})();
