/* SpeakBand prototype — client-side speaking practice.
   STT: browser Web Speech API (free, on-device where supported, no server quota).
   Feedback: DEMO heuristic engine. Production will call /api/feedback
   (Cloudflare Worker → Gemini Flash-Lite / Groq free tier with per-user caps).
   Nothing leaves the browser in this prototype. */
"use strict";

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

function startRecognition(onUpdate, onEnd) {
  if (!srSupported()) return false;
  recognizer = new SR();
  recognizer.lang = "en-GB";            // IELTS examiners commonly use British English
  recognizer.interimResults = true;
  recognizer.continuous = true;
  recognizer.maxAlternatives = 1;
  finalTranscript = "";
  interimTranscript = "";

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
    // Part 2: prep countdown, then auto-enable speaking
    $("#btn-start-rec").disabled = true;
    let left = item.prep;
    session.prepTimer = setInterval(() => {
      left -= 1;
      $("#timer").textContent = fmtTime(Math.max(left, 0));
      if (left <= 0) {
        clearInterval(session.prepTimer);
        session.prepTimer = null;
        $("#timer-note").textContent = "Speak now — up to 2 minutes";
        $("#timer").textContent = fmtTime(item.seconds);
        $("#btn-start-rec").disabled = false;
      }
    }, 1000);
  }
}

function beginRecording() {
  const item = session.queue[session.idx];
  const box = $("#transcript");

  const onUpdate = (text) => {
    box.textContent = text.trim() || "";
  };
  const onEnd = (reason) => {
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

  session.speakElapsed = 0;
  let left = item.seconds;
  session.speakTimer = setInterval(() => {
    session.speakElapsed += 1;
    left -= 1;
    $("#timer").textContent = fmtTime(Math.max(left, 0));
    if (left <= 0) finishRecording("time-up");
  }, 1000);
}

function finishRecording(reason) {
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
  // Save current answer
  const item = session.queue[session.idx];
  let text = finalTranscript.trim();
  const typed = $("#fallback-text").value.trim();
  if (typed) text = typed;
  session.answers.push({
    part: item.part,
    prompt: item.prompt,
    transcript: text,
    secondsSpoken: session.speakElapsed,
    targetSeconds: item.seconds,
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
  clearTimers();
  if (session.answers.length > 0 && confirm("Quit this practice? Your recorded answers will be discarded.")) {
    session.answers = [];
    show("view-home");
  } else if (session.answers.length === 0) {
    show("view-home");
  }
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
  const all = session.answers.map((a) => a.transcript).join(" ");
  const totalTarget = session.answers.reduce((s, a) => s + a.targetSeconds, 0);
  const totalSpoken = session.answers.reduce((s, a) => s + a.secondsSpoken, 0);
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

  const list = $("#answer-list");
  list.innerHTML = "";
  session.answers.forEach((ans, i) => {
    const d = document.createElement("details");
    d.className = "card";
    const s = document.createElement("summary");
    s.style.cursor = "pointer";
    s.style.fontWeight = "700";
    s.textContent = `Answer ${i + 1} — ${ans.prompt.slice(0, 60)}${ans.prompt.length > 60 ? "…" : ""}`;
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = ans.transcript || "(no speech captured)";
    d.appendChild(s);
    d.appendChild(p);
    list.appendChild(d);
  });
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

  show("view-home");
});
