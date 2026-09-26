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

  // 学科组归一（数学/英语/文综/理综）——与 kpi-engine.canonSubject 保持一致，
  // 供 weekRoster 仅纳入「科组教师」，确保与 KPI 饱和度分母口径一致。
  function canonSubject(s) {
    s = String(s || '').trim();
    if (!s) return '';
    s = s.replace(/科组$|教研组$|备课组$|学科组$|组$|学科$/, '');
    if (s.indexOf('数学') >= 0) return '数学';
    if (s.indexOf('英语') >= 0) return '英语';
    if (s.indexOf('文综') >= 0) return '文综';
    if (s.indexOf('理综') >= 0) return '理综';
    return s;
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

  // 周度教师名册推导（与 KPI 饱和度分母口径一致：仅含 SUBJECT_GROUPS 科组教师）。
  // 入参：teachers 全量名册；weekStart/weekEnd 形如 'YYYY-MM-DD'（周一 / 周日）。
  // 返回：
  //   active : 截至 weekEnd 时点在职的科组教师（KPI 分母 = 此人数）
  //   joined : 入职/状态生效日落在 [weekStart, weekEnd] 区间内的教师（⊂ active，亦可独立列出）
  //   left   : 离职日落在 [weekStart, weekEnd] 区间内的教师（该周已离职，⊄ active）
  //   counts : { active, joined, left }
  // 说明：口径与 kpi-engine.computeRows(weekEnd) 过滤完全一致（同一 isActiveAt + 同一 SUBJECT_GROUPS 过滤），
  //       保证「周度教师人数」=「周度 KPI 饱和度分母」，两者永不脱节。
  function weekRoster(teachers, weekStart, weekEnd) {
    var SUBJ = ['数学', '英语', '文综', '理综'];
    var active = [], joined = [], left = [];
    (teachers || []).forEach(function (t) {
      if (!t || !t.name) return;
      var subj = canonSubject(t.subjectGroup);
      if (SUBJ.indexOf(subj) < 0) return; // 仅科组教师（与 KPI 分母一致）
      var effFrom = t.statusFrom || t.entryDate || '';
      var status = t.status || statusOf(t);
      var leftAt = (status === 'left') ? (t.leftAt || '') : '';
      var rec = {
        name: t.name, group: subj, status: status,
        statusFrom: effFrom, leftAt: leftAt
      };
      if (isActiveAt(t, weekEnd)) active.push(rec);
      if (effFrom && weekStart && effFrom >= weekStart && effFrom <= weekEnd) joined.push(rec);
      if (leftAt && weekStart && leftAt >= weekStart && leftAt <= weekEnd) left.push(rec);
    });
    return {
      active: active, joined: joined, left: left,
      counts: { active: active.length, joined: joined.length, left: left.length }
    };
  }

  var api = {
    STATUS_LABEL: STATUS_LABEL,
    statusLabel: statusLabel,
    statusOf: statusOf,
    isActiveAt: isActiveAt,
    employedNames: employedNames,
    deriveStatusFrom: deriveStatusFrom,
    canonSubject: canonSubject,
    weekRoster: weekRoster
  };

  if (root && (root.App = root.App || {})) { root.App.teachersUtil = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
