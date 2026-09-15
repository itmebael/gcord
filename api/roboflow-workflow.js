const WORKFLOW_URL = process.env.ROBOFLOW_WORKFLOW_URL || 'https://serverless.roboflow.com/bael/workflows/custom-workflow-5';

// Workflow outputs can contain named blocks or JSON text from a model step.
// Read structured fields only; raw_extraction is OCR text, not a receipt object.
function receiptOutput(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') {
    const json = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return receiptOutput(JSON.parse(json), depth + 1); }
    catch { return null; }
  }
  if (typeof value !== 'object') return null;
  const fields = ['name', 'number', 'amount', 'reference_number', 'date', 'time', 'parse_error'];
  const isReceipt = fields.some(key => Object.prototype.hasOwnProperty.call(value, key));
  if (isReceipt && typeof value.name === 'string' && value.name.trim() &&
      fields.slice(1).some(key => Object.prototype.hasOwnProperty.call(value, key))) return value;
  for (const key of Object.keys(value)) {
    if (key === 'raw_extraction' || fields.includes(key)) continue;
    const found = receiptOutput(value[key], depth + 1);
    if (found) return found;
  }
  return isReceipt ? value : null;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ROBOFLOW_API_KEY) {
    response.status(200).json({
      fallback: true,
      warning: 'Roboflow API key is not configured; continuing with local OCR fallback.'
    });
    return;
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const image = body && (body.imageUrl || body.image);
    const isUrl = typeof image === 'string' && /^https?:\/\//i.test(image);
    const isBase64 = typeof image === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(image);
    if (!isUrl && !isBase64) {
      response.status(400).json({ error: 'A public image URL or base64 data URL image is required' });
      return;
    }

    const comma = image.indexOf(',');
    const value = isUrl ? image : image.slice(comma + 1);
    const roboflowResponse = await fetch(WORKFLOW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: process.env.ROBOFLOW_API_KEY,
        inputs: { image: { type: isUrl ? 'url' : 'base64', value: value } }
      })
    });
    const result = await roboflowResponse.json();
    if (!roboflowResponse.ok) {
      response.status(roboflowResponse.status).json({
        error: 'Receipt extraction failed (HTTP ' + roboflowResponse.status + ').'
      });
      return;
    }
    const output = receiptOutput(result);
    if (!output) {
      response.status(502).json({ error: 'The Workflow returned no data.' });
      return;
    }
    response.status(200).json({
      name: output.name ?? '',
      number: output.number ?? '',
      amount: output.amount ?? '',
      reference_number: output.reference_number ?? '',
      date: output.date ?? '',
      time: output.time ?? '',
      raw_extraction: output.raw_extraction ?? '',
      parse_error: output.parse_error ?? true
    });
  } catch (error) {
    response.status(502).json({ error: 'Could not reach the Roboflow workflow' });
  }
};
