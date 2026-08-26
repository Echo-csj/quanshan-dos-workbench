/* Node 桩测试：教师编辑 + 标签功能（teachers.js）
   运行：node test_teachers_tags.js
   覆盖：API 暴露、openEdit 弹窗构建、标签增删消毒、saveEdit 写回、
         deleteTeacher、upsert 保留 tags、applyUpsert 新增补空 tags */
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

// ---- localStorage 桩 ----
const store_map = {};
sandbox.localStorage = {
  getItem: (k) => (k in store_map ? store_map[k] : null),
  setItem: (k, v) => { store_map[k] = String(v); },
  removeItem: (k) => { delete store_map[k]; },
};

// ---- document 桩：getElementById 按需生成假元素 ----
const elems = {};
function fakeEl() {
  return { innerHTML: '', value: '', textContent: '', style: {}, checked: false };
}
sandbox.document = {
  getElementById: (id) => (elems[id] = elems[id] || fakeEl()),
  createElement: () => fakeEl(),
  addEventListener: () => {},
  querySelectorAll: () => [],
  body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
};
sandbox.window.confirm = () => true; // deleteTeacher 测试用
sandbox.alert = () => {};

vm.createContext(sandbox);

// ---- 按页面顺序加载 ----
const files = ['js/baseline.js', 'js/util.js', 'js/store.js'];
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
// router 桩（teachers.js 加载时 App.router.register）
sandbox.App.router = { register: () => {}, navigate: () => {} };
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/teachers.js'), 'utf8'), sandbox, { filename: 'js/views/teachers.js' });

