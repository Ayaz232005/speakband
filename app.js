/* SpeakBand prototype — client-side speaking practice.
   STT: browser Web Speech API (free; transcription runs through the browser's
   built-in speech service — in Chrome/Edge that means the browser maker's
   servers, not on-device).
   Feedback: DEMO heuristic engine. Production will call /api/feedback
   (Cloudflare Worker → Gemini Flash-Lite / Groq free tier with per-user caps).
   Transcripts stay on-device in this prototype; nothing is uploaded. */
"use strict";

/* SpeakBand API (Cloudflare Worker, live since 2026-10-22).
   The frontend is hosted on a different origin (Cloudflare Pages), so all
   API calls go to this absolute URL. The worker allows cross-origin POSTs. */
const API_BASE = "https://speakband-api.ayazawan273.workers.dev";

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);

function show(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

/* ---------- speech recognition ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let recognizing = false;
let finalTranscript = "";
let interimTranscript = "";

function srSupported() { return !!SR; }

function startRecognition(onUpdate, onEnd, keepTranscript) {
  if (!srSupported()) return false;
  recognizer = new SR();
  recognizer.lang = "en-GB";            // IELTS examiners commonly use British English
  recognizer.interimResults = true;
  recognizer.continuous = true;
  recognizer.maxAlternatives = 1;
  if (!keepTranscript) {
    finalTranscript = "";
    interimTranscript = "";
  }

  recognizer.onresult = (e) => {
    interimTranscript = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTranscript += t + " ";
      else interimTranscript += t;
    }
    onUpdate(finalTranscript + interimTranscript);
  };
  recognizer.onerror = (e) => {
    console.warn("speech error", e.error);
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      onEnd("mic-blocked");
      return;
    }
  };
  recognizer.onend = () => {
    recognizing = false;
    onEnd("ended");
  };
  try {
    recognizer.start();
    recognizing = true;
    return true;
  } catch (err) {
    console.warn("recognizer.start failed", err);
    return false;
  }
}

function stopRecognition() {
  recognizing = false;
  try { if (recognizer) recognizer.stop(); } catch (e) { /* noop */ }
}

/* ---------- session state ---------- */
const session = {
  mode: null,            // 'part1' | 'part2' | 'part3' | 'full'
  queue: [],             // [{part, label, prompt, points?, seconds}]
  idx: 0,
  answers: [],           // [{part, prompt, transcript, secondsSpoken}]
  prepTimer: null,
  speakTimer: null,
  speakElapsed: 0,
};

function buildQueue(mode) {
  const q = [];
  if (mode === "part1" || mode === "full") {
    const t = pickRandom(PART1_TOPICS);
    t.questions.forEach((ques, i) =>
      q.push({ part: 1, label: `Part 1 · Q${i + 1} — ${t.topic}`, prompt: ques, seconds: 45 }));
  }
  if (mode === "part2" || mode === "full") {
    const c = pickRandom(PART2_CARDS);
    q.push({ part: 2, label: "Part 2 · Cue card", prompt: c.title, points: c.points, seconds: 120, prep: 60 });
  }
  if (mode === "part3" || mode === "full") {
    const s = pickRandom(PART3_SETS);
    s.questions.forEach((ques, i) =>
      q.push({ part: 3, label: `Part 3 · Q${i + 1} — ${s.theme}`, prompt: ques, seconds: 60 }));
  }
  return q;
}

/* ---------- practice flow ---------- */
function startMode(mode) {
  session.mode = mode;
  session.queue = buildQueue(mode);
  session.idx = 0;
  session.answers = [];
  renderQuestion();
  show("view-practice");
}

