/* ============================================
   ai.js — LLM 增强层（L1 · DeepSeek）
   能力：统一封装 DeepSeek chat/completions 调用（配置管理 / 脱敏 / 超时降级 / JSON 解析），
        并提供三个高阶能力：周报智能生成、数据红绿灯解读、粘贴任务语义解析。
   安全：Key 由用户自填、存本机 localStorage（不进 Git）；发送前可脱敏教师姓名。
   挂载：window.App.ai
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});

  var STORE_KEY = 'ai_settings';
  var ENDPOINT = 'https://api.deepseek.com/chat/completions';
  var TIMEOUT_MS = 60000;
  var MAX_TOKENS = 2500;

  /* ---------------- 配置 ---------------- */
  function defaultSettings() {
    return {
      apiKey: '',
      model: 'deepseek-v4-flash',                  // 文本模型（V4；旧 deepseek-chat/reasoner 已于 2026-07-24 计划停用）
      visionModel: 'deepseek-v4-flash-vision-exp', // 视觉模型（支持图片输入，同一把密钥）
      mask: true,          // 脱敏开关：发送前把教师姓名替换为代号
      enabled: true
    };
  }
  function getSettings() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        var d = defaultSettings();
        for (var k in d) { if (s[k] === undefined) s[k] = d[k]; }
        return s;
      }
    } catch (e) { /* ignore */ }
    return defaultSettings();
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function isReady() {
    var s = getSettings();
    return !!s.enabled && !!s.apiKey && s.apiKey.trim().length > 4;
  }
  function maskApiKey(key) {
    key = (key || '').trim();
    if (key.length <= 8) return key ? '已配置（' + key.slice(0, 3) + '…）' : '未配置';
    return '已配置（' + key.slice(0, 4) + '…' + key.slice(-4) + '）';
  }

  /* ---------------- 教师姓名脱敏 ---------------- */
  // 收集教师姓名（按姓名长度降序，避免「王静」误替换「王静静」）
  function teacherNames() {
    try {
      var data = App.viewData ? App.viewData() : (App.store ? App.store.getData() : {});
      var ts = data.teachers || [];
      var names = ts.map(function (t) { return t && t.name ? String(t.name).trim() : ''; }).filter(Boolean);
      names = Array.from(new Set(names)).sort(function (a, b) { return b.length - a.length; });
      return names;
    } catch (e) { return []; }
  }
  // 构建 姓名→代号 映射；mask 时按长度优先替换
  function buildMaskMap(names) {
    var map = {}, idx = 0;
    (names || []).forEach(function (n) { if (!map[n]) { map[n] = '教师' + String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? Math.floor(idx / 26) + 1 : ''); idx++; } });
    return map;
  }
  // 正/反向映射表：姓名↔代号
  function maskText(text, names) {
    var fwd = {}, rev = {};
    var idx = 0;
    (names || []).forEach(function (n) {
      if (fwd[n]) return;
      var code = '教师' + String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? Math.floor(idx / 26) + 1 : '');
      fwd[n] = code; rev[code] = n; idx++;
    });
    var out = text;
    Object.keys(fwd).forEach(function (n) { out = out.split(n).join(fwd[n]); });
    return { text: out, rev: rev };
  }
  function unmaskText(text, rev) {
    if (!rev) return text;
    var out = text;
    Object.keys(rev).forEach(function (code) { out = out.split(code).join(rev[code]); });
    return out;
  }

  /* ---------------- 核心调用 ---------------- */
  // 底层 POST：所有调用共用，便于文本与视觉统一错误处理
  function _fetch(model, messages, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var s = getSettings();
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); }, opts.timeout || TIMEOUT_MS);

      var body = {
        model: model,
        messages: messages,
        temperature: (opts.temperature != null) ? opts.temperature : 0.3,
        stream: false,
        max_tokens: opts.maxTokens || MAX_TOKENS
      };
      if (opts.responseFormat === 'json') body.response_format = { type: 'json_object' };

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey.trim() },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      }).then(function (resp) {
        return resp.json().then(function (data) { return { status: resp.status, data: data }; });
      }).then(function (r) {
        clearTimeout(timer);
        if (r.status !== 200) {
          var msg = (r.data && r.data.error && r.data.error.message) ? r.data.error.message : ('HTTP ' + r.status);
          resolve({ ok: false, error: '调用失败：' + msg });
          return;
        }
        var content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message ? r.data.choices[0].message.content : '';
        resolve({ ok: true, text: content });
      }).catch(function (e) {
        clearTimeout(timer);
        var msg = (e && e.name === 'AbortError') ? '请求超时（' + ((opts.timeout || TIMEOUT_MS) / 1000) + 's）' : (e && e.message ? e.message : String(e));
        resolve({ ok: false, error: '网络错误：' + msg });
      });
    });
  }

  // 文本调用（含脱敏）
  function _call(messages, opts) {
    opts = opts || {};
    var s = getSettings();
    if (!s.enabled) return Promise.resolve({ ok: false, error: 'AI 功能未启用，请在「设置 → AI」开启' });
    if (!s.apiKey || s.apiKey.trim().length <= 4) return Promise.resolve({ ok: false, error: '尚未配置 DeepSeek API Key，请在「设置 → AI」填写' });

    // 脱敏：把 messages 里所有 user/system 内容中的教师姓名替换为代号
    var revMap = null;
    if (s.mask) {
      var names = teacherNames();
      if (names.length) {
        var masked = maskText(JSON.stringify(messages), names);
        messages = JSON.parse(masked.text);
        revMap = masked.rev;
      }
    }

    return _fetch(s.model || 'deepseek-v4-flash', messages, opts).then(function (r) {
      if (!r.ok) return r;
      return { ok: true, text: revMap ? unmaskText(r.text, revMap) : r.text, revMap: revMap };
    });
  }

  // 视觉调用：多张图片 + 文本 prompt → 模型返回文本（课程表识图用）
  function parseImages(system, dataURLs, opts) {
    opts = opts || {};
    var s = getSettings();
    if (!s.enabled) return Promise.resolve({ ok: false, error: 'AI 功能未启用，请在「设置 → AI」开启' });
    if (!s.apiKey || s.apiKey.trim().length <= 4) return Promise.resolve({ ok: false, error: '尚未配置 DeepSeek API Key，请在「设置 → AI」填写' });
    if (!dataURLs || !dataURLs.length) return Promise.resolve({ ok: false, error: '未提供图片' });

    // 多模态 content：先文本指令，再逐张图片
    var content = [{ type: 'text', text: system }];
    dataURLs.forEach(function (u) {
      var url = (typeof u === 'string') ? u : (u && u.url) ? u.url : '';
      if (url) content.push({ type: 'image_url', image_url: { url: url } });
    });
    if (content.length < 2) return Promise.resolve({ ok: false, error: '图片为空或格式不支持' });

    var messages = [{ role: 'user', content: content }];
    return _fetch(s.visionModel || 'deepseek-v4-flash-vision-exp', messages, opts);
  }

  function chat(system, user, opts) {
    return _call([{ role: 'system', content: system }, { role: 'user', content: user }], opts);
  }

  // 要求 LLM 返回 JSON，本地解析（带兜底清洗）
  function chatJSON(system, user, opts) {
    opts = opts || {};
    opts.temperature = (opts.temperature != null) ? opts.temperature : 0;
    opts.responseFormat = 'json';
    var sys = system + '\n\n【重要】只输出一个合法的 JSON，不要输出任何解释、Markdown 代码块或多余文字。';
    return chat(sys, user, opts).then(function (r) {
      if (!r.ok) return r;
      var txt = String(r.text || '').trim();
      // 去除可能的代码块包裹
      txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      try {
        return { ok: true, data: JSON.parse(txt) };
      } catch (e) {
        // 尝试提取第一个 {...} 或 [...] 片段
        var m = txt.match(/[\[{][\s\S]*[\]}]/);
        if (m) {
          try { return { ok: true, data: JSON.parse(m[0]) }; } catch (e2) { /* fallthrough */ }
        }
        return { ok: false, error: 'AI 返回内容无法解析为 JSON' };
      }
    });
  }

  /* ============================================================
     高阶能力
     ============================================================ */

  /* F1 周报智能生成：输入聚合数据，输出完整周报四段正文 */
  function generateWeeklyReport(agg) {
    var SYS = '你是教培机构「状元港·泉山校区」的教学运营负责人（DOS）周报撰写助手。' +
      '请根据用户提供的本周原始数据，撰写一份正式、精炼、可直接上报的 DOS 周报，' +
      '严格使用以下四段结构：\n' +
      '一、本周完成事项（逐条列出，含负责人）\n' +
      '二、进行中 / 待跟进（列出重点，含逾期与本周截止）\n' +
      '三、关键节律（本周固定工作节点）\n' +
      '四、教学数据与人事（数据对比、异常归因、下周建议）\n' +
      '要求：语言简洁专业、用数据说话、异常指标要指出原因与整改方向、不编造数据。';
    var user = JSON.stringify(agg, null, 1);
    return chat(SYS, user, { temperature: 0.3 }).then(function (r) {
      if (!r.ok) return r;
      return { ok: true, text: r.text };
    });
  }

  /* F3 红绿灯智能解读：输入指标清单，输出归因与整改建议 */
  function explainBaseline(items) {
    var SYS = '你是教培机构教学数据分析助手。用户提供一组教学指标的「实际值 / 基准值 / 达标状态」，' +
      '请用简洁中文给出：①整体结论（达标面如何）②对每个「临界/异常」指标做简短归因与整改建议 ③对「达标」指标一句带过。' +
      '要求：用数据说话、建议可落地、分点列出、控制在 300 字以内。';
    var user = JSON.stringify(items, null, 1);
    return chat(SYS, user, { temperature: 0.3 }).then(function (r) {
      if (!r.ok) return r;
      return { ok: true, text: r.text };
    });
  }

  /* F2 粘贴任务语义解析：输入群消息文本，输出结构化任务数组 */
  function parseTasks(text) {
    var SYS = '你是任务结构化解析助手。把用户粘贴的工作群消息解析为若干条待办任务。\n' +
      '输出一个 JSON 对象，形如：{"tasks":[{"title":"事项描述","assignee":"负责人姓名","dueDate":"YYYY-MM-DD 或空字符串","priority":"urgent|high|normal|low","note":"补充说明或空字符串"}]}\n' +
      '规则：\n' +
      '1. title 必须是一句明确、可直接执行的事项描述（去除序号、@符号、括号说明等干扰）。\n' +
      '2. assignee 从文中识别负责人（@某人、负责人：某人、括号里的姓名等）；识别不到则用空字符串。\n' +
      '3. dueDate 从文中识别截止日期并转为 YYYY-MM-DD；「今天/明天/下周三」等相对日期请结合用户提供的当前日期换算；识别不到则空字符串。\n' +
      '4. priority 从「紧急/加急/尽快/重要/高优」等词判断；默认为 normal。\n' +
      '5. 忽略纯说明、通知、邮件、回复等非任务内容。\n' +
      '6. 若一条消息包含多个任务，请拆成多条。';
    var today = App.util ? App.util.formatDate(new Date(), 'YYYY-MM-DD') : '';
    var user = '当前日期：' + today + '\n\n群消息内容：\n' + text;
    return chatJSON(SYS, user, {}).then(function (r) {
      if (!r.ok) return r;
      var tasks = (r.data && r.data.tasks) || (Array.isArray(r.data) ? r.data : []);
      if (!Array.isArray(tasks)) tasks = [];
      return { ok: true, items: tasks };
    });
  }

  App.ai = {
    getSettings: getSettings,
    saveSettings: saveSettings,
    isReady: isReady,
    maskApiKey: maskApiKey,
    teacherNames: teacherNames,
    mask: maskText,
    unmask: unmaskText,
    chat: chat,
    chatJSON: chatJSON,
    parseImages: parseImages,
    generateWeeklyReport: generateWeeklyReport,
    explainBaseline: explainBaseline,
    parseTasks: parseTasks
  };
})(window);
