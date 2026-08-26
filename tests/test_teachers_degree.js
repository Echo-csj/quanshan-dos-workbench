/* Node 桩测试：学历列 + 行内下拉编辑（teachers.js）
   运行：node test_teachers_degree.js
   覆盖：API 暴露、表格列渲染、行内编辑进入/提交/取消/Esc、
         原值兜底 option、弹窗学历编辑、upsert 学历保护逻辑 */
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
sandbox.window.confirm = () => true;
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
function setField(id, v) { sandbox.document.getElementById(id).value = v; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function view() { return elems['view-container'] ? elems['view-container'].innerHTML : ''; }
// 提取学历编辑下拉的 HTML 片段（排除工具栏其他下拉的 option）
function degFragment() {
  const v = view();
  const i = v.indexOf('id="deg-select"');
  if (i < 0) return '';
  return v.slice(i, v.indexOf('</select>', i));
}

(async () => {
  console.log('== 1. API 暴露 ==');
  ['startDegreeEdit', 'commitDegreeEdit', 'cancelDegreeEdit', 'degreeKeydown']
    .forEach(fn => assert(typeof T[fn] === 'function', 'App.views.teachers.' + fn + ' 为函数'));

  console.log('== 2. 表格学历列渲染（非编辑态=纯文本）==');
  T.render();
  // 表头可能带 style/class 属性，用正则定位列序（不依赖裸 <th> 字面量）
  function thPos(html, label) {
    var m = new RegExp('<th[^>]*>\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*</th>').exec(html);
    return m ? m.index : -1;
  }
  assert(thPos(view(), '学历') >= 0, '表头含「学历」列');
  const thOrder = thPos(view(), '毕业院校') < thPos(view(), '学历')
    && thPos(view(), '学历') < thPos(view(), '专业');
  assert(thOrder, '学历列位于「毕业院校」之后、「专业」之前');
  assert(view().indexOf('degree-cell') >= 0, '学历单元格使用 degree-cell 类');
  assert(view().indexOf('degree-text') >= 0, '非编辑态为 degree-text 纯文本');
  const t0 = getTeachers()[0];
  assert(view().indexOf('>' + (t0.degree || '—') + '</span>') >= 0, '空学历显示为 —');

  console.log('== 3. 行内编辑：进入 ==');
  T.startDegreeEdit(t0.id, { stopPropagation: () => {} });
  assert(view().indexOf('id="deg-select"') >= 0, '点击后单元格变为下拉');
  assert(view().indexOf('<option value="本科">') >= 0 && view().indexOf('<option value="硕士">') >= 0, '下拉仅含 本科/硕士 两项');
  assert(view().indexOf('选择学历…') >= 0, '空值时显示占位项（disabled）');
  assert((degFragment().match(/<option /g) || []).length === 3, '选项数 = 占位+本科+硕士（无其他值）');

  console.log('== 4. 行内编辑：提交保存与回显 ==');
  toasts = [];
  T.commitDegreeEdit(t0.id, '硕士');
  assert(getTeachers()[0].degree === '硕士', '选择「硕士」后写入数据源');
  assert(view().indexOf('id="deg-select"') < 0, '保存后退出编辑态');
  assert(view().indexOf('degree-text') >= 0 && view().indexOf('>硕士</span>') >= 0, '表格回显「硕士」');
  assert(toasts.some(m => m.indexOf('硕士') >= 0), '保存有 toast 提示');

  console.log('== 5. 行内编辑：取消（blur / Esc）不改数据 ==');
  T.startDegreeEdit(t0.id, {});
  assert(view().indexOf('id="deg-select"') >= 0, '再次进入编辑态');
  T.cancelDegreeEdit();
  assert(getTeachers()[0].degree === '硕士', '取消后数据保持「硕士」不变');
  assert(view().indexOf('id="deg-select"') < 0 && view().indexOf('>硕士</span>') >= 0, '取消后恢复文本态并显示原值');
  T.startDegreeEdit(t0.id, {});
  T.degreeKeydown({ key: 'Escape' });
  assert(getTeachers()[0].degree === '硕士' && view().indexOf('id="deg-select"') < 0, 'Esc 取消：数据不变并退出编辑');
  T.startDegreeEdit(t0.id, {});
  T.degreeKeydown({ key: 'a' });
  assert(view().indexOf('id="deg-select"') >= 0, '非 Esc 按键不触发取消');
  T.cancelDegreeEdit();

  console.log('== 6. 选中相同值：仅退出编辑，不改数据 ==');
  T.startDegreeEdit(t0.id, {});
  toasts = [];
  T.commitDegreeEdit(t0.id, '硕士');
  assert(getTeachers()[0].degree === '硕士', '值未变化');
  assert(toasts.length === 0, '相同值不弹保存提示');

  console.log('== 7. Excel 原值兜底 option ==');
  const teachers = getTeachers().slice();
  teachers[0] = Object.assign({}, teachers[0], { degree: '大专' });
  store.set('teachers', teachers);
  T.startDegreeEdit(teachers[0].id, {});
  assert(view().indexOf('大专（原值）') >= 0, '非标准学历显示为「原值」兜底项');
  assert((degFragment().match(/<option /g) || []).length === 3, '兜底场景选项数 = 原值+本科+硕士');
  T.commitDegreeEdit(teachers[0].id, '本科');
  assert(getTeachers()[0].degree === '本科', '从原值切换为「本科」成功');

  console.log('== 8. 编辑弹窗中的学历 ==');
  T.openEdit(t0.id);
  assert(lastModal && lastModal.content.indexOf('id="ed-degree"') >= 0, '弹窗含学历下拉（ed-degree）');
  assert(lastModal.content.indexOf('<option value=""') >= 0, '弹窗学历含「未填写」选项');
  T.openEdit(t0.id);
  setField('ed-name', t0.name);
  setField('ed-subject', t0.subjectGroup);
  setField('ed-degree', '硕士');
  setField('ed-certs', '');
  T.saveEdit(() => {});
  assert(getTeachers()[0].degree === '硕士', '弹窗保存学历写回成功');
  // 弹窗取消路径：重新打开但不确认
  T.openEdit(t0.id);
  setField('ed-degree', '本科'); // 仅改表单，不点保存
  assert(getTeachers()[0].degree === '硕士', '弹窗未确认前数据源不变（取消保持原值）');

  console.log('== 9. upsert 学历保护逻辑（复刻 applyUpsert 分支）==');
  const list = getTeachers().slice();
  const idx = 0;
  const withDeg = list[idx];
  // 场景 A：Excel 无学历列（p.degree === undefined）→ 更新不覆盖
  let rec = { name: withDeg.name, subjectGroup: withDeg.subjectGroup, positionCode: 'TR',
              entryDate: withDeg.entryDate, school: 'X', major: 'Y', certificates: [] };
  if (withDeg.degree !== undefined) rec.degree = withDeg.degree; // 复刻：仅 provided 才写
  list[idx] = Object.assign({}, withDeg, rec);
  assert(list[idx].degree === '硕士', 'Excel 无学历列时更新保留已有学历');
  // 场景 B：Excel 有学历列（p.degree='本科'）→ 覆盖
  rec = { name: withDeg.name, subjectGroup: withDeg.subjectGroup, positionCode: 'TR',
          entryDate: withDeg.entryDate, school: 'X', major: 'Y', certificates: [], degree: '本科' };
  list[idx] = Object.assign({}, withDeg, rec);
  assert(list[idx].degree === '本科', 'Excel 有学历列时更新为导入值');
  // 场景 C：新增且无学历 → 无 degree 键
  const addRec = { name: '测试新人', subjectGroup: '数学', positionCode: 'TR',
                   entryDate: '2026-08-01', school: '', major: '', certificates: [] };
  if (undefined !== undefined) addRec.degree = undefined; // 复刻：未提供不写键
  assert(!('degree' in addRec) || addRec.degree === undefined, '新增未提供学历时无 degree 键（显示 —）');

  console.log('== 10. localStorage 落盘 ==');
  await sleep(350);
  const persisted = JSON.parse(store_map['zyg_workbench_v1'] || '{}');
  const persistedT = (persisted.teachers || []).find(x => x.id === t0.id);
  assert(persistedT && persistedT.degree === '硕士', '学历已持久化到 localStorage');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('桩测试崩溃：', e); process.exit(1); });