function renderQuestion() {
  clearTimers();
  const item = session.queue[session.idx];
  const total = session.queue.length;

  $("#q-progress").textContent = `Question ${session.idx + 1} of ${total}`;
  $("#q-label").textContent = item.label;
  $("#q-prompt").textContent = item.prompt;

  const pts = $("#q-points");
  pts.innerHTML = "";
  if (item.points) {
    const ul = document.createElement("ul");
    item.points.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    });
    pts.appendChild(ul);
  }

  $("#transcript").innerHTML = '<span class="placeholder">Your words will appear here as you speak…</span>';
  $("#fallback-box").classList.add("hidden");
  $("#fallback-text").value = "";
  $("#btn-start-rec").classList.remove("hidden");
  $("#btn-stop-rec").classList.add("hidden");
  $("#btn-next-q").classList.add("hidden");
  $("#rec-state").innerHTML = '<span class="rec-idle"></span><span class="muted">Mic ready</span>';
  $("#timer").textContent = fmtTime(item.prep || item.seconds);
  $("#timer-note").textContent = item.prep
    ? "Preparation time — think, then speak when ready"
    : "Target speaking time";

  if (item.prep) {
    // Part 2: prep countdown, then auto-enable speaking.
    // Timestamp-based so background-tab throttling can't skew the timer.
    $("#btn-start-rec").disabled = true;
    const prepEndAt = Date.now() + item.prep * 1000;
    session.prepTimer = setInterval(() => {
      const left = Math.max(0, Math.round((prepEndAt - Date.now()) / 1000));
      $("#timer").textContent = fmtTime(left);
      if (left <= 0) {
        clearInterval(session.prepTimer);
        session.prepTimer = null;
        $("#timer-note").textContent = "Speak now — up to 2 minutes";
        $("#timer").textContent = fmtTime(item.seconds);
        $("#btn-start-rec").disabled = false;
      }
    }, 500);
  }
}

function beginRecording() {
  const item = session.queue[session.idx];
  const box = $("#transcript");

  // Reset per-question recording state FIRST (also covers the typed-fallback path below).
  session.speakElapsed = 0;
  session.finishing = false;
  session.manualStop = false;

  const onUpdate = (text) => {
    box.textContent = text.trim() || "";
  };
  const onEnd = (reason) => {
    // Chrome/Edge auto-stop recognition after ~60s of continuous speech or a
    // long silence — silently restart while the speak timer is still running
    // so a long turn isn't cut off mid-answer. If the restart itself fails,
    // end the question instead of running a dead timer.
    if (reason === "ended" && session.speakTimer && !session.manualStop) {
      if (startRecognition(onUpdate, onEnd, /* keepTranscript */ true)) return;
    }
    finishRecording(reason);
  };

  const ok = startRecognition(onUpdate, onEnd);
  if (!ok) {
    // Fallback: typed answer (unsupported browser / mic blocked)
    stopRecognition();
    $("#fallback-box").classList.remove("hidden");
    $("#rec-state").innerHTML = '<span class="rec-idle"></span><span class="muted">Mic unavailable — type your answer instead</span>';
    $("#btn-start-rec").classList.add("hidden");
    $("#btn-next-q").classList.remove("hidden");
    return;
  }

  $("#btn-start-rec").classList.add("hidden");
  $("#btn-stop-rec").classList.remove("hidden");
  $("#rec-state").innerHTML = '<span class="rec-dot"></span><span class="muted">Recording… speak naturally</span>';

  // Timestamp-based countdown: immune to background-tab timer throttling.
  const speakEndAt = Date.now() + item.seconds * 1000;
  session.speakTimer = setInterval(() => {
    const left = Math.max(0, Math.round((speakEndAt - Date.now()) / 1000));
    session.speakElapsed = item.seconds - left;
    $("#timer").textContent = fmtTime(left);
    if (left <= 0) finishRecording("time-up");
  }, 500);
}

function finishRecording(reason) {
  if (session.finishing) return; // recognizer.onend re-fires after stop() — ignore the echo
  session.finishing = true;
  session.manualStop = true;     // block Chrome auto-restart from here on
  if (session.speakTimer) { clearInterval(session.speakTimer); session.speakTimer = null; }
  stopRecognition();
  $("#btn-stop-rec").classList.add("hidden");
  $("#btn-next-q").classList.remove("hidden");
  const label = reason === "time-up" ? "Time's up" : reason === "mic-blocked" ? "Mic blocked" : "Recording stopped";
  $("#rec-state").innerHTML = '<span class="rec-idle"></span><span class="muted">' + label + "</span>";
  if (reason === "mic-blocked") {
    $("#fallback-box").classList.remove("hidden");
  }
}

