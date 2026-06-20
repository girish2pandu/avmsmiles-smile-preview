// script.js — AVMSmiles smile-preview tool (patient self-service version)
//
// The AI smile generation now calls HuggingFace DIRECTLY from the browser —
// no serverless function needed. HuggingFace allows browser fetch calls
// (Access-Control-Allow-Origin: *) from any https:// page.
//
// The HF token below is readable by anyone who views the page source.
// For a small internal clinic tool this is an acceptable tradeoff — the
// token only has Read access and can be regenerated at any time on
// huggingface.co → Settings → Access Tokens if misused.

const DISCLAIMER_TEXT =
  'This is a simulated preview for illustration purposes only. ' +
  'It does not guarantee the exact clinical outcome of any treatment. ' +
  'Ask your dentist for a full evaluation.';

// --- Fill these in before going live -----------------------------------
// 1. Your HuggingFace token (huggingface.co → Settings → Access Tokens)
//    Create a free account, generate a "Read" token, paste it here.
const HF_TOKEN = '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';

// 2. AVMSmiles' WhatsApp number — international format, no spaces/+/0
//    e.g. '91XXXXXXXXXX'. Leave empty to hide the booking button.
const CLINIC_WHATSAPP_NUMBER = '';
const BOOKING_MESSAGE =
  "Hi AVMSmiles! I just tried your smile preview tool and I'd like to book a free consultation.";
// -------------------------------------------------------------------------

const els = {
  errorBanner: document.getElementById('errorBanner'),
  photoInput: document.getElementById('photoInput'),
  captureLabelText: document.getElementById('captureLabelText'),
  capturePreview: document.getElementById('capturePreview'),
  capturedThumb: document.getElementById('capturedThumb'),
  toGenerateBtn: document.getElementById('toGenerateBtn'),
  stepCapture: document.getElementById('step-capture'),
  stepGenerating: document.getElementById('step-generating'),
  stepResult: document.getElementById('step-result'),
  compositeCanvas: document.getElementById('compositeCanvas'),
  bookConsultBtn: document.getElementById('bookConsultBtn'),
  shareBtn: document.getElementById('shareBtn'),
  fallbackShare: document.getElementById('fallbackShare'),
  downloadBtn: document.getElementById('downloadBtn'),
  openWhatsappLink: document.getElementById('openWhatsappLink'),
  resetBtn: document.getElementById('resetBtn'),
  modeBadge: document.getElementById('modeBadge'),
};

// Single source of truth for the disclaimer shown on screen, so it can
// never drift out of sync with the text baked into the image.
document.querySelector('.disclaimer').textContent = DISCLAIMER_TEXT;

// Wire up the booking button once at load — it doesn't depend on any
// per-photo state, just the clinic number above. Hidden entirely if that
// hasn't been filled in yet, rather than shipping a button that goes
// nowhere useful.
if (CLINIC_WHATSAPP_NUMBER) {
  els.bookConsultBtn.href = `https://wa.me/${CLINIC_WHATSAPP_NUMBER}?text=${encodeURIComponent(BOOKING_MESSAGE)}`;
}

let state = {
  file: null,
  img: null,
  objectUrl: null,
  downloadUrl: null,
  afterImg: null,
  afterMode: 'filter', // 'ai' | 'filter'
  aiError: null,
};

function showError(message) {
  els.errorBanner.textContent = message;
  els.errorBanner.classList.remove('hidden');
}

function clearError() {
  els.errorBanner.classList.add('hidden');
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error('Could not read that photo. Please try again.'));
    img.src = url;
  });
}

function base64ToImage(base64, mimeType) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the generated image.'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

// Modern phone cameras can produce 10-50MP photos — several megabytes once
// base64-encoded, which risks tripping Netlify/Lambda's request-size
// limit before the request even reaches our function. Gemini doesn't need
// full resolution for an edit like this anyway, so this downsizes to a
// sensible cap first. Returns a base64 JPEG string (no data: prefix).
function resizeImageToBase64(img, maxDim) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

