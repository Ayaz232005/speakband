/* SpeakBand API worker — Cloudflare Workers (free tier: 100k req/day).
 *
 * Endpoints:
 *   POST /api/feedback  { transcript, part, secondsSpoken } -> { scores, tips, stats }
 *   POST /api/waitlist  { email } -> { ok: true }
 *   GET  /, /index.html, /practice.html, /app.js, /questions.js, /styles.css
 *        -> serves the static site from KV (keys "site:<path>").
 *        The site is hosted HERE (single origin) because the Pages
 *        direct-upload API returned 500s on serve (2026-10-23, root cause TBD).
 *
 * Env (set via `wrangler secret put`, values come from the user's own free
 * signups — never committed):
 *   GEMINI_API_KEY   Google AI Studio key (free tier, no card)
 *   GROQ_API_KEY     GroqCloud key (free tier, no card)
 *
 * Free-tier router: Gemini Flash-Lite first, Groq gpt-oss-120b on 429/error.
 * Per-IP quota: 3 AI-graded mocks/day (KV, 24h TTL). Hard 429 beyond that —
 * never bills, never spends.
 */

const FREE_GRADED_PER_DAY = 3;
const WAITLIST_PER_IP_PER_DAY = 20;
const GEMINI_MODEL = "gemini-3.5-flash-lite"; // verified live 2026-10-22 via models list
const GROQ_MODEL = "openai/gpt-oss-120b";     // verified live 2026-10-22 via models list

const SYSTEM_PROMPT = `You are an IELTS speaking examiner. Score the transcript 0-9 in 0.5 steps on:
Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy.
(Pronunciation is scored separately from audio; omit it.)
Return ONLY valid JSON: {"fluency":x,"lexical":x,"grammar":x,
"tips":{"fluency":"...","lexical":"...","grammar":"..."},
"strength":"one sentence","fix":"one sentence: the single highest-leverage fix"}
Tips must be concrete drills, max 25 words each. Be strict like a real examiner;
a hesitant, filler-heavy answer scores below 6.`;

export default {
  async fetch(request, env) {
    // CORS preflight: the frontend may be served from Pages on another origin.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (!env.KV) {
      return json({ error: "Server storage not configured. Please try again later." }, 500);
    }
    const url = new URL(request.url);
    // Static site (single origin — no CORS needed, but the API keeps it anyway).
    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      return serveStatic(url.pathname, env);
    }
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      return handleFeedback(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/waitlist") {
      return handleWaitlist(request, env);
    }
    return json({ error: "not found" }, 404);
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/* ---------- static site (served from KV, keys "site:<path>") ----------
   Upload with: PUT /accounts/{id}/storage/kv/namespaces/{ns}/values/site:<path>
   Short cache so redeploys propagate within minutes on the free tier. */
const STATIC_FILES = {
  "/": "/index.html",
  "/index.html": "/index.html",
  "/practice.html": "/practice.html",
  "/app.js": "/app.js",
  "/questions.js": "/questions.js",
  "/styles.css": "/styles.css",
  "/speakband-avatar.png": "/speakband-avatar.png",
};
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

async function serveStatic(pathname, env) {
  const file = STATIC_FILES[pathname];
  if (!file) return json({ error: "not found" }, 404);
  const ext = file.slice(file.lastIndexOf("."));
  const binary = ext === ".png";
  const body = binary
    ? await env.KV.get("site:" + file, "arrayBuffer")
    : await env.KV.get("site:" + file);
  if (body == null) return json({ error: "not found" }, 404);
  return new Response(body, {
    headers: {
      "Content-Type": STATIC_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=300",
      ...corsHeaders(),
    },
  });
}

async function handleFeedback(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid JSON" }, 400); }

  const transcript = String(body.transcript || "").slice(0, 6000).trim();
  if (transcript.split(/\s+/).length < 10) {
    return json({ error: "Answer too short to grade. Speak for at least 20-30 seconds." }, 422);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `quota:${ip}:${dayStamp()}`;
  const used = parseInt((await env.KV.get(key)) || "0", 10);
  if (used >= FREE_GRADED_PER_DAY) {
    return json({ error: "Daily free AI-grading limit reached (3/day). Try again tomorrow." }, 429);
  }

  // Sanitize prompt inputs: part is whitelisted, secondsSpoken is numeric.
  const part = ["1", "2", "3"].includes(String(body.part)) ? body.part : "?";
  const secs = Math.max(0, Math.min(900, parseInt(body.secondsSpoken, 10) || 0)) || "?";
  const userMsg = `Part ${part} of IELTS speaking. Spoke ~${secs}s.\n\nTranscript:\n${transcript}`;

  let result = await gradeWithGemini(env, userMsg);
  if (!result.ok) result = await gradeWithGroq(env, userMsg);
  if (!result.ok) {
    return json({ error: "Grading is busy right now. Please try again in a minute." }, 503);
  }

  await env.KV.put(key, String(used + 1), { expirationTtl: 86400 });
  return json({ scores: result.scores, meta: { provider: result.provider } });
}

async function gradeWithGemini(env, userMsg) {
  if (!env.GEMINI_API_KEY) return { ok: false };
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userMsg }] }],
          generationConfig: { response_mime_type: "application/json", maxOutputTokens: 600 },
        }),
      }
    );
    if (!r.ok) return { ok: false, status: r.status };
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const scores = safeParseScores(text);
    if (!scores) return { ok: false };
    return { ok: true, provider: "gemini", scores };
  } catch { return { ok: false }; }
}

async function gradeWithGroq(env, userMsg) {
  if (!env.GROQ_API_KEY) return { ok: false };
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 0.3,
      }),
    });
    if (!r.ok) return { ok: false, status: r.status };
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || "";
    const scores = safeParseScores(text);
    if (!scores) return { ok: false };
    return { ok: true, provider: "groq", scores };
  } catch { return { ok: false }; }
}

/* Parse the model reply and validate the scoring contract: three numeric
   bands in 0–9. Anything else is treated as a grading failure (→ fallback). */
function safeParseScores(text) {
  let s;
  try { s = JSON.parse(text); } catch { return null; }
  if (!s || typeof s !== "object") return null;
  for (const k of ["fluency", "lexical", "grammar"]) {
    if (typeof s[k] !== "number" || !(s[k] >= 0 && s[k] <= 9)) return null;
  }
  return s;
}

async function handleWaitlist(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid JSON" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter a valid email." }, 422);
  }
  // Modest per-IP rate limit: KV writes are free-tier-capped, don't let one
  // client spam keys.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = `waitlist-quota:${ip}:${dayStamp()}`;
  const used = parseInt((await env.KV.get(rlKey)) || "0", 10);
  if (used >= WAITLIST_PER_IP_PER_DAY) {
    return json({ error: "Too many signups from this address today. Try again tomorrow." }, 429);
  }
  // KV first (free); swap to Resend/Loops welcome email when configured.
  await env.KV.put(`waitlist:${email}`, new Date().toISOString());
  await env.KV.put(rlKey, String(used + 1), { expirationTtl: 86400 });
  return json({ ok: true });
}

function dayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
