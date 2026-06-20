# AVMSmiles — patient self-service smile-preview tool

A mobile webpage anyone can open on their own phone — no staff involved, no login, no app to install. Take a selfie, see a before/after smile preview, then tap straight through to book a free consultation on WhatsApp. There's exactly one small piece of server-side code in the whole project, and it exists for a single reason: to call a real AI photo-editing model without exposing a secret API key in the browser. Everything else runs entirely on the visitor's own phone.

(Internally this is built on a codebase called "SmilePath" — you'll see that name in a few code comments and the original project this was adapted from. It doesn't appear anywhere in the actual deployed tool.)

## The whole flow, in a few taps

1. **Take my photo** → the phone's own front-facing camera opens, the visitor takes a selfie smiling with teeth visible.
2. Tap **See my smile preview**. This tries, in order: a real AI-edited "after" photo (teeth actually straightened and whitened, everything else unchanged) if that's been set up; otherwise a free instant in-browser brightening enhancement.
3. The result screen leads with **Book your free consultation** — opens WhatsApp with a message already addressed to AVMSmiles, ready to send. A secondary **Share my preview** button lets them show a friend or family member too.

The photo only leaves the visitor's own phone twice: briefly to the AI generation step (if that's been set up), and if they choose to share or book. Nothing is stored in a database anywhere — there isn't one.

## Branding

This is set up for **AVMSmiles**, using the actual logo file and real colors sampled directly from it — `logo.png` is included in this folder and shows automatically in the header and in the corner of every generated image, with a text wordmark as the only fallback if that file ever goes missing.

The two brand colors — purple `#3b3591` and red `#e02229` — weren't estimated by eye. They came from running pixel-color quantization directly on the logo file: the single most common non-white color in the file's purple lettering, and the single most common red across both the logo's red background square and its red smile-arc graphic. Those exact values are used as `--color-primary` and `--color-accent` throughout `style.css`, and reused directly in the canvas-drawing code in `script.js` for the labels baked into the generated images.

The two colors are used deliberately, matching the logo's own pairing: purple for structural elements (the wordmark, headings, the "before" panel), and red specifically for things meant to draw the eye — the "Book your free consultation" button and the smile-arc icon, mirroring the logo's own red smile-arc accent.

## Before going live: two things you need to fill in

Both are plain-English edits, no programming required.

**1. AVMSmiles' WhatsApp number**, so the "Book your free consultation" button actually goes somewhere. Open `script.js`, find this near the top:

```js
const CLINIC_WHATSAPP_NUMBER = '';
```

Fill in the number in international format with no spaces, no punctuation, and no leading `+` or `0` — e.g. `91XXXXXXXXXX` for an Indian number (country code first, then the number). Until this is filled in, the booking button stays hidden automatically rather than shipping something that goes nowhere.

**2. The Gemini API key**, covered in its own section below, for real AI generation instead of the free filter.

## Deploying it

There are two versions of "deployed," depending on whether you want real AI smile generation working.

### Option 1: quick deploy via Netlify Drop (free filter only, no AI generation)

This is the fastest path to a live, shareable link, and no account is required for a first test:

1. Unzip the project file you downloaded, if you haven't already. You should see a folder containing `index.html`, `style.css`, `script.js`, and a few other files — that whole folder is what you'll upload.
2. On a computer (this step doesn't work from a phone), open a browser and go to **[app.netlify.com/drop](https://app.netlify.com/drop)**.
3. You'll see a page with a large dashed-border box that says something like "Drag and drop your site output folder here." Open your computer's file browser (Finder on Mac, File Explorer on Windows), find that unzipped folder, and **drag the whole folder** onto that box. (If drag-and-drop is awkward on your setup, the page also has a "browse to upload" link that opens a normal file-picker dialog — select the folder there instead.)
4. Within a few seconds, Netlify finishes uploading and shows you a live link that looks like `https://random-name-12345.netlify.app`. That's it — the site is live.
5. Click that link to confirm it loads. That's the link you'd put on a QR code, in a social media bio, or text to a prospective patient.
6. Optional but recommended: that link is tied to an anonymous, temporary session until you claim it. Click "create a free account" wherever Netlify prompts you on that same page, sign up (email or GitHub), and the site becomes permanently yours under that account — same link, no need to re-upload.

This version gives you a fully working tool with the free quick-preview filter and the booking button (once you've filled in the WhatsApp number above). It does not include real AI generation, since Netlify Drop only ever uploads static files and ignores the `netlify/functions` folder — see Option 2 below for that.

### Option 2: full deploy (adds real AI smile generation)

This needs Netlify to actually run the one serverless function, which requires connecting a Git repository instead of a plain drag-and-drop — entirely doable through web pages, no command line needed:

1. Create a free [GitHub](https://github.com) account if you don't have one.
2. Create a new repository (the "+" button, top right, → "New repository"), and on the next page use the **"uploading an existing file"** link to drag in all of this project's files (keeping the `netlify` folder structure intact).
3. Go to [app.netlify.com](https://app.netlify.com), sign up free, click **"Add new site" → "Import an existing project"**, and connect it to the GitHub repository you just created.
4. Netlify will detect `netlify.toml` automatically and deploy both the site and the function. You'll get the same kind of `https://something.netlify.app` link as before.
5. To update the site later (e.g. after filling in the WhatsApp number or the Gemini key), upload changed files to the same GitHub repo (via its web "Upload files" page) — Netlify redeploys automatically within a minute or so.

Either deployment option gives you an `https://` link, which is what matters for the one-tap WhatsApp share/book buttons (they require a secure address, not a plain `http://` one). [Vercel](https://vercel.com) and [Cloudflare Pages](https://pages.cloudflare.com) are reasonable alternatives to Netlify for either option if you'd rather use those.

## Setting up real AI smile generation

This is the part that actually delivers a real before/after, not just a brightness filter. It uses Google's Gemini image model.

1. **Deploy using Option 2 above first** (the function needs to exist for this to do anything).
2. Go to **[Google AI Studio](https://aistudio.google.com)** and sign in with any Google account.
3. Find the **API key** section (Google's exact wording/layout shifts over time — look for "Get API key" or "API keys" in the sidebar) and create one.
4. In your Netlify site's dashboard, go to **Site configuration → Environment variables**, and add one: name it `GEMINI_API_KEY`, paste in the key you just copied, and save.
5. Trigger a redeploy (Netlify usually does this automatically after an environment variable change; if not, there's a "Trigger deploy" button in the Deploys tab).

That's it — no code changes needed. From then on, the small note under the result image will say "Generated with AI smile simulation" once it's actually running on real AI generation.

**Important: read this before relying on the free tier for a real, public, patient-facing deployment.** Google's free Gemini API tier comes with two conditions that matter a lot here, more than they did when this was just an internal test: free-tier usage explicitly excludes commercial use under Google's terms, and Google may use free-tier inputs (including the photos sent through it) to improve their own models, unlike the paid tier. Since this tool now exists specifically to convert paying patients for a business, and will be processing real people's face photos, the responsible setup is almost certainly to **enable billing** on the Google Cloud project behind your API key rather than running on the free tier. The good news: this model is cheap — roughly $0.04 per generated image at the time this was written — so even a few hundred uses a month comes out to a few dollars, not a meaningful expense. Enabling billing is a setting in Google Cloud Console; nothing about the code changes.

A few other honest notes on this part:

- I wrote `netlify/functions/generate-smile.js` against Google's documented request format for this API as researched while building this, but I don't have a Gemini API key or network access to Google's servers from where I work, so I have not been able to run this end to end myself. Please do one real test after setting up the key, and if something's off, the function returns Gemini's raw error detail to help debug it (visible in Netlify's function logs, under the site's "Functions" tab).
- The exact instruction given to the AI model lives in the `PROMPT` constant near the top of `generate-smile.js`, in plain English. If results need tuning, that's the one place to edit.
- Results can occasionally look off, decline to edit certain photos, or vary in quality between attempts — inherent to generative AI, not something fully eliminable. The automatic fallback to the free filter means the tool still works even on a failed request, but it's worth glancing at a few real results after launch.

## Issues to anticipate now that patients use this themselves, unsupervised

This is a meaningfully different risk profile than a doctor-administered chairside tool, worth thinking through deliberately rather than discovering by surprise:

**Photo quality will be more inconsistent.** Nobody is there to catch a closed mouth, bad lighting, or an odd angle before it becomes a disappointing result — which is exactly the failure mode we ran into earlier in this build. The on-screen instructions and the privacy note are the only coaching a visitor gets, so if results still look unconvincing for some patients after AI mode is properly set up, the next lever is making that instruction even more prominent (a short example photo, an illustration, etc.) rather than assuming it's a bug.

**Free-tier API usage and abuse exposure.** Covered above for the commercial-use angle, but it also matters operationally: a public, shareable link can get far more traffic than a chairside tool ever would — a social media post taking off, or simply curious people retrying it repeatedly — burning through a daily quota fast, or running up real cost if many people use it. Worth keeping an eye on usage in Google Cloud Console's billing dashboard early on, and there's no rate-limiting built into this function beyond Gemini's own — that's a reasonable thing to add later if usage grows (e.g. a basic per-IP limit) but isn't built in today.

**Consent and data-handling now happen without a human present.** When a doctor takes the photo in clinic, there's someone there to explain what's happening with it. When a stranger uses this from a QR code at 11pm, the on-screen privacy note is the only explanation they get. The current copy ("used only to generate this preview, not stored or shared unless you choose to") is accurate for how this code behaves, but doesn't cover what Google does with the data on their end — worth a line in AVMSmiles' own privacy policy if this gets meaningful traffic, and worth being on the paid Gemini tier (above) so that line can honestly say photos aren't used for model training.

**No one to add verbal context.** The disclaimer is the only thing standing between "fun preview" and "guaranteed outcome" in someone's mind now — it's already shown on screen, baked into the image, and sent as the share caption, which is about as much redundancy as is reasonable to build in without becoming annoying.

**Minors may use this with no one checking.** A teenager curious about aligners could plausibly try this without a parent present. Nothing in this build restricts that, and there isn't an age gate — worth a quick thought on whether that's acceptable for AVMSmiles or whether some light gating belongs in front of it.

**No lead record beyond what the booking button creates.** If someone tries this, likes it, but doesn't tap "Book your free consultation," there's currently no way to know that happened — no analytics, no capture of "someone explored this." That's a fine tradeoff for keeping this backend-free, but worth knowing it's the tradeoff being made.

## How the "after" image actually gets generated

Two sources, tried in this order automatically when someone taps "See my smile preview":

**1) Real AI generation**, if the Gemini API key above has been set up. This sends the photo to Google's image model with instructions to straighten and whiten the teeth while keeping everything else — face, skin, lighting, background, identity — unchanged.

**2) The free local filter**, automatically, if step 1 isn't set up yet or fails for any reason (no API key configured, hit a rate limit, network hiccup, anything). This is a brightness/whitening-style enhancement that runs instantly in the browser. It will not show crooked teeth as straight — it's a cosmetic stand-in, not a tooth-position change.

The small note under the result only appears when real AI generation actually ran ("Generated with AI smile simulation") — it stays silent for the filter fallback rather than showing a visitor a technical caveat that means nothing to them.

## The disclaimer note

The same disclaimer text appears in three places automatically:

- on screen, right below the before/after image,
- baked directly into the image itself (small print along the bottom), so it travels with the photo even if it's later forwarded, saved, or screenshotted,
- as the caption text sent along with the image if someone shares it further.

All three pull from one place in the code — `DISCLAIMER_TEXT` near the top of `script.js` — so if AVMSmiles' compliance contact wants different wording, it only needs editing once, in plain English:

```js
const DISCLAIMER_TEXT =
  'This is a simulated preview for illustration purposes only. ' +
  'It does not guarantee the exact clinical outcome of any treatment. ' +
  'Ask your dentist for a full evaluation.';
```

## A note on the sharing buttons

Both the booking button and the "Share my preview" button use the phone's built-in share/link-opening behavior, supported on current versions of Chrome on Android and Safari on iOS. If a particular phone or browser doesn't support one-tap image sharing specifically, the secondary share button automatically falls back to "Download my preview" + "Open WhatsApp" instead, with an on-screen note to attach the photo manually. The booking button doesn't depend on this at all — it's a plain link, so it works everywhere.

I built this against the standard, documented browser features for camera capture, image processing, and sharing, but I wasn't able to test it on an actual phone from here — please do one real run-through on your own device after deploying.

## What this version intentionally doesn't have

No login, no patient list, no history of who's used it, no database, no analytics. Anyone with the link can use it, which is the point for a self-service marketing tool, but means there's no record of usage beyond whatever comes through the booking WhatsApp messages themselves. If a record-keeping dashboard or staff-administered mode is ever wanted again, that's a different, more involved build — ask if you'd like to pick that direction back up.

## Customizing it

- **WhatsApp number:** see "Before going live" above, in `script.js`.
- **Logo:** `logo.png` is already the real AVMSmiles logo. If it's ever updated, just replace this file with the new one, same filename — no code changes needed.
- **Colors:** `--color-primary` and `--color-accent` in `style.css`, both sampled from the real logo. Update these if the brand palette ever changes.
- **The AI editing instructions:** plain-English text in the `PROMPT` constant at the top of `netlify/functions/generate-smile.js`.
- **The booking message:** `BOOKING_MESSAGE` right next to `CLINIC_WHATSAPP_NUMBER` in `script.js` — change the wording of what's pre-filled when someone taps "Book your free consultation."

## Troubleshooting

**The before/after images look almost identical, and the note below the result is blank (not "Generated with AI smile simulation").** AI generation isn't actually running — the page falls back to the free filter silently by design. To find out why: visit `your-site-url/.netlify/functions/generate-smile` directly in a browser. A small `{"error":"Method not allowed."}` message means the function itself is deployed correctly — the next place to look is the **Functions** tab in your Netlify dashboard, clicking into `generate-smile`, and checking the log from your most recent real test; it'll show Gemini's exact error (missing/invalid API key being the most common one — double check the environment variable name is exactly `GEMINI_API_KEY` and that you triggered a redeploy after adding it). A generic Netlify "Page not found" at that URL instead means the function never deployed at all, which usually traces back to the `netlify/functions` folder not keeping its nested structure when uploaded to GitHub.

Separately: photos straight from a phone camera can be several megabytes, which risks exceeding Netlify's request-size limit before the request even reaches the function. This build now resizes the photo down to a sensible size in the browser before sending it for AI generation, specifically to avoid that — if you're still hitting size-related errors in the function logs after that, it's worth a closer look at the photo resolution being captured.

**The "Book your free consultation" button doesn't show up.** `CLINIC_WHATSAPP_NUMBER` in `script.js` is still empty — see "Before going live" above.

**Tapping "Take my photo" does nothing, or opens a file browser instead of the camera.** Some desktop browsers and a few older phone browsers don't support the camera shortcut and fall back to a regular file picker — people can still select an existing photo, just not snap a new selfie through this button.

**The "Share my preview" button doesn't appear; only Download/Open WhatsApp do.** That phone's browser doesn't support one-tap image sharing yet — see "A note on the sharing buttons" above. The fallback still works.

**The page looks unstyled or fonts look off.** Check that the device has an internet connection — the fonts load from Google Fonts at runtime.