// Calls the serverless function which proxies to HuggingFace.
// The function runs on Vercel which has full outbound network access.
// Returns {img, error}.
async function tryGenerateWithAI(beforeImg) {
  if (!HF_TOKEN) {
    return { img: null, error: 'HF_TOKEN is not set in script.js — add your HuggingFace token.' };
  }

  try {
    const base64 = resizeImageToBase64(beforeImg, 512);

    async function callServer(attempt) {
      document.querySelector('.generating-text').textContent =
        attempt === 1 ? 'Generating AI preview…' : `AI warming up — retrying (attempt ${attempt})…`;

      const res = await fetch('/api/generate-smile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg', hfToken: HF_TOKEN }),
      });

      if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        const wait = Math.round((data.estimatedTime || 25) * 1000) + 2000;
        document.querySelector('.generating-text').textContent =
          `AI model waking up — retrying in ${Math.round(wait / 1000)}s…`;
        await new Promise(r => setTimeout(r, wait));
        return callServer(attempt + 1);
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || `HTTP ${res.status}`;
        const detail = data.detail ? ' | ' + String(data.detail).substring(0, 200) : '';
        const hint = data.hint ? ' → ' + data.hint : '';
        return { img: null, error: `AI error ${res.status}: ${msg}${detail}${hint}` };
      }

      const data = await res.json();
      if (!data || !data.imageBase64) {
        return { img: null, error: 'Server returned no image. ' + JSON.stringify(data) };
      }

      const img = await base64ToImage(data.imageBase64, data.mimeType || 'image/jpeg');
      return { img, error: null };
    }

    return await callServer(1);
  } catch (err) {
    return { img: null, error: 'Network error: ' + String(err) };
  }
}

// Draws `img` into the dx/dy/dw/dh rect using "cover" scaling (fills the
// rect, center-cropping any excess) — the same behavior as CSS
// object-fit: cover.
function drawCoverFit(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// The "after" panel: a gentle brightness/contrast/saturation lift plus a
// soft glow positioned in the lower-middle of the frame, where a
// forward-facing selfie's mouth typically sits. This is a positional
// heuristic, not real face or mouth detection — it reads well for a
// centered selfie but won't precisely track an off-center smile, and it
// has nothing to work with at all if the mouth is closed in the photo.
function drawAfterPanel(ctx, img, dx, dy, dw, dh) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();

  // Canvas2D's `filter` mirrors CSS filters. Browsers that don't support it
  // simply ignore the assignment and draw unfiltered — a safe degrade.
  ctx.filter = 'brightness(1.18) contrast(1.1) saturate(1.08)';
  drawCoverFit(ctx, img, dx, dy, dw, dh);
  ctx.filter = 'none';

  const cx = dx + dw / 2;
  const cy = dy + dh * 0.62;
  const radius = dw * 0.38;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  glow.addColorStop(0, 'rgba(255,255,255,0.45)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'lighten';
  ctx.fillStyle = glow;
  ctx.fillRect(dx, dy, dw, dh);
  ctx.globalCompositeOperation = 'source-over';

  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  return lines;
}

// Renders the full before/after composite — the single image that actually
// gets shared — onto #compositeCanvas. Built at a fairly high resolution
// (~1100px wide) so the baked-in disclaimer is still legible when a
// recipient opens the photo at full size on their own phone, even though
// it displays much smaller while previewing here.
function buildComposite(beforeImg, afterMode, afterImg) {
  const PADDING = 20;
  const PANEL = 540;
  const GUTTER = 6;
  const HEADER_H = 68;
  const FOOTER_H = 124;

  const width = PADDING * 2 + PANEL * 2 + GUTTER;
  const height = HEADER_H + PANEL + FOOTER_H;

  const canvas = els.compositeCanvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const leftX = PADDING;
  const rightX = PADDING + PANEL + GUTTER;
  const panelY = HEADER_H;

  ctx.textAlign = 'center';
  ctx.font = '700 22px Sora, sans-serif';
  ctx.fillStyle = '#5e5a73';
  ctx.fillText('BEFORE', leftX + PANEL / 2, HEADER_H - 16);
  ctx.fillStyle = '#e02229';
  ctx.fillText('SIMULATED PREVIEW', rightX + PANEL / 2, HEADER_H - 16);

  // Small clinic wordmark, top-left, since this composite is the actual
  // image that might get shared further — worth a light brand touch.
  ctx.textAlign = 'left';
  ctx.font = '700 15px Sora, sans-serif';
  ctx.fillStyle = '#3b3591';
  ctx.fillText('AVMSmiles', leftX, 24);
  ctx.textAlign = 'center';

  drawCoverFit(ctx, beforeImg, leftX, panelY, PANEL, PANEL);

  if (afterMode === 'ai' && afterImg) {
    // A real AI photo edit — draw it as-is, no filter on top.
    drawCoverFit(ctx, afterImg, rightX, panelY, PANEL, PANEL);
  } else {
    // AI generation isn't set up yet, or this attempt failed — fall back to
    // the in-browser brightening enhancement of the same before photo.
    drawAfterPanel(ctx, beforeImg, rightX, panelY, PANEL, PANEL);
  }

  ctx.fillStyle = '#e7e3dc';
  ctx.fillRect(leftX + PANEL, panelY, GUTTER, PANEL);

  ctx.fillStyle = '#5e5a73';
  ctx.font = '400 19px "IBM Plex Sans", sans-serif';
  const lines = wrapText(ctx, DISCLAIMER_TEXT, width - PADDING * 2);
  let ty = panelY + PANEL + 32;
  lines.forEach((line) => {
    ctx.fillText(line, width / 2, ty);
    ty += 24;
  });

  return canvas;
}

function setupShare(blob) {
  const file = new File([blob], 'smile-preview.jpg', { type: 'image/jpeg' });
  const canUseWebShare =
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  if (canUseWebShare) {
    els.shareBtn.classList.remove('hidden');
    els.fallbackShare.classList.add('hidden');
    els.shareBtn.onclick = async () => {
      try {
        await navigator.share({ files: [file], text: DISCLAIMER_TEXT, title: 'My smile preview' });
      } catch (err) {
        // AbortError just means they closed the share sheet without
        // picking anything — not a real failure, so stay quiet about it.
        if (err && err.name !== 'AbortError') {
          showError('Could not open the share menu. Please try again.');
        }
      }
    };
  } else {
    els.shareBtn.classList.add('hidden');
    els.fallbackShare.classList.remove('hidden');
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = URL.createObjectURL(blob);
    els.downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = state.downloadUrl;
      a.download = 'smile-preview.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    els.openWhatsappLink.href = `https://wa.me/?text=${encodeURIComponent(DISCLAIMER_TEXT)}`;
  }
}

els.photoInput.addEventListener('change', async (event) => {
  clearError();
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    const { img, url } = await loadImageFromFile(file);
    state.file = file;
    state.img = img;
    state.objectUrl = url;
    els.capturedThumb.src = url;
    els.capturePreview.classList.remove('hidden');
    els.captureLabelText.textContent = 'Retake my photo';
    els.toGenerateBtn.disabled = false;
  } catch (err) {
    showError(err.message);
  }
});

