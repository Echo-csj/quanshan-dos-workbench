/* ============================================
   ai-local.js — 本地智能引擎（L0 · 零成本 · 纯 JS）
   能力：统计预测（线性回归 / 移动平均）、异常检测（Z-score / 环比）、
        规则化评分与建议。所有计算均在浏览器本地完成，数据不出本机、无任何外部依赖。
   挂载：window.App.aiLocal
   ============================================ */
(function (global) {
  'use strict';
  var App = global.App || (global.App = {});

  /* ---------------- 基础统计 ---------------- */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 均值
  function mean(arr) {
    var xs = (arr || []).filter(isNum);
    if (!xs.length) return null;
    var s = 0;
    xs.forEach(function (v) { s += v; });
    return s / xs.length;
  }

  // 标准差（样本）
  function std(arr) {
    var xs = (arr || []).filter(isNum);
    if (xs.length < 2) return 0;
    var m = mean(xs);
    var s = 0;
    xs.forEach(function (v) { s += (v - m) * (v - m); });
    return Math.sqrt(s / xs.length);
  }

  /* ---------------- 线性回归（预测下一期） ----------------
     输入：values 为按时间升序的数值数组
     输出：{ next, slope, r2, n }；next 为下一期预测值，slope 为斜率（每期变化量）
  */
  function linearForecast(values) {
    var xs = (values || []).filter(isNum);
    var n = xs.length;
    if (n === 0) return { next: null, slope: null, r2: null, n: 0 };
    if (n === 1) return { next: xs[0], slope: 0, r2: null, n: 1 };
    var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
    for (var i = 0; i < n; i++) {
      var x = i, y = xs[i];
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; sumYY += y * y;
    }
    var denom = n * sumXX - sumX * sumX;
    var slope = 0, intercept;
    if (denom !== 0) {
      slope = (n * sumXY - sumX * sumY) / denom;
      intercept = (sumY - slope * sumX) / n;
    } else {
      intercept = sumY / n;
    }
    var next = intercept + slope * n;
    // 拟合优度 r²
    var meanY = sumY / n;
    var ssTot = sumYY - n * meanY * meanY;
    var ssRes = 0;
    for (var j = 0; j < n; j++) {
      var pred = intercept + slope * j;
      ssRes += (xs[j] - pred) * (xs[j] - pred);
    }
    var r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : null;
    return { next: next, slope: slope, r2: r2, n: n };
  }

  // 移动平均（返回与输入等长的平滑数组；不足 window 时回退到已有均值）
  function movingAverage(values, win) {
    win = win || 3;
    var xs = (values || []).slice();
    return xs.map(function (v, i) {
      if (!isNum(v)) return v;
      var from = Math.max(0, i - win + 1);
      var seg = xs.slice(from, i + 1).filter(isNum);
      if (!seg.length) return v;
      var s = 0; seg.forEach(function (x) { s += x; });
      return s / seg.length;
    });
  }

  /* ---------------- 异常检测 ---------------- */

  // Z-score 异常：|z| > threshold 视为异常（默认 1.5，对月频数据较灵敏）
  function zscoreAnomalies(values, threshold) {
    var xs = (values || []).filter(isNum);
    var th = (typeof threshold === 'number') ? threshold : 1.5;
    var m = mean(xs), sd = std(xs);
    var out = [];
    if (m == null) return out;
    xs.forEach(function (v, i) {
      var z = sd > 0 ? (v - m) / sd : 0;
      if (Math.abs(z) >= th) out.push({ index: i, value: v, z: z });
    });
    return out;
  }

  // 环比异常：相对上一期的变化幅度（绝对值）超过 threshold（默认 0.2，即 ±20%）
  function momAnomalies(values, threshold) {
    var xs = (values || []).filter(isNum);
    var th = (typeof threshold === 'number') ? threshold : 0.2;
    var out = [];
    for (var i = 1; i < xs.length; i++) {
      if (!isNum(xs[i]) || !isNum(xs[i - 1]) || xs[i - 1] === 0) continue;
      var change = (xs[i] - xs[i - 1]) / Math.abs(xs[i - 1]);
      if (Math.abs(change) >= th) out.push({ index: i, value: xs[i], prev: xs[i - 1], change: change });
    }
    return out;
  }

  /* ---------------- 通用：趋势方向描述 ---------------- */
  // 依据近端斜率给方向：'上升' | '下降' | '平稳'
  function trendDirection(slope, scale) {
    if (slope == null || !isNum(slope)) return '平稳';
    var s = Math.abs(slope);
    var tol = (scale && scale > 0) ? scale * 0.02 : 0;
    if (s <= tol) return '平稳';
    return slope > 0 ? '上升' : '下降';
  }

  App.aiLocal = {
    mean: mean,
    std: std,
    linearForecast: linearForecast,
    movingAverage: movingAverage,
    zscoreAnomalies: zscoreAnomalies,
    momAnomalies: momAnomalies,
    trendDirection: trendDirection
  };
})(window);