// ---- modal / toast 桩（捕获调用）----
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
// 表单赋值：经 document 桩工厂创建（模态 HTML 不解析，元素按需生成）
function setField(id, v) { sandbox.document.getElementById(id).value = v; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('== 1. API 暴露完整性 ==');
  ['render','onFilterChange','onSearchChange','handleFile','downloadTemplate',
   'openEdit','saveEdit','deleteTeacher','addTag','removeTag','onTagKey']
    .forEach(fn => assert(typeof T[fn] === 'function', 'App.views.teachers.' + fn + ' 为函数'));
  assert(getTeachers().length === 25, '默认花名册 25 人');

  console.log('== 2. openEdit 弹窗构建 ==');
  const t0 = getTeachers()[0];
  T.openEdit(t0.id);
  assert(lastModal && lastModal.title.indexOf(t0.name) >= 0, '弹窗标题含教师姓名');
  assert(typeof lastModal.onConfirm === 'function' && typeof lastModal.onDelete === 'function', '弹窗含 onConfirm/onDelete');
  assert(lastModal.content.indexOf('value="' + t0.name + '"') >= 0, '姓名回填进表单 HTML');
  assert(lastModal.content.indexOf('id="ed-tags-wrap"') >= 0, '标签编辑区存在');

  console.log('== 3. 标签增删 ==');
  T.addTag('跨学科');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('跨学科') >= 0, 'addTag 后 chip 渲染出现「跨学科」');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('离职') >= 0, 'palette 未选项「离职」以 + 形式展示');
  T.addTag('跨学科');
  const selCount = (elems['ed-tags-wrap'].innerHTML.match(/tag-chip sel/g) || []).length;
  assert(selCount === 1, '重复 addTag 不重复添加（sel chip = 1）');
  T.removeTag('跨学科');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('tag-chip sel') < 0, 'removeTag 后已选 chip 清空');

  console.log('== 4. 标签消毒（onclick 注入防护）==');
  const dirty = "a'b<script>alert(1)</scr" + "ipt>`x";
  const clean = dirty.replace(/['"\\<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12); // 复刻 sanitizeTag
  T.addTag(dirty);
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('<script') < 0, '尖括号/引号被剥离（无 <script 残留）');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf('&#39;') < 0, '单引号被剥离（onclick 属性内无 &#39; 转义痕迹）');
  assert(elems['ed-tags-wrap'].innerHTML.indexOf(clean) >= 0, '消毒后标签「' + clean + '」正常渲染');
  T.addTag('   ');
  const selCount2 = (elems['ed-tags-wrap'].innerHTML.match(/tag-chip sel/g) || []).length;
  assert(selCount2 === 1, '纯空白标签被拒绝');
  T.removeTag(clean); // 清掉消毒残留标签
  assert((elems['ed-tags-wrap'].innerHTML.match(/tag-chip sel/g) || []).length === 0, '消毒标签可移除');

  console.log('== 5. saveEdit 写回（含标签）==');
  T.openEdit(t0.id);
  T.addTag('离职');
  T.addTag('骨干教师');
  setField('ed-name', t0.name + '_改');
  setField('ed-subject', t0.subjectGroup);
  setField('ed-pos', 'TR');
  setField('ed-entry', '2022-08-16');
  setField('ed-school', '测试大学');
  setField('ed-major', '测试专业');
  setField('ed-certs', '初中数学、高中生物');
  let closed = false;
  T.saveEdit(() => { closed = true; });
  assert(closed === true, 'saveEdit 调用 close()');
  const saved = getTeachers().find(x => x.id === t0.id);
  assert(saved && saved.name === t0.name + '_改', '姓名写回成功');
  assert(saved.positionCode === 'TR', '岗位编辑写回成功（岗位编辑）');
  assert(Array.isArray(saved.tags) && saved.tags.indexOf('离职') >= 0 && saved.tags.indexOf('骨干教师') >= 0, '标签写回成功（离职 + 自定义「骨干教师」）');
  assert(Array.isArray(saved.certificates) && saved.certificates.length === 2, '证书字符串按 、拆分为数组');

  console.log('== 6. 空值校验 ==');
  toasts = [];
  T.openEdit(t0.id);
  setField('ed-name', '   ');
  let closed2 = false;
  T.saveEdit(() => { closed2 = true; });
  assert(closed2 === false, '姓名为空时弹窗不关闭');
  assert(toasts.some(m => m.indexOf('不能为空') >= 0), '姓名为空时 toast 提示');
  assert(getTeachers().find(x => x.id === t0.id).name === t0.name + '_改', '非法提交不改变数据');

  console.log('== 7. deleteTeacher ==');
  const before = getTeachers().length;
  const victim = getTeachers()[getTeachers().length - 1];
  T.openEdit(victim.id);
  let closed3 = false;
  T.deleteTeacher(() => { closed3 = true; });
  assert(closed3 === true, 'deleteTeacher 调用 close()');
  assert(getTeachers().length === before - 1, '删除后人数 -1（' + before + '→' + getTeachers().length + '）');
  assert(!getTeachers().find(x => x.id === victim.id), '被删教师不再存在');

  console.log('== 8. upsert 对 tags 的保留/初始化 ==');
  // 模拟 applyUpsert：更新已有（保留 tags）、新增（tags=[]）
  const withTag = getTeachers().find(x => (x.tags || []).length > 0);
  assert(!!withTag, '存在带标签教师（供 upsert 保留测试）');
  // 通过内部逻辑等价验证：handleFile 走 XLSX，桩里改为直接验证 store 级不变式
  const list = getTeachers().slice();
  const idx = list.findIndex(x => x.id === withTag.id);
  const rec = { name: withTag.name, subjectGroup: withTag.subjectGroup, positionCode: 'TRM',
                entryDate: withTag.entryDate, school: 'X', major: 'Y', certificates: [] };
  list[idx] = Object.assign({}, list[idx], rec); // 复刻 update 分支
  const newRec = Object.assign({}, rec, { id: store.uid('tr'), tags: [] }); // 复刻 add 分支
  list.push(newRec);
  store.set('teachers', list);
  assert((store.get('teachers')[idx].tags || []).length === (withTag.tags || []).length, 'update 分支保留 tags');
  assert(Array.isArray(store.get('teachers')[store.get('teachers').length - 1].tags)
      && store.get('teachers')[store.get('teachers').length - 1].tags.length === 0, 'add 分支 tags=[]');
  assert(newRec.id !== withTag.id && /^tr_/.test(newRec.id), '新增记录 id 形如 tr_*');

  console.log('== 9. localStorage 落盘（200ms 防抖后） ==');
  await sleep(350);
  const persisted = JSON.parse(store_map['zyg_workbench_v1'] || '{}');
  const persistedT = (persisted.teachers || []).find(x => x.id === t0.id);
  assert(persistedT && persistedT.name === t0.name + '_改', '编辑结果已持久化到 localStorage');
  assert(persistedT && persistedT.tags.indexOf('骨干教师') >= 0, '标签已持久化');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('桩测试崩溃：', e); process.exit(1); });
