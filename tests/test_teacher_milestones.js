/* Node 桩测试：教师职业发展关键节点智能提醒引擎（teacher-milestones.js）
   运行：node test_teacher_milestones.js
   覆盖：日期计算（addMonths/addDays）、按触发日期幂等生成、只生成已到达节点、
         三方同步（里程碑↔时间轴节点↔待办）、标记完成三处一致、reconcile 反向同步、面板渲染 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = {
  console, setTimeout, clearTimeout, Date, JSON, Object, Array,
  isNaN, parseInt, parseFloat, String, Number, RegExp, Math,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const store_map = {};
sandbox.localStorage = {
  getItem: (k) => (k in store_map ? store_map[k] : null),
  setItem: (k, v) => { store_map[k] = String(v); },
  removeItem: (k) => { delete store_map[k]; },
};

const elems = {};
function fakeEl() {
  return { innerHTML: '', value: '', textContent: '', style: {}, checked: false, focus() {} };
}
sandbox.document = {
  getElementById: (id) => (elems[id] = elems[id] || fakeEl()),
  createElement: () => fakeEl(),
  addEventListener: () => {},
  querySelectorAll: () => [],
  readyState: 'loading', // 阻止 boot 定时器在测试中自动触发 ensure
  body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
};
sandbox.window.confirm = () => true;
sandbox.alert = () => {};

vm.createContext(sandbox);

const files = ['js/baseline.js', 'js/util.js', 'js/store.js'];
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
sandbox.App.router = { register: () => {}, navigate: () => {} };
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/teachers.js'), 'utf8'), sandbox, { filename: 'js/views/teachers.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/teacher-milestones.js'), 'utf8'), sandbox, { filename: 'js/views/teacher-milestones.js' });

// 桩：toast / 渲染 no-op（避免测试中触发完整重渲染）
let toasts = [];
sandbox.App.util.toast = (msg, kind) => { toasts.push(msg + '|' + kind); };
sandbox.App.views.teachers.render = function () {};

const MS = sandbox.App.views.teacherMilestones;
const store = sandbox.App.store;

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

// —— 测试用日期工具（与引擎实现一致）——
function addMonthsStr(s, m) {
  const d = new Date(s + 'T00:00:00');
  const y = d.getFullYear(), mo = d.getMonth(), day = d.getDate();
  const t = y * 12 + mo + m;
  const ny = Math.floor(t / 12), nm = t % 12;
  const ld = new Date(ny, nm + 1, 0).getDate();
  return sandbox.App.util.formatDate(new Date(ny, nm, Math.min(day, ld)), 'YYYY-MM-DD');
}
function addDaysStr(s, days) {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return sandbox.App.util.formatDate(d, 'YYYY-MM-DD');
}

const today = sandbox.App.util.formatDate(new Date(), 'YYYY-MM-DD');
const t1entry = addMonthsStr(today, -3);   // 转正(3月)触发日 = 今天；6月节点在未来
const t2entry = addMonthsStr(today, -24);  // 2年节点触发日 = 今天；3年节点在未来

store.set('teachers', [
  { id: 't1', name: '张三', subjectGroup: '数学', positionCode: 'TR', entryDate: t1entry },
  { id: 't2', name: '李四', subjectGroup: '英语', positionCode: 'TR', entryDate: t2entry },
]);
store.set('tasks', []);
store.set('timeline', { fixedNodes: [], customNodes: [] });
store.set('teacherMilestones', []);

console.log('== 1. 日期计算 ==');
assert(addMonthsStr(addMonthsStr(today, -3), 3) === today, 'addMonths 三个月往返对称');
assert(addDaysStr(today, 7) > today, 'addDays 正向偏移可用');

console.log('== 2. 幂等生成（仅已到达节点）==');
MS.generate();
let ms = store.get('teacherMilestones') || [];
assert(ms.length === 5, '应生成 5 条：t1 转正(1) + t2 转正/6月/1年/2年(4)，共 5（3年节点未到）');
assert(ms.some((m) => m.id === 'ms_t1_probation'), 't1 转正里程碑存在');
assert(ms.some((m) => m.id === 'ms_t1_tenure_6m') === false, 't1 6月节点未到 → 不生成');
assert(ms.some((m) => m.id === 'ms_t2_tenure_3y') === false, 't2 3年节点未到 → 不生成');

const t1prob = (store.get('teacherMilestones')).find((m) => m.id === 'ms_t1_probation');
assert(t1prob && t1prob.triggerDate === today, 't1 转正触发日期 = 今天');
assert(t1prob && t1prob.dueDate === addDaysStr(today, 7), 't1 转正截止 = 触发日 +7 天');

// 幂等：再次生成不重复
MS.generate();
assert((store.get('teacherMilestones')).length === 5, '二次 generate 仍 5 条（幂等不重复）');

console.log('== 3. 三方同步（里程碑 ↔ 时间轴节点 ↔ 待办）==');
let allSynced = true;
(store.get('teacherMilestones')).forEach((m) => {
  const task = (store.get('tasks') || []).find((t) => t.id === m.taskId);
  const node = (store.get('timeline').customNodes || []).find((n) => n.id === m.timelineNodeId);
  if (!task || task.assignee !== 'DOS' || task.source !== 'teacher-milestone') allSynced = false;
  if (!node || node.date !== m.triggerDate || node.source !== 'teacher-milestone') allSynced = false;
});
assert(allSynced, '每条里程碑均同步写入「待办(负责人DOS/source)」与「时间轴(触发日期/source)」');

console.log('== 4. 标记完成：三处状态一致 ==');
MS.complete('ms_t1_probation');
ms = store.get('teacherMilestones');
const m1 = ms.find((x) => x.id === 'ms_t1_probation');
const tk1 = (store.get('tasks') || []).find((t) => t.id === m1.taskId);
const nd1 = (store.get('timeline').customNodes || []).find((n) => n.id === m1.timelineNodeId);
assert(m1.status === 'done', '里程碑状态 → done');
assert(tk1.status === 'done', '关联待办状态 → done');
assert(nd1.done === true && /✅$/.test(nd1.title), '关联时间轴节点 → done 且标题带 ✅');

console.log('== 5. reconcile 反向同步（待办完成 → 里程碑完成）==');
const m2 = ms.find((x) => x.id === 'ms_t2_probation');
const tk2 = (store.get('tasks') || []).find((t) => t.id === m2.taskId);
tk2.status = 'done';
store.set('tasks', store.get('tasks'));
MS.reconcile();
assert((store.get('teacherMilestones')).find((x) => x.id === 'ms_t2_probation').status === 'done', '待办标记完成后，reconcile 使里程碑同步为 done');

console.log('== 6. 面板渲染 ==');
const h = MS.panelHtml(); // 默认待处理视图
assert(h.indexOf('教师职业发展关键节点提醒') >= 0, '面板标题渲染');
assert(h.indexOf('李四') >= 0, '面板(待处理)含待处理教师「李四」');
assert(h.indexOf('标记完成') >= 0, '待处理项含「标记完成」按钮');
MS.setFilter('all');
const hAll = MS.panelHtml();
assert(hAll.indexOf('张三') >= 0 && hAll.indexOf('已同步') >= 0, '全部视图含已完成教师「张三」与「已同步」');
MS.setFilter('pending');
assert(typeof MS.pendingCount() === 'number' && MS.pendingCount() === 3, 'pendingCount = 3（t1、t2 转正已完成，余 3 条待处理）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
