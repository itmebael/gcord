const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('supabase-api.js', 'utf8');
async function lookup(rpcAvailable, detailsAvailable) {
  const saved = {id: 42, claimant_name: 'Cash Customer', claimed_at: null, created_at: '2026-09-22T02:00:00Z'};
  const sb = {
    rpc: async name => name === 'app_find_transaction_by_ref' && rpcAvailable
      ? {data: [{id: 42}]} : {error: {message: 'Unavailable'}},
    from: () => ({select() {return this;}, eq() {return this;}, order() {return this;},
      limit: async () => ({data: [saved]}),
      maybeSingle: async () => detailsAvailable ? {data: saved} : {error: {message: 'Access denied'}}})
  };
  const context = {requireClient: () => sb, normalizeRef: value => value};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function findTransactionByRef('), source.indexOf('  async function addTransaction(')), context);
  return context.findTransactionByRef('1234567890123');
}
(async () => {
  for (const code of ['42703', 'PGRST204']) {
    const selections = [];
    const sb = {
      rpc: async () => ({error: {code: 'PGRST202', message: 'Function not found'}}),
      from: () => ({select(columns) {selections.push(columns); this.columns = columns; return this;},
        eq() {return this;}, order() {return this;},
        async limit() {
          return /claimant_name|claimed_at/.test(this.columns)
            ? {error: {code, message: 'Column not found'}}
            : {data: [{id: 42, created_at: '2026-09-22T02:00:00Z'}]};
        }})
    };
    const legacy = {requireClient: () => sb, normalizeRef: value => value};
    vm.createContext(legacy);
    vm.runInContext(source.slice(source.indexOf('  async function findTransactionByRef('), source.indexOf('  async function addTransaction(')), legacy);
    const result = await legacy.findTransactionByRef('1234567890123');
    assert.equal(result.id, 42);
    assert.equal(result.claimed_by_name, null);
    assert.equal(result.claimed_at, '2026-09-22T02:00:00Z');
    assert.equal(selections.length, 3);
    sb.from = () => ({select() {return this;}, eq() {return this;}, order() {return this;},
      limit: async () => ({error: {code: '42501', message: 'Access denied'}})});
    await assert.rejects(legacy.findTransactionByRef('1234567890123'), error => error.code === '42501');
  }
  for (const rpc of [true, false]) {
    const result = await lookup(rpc, true);
    assert.equal(result.claimed_by_name, 'Cash Customer');
    assert.equal(result.claimed_at, '2026-09-22T02:00:00Z');
  }
  const restricted = await lookup(true, false);
  assert.equal(restricted.claimed_by_name, undefined, 'Unavailable protected details must not fabricate a claimant');
  const scan = fs.readFileSync('scan.html', 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(scan.slice(scan.indexOf('  function claimMessage('), scan.indexOf('  var duplicateDialog')), context);
  assert(context.claimMessage({claimant_name: 'Cash Customer'}).includes('Cash Customer'));
  assert(context.claimMessage({}).includes('Claimant not recorded'));
  assert(context.claimMessage({}).includes('cannot be claimed again'));
  console.log('Duplicate claimant lookup and legacy timestamps PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});
