/* Node 桩测试：状态列/标签列移除 + 姓名栏颜色编码（teachers.js）
   运行：node test_teachers_status.js
   覆盖：状态列与标签列已从表格移除、状态以颜色+图标(●▲■)+文字标注在姓名栏、
         标签数据/编辑弹窗标签仍保留、统计条三类人数、行状态色条、证书容器不截断 */
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
function view() { return elems['view-container'] ? elems['view-container'].innerHTML : ''; }

// 构造可控数据：A 在职 / B 待离职 / C 离职 / D 待离职+跨学科 / E 跨学科 / F 含多证书
const FIXTURE = [
  { id: 'tA', name: '在职甲', subjectGroup: '数学', positionCode: 'TR', entryDate: '2022-01-01', school: 'A大', degree: '本科', major: '数学', certificates: ['初中数学'], tags: [] },
  { id: 'tB', name: '待离乙', subjectGroup: '英语', positionCode: 'TRM', entryDate: '2021-01-01', school: 'B大', degree: '硕士', major: '英语', certificates: ['高中英语'], tags: ['待离职'] },
  { id: 'tC', name: '离职丙', subjectGroup: '文综', positionCode: 'JIR', entryDate: '2020-01-01', school: 'C大', degree: '本科', major: '政治', certificates: ['初中政治'], tags: ['离职'] },
  { id: 'tD', name: '跨待丁', subjectGroup: '理综', positionCode: 'IIR', entryDate: '2019-01-01', school: 'D大', degree: '硕士', major: '物理', certificates: ['高中物理'], tags: ['跨学科', '待离职'] },
  { id: 'tE', name: '跨戊', subjectGroup: '数学', positionCode: 'TR', entryDate: '2023-01-01', school: 'E大', degree: '本科', major: '数学', certificates: ['初中数学'], tags: ['跨学科'] },
  { id: 'tF', name: '证己', subjectGroup: '英语', positionCode: 'TR', entryDate: '2018-01-01', school: 'F大', degree: '硕士', major: '英语', certificates: ['初中英语', '高中英语', '英语教师资格证'], tags: [] },
];

(async () => {
  console.log('== 1. 准备可控数据 ==');
  store.set('teachers', FIXTURE.map(function(t) { return Object.assign({}, t); }));
  assert(getTeachers().length === 6, '已写入 6 条教师');

  console.log('== 2. 标签栏(筛选下拉)已移除 ==');
  T.render();
  assert(view().indexOf('tch-filter-tag') < 0, '工具栏不再含 tch-filter-tag 下拉');

  console.log('== 3. 状态列与标签列已从表格移除 ==');
  assert(view().indexOf('<th>状态</th>') < 0, '表头无「状态」列');
  assert(view().indexOf('<th>标签</th>') < 0, '表头无「标签」列');
  assert((view().match(/<th[ >]/g) || []).length === 10, '表头共 10 列（#/姓名/学科组/岗位/入职/工龄/院校/学历/专业/证书）');
  assert(view().indexOf('status-badge') < 0, '不再渲染 status-badge 列徽章');
  assert(view().indexOf('class="tags"') < 0 && view().indexOf('tag-badge') < 0, '不再渲染标签列徽章');

  console.log('== 4. 状态标注在姓名栏（颜色 + 图标 + 文字）==');
  assert(view().indexOf('name-cell') >= 0, '姓名单元格为 .name-cell');
  assert(view().indexOf('name-status status-active') >= 0, '在职姓名 class=name-status status-active');
  assert(view().indexOf('name-status status-pending') >= 0, '待离职姓名 class=name-status status-pending');
  assert(view().indexOf('name-status status-left') >= 0, '离职姓名 class=name-status status-left');
  assert(view().indexOf('ns-glyph') >= 0, '含状态图标(ns-glyph)');
  assert(view().indexOf('ns-name') >= 0, '含姓名(ns-name)');
  assert(view().indexOf('在职') >= 0, '含文字「在职」（统计条/title）');
  assert(view().indexOf('title="在职"') >= 0, '在职姓名 title 含文字说明（色弱友好）');
  assert(view().indexOf('待离职') >= 0, '含文字「待离职」');
  assert(view().indexOf('离职') >= 0, '含文字「离职」');
  // 图标校验（色弱友好：不同形状 ● ▲ ■）
  assert(view().indexOf('>●<') >= 0, '在职图标 ●');
  assert(view().indexOf('>▲<') >= 0, '待离职图标 ▲');
  assert(view().indexOf('>■<') >= 0, '离职图标 ■');

  console.log('== 5. 离职姓名划线 ==');
  const cIdx = view().indexOf('离职丙');
  const cTrStart = view().lastIndexOf('<tr', cIdx);
  const cTrEnd = view().indexOf('</tr>', cIdx);
  const cRow = view().slice(cTrStart, cTrEnd);
  assert(cRow.indexOf('text-decoration:line-through') >= 0, '离职行姓名带 line-through');

  console.log('== 6. 行状态色条（row-active/pending/leave）仍保留，便于扫读 ==');
  assert(view().indexOf('class="row-active"') >= 0, '在职行 class=row-active');
  assert(view().indexOf('class="row-pending"') >= 0, '待离职行 class=row-pending');
  assert(view().indexOf('class="row-leave"') >= 0, '离职行 class=row-leave');

  console.log('== 7. 统计条三类人数 + 颜色点 ==');
  assert(view().indexOf('stat-active') >= 0 && view().indexOf('在职 3') >= 0, '统计：在职 3');
  assert(view().indexOf('stat-pending') >= 0 && view().indexOf('待离职 2') >= 0, '统计：待离职 2');
  assert(view().indexOf('stat-left') >= 0 && view().indexOf('离职 1') >= 0, '统计：离职 1');
  assert(view().indexOf('background:#16A34A') >= 0, '在职点=绿 #16A34A');
  assert(view().indexOf('background:#F97316') >= 0, '待离职点=橙 #F97316');
  assert(view().indexOf('background:#94A3B8') >= 0, '离职点=灰 #94A3B8');

  console.log('== 8. 标签数据保留（编辑弹窗仍可管理标签）==');
  T.openEdit('tD'); // 跨待丁：跨学科 + 待离职
  assert(lastModal && lastModal.title.indexOf('跨待丁') >= 0, '编辑弹窗标题含姓名');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('跨学科') >= 0, '弹窗标签区含「跨学科」');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('待离职') >= 0, '弹窗标签区含「待离职」');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('离职') >= 0, '弹窗标签区含「离职」');

  console.log('== 9. 证书栏容器 + 不截断 ==');
  assert(view().indexOf('class="certs"') >= 0, '证书外裹 .certs 弹性容器');
  assert(view().indexOf('英语教师资格证') >= 0, '长证书名完整显示（未截断）');
  const fStart = view().indexOf('证己');
  const fEnd = view().indexOf('</tr>', fStart);
  const fRow = view().slice(fStart, fEnd);
  const chipCount = (fRow.match(/cert-chip/g) || []).length;
  assert(chipCount === 3, '多证书行渲染 3 个 cert-chip（全部显示）');

  console.log('== 10. 搜索状态文字可用 ==');
  const occ = (view().match(/待离职/g) || []).length;
  assert(occ >= 3, '「待离职」在统计与姓名行中均出现（可搜索命中）');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
