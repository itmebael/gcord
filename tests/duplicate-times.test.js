const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const timestamps = ['2026-09-16T13:26:00', '2026-09-16 13:26:00',
  '2026-09-16T13:26:00Z', '2026-09-16T21:26:00+08:00', '2026-09-16T16:01:00', null, 'invalid'];
let fallback = false;
const transaction = { id: 1, ref_no: '123456789', status: 'duplicate',
  txn_date: '2026-09-01', txn_time: '10:15:00', created_at: timestamps[0] };
const context = {
  Date, Intl, supabase: {}, GCORD_SUPABASE: {},
  localStorage: { getItem: () => JSON.stringify({ id: 1, role: 'admin' }) },
  __gcordSb: { from(table) {
    return {
      select() { return this; }, order() { return this; }, in() { return this; },
      then(resolve) {
        return Promise.resolve(table === 'duplicate_events'
          ? (fallback ? { error: new Error('Unavailable') } : { data: timestamps.map((detected_at, id) => ({
            id, detected_at, original_transaction_id: 1, duplicate_transaction_id: 1
          })) }) : { data: [transaction] }).then(resolve);
      }
    };
  } }
};
context.window = context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../supabase-api.js'), 'utf8'), context);
const originalTZ = process.env.TZ;
(async () => {
  try {
    for (const zone of ['UTC', 'Asia/Manila', 'America/New_York']) {
      process.env.TZ = zone;
      fallback = false;
      const rows = await context.GcordAPI.listDuplicateEvents();
      for (const row of rows.slice(0, 4)) {
        assert.equal(row.detectedAt, 'Sep 16, 2026 • 9:26 PM PHT');
        assert.equal(row.origDate, 'Sep 1, 2026 • 10:15 AM');
        assert.equal(row.matchDate, row.origDate);
      }
      assert.equal(rows[4].detectedAt, 'Sep 17, 2026 • 12:01 AM PHT');
      assert.equal(rows[5].detectedAt, '—');
      assert.equal(rows[6].detectedAt, '—');
      fallback = true;
      const backup = await context.GcordAPI.listDuplicateEvents();
      assert.equal(backup[0].detectedAt, rows[0].detectedAt);
      assert.equal(backup[0].matchDate, rows[0].matchDate);
    }
    console.log('Duplicate timestamps, day rollover, receipt times, and fallback: PASS');
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