function nextQuestion() {
  // Save current answer. Very short/empty answers are recorded but NOT scored —
  // a band score for silence would be meaningless.
  const item = session.queue[session.idx];
  let text = finalTranscript.trim();
  const typed = $("#fallback-text").value.trim();
  if (typed) text = typed;
  const words = text.split(/\s+/).filter(Boolean).length;

  // Typed answers never touch the mic timer: estimate speaking time from word
  // count at ~150 wpm so they're not systematically under-scored.
  let secondsSpoken = session.speakElapsed;
  if (typed) secondsSpoken = Math.min(Math.round(words / 2.5), item.seconds);

  session.answers.push({
    part: item.part,
    prompt: item.prompt,
    transcript: text,
    secondsSpoken,
    targetSeconds: item.seconds,
    scored: words >= 10,
  });

  session.idx += 1;
  finalTranscript = "";
  if (session.idx >= session.queue.length) {
    renderReport();
    show("view-report");
  } else {
    renderQuestion();
  }
}

function clearTimers() {
  if (session.prepTimer) { clearInterval(session.prepTimer); session.prepTimer = null; }
  if (session.speakTimer) { clearInterval(session.speakTimer); session.speakTimer = null; }
  stopRecognition();
}

function quitPractice() {
  // Confirm BEFORE killing timers: cancelling the dialog must leave the
  // practice session (and its timers) untouched, never stranded.
  if (session.answers.length > 0) {
    if (!confirm("Quit this practice? Your recorded answers will be discarded.")) return;
    session.answers = [];
  }
  clearTimers();
  show("view-home");
}

/* ---------- DEMO feedback engine ----------
   Heuristic stand-in for the production LLM scorer.
   Scores 4 IELTS criteria 0–9 in 0.5 steps from transcript features. */
const FILLERS = ["um", "uh", "erm", "ah", "like", "you know", "actually", "basically", "well", "so"];

function analyze(text) {
  const clean = text.toLowerCase().replace(/[^a-z'\s]/g, " ");
  const words = clean.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?…]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 2);
  const unique = new Set(words);
  const fillerHits = words.filter((w) => ["um", "uh", "erm", "ah"].includes(w)).length
    + (text.toLowerCase().match(/you know|like,/g) || []).length;
  const selfCorrect = (text.toLowerCase().match(/i mean|sorry|what i mean|let me (say|rephrase)/g) || []).length;
  const linkers = ["however", "moreover", "furthermore", "although", "despite", "whereas", "consequently",
    "therefore", "in contrast", "on the other hand", "for instance", "for example", "in addition",
    "as a result", "nevertheless", "meanwhile"].filter((l) => clean.includes(l)).length;
  const complex = sentences.filter((s) => /because|although|while|which|who|that|if |when |since/.test(s.toLowerCase())).length;

  return {
    wordCount: words.length,
    uniqueRatio: words.length ? unique.size / words.length : 0,
    avgSentLen: sentences.length ? words.length / sentences.length : 0,
    fillerRate: words.length ? fillerHits / words.length : 0,
    selfCorrect,
    linkers,
    complexRatio: sentences.length ? complex / sentences.length : 0,
    sentenceCount: sentences.length,
  };
}

function bandRound(x) { return Math.round(x * 2) / 2; }
function clampBand(x) { return Math.max(3, Math.min(9, bandRound(x))); }

function scoreCriteria(a, coverage) {
  // coverage: 0..1 — how much of the target speaking time was used
  const base = 4.5 + coverage * 1.5;

  const fluency = clampBand(
    base
    + (a.wordCount > 120 ? 1 : a.wordCount > 60 ? 0.5 : -0.5)
    - a.fillerRate * 12
    - Math.min(a.selfCorrect * 0.25, 1)
    + (a.avgSentLen > 12 ? 0.5 : 0)
  );

  const lexical = clampBand(
    base
    + (a.uniqueRatio > 0.62 ? 1 : a.uniqueRatio > 0.5 ? 0.5 : -0.5)
    + Math.min(a.linkers * 0.25, 1)
    + (a.wordCount > 150 ? 0.5 : 0)
  );

  const grammar = clampBand(
    base
    + (a.complexRatio > 0.4 ? 1 : a.complexRatio > 0.2 ? 0.5 : -0.5)
    + (a.avgSentLen > 14 ? 0.5 : 0)
    - Math.min(a.selfCorrect * 0.2, 0.75)
  );

  const pronunciation = clampBand(base + 0.5); // demo: STT text can't judge pronunciation
  return { fluency, lexical, grammar, pronunciation };
}

