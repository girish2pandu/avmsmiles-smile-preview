// api/generate-smile.js — Vercel serverless function
// Vercel has full outbound network access and 60s timeout on the free plan.

const https = require('https');

const HF_HOST = 'api-inference.huggingface.co';
const HF_PATH = '/models/timbrooks/instruct-pix2pix';
const PROMPT = 'make the teeth perfectly straight, evenly spaced and naturally white as if after clear aligner orthodontic treatment, photorealistic, keep the rest of the face completely identical';
const NEGATIVE_PROMPT = 'blurry, distorted face, different person, changed skin, changed background, changed expression, cartoon, illustration, deformed';

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(55000, () => req.destroy(new Error('HF request timed out after 55s')));
    req.write(body);
    req.end();
  });
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed.' }); return; }

  let payload;
  try { payload = JSON.parse(await getRawBody(req)); }
  catch { res.status(400).json({ error: 'Invalid JSON body.' }); return; }

  // Accept token from env var (preferred) OR from request body (fallback)
  const apiToken = process.env.HF_API_TOKEN || payload.hfToken;
  if (!apiToken) {
    res.status(500).json({ error: 'No HuggingFace token. Set HF_API_TOKEN in Vercel env vars OR set HF_TOKEN in script.js.' });
    return;
  }

  const { imageBase64, mimeType } = payload;
  if (!imageBase64 || !mimeType) {
    res.status(400).json({ error: 'imageBase64 and mimeType are required.' });
    return;
  }

  console.log('[generate-smile] Node:', process.version, '| Token prefix:', apiToken.substring(0, 8));

  const requestBody = JSON.stringify({
    inputs: imageBase64,
    parameters: { prompt: PROMPT, negative_prompt: NEGATIVE_PROMPT, num_inference_steps: 25, image_guidance_scale: 1.8, guidance_scale: 9.0 },
  });

  try {
    const result = await httpsPost({
      hostname: HF_HOST, path: HF_PATH, method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'X-Use-Cache': 'false',
      },
    }, requestBody);

    console.log('[generate-smile] HF status:', result.statusCode, '| size:', result.buffer.length);

    if (result.statusCode === 503) {
      let wait = 25;
      try { wait = JSON.parse(result.buffer.toString()).estimated_time || 25; } catch {}
      res.status(503).json({ error: 'Model loading.', estimatedTime: wait });
      return;
    }

    if (result.statusCode !== 200) {
      const body = result.buffer.toString('utf-8');
      let hint = '';
      if (result.statusCode === 401) hint = 'Token invalid.';
      if (result.statusCode === 429) hint = 'Rate limit — wait 60s.';
      if (result.statusCode === 400) hint = 'Model rejected image — try different photo.';
      res.status(result.statusCode).json({ error: `HF error ${result.statusCode}`, detail: body, hint });
      return;
    }

    const ct = result.headers['content-type'] || '';
    if (ct.includes('application/json')) {
      res.status(502).json({ error: 'HF returned text not image.', detail: result.buffer.toString('utf-8') });
      return;
    }

    if (result.buffer.length < 1000) {
      res.status(502).json({ error: 'HF returned empty image.' });
      return;
    }

    res.status(200).json({ imageBase64: result.buffer.toString('base64'), mimeType: ct || 'image/jpeg' });

  } catch (err) {
    console.error('[generate-smile] Exception:', err.message);
    res.status(500).json({ error: 'Server exception: ' + err.message, detail: err.stack });
  }
};
