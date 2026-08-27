/* Node 桩测试：核心看板 HR 季度/年度离职率汇总公式
   运行：node test_hr_summary.js
   覆盖：季度/年度离职率不再采用「各月离职率相加」的失真口径，
         改为「期间总离职 ÷（期间末在职 + 期间总离职）」 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = {
  console, setTimeout, clearTimeout, Date, JSON, Object, Array,
  isNaN, parseInt, parseFloat, String,  Number, RegExp, Math
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
// data.js 在加载时注册 window 事件监听（dos:linked-store-updated），需桩
sandbox.addEventListener = function () {};
sandbox.location = { hash: '' };
sandbox.window.addEventListener = sandbox.addEventListener;
sandbox.window.location = sandbox.location;

vm.createContext(sandbox);
for (const f of ['js/baseline.js', 'js/util.js', 'js/store.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
sandbox.App.router = { register: () => {}, navigate: () => {} };
sandbox.App.util.svgIcon = () => '';
sandbox.App.util.judge = () => ({ level: null });
sandbox.App.importer = { metric: () => null };
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/data.js'), 'utf8'), sandbox, { filename: 'js/views/data.js' });

const store = sandbox.App.store;
const D = sandbox.App.views.data;
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

// 构造数据：期初 100 人；4/5/6 月各有离职 5，仅 4 月入职 50
// 说明：若用旧公式「各月离职率相加」≈10.35%；新公式「总离职/(期末在职+总离职)」=10%
store.set('hr', {
  baseHeadcount: 100,
  weekly: {
    '2026-W14': { monthKey: '2026-04', weekLabel: '4月', hireCount: 50, leaveCount: 5 },
    '2026-W18': { monthKey: '2026-05', weekLabel: '5月', hireCount: 0, leaveCount: 5 },
    '2026-W22': { monthKey: '2026-06', weekLabel: '6月', hireCount: 0, leaveCount: 5 }
  }
});

console.log('== 1. 年度汇总（2026）==');
const year = D.calcPeriodSummary('year');
console.log('   totalLeave=' + year.totalLeave + ' rate=' + year.rate);
assert(year.totalLeave === 15, '年度总离职 = 15');
assert(Math.abs(year.rate - 0.1) < 1e-9, '年度离职率 = 10%（新口径，而非旧公式的 ≈10.35%）');

console.log('== 2. 季度汇总（当前 Q3=7/8/9，不含 4-6 月）==');
const q = D.calcPeriodSummary('quarter');
console.log('   totalLeave=' + q.totalLeave + ' rate=' + q.rate);
assert(q.totalLeave === 0, '当前季度不含 4-6 月数据 → 总离职 0');
assert(q.rate === 0, '无离职数据 → 离职率 0%（与月度口径一致，不显示失真值）');

console.log('== 3. 月度汇总（当前月 8 月无离职）==');
const m = D.calcPeriodSummary('month');
assert(m.rate === 0, '当前月无离职 → 离职率 0%');

console  .log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
