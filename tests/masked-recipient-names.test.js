const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'transactions.js'), 'utf8');
const context = {
  console,
  window: {},
  document: { querySelectorAll() { return []; }, addEventListener() {}, createElement() { return { getContext() { return { drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(90 * 160 * 4) }; } }; } }; } },
  performance: { now: () => 0 },
  setInterval() {},
  clearInterval() {},
  URL: { createObjectURL() { return 'blob:test'; } },
  Image: class {},
  FormData: class {},
  navigator: { mediaDevices: {} }
};
context.window = context;
context.global = context;

vm.runInNewContext(source, context);

const cases = [
  'A. Dela Cruz',
  'J. Dela Cruz',
  'A. Dela* Cruz',
  'J.* Dela Cruz',
  'A. * Dela Cruz',
  'J. Dela Cruz 09*********',
  'A. Dela Cruz 09171234567'
];

for (const text of cases) {
  const parsed = context.GcordTransactions.parseGCashText(
    'GCash\nAmount PHP 500.00\nReference No. 1234567890123\nSep 5, 2026\n10:30 AM\n' + text + '\n09171234567'
  );
  assert.ok(parsed.recipient && parsed.recipient.length > 0, 'Recipient should be readable for masked name: ' + text);
  console.log('masked-recipient-names test: PASS -> ' + text + ' => ' + parsed.recipient);
}

const receipt = {
  name: 'JE\u2022\u2022O D.', number: '+63 979 507 692', amount: '150.00',
  reference_number: '6028 871 884223', date: '2025-05-20', time: '4:01 PM',
  raw_extraction: 'Recipient: Namm\nAmount PHP 999.00', parse_error: false
};
for (const payload of [[receipt], receipt, { outputs: [receipt] }, { outputs: receipt }]) {
  const parsed = context.GcordTransactions.parseRoboflowResult(payload);
  assert.strictEqual(parsed.recipient, receipt.name);
  assert.strictEqual(parsed.number, receipt.number);
  assert.strictEqual(parsed.amount, '150.00');
  assert.strictEqual(parsed.ref, receipt.reference_number);
  assert.strictEqual(parsed.date, '2025-05-20');
  assert.strictEqual(parsed.time, '4:01 PM');
  assert.strictEqual(parsed.reviewRequired, false);
}
const incomplete = context.GcordTransactions.parseRoboflowResult([{ ...receipt, name: '', parse_error: true }]);
assert.strictEqual(incomplete.recipient, '', 'Never populate the name from raw OCR artifacts');
assert.strictEqual(incomplete.reviewRequired, true);
assert.strictEqual(context.GcordTransactions.parseRoboflowResult([{ ...receipt, date: '' }]).reviewRequired, true);
for (const empty of [[], null, {}, { fallback: true }, { outputs: [] }]) {
  assert.strictEqual(context.GcordTransactions.parseRoboflowResult(empty), null);
}
console.log('Structured workflow fields, response formats, Unicode, manual review: PASS');
for (const [amount, expected] of [[150, '150'], [150.5, '150.5'], ['150.00', '150.00'],
  ['PHP 1,500.00', '1500.00'], ['\u20b1150.00', '150.00'], ['1,500.00', '1500.00'],
  [' PHP\u00a0150.00 ', '150.00'], ['', ''], [null, ''], ['1,50.00', ''],
  ['150.00 10.00', ''], [0, ''], [-150, ''], ['not read', '']]) {
  const parsed = context.GcordTransactions.parseRoboflowResult([{ ...receipt, amount }]);
  assert.strictEqual(parsed.amount, expected, 'Normalize structured amount: ' + amount);
  assert.strictEqual(parsed.reviewRequired, !expected);
}
console.log('Workflow amount formats: PASS');
