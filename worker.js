/* SpeakBand API worker — Cloudflare Workers (free tier: 100k req/day).
 *
 * Endpoints:
 *   POST /api/feedback  { transcript, part, secondsSpoken } -> { scores, tips, stats }
 *   POST /api/waitlist  { email } -> { ok: true }
 *   POST /api/signup    { email, password } -> { ok, email, plan } (sets sb_session cookie)
 *   POST /api/login     { email, password } -> { ok, email, plan } (sets sb_session cookie)
 *   POST /api/logout    -> { ok: true } (clears sb_session cookie)
 *   GET  /api/me        -> { email, plan, used_today, limit, history } | 401
 *   POST /api/lemon-webhook -> Lemon Squeezy subscription events (stub: verifies
 *        signature when LEMON_WEBHOOK_SECRET is set, logs, no-ops gracefully)
 *   GET  /, /index.html, /practice.html, /account.html, /login.html, /app.js,
 *        /questions.js, /styles.css, /motion.js, /privacy.html, /terms.html,
 *        /speakband-avatar.png
 *        -> serves the static site from KV (keys "site:<path>").
 *        The site is hosted HERE (single origin) because the Pages
 *        direct-upload API returned 500s on serve (2026-10-23, root cause TBD).
 *
 * Env (set via `wrangler secret put`, values come from the user's own free
 * signups — never committed):
 *   GEMINI_API_KEY   Google AI Studio key (free tier, no card)
 *   GROQ_API_KEY     GroqCloud key (free tier, no card)
 *   LEMON_WEBHOOK_SECRET  Lemon Squeezy webhook signing secret (set when the
 *                         store exists; webhook verifies + logs only until then)
 *
 * Auth storage (KV fallback — the API token has no D1 scope as of 2026-10-23,
 * so D1 was not created; swap the getUser/putUser/getSession/putSession/
 * delSession helpers below for D1 when scope is granted — the rest of the
 * code only talks to those helpers):
 *   user:<email>     JSON { email, salt(b64), hash(b64), iters, created_at, pro_until }
 *   session:<token>  JSON { email, expires } (TTL 30d)
 *   usage:<email>:<day>  account grading count (TTL 24h)
 *   history:<email>  JSON array, last 20 gradings (TTL 90d)
 *   authrl:<ip>:<day>    signup/login attempt count (TTL 24h)
 *
 * Free-tier router: Gemini Flash-Lite first, Groq gpt-oss-120b on 429/error.
 * Per-account quota: 3 AI gradings/day tied to the ACCOUNT (logged in);
 * anonymous visitors keep the existing per-IP quota. Hard 429 beyond that —
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
    if (request.method === "POST" && url.pathname === "/api/signup") {
      return handleSignup(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/login") {
      return handleLogin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/logout") {
      return handleLogout(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/me") {
      return handleMe(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/lemon-webhook") {
      return handleLemonWebhook(request, env);
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
  "/motion.js": "/motion.js",
  "/privacy.html": "/privacy.html",
  "/terms.html": "/terms.html",
  "/account.html": "/account.html",
  "/login.html": "/login.html",
  "/about.html": "/about.html",
  "/blog.html": "/blog.html",
  "/contact.html": "/contact.html",
  "/blog/band-6-mistakes.html": "/blog/band-6-mistakes.html",
  "/blog/how-speaking-is-scored.html": "/blog/how-speaking-is-scored.html",
  "/blog/practice-alone.html": "/blog/practice-alone.html",
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
  // Logged-in users get their quota tied to the ACCOUNT; anonymous visitors
  // keep the existing per-IP quota. Same 3/day free limit either way.
  const sessionUser = await getSessionUser(request, env);
  const key = sessionUser ? `usage:${sessionUser.email}:${dayStamp()}` : `quota:${ip}:${dayStamp()}`;
  const used = parseInt((await env.KV.get(key)) || "0", 10);
  if (used >= FREE_GRADED_PER_DAY) {
    return json({
      error: sessionUser
        ? "Daily free AI-grading limit reached (3/day). Upgrade to Pro for unlimited grading."
        : "Daily free AI-grading limit reached (3/day). Sign up free — your quota follows your account.",
      signup: !sessionUser,
    }, 429);
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
  if (sessionUser) {
    await recordGrading(env, sessionUser.email, {
      date: new Date().toISOString(),
      part,
      fluency: result.scores.fluency,
      lexical: result.scores.lexical,
      grammar: result.scores.grammar,
      provider: result.provider,
    });
  }
  return json({
    scores: result.scores,
    meta: { provider: result.provider, account: !!sessionUser, used: used + 1, limit: FREE_GRADED_PER_DAY },
  });
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

/* ---------- Lemon Squeezy webhook (activation-ready stub) ----------
   Until the store exists this verifies nothing and changes nothing: it
   validates the HMAC signature when LEMON_WEBHOOK_SECRET is configured,
   logs the event type, and returns 200. When Pro launches, extend this to
   record subscription status in KV (keyed by customer email). */
