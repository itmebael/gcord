const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-16T16:30:00Z'])); }
}
function element() {
  return { children: [], style: {}, textContent: '', replaceChildren() { this.children = []; },
    append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); },
    setAttribute() {}, addEventListener(type, fn) { this[type] = fn; } };
}
const elements = new Map();
const fixtures = [
  { id: 1, created_at: '2026-09-16T15:59:59Z', txn_date: '2026-09-17', created_by_user_id: 7, status: 'verified' },
  { id: 2, created_at: '2026-09-16T16:00:00', txn_date: '2026-01-01', created_by_user_id: 7, status: 'verified' },
  { id: 3, created_at: '2026-09-17T15:59:59.999Z', txn_date: '2026-01-01', created_by_user_id: 7, status: 'duplicate' },
  { id: 4, created_at: '2026-09-17T16:00:00Z', txn_date: '2026-09-17', created_by_user_id: 7, status: 'verified' },
  { id: 5, created_at: '2026-09-16T16:00:00Z', txn_date: '2026-09-17', created_by_user_id: 8, status: 'verified' }
];
const results = [];
const context = {
  Date: Clock, Intl, Event: class { constructor(type) { this.type = type; } },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  document: { createElement: element, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } },
  dispatchEvent(event) { if (event.type === 'staff-report-data') results.push(event.detail); },
  localStorage: { getItem: () => JSON.stringify({ id: 7, role: 'staff' }) },
  supabase: {}, GCORD_SUPABASE: {},
  __gcordSb: {
    rpc: async () => ({ data: 7 }),
    from() {
      const filters = [];
      return {
        select(columns) { assert(columns.includes('created_at')); return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        gte(key, value) { assert.equal(key, 'created_at'); filters.push(row => context.GcordAPI.parseDatabaseTimestamp(row[key]) >= new Date(value)); return this; },
        lt(key, value) { assert.equal(key, 'created_at'); filters.push(row => context.GcordAPI.parseDatabaseTimestamp(row[key]) < new Date(value)); return this; },
        order() { return this; },
        async range(start, end) { return { data: fixtures.filter(row => filters.every(fn => fn(row))).slice(start, end + 1) }; }
      };
    }
  }
};
context.window = context;
vm.createContext(context);
for (const file of ['supabase-api.js', 'report-trend.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
(async () => {
  const trend = context.GcordReportTrend;
  await trend.load('Today');
  let report = results.at(-1);
  assert.equal(report.dates.start, '2026-09-17', 'Today follows Manila even while UTC is September 16');
  assert.deepEqual(Array.from(report.rows, row => row.id), [2, 3], 'Includes entire Manila day, ignores receipt dates and other users');
  assert.match(elements.get('trendStatus').textContent, /2 transactions.*1 verified.*1 duplicate/);
  assert.equal(elements.get('trendDays').children.length, 1);
  await trend.load('Last 7 Days');
  assert.equal(results.at(-1).dates.start, '2026-09-11');
  assert.equal(elements.get('trendDays').children.length, 7);
  await trend.load('This Month');
  assert.equal(results.at(-1).dates.start, '2026-09-01');
  await trend.load('Custom', { from: '2026-09-16', to: '2026-09-16' });
  assert.deepEqual(Array.from(results.at(-1).rows, row => row.id), [1]);
  elements.get('refreshTrend').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(results.at(-1).dates.end, '2026-09-16', 'Refresh retains custom dates');
  await trend.load('Custom', { from: '2026-01-01', to: '2026-01-01' });
  assert.equal(results.at(-1).rows.length, 0);
  console.log('Report filters: Manila day boundaries, presets, custom dates, refresh, chart counts, and user isolation PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
