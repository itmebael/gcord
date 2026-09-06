const WORKFLOW_URL = process.env.ROBOFLOW_WORKFLOW_URL || 'https://serverless.roboflow.com/bael/workflows/custom-workflow-5';

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
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.ROBOFLOW_API_KEY
      },
      body: JSON.stringify({
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
    // Serverless responses can wrap the same receipt array in `outputs`.
    const results = result && result.outputs !== undefined ? result.outputs : result;
    const output = Array.isArray(results) ? results[0] : results;
    if (!output || typeof output !== 'object') {
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
