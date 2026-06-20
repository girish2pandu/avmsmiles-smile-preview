// netlify/functions/generate-smile.js
// Uses Node's built-in https module instead of fetch() — works on all
// Node versions (14, 16, 18+) without any npm packages.

const https = require('https');
const { URL }  = require('url');

const HF_HOST   = 'api-inference.huggingface.co';
const HF_PATH   = '/models/timbrooks/instruct-pix2pix';

const PROMPT =
  'make the teeth perfectly straight, evenly spaced and naturally white ' +
  'as if after clear aligner orthodontic treatment, photorealistic, ' +
  'keep the rest of the face completely identical';

const NEGATIVE_PROMPT =
  'blurry, distorted face, different person, changed skin, changed background, ' +
  'changed expression, cartoon, illustration, deformed';

// Promisified https.request so we can await it
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ statusCode: res.statusCode, headers: res.headers, buffer });
      });
    });
    req.on('error', reject);
    req.setTimeout(24000, () => {      // 24s — just under Netlify's 26s limit
      req.destroy(new Error('Request timed out after 24 seconds'));
    });
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  const apiToken = process.env.HF_API_TOKEN;
  if (!apiToken) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({
        error: 'HF_API_TOKEN is not configured.',
        fix: 'Add HF_API_TOKEN in Netlify → Site configuration → Environment variables',
      }),
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body.' }) }; }

  const { imageBase64, mimeType } = payload;
  if (!imageBase64 || !mimeType) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'imageBase64 and mimeType are required.' }) };
  }

  console.log('[generate-smile] Node version:', process.version);
  console.log('[generate-smile] Token prefix:', apiToken.substring(0, 8) + '...');
  console.log('[generate-smile] Image base64 length:', imageBase64.length);

  const requestBody = JSON.stringify({
    inputs: imageBase64,
    parameters: {
      prompt: PROMPT,
      negative_prompt: NEGATIVE_PROMPT,
      num_inference_steps: 25,
      image_guidance_scale: 1.8,
      guidance_scale: 9.0,
    },
  });

  try {
    console.log('[generate-smile] Calling HuggingFace...');

    const result = await httpsRequest(
      {
        hostname: HF_HOST,
        path: HF_PATH,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'X-Use-Cache': 'false',
        },
      },
      requestBody
    );

    console.log('[generate-smile] HF status:', result.statusCode);
    console.log('[generate-smile] HF content-type:', result.headers['content-type']);
    console.log('[generate-smile] HF response size:', result.buffer.length, 'bytes');

    // 503 = model loading
    if (result.statusCode === 503) {
      let estimatedTime = 25;
      try {
        const json = JSON.parse(result.buffer.toString('utf-8'));
        estimatedTime = json.estimated_time || 25;
      } catch {}
      return {
        statusCode: 503, headers,
        body: JSON.stringify({ error: 'Model loading.', estimatedTime }),
      };
    }

    // Any non-200 from HF
    if (result.statusCode !== 200) {
      const body = result.buffer.toString('utf-8');
      console.error('[generate-smile] HF error:', result.statusCode, body);
      let hint = '';
      if (result.statusCode === 401) hint = 'Token invalid — check HF_API_TOKEN.';
      if (result.statusCode === 429) hint = 'Rate limit — wait 60s and retry.';
      if (result.statusCode === 400) hint = 'Model rejected image — try a different photo.';
      return {
        statusCode: result.statusCode, headers,
        body: JSON.stringify({ error: `HF error ${result.statusCode}`, detail: body, hint }),
      };
    }

    // Check if HF returned JSON (unexpected) instead of image bytes
    const contentType = result.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      const jsonStr = result.buffer.toString('utf-8');
      console.error('[generate-smile] HF returned JSON instead of image:', jsonStr);
      return {
        statusCode: 502, headers,
        body: JSON.stringify({ error: 'HF returned text, not image.', detail: jsonStr }),
      };
    }

    if (result.buffer.length < 1000) {
      return {
        statusCode: 502, headers,
        body: JSON.stringify({ error: 'HF returned empty image.', detail: result.buffer.toString('utf-8') }),
      };
    }

    const resultBase64 = result.buffer.toString('base64');
    const resultMime   = contentType || 'image/jpeg';

    console.log('[generate-smile] Success! Returning image.');
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ imageBase64: resultBase64, mimeType: resultMime }),
    };

  } catch (err) {
    console.error('[generate-smile] Exception:', err.message, err.stack);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Server exception: ' + err.message, detail: err.stack }),
    };
  }
};
