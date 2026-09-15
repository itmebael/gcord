const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const now = Date.parse('2026-09-15T16:05:00Z'); // September 16 in Manila.
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const timestamps = ['2026-09-15T16:01:00', '2026-09-15T16:01:00Z',
  '2026-09-16T00:01:00+08:00', '2026-09-15T15:59:00',
  '2026-09-13T00:00:00', null, 'invalid'];
let feed = 'notifications';
const context = {
  Date: Clock, Intl,
  localStorage: { getItem: () => JSON.stringify({ id: 1, role: 'admin' }) },
  supabase: {}, GCORD_SUPABASE: {},
  __gcordSb: { from(table) {
    const query = {
      select() { return this; }, order() { return this; },
      limit() { return this; }, eq() { return this; },
      then(resolve) { return Promise.resolve({ data: table === feed
        ? timestamps.map((created_at, id) => ({ id, created_at })) : [] }).then(resolve); }
    };
    return query;
  } }
};
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../supabase-api.js'), 'utf8'), context);
(async () => {
  for (feed of ['notifications', 'system_logs']) {
    const rows = await context.GcordAPI.listNotifications({ adminFeed: true });
    assert.equal(rows.length, timestamps.length);
    for (const row of rows.slice(0, 3)) {
      assert.match(row.timeLabel, /12:01\s*AM/i);
      assert.match(row.dateTimeLabel, /Sep 16, 2026/);
      assert.match(row.dateTimeLabel, /PHT$/);
      assert.equal(row.dayKey, 'today');
      assert.equal(row.dateTimeLabel, rows[0].dateTimeLabel);
    }
    assert.equal(rows[3].dayKey, 'yesterday');
    assert.equal(rows[4].dayKey, 'older');
    for (const row of rows.slice(5)) {
      assert.equal(row.dayKey, 'older');
      assert.equal(row.dateTimeLabel, '—');
    }
  }
  console.log('Notification timestamps and Manila day boundaries: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
