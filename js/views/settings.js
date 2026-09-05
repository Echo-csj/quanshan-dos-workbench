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
    html += '<div><strong>数据量：</strong>' + ((data.timeline.fixedNodes || []).length) + ' 个时间节点 / ' + Object.keys((data.reports && data.reports.monthly) || {}).length + ' 个月度报表</div>';
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
      html += '<td><strong>' + App.util.escapeHtml(node.title) + '</strong></td>';
      html += '<td><span class="tag tag-' + (node.type === 'monthly' ? 'warn' : 'accent') + '" style="font-size:10px">' + (node.type === 'fixed' ? '固定' : '月度') + '</span></td>';
      html += '<td>' + (node.weekday !== null ? '周' + wdNames[node.weekday] : '-') + '</td>';
      html += '<td class="mono" style="font-size:12px">' + (node.time || '-') + '</td>';
      html += '<td>' + (node.reminder ? '✅' : '❌') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // --- 教研时间轴同步 ---
    html += '<div class="card" style="margin-bottom:20px"><div class="card-header"><h3 class="card-title">📚 教研时间轴同步</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">将《校区教研流程与标准》中的教研周节律 / 月节律节点一键同步进「时间轴」板块。不会覆盖你已有的节点，可重复点击。</p>';
    html += '<button class="btn btn-secondary" onclick="App.views.settings.syncResearchTimeline()">🔄 同步教研时间轴节点</button>';
    html += '</div>';

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
    html += '<p class="form-hint">导出的 JSON 文件包含所有时间节点、报表数据、设置等。可在不同设备间通过导入/导出同步。</p>';
    var remind = (data.settings && data.settings.remindBackup !== false);
    html += '<div style="display:flex;align-items:center;gap:10px;padding-top:12px;border-top:1px solid var(--border);margin-top:4px">';
    html += '<input type="checkbox" id="remind-backup" ' + (remind ? 'checked' : '') + ' style="width:16px;height:16px" onchange="App.store.set(\'settings.remindBackup\', this.checked); App.util.toast(\'已保存\',\'ok\')">';
    html += '<label for="remind-backup" style="font-size:13px;color:var(--text-secondary);cursor:pointer">每月提醒我导出数据备份（防止浏览器清理导致数据丢失）</label>';
    html += '</div>';
    // 已完成自动归档天数
    html += '<div style="display:flex;align-items:center;gap:10px;padding-top:12px;border-top:1px solid var(--border);margin-top:4px;flex-wrap:wrap">';
    html += '<label for="archive-days" style="font-size:13px;color:var(--text-secondary);cursor:pointer;white-space:nowrap">已完成自动归档（天）：</label>';
    html += '<input type="number" id="archive-days" min="1" max="365" value="' + (settings.tasksArchiveDays || 30) + '" style="width:70px" class="form-input" onchange="App.store.set(\'settings.tasksArchiveDays\', parseInt(this.value,10)||30); App.util.toast(\'已保存\',\'ok\')">';
    html += '<span style="font-size:12px;color:var(--text-faint)">超过该天数未完成复核的已完成事项，将自动移入归档（仍可在「已归档」中查询恢复）</span>';
    html += '</div>';
    html += '</div></div>';

    // --- AI 智能（DeepSeek） ---
    html += renderAICard();

    // --- 示例数据 ---
    html += '<div class="card"><div class="card-header"><h3 class="card-title">' + App.util.svgIcon('star', 18) + '示例数据</h3></div>';
    html += '<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">首次使用？注入示例数据快速体验全部功能。</p>';
    html += '<button class="btn btn-secondary" onclick="App.views.settings.injectSeedData()">' + App.util.svgIcon('play', 14) + '注入示例数据</button>';
    html += '</div>';

    container.innerHTML = html;
  });

  // --- 模型下拉构建（保留当前值，避免切换时丢失自定义名）---
  function buildModelSelect(id, current, options) {
    var html = '<select id="' + id + '" class="form-input">';
    var has = {};
    options.forEach(function (o) {
      has[o[0]] = true;
      html += '<option value="' + App.util.escapeAttr(o[0]) + '"' + (o[0] === current ? ' selected' : '') + '>' + App.util.escapeHtml(o[1]) + '</option>';
    });
    if (current && !has[current]) {
      html += '<option value="' + App.util.escapeAttr(current) + '" selected>' + App.util.escapeHtml(current) + '（当前）</option>';
    }
    html += '</select>';
    return html;
  }

  // --- AI 智能设置卡 ---
  function renderAICard() {
    var A = App.ai;
    if (!A) return '';
    var s = A.getSettings();
    var keyHint = s.apiKey ? A.maskApiKey(s.apiKey) : '未配置';
    var html = '<div class="card" style="margin-bottom:20px">';
    html += '<div class="card-header"><h3 class="card-title">' + App.util.svgIcon('zap', 18) + 'AI 智能（DeepSeek）</h3>';
    html += '<span class="ai-tag-local">可选 · 数据可脱敏</span></div>';
    html += '<p style="font-size:12px;color:var(--text-muted);line-height:1.7;margin-bottom:14px">接入 DeepSeek 大模型，解锁「智能周报」「数据红绿灯解读」「粘贴任务语义解析」。<b>Key 仅存本机浏览器</b>（不进 Git 仓库）；开启脱敏后，发送前会把教师姓名替换为代号。</p>';

    html += '<div class="form-group"><label class="form-label">DeepSeek API Key（' + keyHint + '）</label>';
    html += '<input type="password" id="ai-key" class="form-input" placeholder="sk-..." value="' + App.util.escapeAttr(s.apiKey) + '" autocomplete="off"></div>';

    html += '<div class="form-group"><label class="form-label">文本模型（V4 推荐）</label>';
    html += buildModelSelect('ai-model', s.model, [
      ['deepseek-v4-flash', 'deepseek-v4-flash（推荐·通用）'],
      ['deepseek-v4-pro', 'deepseek-v4-pro（更强·推理）'],
      ['deepseek-v4-flash-vision-exp', 'deepseek-v4-flash-vision-exp（视觉·亦可作文本）'],
      ['deepseek-chat', 'deepseek-chat（旧·可能已停用）'],
      ['deepseek-reasoner', 'deepseek-reasoner（旧·推理·可能已停用）']
    ]);
    html += '<p class="form-hint">DeepSeek 旧模型（deepseek-chat / deepseek-reasoner）已于 2026-07-24 计划停用，建议切换到 V4；若你的 Key 仍支持旧名可保留。</p></div>';

    html += '<div class="form-group"><label class="form-label">视觉识别模型（课程表截图识别用）</label>';
    html += buildModelSelect('ai-vision-model', s.visionModel, [
      ['deepseek-v4-flash-vision-exp', 'deepseek-v4-flash-vision-exp（默认·支持图片）'],
      ['deepseek-v4-flash', 'deepseek-v4-flash'],
      ['deepseek-v4-pro', 'deepseek-v4-pro']
    ]);
    html += '<p class="form-hint">课程表导入依赖此视觉模型，复用同一把 DeepSeek Key，无需新账号。</p></div>';

    html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">';
    html += '<label style="font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px"><input type="checkbox" id="ai-mask" style="width:16px;height:16px"' + (s.mask ? ' checked' : '') + '> 发送前脱敏教师姓名（替换为代号）</label>';
    html += '<label style="font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px"><input type="checkbox" id="ai-enabled" style="width:16px;height:16px"' + (s.enabled ? ' checked' : '') + '> 启用 AI 功能</label>';
    html += '</div>';

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="App.views.settings.saveAI()">' + App.util.svgIcon('check', 14) + '保存设置</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.settings.testAI()">' + App.util.svgIcon('refresh-cw', 14) + '测试连接</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="App.views.settings.testVisionAI()">' + App.util.svgIcon('camera', 14) + '测试视觉识别</button>';
    html += '</div>';
    html += '<div id="ai-status" style="margin-top:10px;font-size:12px"></div>';
    html += '</div>';
    return html;
  }

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
        content: '<p style="color:var(--bad);font-size:13px">此操作将<strong>清除所有数据</strong>（时间节点、报表、检查清单、设置等），且不可恢复！</p><p class="form-hint" style="margin-top:8px">建议先「导出备份」再重置。</p>',
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

      App.util.toast('已注入 3 个月度示例数据', 'ok');
      App.router.resolve();
    },

    syncResearchTimeline: function() {
      var added = App.store.mergeResearchTimeline();
      App.util.toast(added > 0 ? ('已同步 ' + added + ' 个教研时间轴节点') : '教研时间轴节点已是最新', 'ok');
      App.router.resolve();
    },

    saveAI: function() {
      if (!App.ai) return;
      var s = App.ai.getSettings();
      s.apiKey = (document.getElementById('ai-key') || {}).value.trim();
      var mSel = document.getElementById('ai-model');
      s.model = (mSel && mSel.value) ? mSel.value.trim() : 'deepseek-v4-flash';
      var vSel = document.getElementById('ai-vision-model');
      s.visionModel = (vSel && vSel.value) ? vSel.value.trim() : 'deepseek-v4-flash-vision-exp';
      s.mask = document.getElementById('ai-mask') ? document.getElementById('ai-mask').checked : true;
      s.enabled = document.getElementById('ai-enabled') ? document.getElementById('ai-enabled').checked : true;
      App.ai.saveSettings(s);
      App.util.toast('AI 设置已保存', 'ok');
    },

    testAI: function() {
      if (!App.ai) return;
      App.views.settings.saveAI();
      var statusEl = document.getElementById('ai-status');
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">正在测试连接…</span>';
      App.ai.chat('你是助手，只按指令回复。', '请只回复两个字：正常').then(function(r) {
        if (!statusEl) return;
        statusEl.innerHTML = r.ok
          ? '<span style="color:var(--ok)">✓ 连接成功：' + App.util.escapeHtml(r.text) + '</span>'
          : '<span style="color:var(--bad)">✗ ' + App.util.escapeHtml(r.error || '失败') + '</span>';
      });
    },

    testVisionAI: function() {
      if (!App.ai) return;
      App.views.settings.saveAI();
      var statusEl = document.getElementById('ai-status');
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">请选择一张图片以测试视觉识别…</span>';
      var input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = function() {
        var file = input.files && input.files[0];
        if (!file) return;
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted)">正在测试视觉识别…</span>';
        var rd = new FileReader();
        rd.onload = function() {
          App.ai.parseImages('你是一个测试助手，请只回复两个字：正常', [rd.result], { temperature: 0, timeout: 60000 }).then(function(r) {
            if (!statusEl) return;
            statusEl.innerHTML = r.ok
              ? '<span style="color:var(--ok)">✓ 视觉识别正常：' + App.util.escapeHtml(String(r.text).slice(0, 40)) + '</span>'
              : '<span style="color:var(--bad)">✗ ' + App.util.escapeHtml(r.error || '失败') + '</span>';
          });
        };
        rd.onerror = function() { if (statusEl) statusEl.innerHTML = '<span style="color:var(--bad)">✗ 图片读取失败</span>'; };
        rd.readAsDataURL(file);
      };
      input.click();
    }
  };

})();
