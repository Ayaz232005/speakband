# SpeakBand — build notes (v1.3, 2026-10-23)

Working name; branding not final.

**LIVE:** https://speakband-api.ayazawan273.workers.dev/ — landing page at `/`,
practice app at `/practice.html`. The Cloudflare Worker serves both the static
site (from KV, keys `site:<path>`) and the API on a single origin. $0 spent.

## What exists
- `index.html` — marketing landing page (root) with waitlist form. POSTs to the
  live `/api/waitlist`; on-device localStorage queue + auto-sync if offline.
- `practice.html` — the practice app (home → mode select → practice → band report).
- `styles.css` — shared mobile-first styles.
- `questions.js` — question banks: 10× Part-1 topics (4 Qs each), 12× Part-2 cue cards, 6× Part-3 sets.
- `app.js` — flow logic, Web Speech API recording (en-GB), timestamp-based timers,
  Chrome auto-restart for long turns, DEMO heuristic band scorer (unscored answers excluded),
  "Get AI band feedback" button → POSTs the session to the live `/api/feedback`
  (absolute `API_BASE`), renders AI bands/tips/strength/fix; honest error note on
  failure (quota/network) — never fakes a score.
- `worker.js` — Cloudflare Worker: POST /api/feedback (Gemini→Groq fallback chain,
  3 free gradings/day/IP via KV, CORS + input sanitizing + score validation),
  POST /api/waitlist (per-IP rate limit), plus GET static serving for the 5 site
  files from KV. Needs GEMINI_API_KEY + GROQ_API_KEY (owner-entered, never committed).
- `wrangler.toml` — deploy config (KV namespace id filled in).

## Verified 2026-10-23 (Day 4) — all on the PUBLIC URL
- `/` serves the landing page (hero copy, waitlist form, FAQ); `/practice.html`
  serves the app; `app.js`/`styles.css`/`questions.js` serve with correct types.
- Waitlist POST → `{"ok":true}` (saved in KV).
- Real AI grading end-to-end via Gemini: Part-2 sample → 7.0/6.5/7.0 with
  concrete tips. Quota guard intact (3/day/IP).
- `node --check` clean on all JS.
- Pushed to Ayaz232005/speakband: commit 984a7dea, verified on main.

## Hosting notes
- Cloudflare Pages project `speakband` exists, but direct-upload API deployments
  500 on serve (manifest+branch multipart exactly as wrangler sends it; assets
  verified present via check-missing/upload responses). Root cause TBD — the
  worker-serves-static setup is the working path; revisit Pages later if needed.
- Redeploy static: upload files to KV (`PUT .../values/site:<path>`) then
  `python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf_deploy_worker.py`.
  KV is eventually consistent — allow ~1 min for edge propagation.
- Full runbook: hidden_files/DEPLOY.md.

## Next steps
1. Drive traffic: first content batch (news-roundup IELTS Shorts/TikTok/IG) —
   drafts need the user's per-post approval before anything goes public.
2. Supabase auth + progress tracking (later, when retention matters).
3. Freemium paywall ($8–10/mo) once free usage proves demand — via Creem
   or Paddle (both pay out to Pakistan; Stripe unavailable in PK).
