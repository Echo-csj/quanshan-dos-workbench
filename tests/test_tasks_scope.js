/* Node 桩测试：任务「个人/团队」识别 = 负责人（assignee）
   运行：node test_tasks_scope.js
   覆盖：
   1. store 迁移：按负责人重新推导 scope（DOS→personal、他人→team、空→''未分配）
   2. /tasks 看板渲染：团队/未分配徽标 + 个人/团队/未分配筛选 chips
   3. saveTask 按负责人自动推导 scope */
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
const U = sandbox.App.util;
const tasksApi = sandbox.App.views.tasks;

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

console.log('\n[1] 负责人推导 scope（识别规则）');
assert(U.deriveScope('DOS') === 'personal', 'assignee=DOS → personal（个人）');
assert(U.deriveScope('张老师') === 'team', 'assignee=张老师 → team（团队）');
assert(U.deriveScope('') === '', 'assignee 空 → 未分配');
assert(U.deriveScope('  DOS  ') === 'personal', '带空格的 DOS → personal');

console.log('\n[2] store scope 迁移（按负责人重新推导）');
store_map['zyg_workbench_v1'] = JSON.stringify({
  tasks: [
    { id: 'old1', title: '无负责人', status: 'todo', dueDate: '', scope: 'personal' },
    { id: 'old2', title: 'DOS任务', status: 'doing', assignee: 'DOS' },
    { id: 'old3', title: '张老师任务', status: 'todo', assignee: '张老师', scope: 'personal' }
  ]
});
store.refresh();
const migrated = store.get('tasks') || [];
const f = (id) => migrated.find((t) => t.id === id);
assert(f('old1') && f('old1').scope === '', '无负责人 → scope 被纠正为「未分配」');
assert(f('old2') && f('old2').scope === 'personal', 'assignee=DOS → scope=personal');
assert(f('old3') && f('old3').scope === 'team', 'assignee=张老师 → scope=team（覆盖旧 personal）');

console.log('\n[3] /tasks 看板渲染（团队/未分配徽标 + scope chips）');
store.set('tasks', [
  { id: 't_p', title: '个人任务', status: 'todo', priority: 'normal', assignee: 'DOS', scope: 'personal' },
  { id: 't_t', title: '团队任务', status: 'todo', priority: 'normal', assignee: '张老师', scope: 'team' },
  { id: 't_u', title: '未分配任务', status: 'todo', priority: 'normal', assignee: '', scope: '' }
]);
routeHandler();
const html = (elems['view-container'] && elems['view-container'].innerHTML) || '';
assert(html.indexOf('scope-team') >= 0, '看板卡片渲染「团队」徽标');
assert(html.indexOf('scope-unassigned') >= 0, '看板卡片渲染「未分配」徽标');
assert(html.indexOf('toggleFilter(\'scope\',\'personal\')') >= 0, '含「个人」筛选 chip');
assert(html.indexOf('toggleFilter(\'scope\',\'team\')') >= 0, '含「团队」筛选 chip');
assert(html.indexOf('toggleFilter(\'scope\',\'unassigned\')') >= 0, '含「未分配」筛选 chip');

console.log('\n[4] saveTask 按负责人自动推导 scope');
function fillAndSave(assignee) {
  elems['task-title'] = { value: '任务X', trim() { return '任务X'; } };
  elems['task-priority'] = { value: 'normal' };
  elems['task-status'] = { value: 'todo' };
  elems['task-assignee'] = { value: assignee, trim() { return assignee; } };
  elems['task-due'] = { value: '' };
  elems['task-note'] = { value: '', trim() { return ''; } };
  tasksApi.saveTask(null, null);
  const arr = store.get('tasks') || [];
  return arr[arr.length - 1];
}
assert(fillAndSave('DOS').scope === 'personal', '负责人=DOS → 写入 scope=personal');
assert(fillAndSave('李老师').scope === 'team', '负责人=李老师 → 写入 scope=team');
assert(fillAndSave('').scope === '', '负责人空 → 写入 scope=未分配');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
