# SpeakBand — build notes (prototype v1, 2026-10-21)

Working name; branding not final.

## What exists
- `index.html` — the practice app (home → mode select → practice → band report).
- `landing.html` — marketing landing page with waitlist form (form endpoint TODO: Formspree free).
- `styles.css` — shared mobile-first styles.
- `questions.js` — question banks: 10× Part-1 topics (4 Qs each), 12× Part-2 cue cards, 6× Part-3 sets.
- `app.js` — flow logic, Web Speech API recording (en-GB), timers, DEMO heuristic band scorer.
- `worker.js` — Cloudflare Worker for production: POST /api/feedback (Gemini→Groq fallback chain,
  3 free gradings/day/IP via KV), POST /api/waitlist. Needs GEMINI_API_KEY + GROQ_API_KEY env
  (user's free signups, via secure entry when we get there). NOT deployed yet.

## Verified 2026-10-21
- `node --check` clean on questions.js + app.js.
- Demo scorer smoke-tested: weak sample → 6.0 overall (fluency 4.0); strong sample → 6.5.
- All 24 element IDs referenced in app.js exist in index.html; all 4 mode buttons present.
- Headless-Chromium screenshots failed in this VM (no png output) — visual check still TODO
  (open index.html in a real browser; mic needs HTTPS or localhost).

## Next steps
1. Visual QA in a real browser (mic flow, timers, report rendering).
2. Deploy static files to Cloudflare Pages (needs free Cloudflare account decision).
3. Wire landing waitlist form to Formspree (free, 50 submissions/mo) or worker endpoint.
4. When ready for real AI grading: get Gemini + Groq keys (user's free accounts), `wrangler secret put`,
   deploy worker.js, point app.js "Get band feedback" at /api/feedback.
5. Supabase auth + progress tracking (later, when retention matters).
