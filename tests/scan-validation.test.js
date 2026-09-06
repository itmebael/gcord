const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../scan.html'), 'utf8');
const messages = [];
const context = { document: { createElement: () => ({ style: {} }) }, showToast: message => messages.push(message) };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../transactions.js'), 'utf8'), context);
vm.runInContext(source.slice(source.indexOf('  function validatePayload('), source.indexOf('  async function savePayload(')), context);

const values = { recipient: 'JE\u2022\u2022O D.', claimant: 'Test Customer', number: '+63 979 507 692',
  amount: '150.00', ref: '6028 871 884223', date: '2025-05-20', time: '4:01 PM' };
const fields = Object.entries(values).map(([name, value]) => {
  const attributes = {};
  const input = { name, value, id: name, focus() { this.focused = true; },
    setAttribute(key, value) { attributes[key] = value; }, getAttribute(key) { return attributes[key]; } };
  return { input, classList: { toggle() {} },
    querySelector(selector) { return selector === 'input' ? input : this.error; },
    appendChild(error) { this.error = error; } };
});
const form = { querySelectorAll: () => fields };
const byName = name => fields.find(field => field.input.name === name);
assert.strictEqual(context.validatePayload(values, form), false);
assert.ok(byName('number').input.focused);
assert.ok(byName('number').error.textContent.includes('9 digits after +63; it needs 10'));
assert.strictEqual(byName('number').input.value, '+63979507692');
assert.strictEqual(values.number, '+63979507692');
for (const number of ['+63 979 507 6921', '09795076921', '9795076921', '0979 507 6921', '+63\u00a0979\u00a0507\u00a06921']) {
  byName('number').input.value = number;
  assert.strictEqual(context.validatePayload(values, form), true, 'Accept complete formatted numbers');
  assert.strictEqual(byName('number').error.hidden, true);
  assert.strictEqual(byName('number').input.value, '09795076921');
  assert.strictEqual(values.number, '09795076921', 'Save the normalized value');
}
byName('claimant').input.value = '';
assert.strictEqual(context.validatePayload(values, form), false);
assert.strictEqual(messages.at(-1), 'Enter Claimed by (customer name).');
byName('claimant').input.value = 'Test Customer';
byName('ref').input.value = '123';
assert.strictEqual(context.validatePayload(values, form), false);
assert.ok(messages.at(-1).includes('Reference Number'));
byName('ref').input.value = values.ref;
byName('amount').input.value = '0';
assert.strictEqual(context.validatePayload(values, form), false);
assert.strictEqual(messages.at(-1), 'Amount must be greater than zero.');
console.log('Scan validation: PASS (filled invalid phone, formatted numbers, claimant, reference, amount)');
