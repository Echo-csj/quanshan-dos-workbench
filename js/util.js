/* ============================================
   util.js — 工具函数
   日期/周次计算、红绿灯判定、格式化、DOM工具
   ============================================ */

window.App = window.App || {};

(function() {

  // --- Date Utilities ---

  // 获取ISO周数
  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  // 获取当月第几周（基于周一起始）
  function getMonthWeek(d) {
    var firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    var firstMonday = firstOfMonth.getDay(); // 0=Sun
    var adjustedFirst = firstMonday === 0 ? 6 : firstMonday - 1; // 转为周一=0
    var dayOfMonth = d.getDate();
    return Math.ceil((dayOfMonth + adjustedFirst) / 7);
  }

  // 格式化日期
  function formatDate(d, fmt) {
    if (!d) return '';
    if (typeof d === 'string') d = new Date(d);
    var map = {
      'YYYY': d.getFullYear(),
      'MM': String(d.getMonth() + 1).padStart(2, '0'),
      'DD': String(d.getDate()).padStart(2, '0'),
      'HH': String(d.getHours()).padStart(2, '0'),
      'mm': String(d.getMinutes()).padStart(2, '0'),
      'WW': getWeekNumber(d)
    };
    var result = fmt || 'YYYY-MM-DD';
    Object.keys(map).forEach(function(k) {
      result = result.replace(k, map[k]);
    });
    return result;
  }

  // 获取星期中文名
  function getWeekdayName(d) {
    if (typeof d === 'string') d = new Date(d);
    var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return names[d.getDay()];
  }

  // 获取月份名
  function getMonthName(month) {
    return (month + 1) + '月';
  }

  // 计算距离下一个周日还有几天
  function daysUntilSunday(fromDate) {
    fromDate = fromDate || new Date();
    var day = fromDate.getDay(); // 0=Sun
    return day === 0 ? 0 : 7 - day;
  }

  // 判断是否是本月最后一周
  function isLastWeekOfMonth(d) {
    d = d || new Date();
    var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    var diff = lastDay.getDate() - d.getDate();
    return diff < 7;
  }

  // 判断当前是否在寒暑假（简化：7-8月+1-2月）
  function isSummerWinter(month) {
    return month >= 6 && month <= 8; // 7-8月暑假（month从0开始）
  }
  function isWinterBreak(month) {
    return month === 0 || month === 1; // 1-2月寒假
  }

  // 获取当前季节标识
  function getSeasonTag() {
    var m = new Date().getMonth();
    if (isSummerWinter(m)) return '寒暑假';
    if (isWinterBreak(m)) return '寒暑假';
    return '常规';
  }

  // --- Traffic Light Judgment (红绿灯判定) ---
  function judge(actual, baselineItem) {
    if (!baselineItem) return { level: 'neutral', label: '无基准', color: 'var(--text-faint)' };

    var mode = baselineItem.mode || 'gte';
    var val = baselineItem.value;

    // 处理 range 类型
    if (mode === 'range') {
      var lo = Array.isArray(val) ? val[0] : 0;
      var hi = Array.isArray(val) ? val[1] : val;
      if (actual >= lo && actual <= hi) return { level: 'ok', label: '达标', color: 'var(--ok)' };
      if (actual >= lo * 0.95 && actual <= hi * 1.05) return { level: 'warn', label: '临界', color: 'var(--warn)' };
      return { level: 'bad', label: '异常', color: 'var(--bad)' };
    }

    // gte: 实际值应 ≥ 基准值
    if (mode === 'gte') {
      if (actual >= val) return { level: 'ok', label: '达标', color: 'var(--ok)' };
      if (actual >= val * 0.95) return { level: 'warn', label: '接近', color: 'var(--warn)' };
      return { level: 'bad', label: '偏低', color: 'var(--bad)' };
    }

    // lte: 实际值应 ≤ 基准值
    if (mode === 'lte') {
      if (actual <= val) return { level: 'ok', label: '达标', color: 'var(--ok)' };
      if (actual <= val * 1.05) return { level: 'warn', label: '接近', color: 'var(--warn)' };
      return { level: 'bad', label: '偏高', color: 'var(--bad)' };
    }

    return { level: 'neutral', label: '未知', color: 'var(--text-faint)' };
  }

  // 获取带季节调整的基准值
  function getSeasonalBaseline(baselineItem) {
    if (!baselineItem || !baselineItem.seasonal) return baselineItem ? baselineItem.value : null;
    var season = getSeasonTag();
    var seasonalMap = baselineItem.seasonal;
    if (seasonalMap[season] !== undefined) return seasonalMap[season];

    // 检查月份匹配
    var m = new Date().getMonth() + 1;
    var monthKeys = Object.keys(seasonalMap).filter(function(k) {
      return k.split(',').map(Number).includes(m);
    });
    if (monthKeys.length > 0) return seasonalMap[monthKeys[0]];

    return baselineItem.value;
  }

  // --- Formatting Helpers ---

  // 百分比格式化
  function pct(val, decimals) {
    decimals = decimals || 1;
    if (val == null) return '-';
    return (val * 100).toFixed(decimals) + '%';
  }

  // 数字格式化（千分位）
  function num(n) {
    if (n == null) return '-';
    return Number(n).toLocaleString('zh-CN');
  }

  // 截断文本
  function truncate(text, maxLen) {
    maxLen = maxLen || 20;
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  }

  // 相对时间描述
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + '小时前';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + '天前';
    return formatDate(new Date(dateStr), 'MM-DD');
  }

  // --- DOM Helpers ---

  // 创建元素快捷方式
  function el(tag, attrs, children) {
    var elem = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(k) {
        if (k === 'className') elem.className = attrs[k];
        else if (k === 'innerHTML') elem.innerHTML = attrs[k];
        else if (k.startsWith('on')) elem.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else elem.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      if (typeof children === 'string') {
        // 检测 HTML/SVG 标记，用 innerHTML 渲染；纯文本用 textContent
        if (children.trim().indexOf('<') === 0) { elem.innerHTML = children; }
        else { elem.textContent = children; }
      }
      else if (Array.isArray(children)) children.forEach(function(c) {
        if (!c) return;
        if (typeof c === 'string') {
          if (c.trim().indexOf('<') === 0) {
            var wrapper = document.createElement('span');
            wrapper.innerHTML = c;
            while (wrapper.firstChild) elem.appendChild(wrapper.firstChild);
          } else {
            elem.appendChild(document.createTextNode(c));
          }
        } else {
          elem.appendChild(c);
        }
      });
      else if (children instanceof HTMLElement) elem.appendChild(children);
    }
    return elem;
  }

  // Toast 提示
  function toast(message, type) {
    type = type || 'ok';
    var container = document.getElementById('toast-container');
    if (!container) {
      container = el('div', { id: 'toast-container', className: 'toast-container' });
      document.body.appendChild(container);
    }
    var t = el('div', { className: 'toast ' + type }, [
      message
    ]);
    container.appendChild(t);
    setTimeout(function() {
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px)';
      t.style.transition = 'all .25s ease';
      setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
    }, 3000);
  }

  // Modal 弹窗
  function modal(options) {
    var overlay = el('div', { className: 'modal-overlay' });
    var modalEl = el('div', { className: 'modal' });

    // Header
    var header = el('div', { className: 'modal-header' }, [
      el('h3', {}, options.title || ''),
      el('button', { className: 'modal-close', onClick: function() { close(); } }, [svgIcon('x')])
    ]);

    // Body
    var body = el('div', { className: 'modal-body' });
    if (options.content) {
      if (typeof options.content === 'string') {
        body.innerHTML = options.content;
      } else {
        body.appendChild(options.content);
      }
    }

    // Footer
    var footer = el('div', { className: 'modal-footer' });
    if (options.onDelete) {
      footer.appendChild(el('button', { className: 'btn btn-danger btn-sm', onClick: function() {
        options.onDelete(close);
      }}, options.deleteText || '删除'));
    }
    if (options.showCancel !== false) {
      footer.appendChild(el('button', { className: 'btn btn-secondary', onClick: close }, '取消'));
    }
    if (options.onConfirm) {
      var cls = options.confirmStyle === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
      footer.appendChild(el('button', { className: cls, onClick: function() {
        options.onConfirm(close);
      }}, options.confirmText || '确定'));
    }

    modalEl.appendChild(header);
    modalEl.appendChild(body);
    if (footer.children.length > 0) modalEl.appendChild(footer);
    overlay.appendChild(modalEl);

    function close() {
      overlay.classList.remove('show');
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
      if (options.onClose) options.onClose();
    }

    // ESC 关闭
    function onEsc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } }
    document.addEventListener('keydown', onEsc);

    // 点击遮罩关闭
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('show'); });

    return { close: close, overlay: overlay, body: body };
  }

  // SVG 图标库（内联，离线可用）
  function svgIcon(name, size) {
    size = size || 18;
    var icons = {
      'home': '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><polyline points="9 22 9 12 15 12 15 22"/>',
      'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
      'bar-chart-2': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
      'folder': '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
      'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
      'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
      'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
      'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
      'download': '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      'upload': '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
      'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
      'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
      'edit': '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
      'trash-2': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
      'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
      'users': '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
      'clipboard': '<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
      'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
      'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
      'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
      'book-open': '<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>',
      'award': '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
      'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      'refresh-cw': '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
      'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
      'play': '<polygon points="5 3 19 12 5 21 5 3"/>',
      'layout-grid': '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
      'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
      'check': '<polyline points="20 6 9 17 4 12"/>',
      'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
      'info': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    };
    var path = icons[name] || icons['info'];
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }

  // --- Priority & Status helpers ---
  function priorityLabel(p) {
    var map = { urgent: '紧急', high: '高', normal: '普通', low: '低' };
    return map[p] || p || '普通';
  }

  function statusLabel(s) {
    var map = { todo: '待办', doing: '进行中', review: '审阅中', following: '待跟进', done: '已完成', overdue: '已逾期' };
    return map[s] || s;
  }

  function statusColor(s) {
    var map = { todo: 'neutral', doing: 'accent', following: 'warn', done: 'ok', overdue: 'bad' };
    return map[s] || 'neutral';
  }

  // 是否逾期（截止日当天 23:59:59 前未完成即逾期）
  function isOverdue(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr + 'T23:59:59');
    return d.getTime() < Date.now();
  }

  // --- SVG 折线图（离线渲染，用于趋势）---
  function judgeColor(level) {
    return level === 'ok' ? 'var(--ok)' : level === 'warn' ? 'var(--warn)' : level === 'bad' ? 'var(--bad)' : 'var(--text-faint)';
  }
  function chartFmt(v, opts) {
    if (v == null || isNaN(v)) return '-';
    opts = opts || {};
    if (opts.unit === '%') return (v * 100).toFixed(0) + '%';
    if (opts.dec != null) return v.toFixed(opts.dec);
    if (Math.abs(v) >= 100) return Math.round(v).toString();
    return v.toFixed(1);
  }

  function lineChart(series, opts) {
    opts = opts || {};
    var W = 680, H = 280, padL = 46, padR = 16, padT = 16, padB = 36;
    var values = series.map(function(s) { return s.value; }).filter(function(v) { return v != null && !isNaN(v); });
    if (!values.length) return '<div class="empty-state" style="padding:30px">该指标暂无数据</div>';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (opts.baseline != null) { min = Math.min(min, opts.baseline); max = Math.max(max, opts.baseline); }
    if (min === max) { min = min * 0.95; max = max * 1.05; if (min === max) { min = 0; max = 1; } }
    var n = series.length;
    function x(i) { return padL + (n === 1 ? (W - padL - padR) / 2 : (W - padL - padR) * i / (n - 1)); }
    function y(v) { return padT + (H - padT - padB) * (1 - (v - min) / (max - min)); }
    var p = [];
    p.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" style="background:var(--surface-2);border-radius:var(--radius);display:block">');
    if (opts.baseline != null) {
      p.push('<line x1="' + padL + '" y1="' + y(opts.baseline) + '" x2="' + (W - padR) + '" y2="' + y(opts.baseline) + '" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 4"/>');
      p.push('<text x="' + (W - padR - 2) + '" y="' + (y(opts.baseline) - 5) + '" text-anchor="end" font-size="10" fill="var(--accent)">基准 ' + (opts.baselineLabel || '') + '</text>');
    }
    [min, (min + max) / 2, max].forEach(function(g) {
      p.push('<line x1="' + padL + '" y1="' + y(g) + '" x2="' + (W - padR) + '" y2="' + y(g) + '" stroke="var(--border)" stroke-width="1"/>');
      p.push('<text x="' + (padL - 6) + '" y="' + (y(g) + 3) + '" text-anchor="end" font-size="9" fill="var(--text-faint)">' + chartFmt(g, opts) + '</text>');
    });
    var linePts = series.map(function(s, i) { return (s.value == null || isNaN(s.value)) ? null : (x(i) + ',' + y(s.value)); }).filter(Boolean).join(' ');
    p.push('<polyline points="' + linePts + '" fill="none" stroke="var(--text)" stroke-width="2.5" stroke-linejoin="round"/>');
    series.forEach(function(s, i) {
      if (s.value == null || isNaN(s.value)) return;
      var c = s.level ? judgeColor(s.level) : 'var(--text)';
      p.push('<circle cx="' + x(i) + '" cy="' + y(s.value) + '" r="3.5" fill="' + c + '"/>');
      p.push('<text x="' + x(i) + '" y="' + (H - padB + 14) + '" text-anchor="middle" font-size="9" fill="var(--text-muted)">' + s.label + '</text>');
      p.push('<text x="' + x(i) + '" y="' + (y(s.value) - 8) + '" text-anchor="middle" font-size="9" fill="var(--text)">' + chartFmt(s.value, opts) + '</text>');
    });
    p.push('</svg>');
    return p.join('');
  }

  // --- HTML 转义（防止 XSS / 标签注入）---
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // Public API
  App.util = {
    getWeekNumber: getWeekNumber,
    getMonthWeek: getMonthWeek,
    formatDate: formatDate,
    getWeekdayName: getWeekdayName,
    getMonthName: getMonthName,
    daysUntilSunday: daysUntilSunday,
    isLastWeekOfMonth: isLastWeekOfMonth,
    getSeasonTag: getSeasonTag,
    judge: judge,
    getSeasonalBaseline: getSeasonalBaseline,
    pct: pct,
    num: num,
    truncate: truncate,
    timeAgo: timeAgo,
    el: el,
    toast: toast,
    modal: modal,
    svgIcon: svgIcon,
    priorityLabel: priorityLabel,
    statusLabel: statusLabel,
    statusColor: statusColor,
    isOverdue: isOverdue,
    lineChart: lineChart,
    chartFmt: chartFmt,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr
  };

})();
