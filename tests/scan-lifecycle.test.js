const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('scan.html', 'utf8');
const noop = () => {};
const classes = {add: noop, remove: noop};
let writes = 0, duplicate = false;
const context = {
  dupBanner: {dataset: {}, classList: classes}, resultBackdrop: {classList: classes, setAttribute: noop},
  duplicateDialog: {querySelector: () => ({})}, reviewAfterDuplicate: false,
  fillResultForm: async () => duplicate,
  GcordAPI: {client: () => ({rpc: () => {writes++;}})}
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  async function openResult('), source.indexOf('  function readPayloadFromForm(')), context);

(async () => {
  let discarded = 0;
  Object.assign(context, {
    savePayload: {}, preview: {removeAttribute: noop, style: {}}, showToast: noop, startCamera: noop,
    document: {getElementById: id => id === 'resultForm' ? {reset: () => discarded++} : {classList: {contains: () => true}}}
  });
  vm.runInContext(source.slice(source.indexOf('  function cancelResult()'), source.indexOf("  document.getElementById('cancelResultBtn').addEventListener")), context);
  for (duplicate of [false, true, true]) {
    await context.openResult({ref: '1234567890123', recipient: 'Owner', number: '09123456789', amount: '100', date: '2026-09-22', time: '10:00 AM', reviewRequired: false});
    context.cancelResult();
  }
  assert.equal(discarded, 3, 'Cancel discards the form even for a successfully read receipt');
  assert.equal(writes, 0, 'Opening and cancelling normal or duplicate previews must never write');
  let release;
  Object.assign(context, {
    showToast: noop, setTimeout: noop,
    GcordAPI: {getCurrentUser: () => ({id: 7})},
    GcordTransactions: {addTransaction: async payload => {
      writes++;
      assert.equal(payload.claimant_name, 'Cash Customer');
      await new Promise(resolve => {release = resolve;});
      return {isDuplicate: false};
    }}
  });
  vm.runInContext(source.slice(source.indexOf('  async function savePayload('), source.indexOf('  function showCaptured(')), context);
  const saving = context.savePayload({claimant: 'Cash Customer'}, 'scan');
  await context.savePayload({claimant: 'Cash Customer'}, 'scan');
  release();
  await saving;
  assert.equal(writes, 1, 'Two cancelled previews followed by a save (including double click) create one record');

  let tick, now = 0, calls = 0;
  const pending = [], timers = new Map();
  let timerId = 0;
  const pixels = new Uint8ClampedArray(90 * 160 * 4);
  for (let i = 0; i < 90 * 160; i++) {
    const value = (i + Math.floor(i / 90)) % 2 ? 200 : 70;
    pixels.set([value, value, value, 255], i * 4);
  }
  const draw = {drawImage: noop, getImageData: () => ({data: pixels})};
  const scanner = {
    document: {hidden: false, addEventListener: noop, createElement: () => ({getContext: () => draw, toDataURL: () => 'image'})},
    performance: {now: () => now},
    setInterval: fn => {tick = fn; return 1;}, clearInterval: noop,
    setTimeout: fn => {timers.set(++timerId, fn); return timerId;}, clearTimeout: id => timers.delete(id),
    Tesseract: {recognize: () => {calls++; return new Promise(resolve => pending.push(resolve));}},
    isAutoCaptureReceipt: () => false
  };
  scanner.window = scanner;
  vm.createContext(scanner);
  vm.runInContext(fs.readFileSync('scanner-auto-capture.js', 'utf8'), scanner);
  const controller = scanner.createScannerAutoCapture(
    {clientWidth: 90, clientHeight: 160, videoWidth: 90, videoHeight: 160, readyState: 2},
    {classList: classes}, {}, {checked: true, addEventListener: noop}, noop, () => true);
  function advance() {for (let i = 0; i < 8; i++) {now += 250; tick();}}
  controller.start(); advance();
  assert.equal(calls, 1);
  controller.stop(); controller.start(); advance();
  assert.equal(calls, 2, 'Restart retries detection even when previous OCR never completed');
  pending[0]({data: {}});
  await new Promise(setImmediate);
  advance();
  assert.equal(calls, 2, 'Old OCR completion cannot clear the new inspection lock');
  for (const timeout of [...timers.values()]) timeout();
  await new Promise(setImmediate);
  now += 3500; advance();
  assert.equal(calls, 3, 'Timed out detection can retry');
  controller.stop();
  console.log('Scan lifecycle: cancellation, explicit save, double submission, OCR restart and timeout PASS');
})().catch(error => {console.error(error); process.exitCode = 1;});