async function handleLemonWebhook(request, env) {
  const raw = await request.text();
  const secret = env.LEMON_WEBHOOK_SECRET || "";
  if (secret) {
    const sig = request.headers.get("x-signature") || "";
    const ok = await verifyLemonSignature(raw, sig, secret);
    if (!ok) return json({ error: "bad signature" }, 401);
  }
  let event = { meta: {} };
  try { event = JSON.parse(raw); } catch { /* keep default */ }
  const type = event?.meta?.event_name || "unknown";
  // No-op for now: log + acknowledge. Pro entitlements land here at launch.
  console.log(`[lemon-webhook] ${type}`);
  return json({ ok: true, received: type });
}

async function verifyLemonSignature(rawBody, signatureHex, secret) {
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
    return timingSafeEqualHex(hex, signatureHex);
  } catch { return false; }
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- accounts: signup / login / logout / me ----------
   KV-backed (D1 swap point documented in the file header). Passwords are
   PBKDF2-SHA256 (100k iterations) via WebCrypto; sessions are 256-bit random
   tokens in HttpOnly Secure SameSite=Lax cookies. Passwords are never logged. */
const PBKDF2_ITERS = 100000;
const SESSION_TTL = 30 * 24 * 3600; // 30 days, seconds
const AUTH_RL_PER_DAY = 20;         // signup/login attempts per IP per day

/* Storage helpers — the ONLY functions that touch user/session keys.
   Swap these for D1 when the API token gains scope. */
async function getUser(env, email) {
  const raw = await env.KV.get("user:" + email);
  return raw ? JSON.parse(raw) : null;
}
async function putUser(env, user) {
  await env.KV.put("user:" + user.email, JSON.stringify(user));
}
async function getSession(env, token) {
  const raw = await env.KV.get("session:" + token);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s.email || s.expires < Date.now()) {
    await env.KV.delete("session:" + token).catch(() => {});
    return null;
  }
  return s;
}
async function putSession(env, token, email) {
  await env.KV.put("session:" + token,
    JSON.stringify({ email, expires: Date.now() + SESSION_TTL * 1000 }),
    { expirationTtl: SESSION_TTL });
}
async function delSession(env, token) {
  await env.KV.delete("session:" + token).catch(() => {});
}

