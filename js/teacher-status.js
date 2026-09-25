/* ============================================
   teacher-status.js — 教师在职时点判定
   核心需求：按 week_end（周结束日，周日）时点判定教师是否在职。
   规则（2026-09-25 锁定）：
     1) 入职 / 状态生效日期（statusFrom，缺省回退 entryDate）晚于该周结束 → 当时尚未入职 → 不在职。
     2) 已离职（status==='left'）且离职日期（leftAt / left_date）≤ week_end → 该周已离职 → 不在职。
     3) 其余（在职 active / 待离职 pending / 离职但离职日在该周之后）→ 在职。
        ——「待离职」仍占用课次，按在职计入 KPI。
   纯函数、零依赖；同时 module.exports 供 Node 测试复用。
   ============================================ */

(function (root) {

  // 状态中文标签（与 teachers.js STATUS_META 保持一致）
  var STATUS_LABEL = { active: '在职', pending: '待离职', left: '离职' };
  function statusLabel(s) { return STATUS_LABEL[s] || '在职'; }

  // 回退：若无结构化 status 字段，则按旧 tag 派生（保证旧数据不崩）
  function statusOf(t) {
    if (!t) return 'active';
    if (t.status === 'left') return 'left';
    if (t.status === 'pending') return 'pending';
    if (t.status === 'active') return 'active';
    var tags = Array.isArray(t.tags) ? t.tags : [];
    if (tags.indexOf('离职') >= 0) return 'left';
    if (tags.indexOf('待离职') >= 0) return 'pending';
    return 'active';
  }

  // 按 week_end 时点判定在职；weekEndIso 形如 'YYYY-MM-DD'
  function isActiveAt(teacher, weekEndIso) {
    if (!teacher) return false;
    var effFrom = teacher.statusFrom || teacher.entryDate || '';
    // 入职/状态生效晚于该周结束 → 当时尚未入职
    if (effFrom && weekEndIso && effFrom > weekEndIso) return false;
    var status = teacher.status || statusOf(teacher);
    if (status === 'left') {
      var leftAt = teacher.leftAt || '';
      // 已离职且离职日期 ≤ week_end → 该周已不在职
      if (leftAt && weekEndIso && leftAt <= weekEndIso) return false;
    }
    return true;
  }

  // 返回截至某 week_end 在职的教师姓名数组（按输入顺序、去重）
  function employedNames(teachers, weekEndIso) {
    var seen = {}, out = [];
    (teachers || []).forEach(function (t) {
      if (t && t.name && isActiveAt(t, weekEndIso) && !seen[t.name]) {
        seen[t.name] = 1; out.push(t.name);
      }
    });
    return out;
  }

  // 推导 statusFrom 默认值：离职默认 = 离职日期；其它默认 = 入职日期
  function deriveStatusFrom(teacher, status, entryDate) {
    status = status || (teacher && teacher.status) || 'active';
    entryDate = entryDate || (teacher && teacher.entryDate) || '';
    if (status === 'left') return (teacher && teacher.leftAt) ? teacher.leftAt : entryDate;
    return entryDate;
  }

  var api = {
    STATUS_LABEL: STATUS_LABEL,
    statusLabel: statusLabel,
    statusOf: statusOf,
    isActiveAt: isActiveAt,
    employedNames: employedNames,
    deriveStatusFrom: deriveStatusFrom
  };

  if (root && (root.App = root.App || {})) { root.App.teachersUtil = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
