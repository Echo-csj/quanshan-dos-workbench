/* Node 桩测试：今日指挥台「辨别筛选 + 黄历」+ 手动新建任务同步
   运行：node test_today.js
   覆盖：
   1. classifyTask 分类：手动新建(无日期 todo)→core；今日到期→core；进行中→core；
      高优→core；逾期→alert；临近截止→alert；远期普通→other；已完成→null
   2. 手动新建任务能归入「核心工作」，从而实时出现在今日指挥台
   3. almanac 黄历数据：宜/忌非空、动态提示（逾期/今日到期/里程碑/节律）
   4. getPendingMilestones：过滤待处理教师发展提醒 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = {
  console, setTimeout, clearTimeout, Date, JSON, Object, Array,
  isNaN, parseInt, parseFloat, String, Number, RegExp, Math
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const store_map = {};
sandbox.localStorage = {
  getItem: (k) => (k in store_map ? store_map[k] : null),
  setItem: (k, v) => { store_map[k] = String(v); },
  removeItem: (k) => { delete store_map[k]; }
};

function fakeEl() {
  return { innerHTML: '', value: '', textContent: '', style: {}, checked: false, focus() {}, classList: { add() {}, remove() {}, toggle() {} } };
}
const elems = {};
sandbox.document = {
  getElementById: (id) => (elems[id] = elems[id] || fakeEl()),
  createElement: () => fakeEl(),
  addEventListener: () => {},
  querySelectorAll: () => [],
  body: { appendChild: () => {}, classList: { add() {}, remove() {}, toggle() {} } }
};
sandbox.window.confirm = () => true;
sandbox.alert = () => {};
sandbox.addEventListener = function () {};
sandbox.location = { hash: '' };
sandbox.window.addEventListener = sandbox.addEventListener;
sandbox.window.location = sandbox.location;

vm.createContext(sandbox);
for (const f of ['js/baseline.js', 'js/util.js', 'js/store.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
// lunar-javascript：UMD 在 vm 内无 module/define，走 root[i]=o[i] 挂到 sandbox 全局（Solar/Lunar）
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/lib/lunar.js'), 'utf8'), sandbox, { filename: 'js/lib/lunar.js' });
let routeHandler = null;
sandbox.App.router = { register: (path, fn) => { if (path === '/today') routeHandler = fn; }, navigate: () => {}, resolve: () => {} };
sandbox.App.util.svgIcon = () => '';
sandbox.App.views = sandbox.App.views || {};
sandbox.App.views.tasks = { editTask: () => {}, openTaskModal: () => {} };
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/today.js'), 'utf8'), sandbox, { filename: 'js/views/today.js' });

const store = sandbox.App.store;
const U = sandbox.App.util;
const today = sandbox.App.views.today;

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

// 相对日期工具（基于真实今天）
function dStr(offsetDays) {
  return U.formatDate(new Date(Date.now() + offsetDays * 86400000), 'YYYY-MM-DD');
}
const todayStr = dStr(0);
const soonStr = dStr(3);

console.log('\n[1] classifyTask 分类规则');
const ct = today.classifyTask;
assert(ct({ status: 'todo', priority: 'normal', dueDate: '' }, todayStr, soonStr) === 'core', '手动新建（无截止日期 todo）→ core');
assert(ct({ status: 'todo', dueDate: todayStr }, todayStr, soonStr) === 'core', '今日到期 → core');
assert(ct({ status: 'doing', dueDate: '' }, todayStr, soonStr) === 'core', '进行中 → core');
assert(ct({ status: 'review', dueDate: '' }, todayStr, soonStr) === 'core', '审阅中 → core');
assert(ct({ status: 'todo', priority: 'high', dueDate: dStr(10) }, todayStr, soonStr) === 'core', '高优（远期）→ core');
assert(ct({ status: 'todo', priority: 'urgent', dueDate: dStr(10) }, todayStr, soonStr) === 'core', '紧急（远期）→ core');
assert(ct({ status: 'todo', dueDate: dStr(-1) }, todayStr, soonStr) === 'alert', '逾期 → alert');
assert(ct({ status: 'todo', dueDate: dStr(2) }, todayStr, soonStr) === 'alert', '临近截止(今+2天) → alert');
assert(ct({ status: 'todo', dueDate: dStr(3) }, todayStr, soonStr) === 'alert', '临近截止(今+3天) → alert');
assert(ct({ status: 'todo', dueDate: dStr(10) }, todayStr, soonStr) === 'other', '远期普通待办 → other');
assert(ct({ status: 'done', dueDate: todayStr }, todayStr, soonStr) === null, '已完成 → null');
assert(ct({ status: 'todo', archived: true }, todayStr, soonStr) === null, '已归档 → null');

console.log('\n[2] 手动新建任务实时出现在「核心工作」');
store.set('tasks', [
  { id: 'task_manual1', title: '手动新建任务', status: 'todo', priority: 'normal', assignee: '张老师', dueDate: '', source: 'manual' }
]);
const tasks = store.get('tasks');
const manualTask = tasks[0];
assert(manualTask !== undefined, '手动任务已写入 store.tasks');
assert(today.classifyTask(manualTask, todayStr, soonStr) === 'core', '手动新建任务归类为核心工作（可在今日指挥台看到）');

console.log('\n[3] almanac 黄历数据');
const alm0 = today.almanac();
assert(Array.isArray(alm0.yi) && alm0.yi.length > 0, '「宜」非空数组');
assert(Array.isArray(alm0.ji) && alm0.ji.length > 0, '「忌」非空数组');
assert(Array.isArray(alm0.tips) && alm0.tips.length > 0, '「今日提示」非空数组');
assert(alm0.dateLabel && alm0.weekLabel, '含日期与周次标签');
assert(alm0.lunar != null, 'lunar 对象非空（lunar 库已加载）');
assert(alm0.lunar && alm0.lunar.yearGanZhi && alm0.lunar.yearGanZhi.length >= 2, '干支年非空');
assert(alm0.lunar && alm0.lunar.shengXiao, '生肖非空');
assert(alm0.lunar && alm0.lunar.lunarDate, '农历日期非空');

// 注入逾期 + 今日到期 + 里程碑，验证动态提示
store.set('tasks', [
  { id: 't_overdue', title: '逾期任务', status: 'todo', dueDate: dStr(-2) },
  { id: 't_today', title: '今日到期任务', status: 'todo', dueDate: todayStr },
  { id: 't_soon', title: '临近截止任务', status: 'todo', dueDate: dStr(2) }
]);
store.set('teacherMilestones', [
  { id: 'ms_1', teacherName: '李四', label: '转正提醒', status: 'pending', dueDate: todayStr },
  { id: 'ms_2', teacherName: '王五', label: '入职6个月沟通', status: 'done', dueDate: todayStr }
]);
const alm = today.almanac();
assert(alm.overdue === 1, 'overdue 计数 = 1');
assert(alm.dueToday === 1, 'dueToday 计数 = 1');
assert(alm.dueSoon === 1, 'dueSoon 计数 = 1');
assert(alm.msPending === 1, 'msPending 计数 = 1（仅 pending）');
assert(alm.tips.some((s) => s.indexOf('已逾期') >= 0), '提示含「已逾期」');
assert(alm.tips.some((s) => s.indexOf('今日到期') >= 0), '提示含「今日到期」');
assert(alm.tips.some((s) => s.indexOf('教师发展提醒') >= 0), '提示含「教师发展提醒」');

console.log('\n[4] getPendingMilestones');
const pend = today.getPendingMilestones();
assert(Array.isArray(pend) && pend.length === 1, '仅返回 status !== done 的里程碑');
assert(pend[0].id === 'ms_1', '返回的是 pending 那条');

console.log('\n[5] /today 路由渲染冒烟（验证手动任务真实出现在 HTML）');
store.set('tasks', [
  { id: 't_manual', title: '手动新建任务', status: 'todo', priority: 'normal', assignee: 'DOS', dueDate: '', source: 'manual', scope: 'personal' },
  { id: 't_team', title: '团队协作任务', status: 'todo', priority: 'normal', assignee: '张老师', dueDate: '', scope: 'team' },
  { id: 't_unassigned', title: '未分配任务', status: 'todo', priority: 'normal', assignee: '', dueDate: '', scope: '' }
]);
store.set('teacherMilestones', [
  { id: 'ms_smoke', teacherName: '李四', label: '转正提醒', status: 'pending', dueDate: todayStr }
]);
routeHandler(); // 执行 /today 路由，写入 view-container.innerHTML
const html = (elems['view-container'] && elems['view-container'].innerHTML) || '';
assert(html.indexOf('今日工作') >= 0, '渲染含「今日工作」卡片');
assert(html.indexOf('核心工作') >= 0, '渲染含「核心工作」筛选 tab');
assert(html.indexOf('重要提示') >= 0, '渲染含「重要提示」筛选 tab');
assert(html.indexOf('今日黄历') >= 0, '渲染含「今日黄历」卡片');
assert(html.indexOf('>宜<') >= 0 || html.indexOf('almanac-tag-yi') >= 0, '黄历含「宜」');
assert(html.indexOf('>忌<') >= 0 || html.indexOf('almanac-tag-ji') >= 0, '黄历含「忌」');
assert(html.indexOf('almanac-lunar') >= 0, '玄学黄历头（农历/干支）已渲染');
assert(html.indexOf('手动新建任务') >= 0, '手动新建任务出现在今日指挥台 HTML');
assert(html.indexOf('李四') >= 0, '教师里程碑提醒出现在今日指挥台 HTML');
assert(html.indexOf('tw-badge-team') >= 0, '团队任务在今日指挥台带「团队」徽标');
assert(html.indexOf('团队协作任务') >= 0, '团队任务标题出现在今日指挥台 HTML');
assert(html.indexOf('tw-badge-unassigned') >= 0, '未分配任务在今日指挥台带「未分配」徽标');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