function b64encode(u8) {
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function randomHex(nbytes) {
  return [...crypto.getRandomValues(new Uint8Array(nbytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    key, 256);
  return new Uint8Array(bits);
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function sessionCookie(token, maxAge) {
  return `sb_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function sessionUserFromRequest(request) {
  // Only used for cookie parsing; validation happens in getSessionUser.
  const cookie = request.headers.get("Cookie") || "";
  const m = /(?:^|;\s*)sb_session=([a-f0-9]{64})/.exec(cookie);
  return m ? m[1] : null;
}
async function getSessionUser(request, env) {
  const token = sessionUserFromRequest(request);
  if (!token) return null;
  const s = await getSession(env, token);
  if (!s) return null;
  return getUser(env, s.email);
}
function planOf(user) {
  return user && user.pro_until > Date.now() ? "Pro" : "Free";
}
function publicUser(env, user, usedToday) {
  return { email: user.email, plan: planOf(user), used_today: usedToday, limit: FREE_GRADED_PER_DAY };
}
async function authRateLimited(env, ip) {
  const k = `authrl:${ip}:${dayStamp()}`;
  const n = parseInt((await env.KV.get(k)) || "0", 10);
  if (n >= AUTH_RL_PER_DAY) return true;
  await env.KV.put(k, String(n + 1), { expirationTtl: 86400 });
  return false;
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleSignup(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await authRateLimited(env, ip)) {
    return json({ error: "Too many attempts from this address. Try again tomorrow." }, 429);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid JSON" }, 400); }
  const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
  const password = String(body.password || "");
  if (!validEmail(email)) return json({ error: "Please enter a valid email." }, 422);
  if (password.length < 8 || password.length > 128) {
    return json({ error: "Password must be 8–128 characters." }, 422);
  }
  if (await getUser(env, email)) {
    return json({ error: "An account with this email already exists. Try logging in." }, 409);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  const user = {
    email,
    salt: b64encode(salt),
    hash: b64encode(hash),
    iters: PBKDF2_ITERS,
    created_at: new Date().toISOString(),
    pro_until: 0,
  };
  await putUser(env, user);
  const token = randomHex(32);
  await putSession(env, token, email);
  const res = json({ ok: true, ...publicUser(env, user, 0) });
  res.headers.append("Set-Cookie", sessionCookie(token, SESSION_TTL));
  return res;
}

async function handleLogin(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await authRateLimited(env, ip)) {
    return json({ error: "Too many attempts from this address. Try again tomorrow." }, 429);
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid JSON" }, 400); }
  const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
  const password = String(body.password || "");
  if (!validEmail(email) || !password) {
    return json({ error: "Enter your email and password." }, 422);
  }
  const user = await getUser(env, email);
  // Generic message either way — don't reveal whether the email exists.
  const fail = () => json({ error: "Email or password didn't match. Try again." }, 401);
  if (!user) {
    // Burn equal-ish work so timing doesn't leak existence.
    await hashPassword("dummy-password-for-timing", crypto.getRandomValues(new Uint8Array(16)));
    return fail();
  }
  const hash = await hashPassword(password, b64decode(user.salt));
  if (!bytesEqual(hash, b64decode(user.hash))) return fail();
  const token = randomHex(32);
  await putSession(env, token, email);
  const used = parseInt((await env.KV.get(`usage:${email}:${dayStamp()}`)) || "0", 10);
  const res = json({ ok: true, ...publicUser(env, user, used) });
  res.headers.append("Set-Cookie", sessionCookie(token, SESSION_TTL));
  return res;
}

async function handleLogout(request, env) {
  const token = sessionUserFromRequest(request);
  if (token) await delSession(env, token);
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie("deleted", 0));
  return res;
}

async function handleMe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Not signed in." }, 401);
  const used = parseInt((await env.KV.get(`usage:${user.email}:${dayStamp()}`)) || "0", 10);
  let history = [];
  try { history = JSON.parse(await env.KV.get("history:" + user.email) || "[]"); }
  catch { /* keep empty */ }
  return json({ ...publicUser(env, user, used), history: history.slice(0, 20) });
}

/* Per-user grading history (last 20, 90-day TTL). */
async function recordGrading(env, email, entry) {
  const k = "history:" + email;
  let arr = [];
  try { arr = JSON.parse(await env.KV.get(k) || "[]"); } catch { /* reset */ }
  arr.unshift(entry);
  await env.KV.put(k, JSON.stringify(arr.slice(0, 20)), { expirationTtl: 90 * 86400 });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
