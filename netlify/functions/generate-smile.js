// netlify/functions/generate-smile.js
//
// Serverless proxy to Google's Gemini image-generation API ("Nano Banana").
// This is the ONLY reason any server-side code exists in this project: a
// real generative photo edit needs a secret API key, and a secret key can
// never be safely placed in a webpage's public JavaScript — anyone could
// open dev tools, copy it, and run up charges on your account. Putting the
// call here means the key lives only in Netlify's environment variables,
// never in anything sent to the browser.
//
// SETUP REQUIRED (see README): create a free Gemini API key at Google AI
// Studio (aistudio.google.com), then add it as an environment variable
// named GEMINI_API_KEY in this site's Netlify settings
// (Site configuration -> Environment variables). Nothing else needs to
// change — the frontend already calls this function automatically and
// falls back to the free local filter if this isn't set up yet.
//
// HONESTY NOTE: this is written against Google's documented REST pattern
// for the Gemini API as researched in mid-2026. I don't have a Gemini API
// key or network access to Google's API from where I built this, so I
// have not been able to run it against the real service end to end.
// Please do one real test after deploying. If Google has changed the
// response shape since, the error detail returned below should help
// whoever's debugging it figure out what changed.

const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Edit this wording any time to tune results — no other code needs to
// change. Keep it specific about what should and shouldn't change.
const PROMPT = [
  "Edit this photo to show how this exact same person's smile would look",
  'after clear aligner or braces treatment: make their teeth straight,',
  'evenly spaced, and naturally white. Keep the face, skin tone, hairstyle,',
  'expression, pose, lighting, clothing, and background completely',
  'unchanged. Do not alter their identity or any other feature. The result',
  'must look like a real, unedited photograph of the same person — not an',
  'illustration, not a different person.',
].join(' ');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server yet.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { imageBase64, mimeType } = payload;
  if (!imageBase64 || !mimeType) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'imageBase64 and mimeType are both required.' }),
    };
  }

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return {
        statusCode: geminiRes.status,
        body: JSON.stringify({ error: 'Gemini API returned an error.', detail: data }),
      };
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part) => part.inlineData && part.inlineData.data);

    if (!imagePart) {
      // Most often this means Gemini declined the edit (e.g. safety
      // filters) or returned text instead of an image for this prompt.
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Gemini did not return an image for this request.', detail: data }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType || 'image/png',
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not reach Gemini.', detail: String(err) }),
    };
  }
};
