const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../scan.html'), 'utf8');
const start = source.indexOf('  async function runRoboflow(imageDataUrl) {');
const end = source.indexOf("  document.querySelectorAll('.mode-tab')", start);

async function scan(output, localReader) {
  const opened = [];
  const messages = [];
  const button = { disabled: false };
  const context = {
    busy: false, clearTimeout() {}, closeResult() {},
    toast: {}, ocrProgress: { classList: { add() {}, remove() {} } },
    document: { getElementById() { return button; } },
    showToast(message) { messages.push(message); },
    imageToDataUrl: async image => image,
    fetch: async () => ({ ok: true, status: 200, json: async () => output }),
    openResult: async result => opened.push(result),
    console: { error() {} }, Tesseract: localReader
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../transactions.js'), 'utf8'), context);
  vm.runInContext(source.slice(start, end), context);
  await context.runOcr('data:image/png;base64,test');
  assert.strictEqual(context.busy, false);
  assert.strictEqual(button.disabled, false);
  return { opened, messages };
}

(async () => {
  const receipt = {
    name: 'JE\u2022\u2022O D.', number: '+63 979 507 692', amount: '150.00',
    reference_number: '6028 871 884223', date: '2025-05-20', time: '4:01 PM',
    raw_extraction: 'Recipient: Namm', parse_error: false
  };
  let localCalls = 0;
  const reader = { recognize: async () => { localCalls++; throw new Error('Should not run'); } };
  for (const payload of [[receipt], receipt, { outputs: [receipt] }]) {
    const result = await scan(payload, reader);
    assert.strictEqual(result.opened.length, 1);
    assert.strictEqual(result.opened[0].recipient, receipt.name);
    assert.strictEqual(result.opened[0].number, receipt.number);
    assert.strictEqual(result.opened[0].reviewRequired, false);
  }
  const partial = await scan([{ ...receipt, name: '', date: '', parse_error: true }], reader);
  assert.strictEqual(partial.opened.length, 1, 'Incomplete workflow result must open for manual review');
  assert.strictEqual(partial.opened[0].recipient, '');
  assert.strictEqual(partial.opened[0].date, '');
  assert.strictEqual(partial.opened[0].reviewRequired, true);
  assert.strictEqual(localCalls, 1, 'Retry local OCR only when the workflow name is missing');
  const recovered = await scan({ ...receipt, name: '' }, {
    recognize: async () => ({ data: { text: 'GCash\nRecipient Name: JU** CR**\nAmount PHP 999.00' } })
  });
  assert.strictEqual(recovered.opened[0].recipient, 'JU** CR**');
  assert.strictEqual(recovered.opened[0].amount, receipt.amount, 'Name recovery preserves cloud amount');
  assert.strictEqual(recovered.opened[0].number, receipt.number);
  assert.strictEqual(recovered.opened[0].ref, receipt.reference_number);
  assert.strictEqual(recovered.opened[0].reviewRequired, true);
  assert.match(recovered.opened[0].reviewMessage, /local OCR/);
  const unreadable = await scan({ ...receipt, name: '' }, {
    recognize: async () => ({ data: { text: 'GCash\nAmount PHP 150.00' } })
  });
  assert.strictEqual(unreadable.opened[0].recipient, '', 'Do not invent an unreadable name');
  assert.strictEqual(unreadable.opened[0].amount, receipt.amount);
  const fields = {};
  const formContext = {
    document: { getElementById(id) { return fields[id] || (fields[id] = {}); } },
    checkDuplicatePreview() {}
  };
  vm.createContext(formContext);
  const fillStart = source.indexOf('  function fillResultForm(data) {');
  const fillEnd = source.indexOf('  function checkDuplicatePreview()', fillStart);
  vm.runInContext(source.slice(fillStart, fillEnd), formContext);
  formContext.fillResultForm({ recipient: receipt.name, number: receipt.number, amount: receipt.amount,
    ref: receipt.reference_number, date: receipt.date, time: receipt.time, reviewRequired: false });
  assert.strictEqual(fields.resultName.value, receipt.name, 'Preserve Unicode through the review form');
  assert.strictEqual(fields.resultNumber.value, receipt.number);
  assert.strictEqual(fields.resultReviewWarning.hidden, true);
  // Regression: run the reported Roboflow response through the real API adapter,
  // scanner parser, and form assignment, with only the upstream HTTP call mocked.
  const reported = [{
    name: 'PE\u2022\u2022\u2022E Y.', number: '00132229112', amount: '50,000.00',
    reference_number: '0013222911269', date: '2023-11-13', time: '2:19 PM',
    raw_extraction: 'PE...E Y.\n09...6020\nSent via GCash\nAmount 50,000.00\nTotal Amount Sent \u20b150,000.00\nRef No. 0013222911269\nNov 13, 2023 2:19 PM\nproof release today',
    parse_error: false
  }];
  const previousKey = process.env.ROBOFLOW_API_KEY;
  const previousFetch = global.fetch;
  try {
    process.env.ROBOFLOW_API_KEY = 'test-key';
    global.fetch = async () => ({ ok: true, json: async () => reported });
    let responseBody;
    await require('../api/roboflow-workflow')(
      { method: 'POST', body: { image: 'data:image/png;base64,test' } },
      { status(code) { assert.equal(code, 200); return this; }, json(body) { responseBody = body; } }
    );
    const cloudOnly = await scan(responseBody, {
      recognize: async () => { throw new Error('Cloud name should not need local OCR'); }
    });
    formContext.fillResultForm(cloudOnly.opened[0]);
    assert.strictEqual(fields.resultName.value, reported[0].name);
    assert.strictEqual(fields.resultAmount.value, '50000.00');
    assert.strictEqual(fields.resultRef.value, reported[0].reference_number);
    assert.strictEqual(fields.resultReviewWarning.hidden, true);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ROBOFLOW_API_KEY;
    else process.env.ROBOFLOW_API_KEY = previousKey;
  }
  for (const amount of ['1,500.00', 'PHP 1,500.00', '\u20b11,500.00', 1500]) {
    const scanned = await scan([{ ...receipt, amount }], reader);
    formContext.fillResultForm(scanned.opened[0]);
    assert.strictEqual(Number(fields.resultAmount.value), 1500);
    assert.ok(/^\d+(?:\.\d+)?$/.test(fields.resultAmount.value), 'Amount must be valid for the HTML number input');
  }
  formContext.fillResultForm(partial.opened[0]);
  assert.strictEqual(fields.resultName.value, '');
  assert.strictEqual(fields.resultDate.value, '', 'Do not fabricate the transaction date');
  assert.strictEqual(fields.resultReviewWarning.hidden, false);
  const fallback = await scan({ fallback: true }, { recognize: async () => ({ data: { text: 'GCash\nJU** CR**\nAmount PHP 500.00' } }) });
  assert.strictEqual(fallback.opened[0].recipient, 'JU** CR**');
  assert.strictEqual(fallback.opened[0].reviewRequired, true);
  const failed = await scan({ fallback: true }, undefined);
  assert.strictEqual(failed.opened.length, 0);
  assert.ok(failed.messages[0].includes('receipt reader is unavailable'));
  console.log('Scan flow: PASS (structured name, incomplete review, local fallback, unavailable OCR)');
})().catch(error => { console.error(error); process.exitCode = 1; });