function tipsFor(name, score) {
  const tips = {
    fluency: score < 6
      ? "Slow down slightly and pause between ideas instead of filling silence with “um”. Try the 4-3-2 technique: say the same answer in 4 minutes, then 3, then 2."
      : "Good flow. Push toward band 7+ by extending answers with a reason and an example instead of stopping at one sentence.",
    lexical: score < 6
      ? "Learn 5–6 topic collocations (e.g. “bustling city”, “tight-knit family”) and force yourself to use two per answer. Avoid repeating the question's words."
      : "Range is developing well. Add less-common phrases and precise adjectives to lift Lexical Resource toward 7.",
    grammar: score < 6
      ? "Mix one complex sentence into every answer: start with “Although…”, “Because…”, or “If…”. Record yourself and count them."
      : "Structures are solid. Vary conditionals and relative clauses, and watch verb tenses when you narrate past events.",
    pronunciation: "Demo note: pronunciation can't be scored from text. In the full version this uses your audio. Meanwhile, shadow native speakers: repeat 10 seconds of audio, matching rhythm and stress.",
  };
  return tips[name];
}

function criterionName(k) {
  return { fluency: "Fluency & Coherence", lexical: "Lexical Resource",
           grammar: "Grammatical Range & Accuracy", pronunciation: "Pronunciation (demo)" }[k];
}

function renderReport() {
  // Only scorable answers feed the band computation — unscored ones are still
  // listed below, marked as not scored.
  const scored = session.answers.filter((a) => a.scored);

  const list = $("#answer-list");
  list.innerHTML = "";
  session.answers.forEach((ans, i) => {
    const d = document.createElement("details");
    d.className = "card";
    const s = document.createElement("summary");
    s.style.cursor = "pointer";
    s.style.fontWeight = "700";
    s.textContent = `Answer ${i + 1} — ${ans.prompt.slice(0, 60)}${ans.prompt.length > 60 ? "…" : ""}` +
      (ans.scored ? "" : " · not scored (too short)");
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = ans.transcript || "(no speech captured)";
    d.appendChild(s);
    d.appendChild(p);
    list.appendChild(d);
  });

  if (!scored.length) {
    $("#band-overall").innerHTML = "— <small>/ 9</small>";
    $("#band-sub").textContent =
      "No scorable answers this session. Speak (or type) at least a few sentences per question so we can grade you.";
    $("#criteria").innerHTML = "";
    $("#stats").innerHTML = "";
    $("#btn-ai-feedback").classList.add("hidden");
    $("#ai-feedback").classList.add("hidden");
    return;
  }
  $("#btn-ai-feedback").classList.remove("hidden");
  $("#ai-feedback").classList.add("hidden");
  $("#ai-feedback").innerHTML = "";

  const all = scored.map((a) => a.transcript).join(" ");
  const totalTarget = scored.reduce((s, a) => s + a.targetSeconds, 0);
  const totalSpoken = scored.reduce((s, a) => s + a.secondsSpoken, 0);
  const coverage = totalTarget ? Math.min(totalSpoken / totalTarget, 1) : 0;

  const a = analyze(all);
  const scores = scoreCriteria(a, coverage);
  const overall = bandRound((scores.fluency + scores.lexical + scores.grammar + scores.pronunciation) / 4);

  $("#band-overall").innerHTML = overall.toFixed(1) + " <small>/ 9</small>";
  $("#band-sub").textContent =
    overall >= 7 ? "Strong performance — keep polishing." :
    overall >= 6 ? "Competent — targeted practice will lift you." :
    "A solid start — focused drills will move this fast.";

  const box = $("#criteria");
  box.innerHTML = "";
  ["fluency", "lexical", "grammar", "pronunciation"].forEach((k) => {
    const div = document.createElement("div");
    div.className = "criterion";
    div.innerHTML =
      `<div class="chead"><h4>${criterionName(k)}</h4><span class="score">${scores[k].toFixed(1)}</span></div>` +
      `<p>${tipsFor(k, scores[k])}</p>`;
    box.appendChild(div);
  });

  $("#stats").innerHTML = [
    [a.wordCount + " words", "total spoken"],
    [Math.round(a.fillerRate * 100) + "%", "filler-word rate"],
    [Math.round(a.uniqueRatio * 100) + "%", "vocabulary variety"],
    [session.answers.length + " answers", "recorded"],
  ].map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
}

/* ---------- production AI feedback (Cloudflare Worker) ----------
   POSTs the session transcript to the live /api/feedback endpoint (worker.js
   → Gemini/Groq free tier, 3 gradings/day/visitor). Errors (quota reached,
   network down) are shown honestly — a score is never faked. */
