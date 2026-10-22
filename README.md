# SpeakBand — build notes (prototype v1.2, 2026-10-22)

Working name; branding not final.

## What exists
- `index.html` — the practice app (home → mode select → practice → band report).
- `landing.html` — marketing landing page with waitlist form (POSTs to `/api/waitlist`;
  on-device localStorage queue + auto-sync until the worker is deployed — no lead is lost).
- `styles.css` — shared mobile-first styles.
- `questions.js` — question banks: 10× Part-1 topics (4 Qs each), 12× Part-2 cue cards, 6× Part-3 sets.
- `app.js` — flow logic, Web Speech API recording (en-GB), timestamp-based timers,
  Chrome auto-restart for long turns, DEMO heuristic band scorer (unscored answers excluded),
  "Get AI band feedback" button → POST /api/feedback (honest "not live yet" until deployed).
- `worker.js` — Cloudflare Worker: POST /api/feedback (Gemini→Groq fallback chain,
  3 free gradings/day/IP via KV, CORS + input sanitizing + score validation),
  POST /api/waitlist (per-IP rate limit). Needs GEMINI_API_KEY + GROQ_API_KEY env
  (user's free signups, via secure entry when we get there). NOT deployed yet.
- `wrangler.toml` — deploy config (KV namespace id placeholder).

## Verified 2026-10-21
- `node --check` clean on questions.js + app.js.
- Demo scorer smoke-tested: weak sample → 6.0 overall (fluency 4.0); strong sample → 6.5.
- All 24 element IDs referenced in app.js exist in index.html; all 4 mode buttons present.
- Headless-Chromium screenshots failed in this VM (no png output) — visual check still TODO
  (open index.html in a real browser; mic needs HTTPS or localhost).

## Verified 2026-10-22 (Day 3)
- Model IDs verified LIVE against both APIs: `gemini-3.5-flash-lite` and
  `openai/gpt-oss-120b` both exist (worker.js updated).
- Grading prompt validated end-to-end on the real Gemini API via the stored key:
  weak transcript → 4.0/3.5/4.0, strong transcript → 8.5/8.0/8.5; JSON contract valid.
  Strict examiner behavior confirmed (hesitant filler-heavy answer scores below 6).
- Static code review (25 findings) applied: CORS on worker, waitlist wired with
  honest on-device fallback, quit-confirm timer fix, speakElapsed reset fix,
  empty-answer guard (silence is no longer scored ~5.5), typed-answer coverage
  estimate, finishRecording double-fire guard, timestamp timers, Chrome
  recognizer auto-restart, privacy copy corrected (Web Speech API streams to the
  browser maker's servers in Chrome/Edge), iOS input zoom fix, button markup
  validity, footer contrast, dead code removed.
- "Get AI band feedback" button added to the report view: POSTs the session to
  /api/feedback, renders AI bands/tips/strength/fix; shows an honest "not live
  yet" note until the worker is deployed (never fakes a score).
- `node --check` clean on all JS after fixes; HTML tag-balance valid on both pages.
- Visual QA in a real browser still TODO: live-browser task couldn't reach the
  VM's localhost (separate environment), and this VM has no browser binaries —
  static verification only. Deploy first, then QA on the live URL.
- Cloudflare: dash.cloudflare.com shows the login page in the browser profile —
  NO active session. Deployment needs the account owner to log in (one tiny
  action) or run the Path A commands; worker secrets can only be entered by the
  key owner. Full runbook: hidden_files/DEPLOY.md.
- Pushed to Ayaz232005/speakband: commits b22d13a (v1.1 fixes) + c36300e (v1.2 AI
  button), verified with live reads.

## Next steps
1. **Deploy** (blocked on one tiny owner action — see hidden_files/DEPLOY.md):
   Cloudflare login → `wrangler kv namespace create KV` → fill id in wrangler.toml →
   `wrangler secret put` GEMINI_API_KEY + GROQ_API_KEY (key owner pastes values) →
   `wrangler deploy` + `wrangler pages deploy`. Interim alternative: GitHub Pages
   (repo Settings → Pages → main branch, one click) for the static site now.
2. Visual QA on the live URL (mic flow, timers, report rendering, AI feedback button).
3. Supabase auth + progress tracking (later, when retention matters).
