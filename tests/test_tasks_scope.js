/* Node 桩测试：任务「个人/团队」scope 字段
   运行：node test_tasks_scope.js
   覆盖：
   1. store 迁移：老任务（无 scope）经 load/refresh 后自动回填 scope='personal'
   2. /tasks 看板渲染：团队任务带「团队」徽标；工具栏含「个人/团队」筛选 chips；
      source chips 补齐「里程碑」 */
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
  return { innerHTML: '', value: '', textContent: '', style: {}, checked: false, focus() {}, appendChild: () => {}, classList: { add() {}, remove() {}, toggle() {} } };
}
const elems = {};
sandbox.document = {
  getElementById: (id) => (elems[id] = elems[id] || fakeEl()),
  createElement: () => fakeEl(),
  createTextNode: () => fakeEl(),
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
let routeHandler = null;
sandbox.App.router = { register: (path, fn) => { if (path === '/tasks') routeHandler = fn; }, navigate: () => {}, resolve: () => {} };
sandbox.App.util.svgIcon = () => '';
sandbox.App.views = sandbox.App.views || {};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/tasks.js'), 'utf8'), sandbox, { filename: 'js/views/tasks.js' });

const store = sandbox.App.store;
const tasksApi = sandbox.App.views.tasks;

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

console.log('\n[1] store scope 迁移');
// 预置「老数据」：tasks 无 scope 字段
store_map['zyg_workbench_v1'] = JSON.stringify({
  tasks: [
    { id: 'old1', title: '老任务A', status: 'todo', dueDate: '' },
    { id: 'old2', title: '老任务B', status: 'doing', scope: 'team' }
  ]
});
store.refresh(); // 触发 load() → deepMerge → migrateTasksScope
const migrated = store.get('tasks') || [];
assert(migrated.length === 2, '迁移后任务数不变');
const a = migrated.find((t) => t.id === 'old1');
const b = migrated.find((t) => t.id === 'old2');
assert(a && a.scope === 'personal', '无 scope 老任务 → 回填 personal');
assert(b && b.scope === 'team', '已有 team 的任务不被覆盖');

console.log('\n[2] /tasks 看板渲染（团队徽标 + scope 筛选 chips）');
store.set('tasks', [
  { id: 't_p', title: '个人任务', status: 'todo', priority: 'normal', dueDate: '', scope: 'personal' },
  { id: 't_t', title: '团队任务', status: 'todo', priority: 'normal', dueDate: '', scope: 'team' },
  { id: 't_ms', title: '转正提醒-李四', status: 'todo', priority: 'high', dueDate: '', source: 'teacher-milestone', scope: 'personal' }
]);
routeHandler(); // 执行 /tasks 路由，写入 view-container.innerHTML
const html = (elems['view-container'] && elems['view-container'].innerHTML) || '';
assert(html.indexOf('scope-team') >= 0, '看板卡片渲染「团队」徽标');
assert(html.indexOf('toggleFilter(\'scope\',\'personal\')') >= 0, '工具栏含「个人」筛选 chip');
assert(html.indexOf('toggleFilter(\'scope\',\'team\')') >= 0, '工具栏含「团队」筛选 chip');
assert(html.indexOf('toggleFilter(\'source\',\'teacher-milestone\')') >= 0, 'source 筛选补齐「里程碑」chip');

console.log('\n[3] saveTask 读取 scope radio（桩 getElementById）');
// 模拟弹窗：团队 radio 被勾选
elems['task-title'] = { value: '新团队任务', trim() { return '新团队任务'; } };
elems['task-priority'] = { value: 'normal' };
elems['task-status'] = { value: 'todo' };
elems['task-assignee'] = { value: '张老师', trim() { return '张老师'; } };
elems['task-due'] = { value: '' };
elems['task-note'] = { value: '', trim() { return ''; } };
elems['task-scope-team'] = { checked: true };
tasksApi.saveTask(null, null);
const newTasks = store.get('tasks') || [];
const nt = newTasks.find((t) => t.title === '新团队任务');
assert(nt && nt.scope === 'team', 'saveTask 勾选团队 → 写入 scope=team');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