els.toGenerateBtn.addEventListener('click', () => {
  clearError();
  els.stepCapture.classList.add('hidden');
  els.stepGenerating.classList.remove('hidden');

  // Always try the real AI generator first. If it's not deployed yet, not
  // configured yet, or Gemini errors for any reason, fall back to the free
  // local filter automatically — from the patient's point of view the
  // button behaves the same either way, it just gets better once AI mode
  // is set up.
  tryGenerateWithAI(state.img).then(({ img, error }) => {
    if (img) {
      state.afterImg = img;
      state.afterMode = 'ai';
      state.aiError = null;
    } else {
      state.afterImg = null;
      state.afterMode = 'filter';
      state.aiError = error;
    }
    finishGenerate();
  });
});

const MODE_BADGE_TEXT = {
  ai: '✨ Generated with AI smile simulation',
  // Show clearly when filter fallback ran — important for debugging during setup.
  // Once AI is confirmed working, this message can be softened or removed.
  filter: '⚠️ AI generation unavailable — showing brightness preview only. Check Netlify function logs.',
};

function finishGenerate() {
  if (!state.img) return;

  // A short, intentional minimum pause so the reveal feels deliberate
  // rather than an instant swap, even when a step resolves almost
  // instantly. Real AI generation can itself take several seconds, which
  // the loading screen's looping animation already covers gracefully.
  setTimeout(() => {
    try {
      const canvas = buildComposite(state.img, state.afterMode, state.afterImg);
      canvas.toBlob(
        (blob) => {
          setupShare(blob);
          if (state.afterMode === 'ai') {
            els.modeBadge.textContent = '✨ Generated with AI smile simulation';
            els.modeBadge.className = 'mode-badge mode-ai';
          } else {
            const errorDetail = state.aiError ? '\n\nError detail: ' + state.aiError : '';
            els.modeBadge.textContent = '⚠️ AI unavailable — showing brightness filter only.' + errorDetail;
            els.modeBadge.className = 'mode-badge mode-filter';
          }
          if (CLINIC_WHATSAPP_NUMBER) {
            els.bookConsultBtn.classList.remove('hidden');
          }
          els.stepGenerating.classList.add('hidden');
          els.stepResult.classList.remove('hidden');
        },
        'image/jpeg',
        0.92
      );
    } catch (err) {
      els.stepGenerating.classList.add('hidden');
      els.stepCapture.classList.remove('hidden');
      showError('Could not put the preview together. Please try again.');
    }
  }, 450);
}

els.resetBtn.addEventListener('click', () => {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
  state = { file: null, img: null, objectUrl: null, downloadUrl: null, afterImg: null, afterMode: 'filter', aiError: null };

  els.photoInput.value = '';
  els.capturePreview.classList.add('hidden');
  els.captureLabelText.textContent = 'Take my photo';
  els.toGenerateBtn.disabled = true;

  els.bookConsultBtn.classList.add('hidden');
  els.stepResult.classList.add('hidden');
  els.stepCapture.classList.remove('hidden');
  els.modeBadge.textContent = '';
  clearError();
});
