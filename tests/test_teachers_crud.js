/* Node 桩测试：新建教师 + 按 ID 删除教师（teachers.js）
   运行：node test_teachers_crud.js
   覆盖：addTeacher 打开新建表单、saveEdit 新建(长度+1/字段正确)、
         必填校验(姓名+部门)、同名同部门查重拦截、deleteTeacherById(有效ID删除/无效ID不删/取消不删) */
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
  body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
};
let confirmReturn = true;
sandbox.window.confirm = () => confirmReturn;
sandbox.alert = () => {};

vm.createContext(sandbox);

const files = ['js/baseline.js', 'js/util.js', 'js/store.js'];
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
sandbox.App.router = { register: () => {}, navigate: () => {} };
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/teachers.js'), 'utf8'), sandbox, { filename: 'js/views/teachers.js' });

let lastModal = null;
let toasts = [];
sandbox.App.util.modal = (o) => { lastModal = o; };
sandbox.App.util.toast = (msg, kind) => { toasts.push(msg + '|' + kind); };

const T = sandbox.App.views.teachers;
const store = sandbox.App.store;
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}
function getTeachers() { return store.get('teachers') || []; }
function toastKinds() { return toasts.map(function(t) { return t.split('|')[1]; }); }
function resetToasts() { toasts = []; }
function setField(id, v) { sandbox.document.getElementById(id).value = v; }

const FIXTURE = [
  { id: 'tA', name: '在职甲', subjectGroup: '数学', positionCode: 'TR', entryDate: '2022-01-01', school: 'A大', degree: '本科', major: '数学', certificates: ['初中数学'], tags: [] },
  { id: 'tB', name: '待离乙', subjectGroup: '英语', positionCode: 'TRM', entryDate: '2021-01-01', school: 'B大', degree: '硕士', major: '英语', certificates: ['高中英语'], tags: ['待离职'] },
];

(async () => {
  console.log('== 1. 准备可控数据 ==');
  store.set('teachers', FIXTURE.map(function(t) { return Object.assign({}, t); }));
  assert(getTeachers().length === 2, '已写入 2 条教师');

  console.log('== 2. 新建教师：打开空表单（无删除按钮）==');
  resetToasts();
  T.addTeacher();
  assert(lastModal && lastModal.title === '新建教师', '弹窗标题为「新建教师」');
  assert(lastModal.onDelete == null, '新建表单无删除按钮(onDelete 为 null)');
  assert(lastModal.confirmText === '创建', '确认按钮文案为「创建」');

  console.log('== 3. 新建教师：填写必填项并保存 ==');
  setField('ed-name', '新老师');
  setField('ed-subject', '理综');
  setField('ed-pos', 'IIR');
  setField('ed-entry', '2024-03-01');
  setField('ed-school', 'C大');
  setField('ed-degree', '硕士');
  setField('ed-major', '物理');
  setField('ed-certs', '高中物理、初中物理');
  resetToasts();
  T.saveEdit(function(){});
  assert(getTeachers().length === 3, '教师数量 2 → 3');
  var nt = getTeachers().find(function(t) { return t.name === '新老师'; });
  assert(!!nt, '新教师已入库');
  assert(nt && nt.subjectGroup === '理综', '所属部门(学科组)=理综');
  assert(nt && nt.positionCode === 'IIR', '岗位=IIR');
  assert(nt && nt.degree === '硕士', '学历=硕士');
  assert(nt && nt.certificates.length === 2, '证书拆为 2 项');
  assert(nt && /^tr[_-]/.test(nt.id), '分配内部教师 ID(tr_*/tr-*)');
  assert(toastKinds().indexOf('bad') < 0 && toastKinds().indexOf('ok') >= 0, '保存成功反馈(ok)');

  console.log('== 4. 校验：姓名 + 部门 必填 ==');
  resetToasts();
  T.addTeacher();
  setField('ed-name', '');
  setField('ed-subject', '数学');
  T.saveEdit(function(){});
  assert(getTeachers().length === 3, '姓名为空时不新增（仍为 3）');
  assert(toastKinds().indexOf('bad') >= 0, '给出错误反馈(bad)');

  console.log('== 5. 查重：同名同部门应与已有记录合并/拦截 ==');
  resetToasts();
  T.addTeacher();
  setField('ed-name', '在职甲');     // 与 tA 同名同部门
  setField('ed-subject', '数学');
  T.saveEdit(function(){});
  assert(getTeachers().length === 3, '同名同部门被拦截，数量仍为 3');
  assert(toastKinds().indexOf('bad') >= 0, '查重给出错误反馈(bad)');

  console.log('== 6. 按教师 ID 删除（含确认提示与反馈）==');
  resetToasts();
  confirmReturn = true;
  var before = getTeachers().length;
  var ok = T.deleteTeacherById('tB', function(){});
  assert(ok === true, 'deleteTeacherById 返回 true');
  assert(getTeachers().length === before - 1, '删除后数量 -1');
  assert(!getTeachers().some(function(t){ return t.id === 'tB'; }), 'tB 已不存在');
  assert(toastKinds().indexOf('ok') >= 0, '删除成功反馈(ok)');

  console.log('== 7. 无效 ID 不删除 ==');
  resetToasts();
  var n0 = getTeachers().length;
  var ok2 = T.deleteTeacherById('不存在的ID', function(){});
  assert(ok2 === false, '无效 ID 返回 false');
  assert(getTeachers().length === n0, '数量不变');
  assert(toastKinds().indexOf('bad') >= 0, '无效 ID 给出错误反馈(bad)');

  console.log('== 8. 取消确认不删除 ==');
  resetToasts();
  confirmReturn = false; // 用户点「取消」
  var n1 = getTeachers().length;
  T.deleteTeacherById('tA', function(){});
  assert(getTeachers().length === n1, '取消确认后数量不变');
  assert(getTeachers().some(function(t){ return t.id === 'tA'; }), 'tA 仍在');

  console.log('== 9. 编辑现有教师（回归）==');
  resetToasts();
  T.openEdit('tA');
  assert(lastModal && lastModal.onDelete != null, '编辑表单含删除按钮');
  setField('ed-name', '在职甲改');
  setField('ed-subject', '数学');
  T.saveEdit(function(){});
  var ta = getTeachers().find(function(t){ return t.id === 'tA'; });
  assert(ta && ta.name === '在职甲改', '编辑后姓名已更新');
  assert(ta && ta.id === 'tA', '编辑保留原 ID');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
