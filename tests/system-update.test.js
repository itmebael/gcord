const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rows = Array.from({length: 1201}, (_, i) => ({id: i + 1, ref_no: '0012345678901', recipient_name: 'Owner', claimant_name: 'Customer', recipient_number: '09123456789', amount: 100, status: i % 2 ? 'duplicate' : 'verified', created_at: '2026-08-15T00:00:00Z', txn_date: '2026-09-10', created_by_user_id: 7}));
rows.push({...rows[0], id: 1202, created_at: '2026-08-31T16:00:00Z', txn_date: '2026-08-31'});
rows.push({...rows[0], id: 1203, created_at: '2026-07-31T16:00:00Z'});
let session = {id: 7, role: 'super_admin', session_token: 'test'};
const context = {Intl, Date, TextEncoder, URLSearchParams, supabase: {}, GCORD_SUPABASE: {}, localStorage: {getItem: () => JSON.stringify(session)}, document: {querySelector: () => ({addEventListener() {}})}, location: {search: ''}};
context.window = context;
context.__gcordSb = {rpc: async () => ({data: 7}), from(table) {
  const filters = [];
  return {select() {return this;}, order() {return this;},
    eq(k, v) {filters.push(r => r[k] === v); return this;},
    gte(k, v) {filters.push(r => Date.parse(r[k]) >= Date.parse(v + (v.endsWith('Z') ? '' : 'Z'))); return this;},
    lt(k, v) {filters.push(r => Date.parse(r[k]) < Date.parse(v + (v.endsWith('Z') ? '' : 'Z'))); return this;},
    async range(a, b) {return {data: rows.filter(r => filters.every(f => f(r))).slice(a, b + 1)};},
    then(resolve) {resolve({data: table === 'users' ? [] : rows});}
  };
}};
vm.createContext(context);
for (const file of ['supabase-api.js', 'spreadsheet-export.js', 'verified-auth.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
(async () => {
  const all = await context.GcordAPI.getTransactionStats({all: true});
  const report = await context.GcordAPI.getAdminReport({type: 'all'});
  assert.equal(all.total, 1203);
  assert.equal(report.total, all.total);
  assert.equal(report.verified, all.verified);
  assert.equal(report.duplicate, all.duplicate);
  const august = await context.GcordAPI.getAdminReport({fromDate: '2026-08-01', toDate: '2026-08-31', useRecordedDate: true});
  assert.equal(august.total, 1202);
  assert(!august.transactions.some(r => r.id === '1202'), 'September PHT record excluded despite August receipt date');
  assert(august.transactions.some(r => r.id === '1203'), 'Start boundary included');
  assert.equal(august.transactions[0].recipient, 'Owner');
  assert.equal(august.transactions[0].claimant, 'Customer');
  const workbook = context.GcordSpreadsheet([['0012345678901', '09123456789', '=1+1', 'A&B <C>', 100]]);
  assert.equal(Buffer.from(workbook).readUInt32LE(0), 0x04034b50);
  const xml = Buffer.from(workbook).toString('utf8');
  assert(xml.includes('t="inlineStr"><is><t xml:space="preserve">0012345678901</t>'));
  assert(xml.includes('t="inlineStr"><is><t xml:space="preserve">=1+1</t>'));
  assert(xml.includes('A&amp;B &lt;C&gt;'));
  assert(xml.includes('<v>100</v>'));
  context.GcordIdentity.checkPassword('Strong@Test1234');
  assert.throws(() => context.GcordIdentity.checkPassword('weak'));
  assert.throws(() => context.GcordIdentity.checkPassword('A1!' + 'é'.repeat(35)));
  console.log('System update: complete pagination, consistent counts, Manila date boundaries, claimant separation, spreadsheet text cells, password validation PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});
