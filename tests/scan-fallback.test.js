const assert = require('assert');
const handler = require('../api/roboflow-workflow');

(async () => {
  const previous = process.env.ROBOFLOW_API_KEY;
  const previousFetch = global.fetch;
  delete process.env.ROBOFLOW_API_KEY;

  let statusCode = 0;
  let body = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    }
  };

  try {
    await handler({ method: 'POST', body: JSON.stringify({ image: 'data:image/jpeg;base64,abcd' }) }, response);
    assert.strictEqual(statusCode, 200, 'Expected Roboflow fallback route to keep the scan flow alive without a key');
    assert.strictEqual(body && body.fallback, true, 'Expected fallback flag to allow Tesseract OCR to continue');
    process.env.ROBOFLOW_API_KEY = 'test-key';
    let expectedImage = { type: 'base64', value: 'abcd' };
    const receipt = { name: 'JE\u2022\u2022O D.', number: '+63 979 507 692', amount: '150.00',
      reference_number: '6028 871 884223', date: '2025-05-20', time: '4:01 PM',
      raw_extraction: 'Namm', parse_error: false };
    let upstream = { outputs: [receipt] };
    let upstreamStatus = 200;
    global.fetch = async function (url, options) {
      assert.strictEqual(url, process.env.ROBOFLOW_WORKFLOW_URL || 'https://serverless.roboflow.com/bael/workflows/custom-workflow-5');
      assert.strictEqual(options.headers.Authorization, 'Bearer test-key');
      assert.deepStrictEqual(JSON.parse(options.body), { inputs: { image: expectedImage } });
      return { status: upstreamStatus, ok: upstreamStatus === 200, json: async () => upstream };
    };
    await handler({ method: 'POST', body: { image: 'data:image/jpeg;base64,abcd' } }, response);
    assert.deepStrictEqual(body, receipt);
    expectedImage = { type: 'url', value: 'https://example.com/receipt.png?signature=sample' };
    await handler({ method: 'POST', body: { imageUrl: expectedImage.value } }, response);
    assert.strictEqual(statusCode, 200);
    await handler({ method: 'POST', body: { image: expectedImage.value } }, response);
    assert.strictEqual(statusCode, 200);
    for (const format of [[receipt], receipt, { outputs: [receipt] }]) {
      upstream = format;
      await handler({ method: 'POST', body: { imageUrl: expectedImage.value } }, response);
      assert.deepStrictEqual(body, receipt);
    }
    upstream = [{ name: null, parse_error: null }];
    await handler({ method: 'POST', body: { imageUrl: expectedImage.value } }, response);
    assert.deepStrictEqual(body, { name: '', number: '', amount: '', reference_number: '', date: '', time: '', raw_extraction: '', parse_error: true });
    upstream = [];
    await handler({ method: 'POST', body: { imageUrl: expectedImage.value } }, response);
    assert.strictEqual(statusCode, 502);
    assert.strictEqual(body.error, 'The Workflow returned no data.');
    upstreamStatus = 401;
    upstream = { message: 'Unauthorized' };
    await handler({ method: 'POST', body: { imageUrl: expectedImage.value } }, response);
    assert.strictEqual(statusCode, 401);
    assert.ok(body.error.includes('Receipt extraction failed'));
    await handler({ method: 'POST', body: { image: 'file:///receipt.png' } }, response);
    assert.strictEqual(statusCode, 400);
    console.log('scan-fallback test: PASS');
  } catch (error) {
    console.error('scan-fallback test: FAIL');
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    global.fetch = previousFetch;
    if (previous === undefined) delete process.env.ROBOFLOW_API_KEY;
    else process.env.ROBOFLOW_API_KEY = previous;
  }
})();
