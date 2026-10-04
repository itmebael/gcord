const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async function () {
  let created = 0, active = 0, maximum = 0, terminated = 0, fail = false;
  const context = {
    setTimeout, clearTimeout,
    Tesseract: {createWorker: async () => {
      created++;
      return {
        recognize: async image => {
          active++; maximum = Math.max(maximum, active);
          await new Promise(setImmediate);
          active--;
          if (fail) { fail = false; throw new Error('Worker failed'); }
          return {data: {text: image}};
        },
        terminate: async () => { terminated++; }
      };
    }}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('scanner-ocr.js', 'utf8'), context);
  const reader = context.GcordScannerOCR;
  await reader.prepare();
  const results = await Promise.all([reader.recognize('first'), reader.recognize('second')]);
  assert.equal(created, 1, 'Preloaded worker is reused across scans');
  assert.equal(maximum, 1, 'Camera and manual jobs do not run concurrently');
  assert.equal(results[1].data.text, 'second');
  fail = true;
  await assert.rejects(reader.recognize('failed'), /Worker failed/);
  await reader.recognize('retry');
  assert.equal(created, 2, 'Failed worker is replaced for the next scan');
  assert.equal(terminated, 1, 'Failed worker is released');
  console.log('Scanner OCR: warm worker reuse, serialized jobs and failure recovery PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
