// script.js — AVMSmiles smile-preview tool (patient self-service version)
//
// Built for a patient to use on their own phone — waiting room, a QR code
// on a poster, a link shared on social media — with no staff member
// walking them through it. No backend for hosting or sharing — only one
// small serverless function (netlify/functions/generate-smile.js) exists
// at all, and only to keep a secret API key off the public internet.
//
// Two ways to get an "after" photo, tried in this order automatically:
//   A) Real AI generation via that serverless function (Google's Gemini
//      image model) — an actual photo edit that straightens and whitens
//      the visible teeth while keeping the rest of the photo unchanged.
//      Only works once GEMINI_API_KEY is configured server-side; see the
//      README.
//   B) If (A) isn't set up yet, or the request fails for any reason, this
//      page falls back automatically to an in-browser brightness/
//      whitening-style enhancement of the same photo — free, instant, but
//      a cosmetic enhancement only, not a real tooth-position change.
//
// The result screen leads with a "Book your free consultation" button
// (opens WhatsApp pointed at AVMSmiles' own number, configured below) since
// that's the actual conversion moment — everything else on this page is in
// service of getting someone to that button. The Web Share API is offered
// too, as a secondary "show a friend" action.

const DISCLAIMER_TEXT =
  'This is a simulated preview for illustration purposes only. ' +
  'It does not guarantee the exact clinical outcome of any treatment. ' +
  'Ask your dentist for a full evaluation.';

// --- Fill these in before going live -----------------------------------
// AVMSmiles' WhatsApp number in international format, no spaces or
// punctuation, e.g. '91XXXXXXXXXX' for an Indian number (country code, no
// leading +, no leading 0). Leave empty and the booking button stays
// hidden rather than shipping a broken link.
const CLINIC_WHATSAPP_NUMBER = '9281459789';
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(file);
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

// Calls the serverless function for a real AI-generated after-photo.
// Resolves to an Image on success, or null on ANY failure — not deployed
// yet (404), not configured yet (500, no API key), Gemini declining the
// edit, a slow network, anything — so the caller can fall back to the
// free filter without needing to know which case happened.
async function tryGenerateWithAI(file) {
  try {
    const base64 = await fileToBase64(file);
    const res = await fetch('/.netlify/functions/generate-smile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType: file.type || 'image/jpeg' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.imageBase64) return null;
    return await base64ToImage(data.imageBase64, data.mimeType || 'image/png');
  } catch {
    return null;
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
  tryGenerateWithAI(state.file).then((aiImg) => {
    if (aiImg) {
      state.afterImg = aiImg;
      state.afterMode = 'ai';
    } else {
      state.afterImg = null;
      state.afterMode = 'filter';
    }
    finishGenerate();
  });
});

const MODE_BADGE_TEXT = {
  ai: '✨ Generated with AI smile simulation',
  // Intentionally no message for the filter fallback — a patient doesn't
  // need or want a technical caveat about which engine ran; the
  // .mode-badge:empty CSS rule hides this line entirely in that case.
  filter: '',
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
          els.modeBadge.textContent = MODE_BADGE_TEXT[state.afterMode] || '';
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
  state = { file: null, img: null, objectUrl: null, downloadUrl: null, afterImg: null, afterMode: 'filter' };

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
