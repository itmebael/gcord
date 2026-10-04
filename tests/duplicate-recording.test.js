const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const api = fs.readFileSync('supabase-api.js', 'utf8');
  let reply = {data: 51}, calls = 0;
  const context = {
    requireClient: () => ({rpc: async (name, args) => {
      assert.equal(name, 'app_record_duplicate_scan');
      assert.equal(args.p_ref, '1234567890123');
      return reply;
    }}),
    requireActiveSession: async () => ({id: 7}),
    normalizeRef: ref => ref.replace(/\D/g, '')
  };
  vm.createContext(context);
  vm.runInContext(api.slice(api.indexOf('  async function recordDuplicateScan('), api.indexOf('  async function addTransaction(')), context);
  assert.equal((await context.recordDuplicateScan('REF 1234567890123')).transactionId, 51);
  reply = {error: {code: 'PGRST202'}};
  await assert.rejects(context.recordDuplicateScan('1234567890123'), /record_duplicate_scan.sql/);
  reply = {error: {message: 'Please sign in again.'}};
  await assert.rejects(context.recordDuplicateScan('1234567890123'), error => /sign in again/.test(error.message));

  const buttons = [{disabled: false}, {disabled: false}];
  const message = {};
  let release;
  Object.assign(context, {
    duplicateRecording: false,
    duplicateDialog: {
      dataset: {ref: '1234567890123', recorded: 'false'},
      querySelectorAll: () => buttons,
      querySelector: selector => selector.includes('record') ? buttons[0] : message
    },
    GcordAPI: {recordDuplicateScan: async () => {
      calls++;
      await new Promise(resolve => {release = resolve;});
    }}
  });
  const scan = fs.readFileSync('scan.html', 'utf8');
  vm.runInContext(scan.slice(scan.indexOf('  async function recordBlockedDuplicate('), scan.indexOf("  duplicateDialog.addEventListener('close'")), context);
  const saving = context.recordBlockedDuplicate();
  await context.recordBlockedDuplicate();
  assert(buttons.every(button => button.disabled));
  release();
  await saving;
  await context.recordBlockedDuplicate();
  assert.equal(calls, 1, 'Repeated clicks save one blocked attempt');
  assert.equal(context.duplicateDialog.dataset.recorded, 'true');
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].disabled, false);
  context.duplicateDialog.dataset.recorded = 'false';
  context.GcordAPI.recordDuplicateScan = async () => {throw new Error('Database unavailable');};
  await context.recordBlockedDuplicate();
  assert.equal(context.duplicateDialog.dataset.recorded, 'false');
  assert.equal(buttons[0].disabled, false, 'Failed saves allow retry');
  assert.match(message.textContent, /Database unavailable/);
  console.log('Explicit duplicate recording, errors and repeated clicks PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});
