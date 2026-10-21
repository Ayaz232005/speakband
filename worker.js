/* SpeakBand API worker — Cloudflare Workers (free tier: 100k req/day).
 *
 * Endpoints:
 *   POST /api/feedback  { transcript, part, secondsSpoken } -> { scores, tips, stats }
 *   POST /api/waitlist  { email } -> { ok: true }
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
const GEMINI_MODEL = "gemini-3.5-flash-lite"; // 500 RPD free (Oct 2026); re-check
const GROQ_MODEL = "openai/gpt-oss-120b";     // 1,000 RPD free (Oct 2026); re-check

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
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      return handleFeedback(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/waitlist") {
      return handleWaitlist(request, env);
    }
    return json({ error: "not found" }, 404);
  },
};

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

  const userMsg = `Part ${body.part || "?"} of IELTS speaking. Spoke ~${body.secondsSpoken || "?"}s.\n\nTranscript:\n${transcript}`;

  let result = await gradeWithGemini(env, userMsg);
  if (!result.ok) result = await gradeWithGroq(env, userMsg);
  if (!result.ok) {
    return json({ error: "Grading is busy right now. Your practice was saved — try again in a minute." }, 503);
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
    return { ok: true, provider: "gemini", scores: JSON.parse(text) };
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
    return { ok: true, provider: "groq", scores: JSON.parse(text) };
  } catch { return { ok: false }; }
}

async function handleWaitlist(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid JSON" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter a valid email." }, 422);
  }
  // KV first (free); swap to Resend/Loops welcome email when configured.
  await env.KV.put(`waitlist:${email}`, new Date().toISOString());
  return json({ ok: true });
}

function dayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