async function getAIFeedback() {
  const box = $("#ai-feedback");
  const btn = $("#btn-ai-feedback");
  box.classList.remove("hidden");
  box.innerHTML = '<p class="muted">Grading with AI — this takes a few seconds…</p>';
  btn.disabled = true;
  try {
    const scored = session.answers.filter((a) => a.scored);
    const transcript = scored
      .map((a) => `Q: ${a.prompt}\nA: ${a.transcript}`)
      .join("\n\n")
      .slice(0, 6000);
    const r = await fetch(API_BASE + "/api/feedback", {
      method: "POST",
      credentials: "same-origin", // sends sb_session so quota follows the account
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        part: scored[0] ? scored[0].part : 1,
        secondsSpoken: scored.reduce((s, a) => s + a.secondsSpoken, 0),
      }),
    });
    let data = {};
    try { data = await r.json(); } catch { /* non-JSON error page */ }
    if (r.status === 429 && data && data.signup) {
      // Out of anonymous quota — nudge toward a free account (quota follows it).
      box.innerHTML =
        '<div class="demo-note"><strong>Daily free AI-grading limit reached (3/day).</strong> ' +
        '<a href="/login.html" style="color:inherit;font-weight:700">Sign up free</a> — ' +
        "your quota and history follow your account.</div>";
      return;
    }
    if (!r.ok || !data.scores) throw new Error((data && data.error) || "grading unavailable");
    renderAIFeedback(box, data.scores, data.meta);
  } catch (e) {
    box.innerHTML =
      '<div class="demo-note"><strong>AI grading is unavailable right now.</strong> ' +
      "The demo scores above are yours to work with — please try the AI grading " +
      "again in a minute (each visitor gets 3 free AI gradings per day).</div>";
  } finally {
    btn.disabled = false;
  }
}

function renderAIFeedback(box, scores, meta) {
  const names = { fluency: "Fluency & Coherence", lexical: "Lexical Resource", grammar: "Grammatical Range & Accuracy" };
  const rows = ["fluency", "lexical", "grammar"].map((k) =>
    `<div class="criterion"><div class="chead"><h4>${names[k]} <span class="muted">· AI</span></h4>` +
    `<span class="score">${Number(scores[k]).toFixed(1)}</span></div>` +
    `<p>${escapeHtml((scores.tips && scores.tips[k]) || "")}</p></div>`
  ).join("");
  const usage = meta && typeof meta.used === "number"
    ? `<p class="muted" style="font-size:var(--step-small)">` +
      (meta.account ? `Signed in — ${meta.used} of ${meta.limit} free gradings used today.`
                    : `${meta.used} of ${meta.limit} free gradings used today. <a href="/login.html" style="color:inherit">Sign up free</a> to keep your history.`) +
      `</p>`
    : "";
  box.innerHTML =
    `<div class="card" style="margin:0"><h3 style="margin-top:0">🤖 AI examiner feedback` +
    (meta && meta.provider ? ` <span class="muted" style="font-weight:400">· via ${escapeHtml(meta.provider)}</span>` : "") +
    `</h3>${rows}` +
    (scores.strength ? `<p><strong>Strength:</strong> ${escapeHtml(scores.strength)}</p>` : "") +
    (scores.fix ? `<p><strong>One fix to focus on:</strong> ${escapeHtml(scores.fix)}</p>` : "") +
    usage + `</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- wiring ---------- */
document.addEventListener("DOMContentLoaded", () => {
  $("#year").textContent = new Date().getFullYear();

  if (!srSupported()) {
    $("#mic-warning").classList.remove("hidden");
  }

  document.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", () => show("view-modes")));
  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => startMode(b.getAttribute("data-mode"))));
  $("#btn-back-home").addEventListener("click", () => show("view-home"));
  $("#btn-start-rec").addEventListener("click", beginRecording);
  $("#btn-stop-rec").addEventListener("click", () => finishRecording("stopped"));
  $("#btn-next-q").addEventListener("click", nextQuestion);
  $("#btn-quit").addEventListener("click", quitPractice);
  $("#btn-again").addEventListener("click", () => startMode(session.mode));
  $("#btn-home2").addEventListener("click", () => show("view-home"));
  $("#btn-ai-feedback").addEventListener("click", getAIFeedback);

  show("view-home");
});
