const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { Intl, Date };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../supabase-api.js'), 'utf8'), context);
const page = fs.readFileSync(path.join(__dirname, '../system-logs.html'), 'utf8');
const mapLog = page.slice(page.indexOf('  function mapLog(row)'), page.indexOf('  function rebuildDateIndex()'));
vm.runInContext("var ICONS = { info: { cls: 'login', svg: '' } };" + mapLog, context);

const originalTZ = process.env.TZ;
try {
  for (const zone of ['UTC', 'Asia/Manila', 'America/New_York']) {
    process.env.TZ = zone;
    for (const timestamp of ['2026-09-16T13:26:00', '2026-09-16 13:26:00',
      '2026-09-16T13:26:00Z', '2026-09-16T21:26:00+08:00']) {
      const log = context.mapLog({ created_at: timestamp });
      assert.equal(log.timeLabel, '09/16/2026, 9:26 PM PHT', zone);
      assert.equal(log.date, '2026-09-16', zone);
    }
    const midnight = context.mapLog({ created_at: '2026-09-16T16:01:00' });
    assert.equal(midnight.timeLabel, '09/17/2026, 12:01 AM PHT', zone);
    assert.equal(midnight.date, '2026-09-17', zone);
    assert.equal(context.mapLog({ created_at: 'invalid' }).timeLabel, 'invalid');
  }
} finally {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
}
console.log('System log Philippine timestamps and calendar dates: PASS');
