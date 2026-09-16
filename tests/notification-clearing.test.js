const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = new Map();
storage.set('gcord_session', JSON.stringify({ id: 1, role: 'admin' }));
let notifications = [{ id: 10, user_id: 1 }, { id: 20, user_id: 2 }];
const logs = [{ id: 1, created_at: '2020-01-01T00:00:00Z' }];
let failDelete = false;
const source = fs.readFileSync(path.join(__dirname, '../supabase-api.js'), 'utf8');
function load() {
  const context = {
    Date, Intl, supabase: {}, GCORD_SUPABASE: {},
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    __gcordSb: { from(table) {
      let deleting = false;
      const filters = [];
      return {
        select() { return this; }, order() { return this; }, limit() { return this; },
        delete() { deleting = true; return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        then(resolve) {
          if (deleting && failDelete) return Promise.resolve({ error: new Error('Delete failed') }).then(resolve);
          const matches = row => filters.every(filter => filter(row));
          const data = (table === 'notifications' ? notifications : logs).filter(matches);
          if (deleting) notifications = notifications.filter(row => !matches(row));
          return Promise.resolve({ data }).then(resolve);
        }
      };
    } }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.GcordAPI;
}

(async () => {
  let api = load();
  await api.clearNotifications();
  assert.deepEqual(notifications.map(row => row.id), [20], 'Only current user notifications deleted');
  api = load();
  assert.equal((await api.listNotifications({ adminFeed: true })).length, 0, 'Old logs stay dismissed after reload');
  logs.push({ id: 2, created_at: new Date(Date.now() + 1000).toISOString() });
  assert.equal((await api.listNotifications({ adminFeed: true }))[0].id, 'log-2', 'New activity remains visible');
  await api.removeNotification('log-2');
  assert.equal((await load().listNotifications({ adminFeed: true })).length, 0, 'Individual log dismissal persists');
  assert.equal(logs.length, 2, 'Audit trail is preserved');
  const saved = storage.get('gcord_log_dismissals_1');
  failDelete = true;
  await assert.rejects(api.clearNotifications(), /Delete failed/);
  assert.equal(storage.get('gcord_log_dismissals_1'), saved, 'Failed deletion does not advance dismissal cutoff');
  storage.set('gcord_session', JSON.stringify({ id: 3, role: 'admin' }));
  assert.equal((await load().listNotifications({ adminFeed: true })).length, 2, 'Dismissals are scoped to the account');
  console.log('Notification clearing, reload persistence, new activity, and account isolation: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
