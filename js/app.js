import { store, textCache } from "./store.js";
import { extractResource } from "./extract.js";
import { player, englishVoices, pickVoice } from "./player.js";
import { grade as srsGrade, outcomeFrom, dueKeys, forecast, cardCount, matureCount } from "./srs.js";
import { loadSavedIndex, isSaved, markSaved, downloadable, savedCount, downloadAll, storageEstimate } from "./offline.js";

// ---------------------------------------------------------------- data
const C = { stages: [], modules: new Map(), resources: new Map(), order: [] };

async function loadCurriculum() {
  const index = await (await fetch("data/stages/index.json", { cache: "no-cache" })).json();
  const stages = await Promise.all(index.files.map(async (f) => (await fetch(`data/stages/${f}`, { cache: "no-cache" })).json()));
  stages.sort((a, b) => a.number - b.number);
  const seen = new Map();
  for (const s of stages) {
    for (const m of s.modules) {
      m.stage = s;
      C.modules.set(m.id, m);
      C.order.push(m);
      for (const r of m.resources) {
        r.module = m;
        r.stage = s;
        C.resources.set(r.id, r);
        const key = r.arxiv || r.youtube || r.url;
        if (seen.has(key)) { store.alias(r.id, seen.get(key)); } else { seen.set(key, r.id); }
      }
    }
  }
  C.stages = stages;
}

// ---------------------------------------------------------------- helpers
const $ = (sel, el = document) => el.querySelector(sel);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const paras = (text) => String(text || "").split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("");
const PASS = 80; // mastery threshold

const ICONS = {
  paper: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9v6l5-3z" fill="currentColor"/></svg>',
  essay: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z M12 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  course: '<svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  tool: '<svg viewBox="0 0 24 24"><path d="M14 6a4 4 0 0 0 5 5l-8 8a2 2 0 0 1-3-3l8-8a4 4 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 8 14" width="8" height="14"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>',
  back15: '<svg viewBox="0 0 24 24"><path d="M11 6 6 10.5 11 15M6.5 10.5H15a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fwd15: '<svg viewBox="0 0 24 24"><path d="M13 6l5 4.5-5 4.5M17.5 10.5H9a5 5 0 0 0 0 10h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const KIND_LABEL = { paper: "Paper", video: "Video", essay: "Essay", book: "Book", course: "Course", tool: "Tool" };

function kindIcon(r) {
  return `<span class="kind-icon ${store.isDone(r.id) ? "done" : ""}">${store.isDone(r.id) ? ICONS.check : ICONS[r.kind] || ICONS.paper}</span>`;
}

function fmtMin(m) {
  if (!m) { return ""; }
  if (m < 60) { return `${Math.round(m)} min`; }
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
}

function resMeta(r) {
  return [KIND_LABEL[r.kind], r.authors, r.year, r.venue].filter(Boolean).map(esc).join(" · ");
}

let toastTimer = null;
function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2200);
}

// ---------------------------------------------------------------- progress logic
function required(m) { return m.resources.filter((r) => !r.optional); }

function moduleStatus(m) {
  const req = required(m);
  const done = req.filter((r) => store.isDone(r.id)).length;
  const q = store.quiz(m.id);
  const passed = !!q && q.best >= PASS;
  const units = req.length + 1;
  const got = done + (passed ? 1 : 0);
  return { done, total: req.length, passed, quiz: q, frac: got / units, complete: got === units };
}

function stageStatus(s) {
  let got = 0;
  let units = 0;
  let complete = 0;
  let minutes = 0;
  for (const m of s.modules) {
    const st = moduleStatus(m);
    got += st.done + (st.passed ? 1 : 0);
    units += st.total + 1;
    if (st.complete) { complete++; }
    minutes += required(m).reduce((n, r) => n + (r.minutes || 0), 0);
  }
  return { frac: units ? got / units : 0, complete, modules: s.modules.length, minutes };
}

function nextStep() {
  for (const m of C.order) {
    const next = required(m).find((r) => !store.isDone(r.id));
    if (next) { return { kind: "res", r: next, m }; }
    if (!moduleStatus(m).passed) { return { kind: "quiz", m }; }
  }
  return null;
}

// ---------------------------------------------------------------- chrome
function setTop({ title = "HAI Scholar", back = null, right = [] } = {}) {
  $("#title").textContent = title;
  const b = $("#back");
  if (back) {
    b.hidden = false;
    $("#back-label").textContent = back.label || "Back";
    b.onclick = () => { location.hash = back.href; };
  } else {
    b.hidden = true;
  }
  const rr = $("#topbar-right");
  rr.innerHTML = "";
  for (const item of right) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    btn.onclick = item.onClick;
    rr.appendChild(btn);
  }
}

function setTab(name) {
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === name));
}

function updateMini() {
  const mini = $("#miniplayer");
  const onListen = location.hash === `#/listen/${player.res?.id}`;
  const show = !!player.res && player.items.length > 0 && !onListen;
  mini.hidden = !show;
  document.body.classList.toggle("has-mini", show);
  if (!show) { return; }
  $("#mini-title").textContent = player.res.title;
  $("#mini-toggle").innerHTML = player.playing ? ICONS.pause : ICONS.play;
  $("#mini-toggle").querySelector("svg").setAttribute("width", "22");
}
$("#mini-toggle").onclick = () => player.toggle();
$("#mini-open").onclick = () => { location.hash = `#/listen/${player.res.id}`; };
player.addEventListener("change", updateMini);
player.addEventListener("completed", () => { if (!location.hash.startsWith("#/listen")) { toast("Marked as done ✓"); } });

// ---------------------------------------------------------------- views
function offlineTag(r) {
  return r.kind !== "video" && isSaved(r) ? ` · <span style="color:var(--good)">${ICONS.down} offline</span>` : "";
}

function resRow(r, sub = "") {
  return `<a class="li" href="#/res/${r.id}">${kindIcon(r)}
    <span class="li-body"><div class="li-title">${esc(r.title)}</div>
    <div class="li-sub">${resMeta(r)}${r.minutes ? ` · ${fmtMin(r.minutes)}` : ""}${offlineTag(r)}${sub}</div></span>${ICONS.chev}</a>`;
}

function dueCount() {
  return dueKeys().filter((k) => cardExists(k)).length;
}

function cardExists(key) {
  if (key.startsWith("r:")) { return C.resources.has(key.slice(2)); }
  const [mid, qi] = key.split(":");
  return !!C.modules.get(mid)?.quiz[qi];
}

function viewPath() {
  setTab("path");
  setTop({ title: "" });
  const next = nextStep();
  let total = 0;
  let got = 0;
  for (const s of C.stages) { const st = stageStatus(s); total += 1; got += st.frac; }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const due = dueCount();

  let cont = "";
  if (next?.kind === "res") {
    const pos = store.pos(next.r.id);
    const started = pos && pos.i > 0;
    const pre = store.pre(next.m.id);
    const fresh = !pre && required(next.m).every((r) => !store.isDone(r.id));
    const href = fresh ? `#/pre/${next.m.id}` : `#/res/${next.r.id}`;
    cont = `<a class="continue" href="${href}">
      <div class="k">${fresh ? "Start module" : started ? "Continue listening" : "Up next"} · Stage ${next.m.stage.number}</div>
      <div class="t">${esc(fresh ? next.m.title : next.r.title)}</div>
      <div class="s">${fresh ? "Begins with 3 quick prequestions" : `${esc(next.m.title)} · ${esc(KIND_LABEL[next.r.kind])} · ${fmtMin(next.r.minutes)}`}</div></a>`;
  } else if (next?.kind === "quiz") {
    cont = `<a class="continue" href="#/quiz/${next.m.id}">
      <div class="k">Check your understanding · Stage ${next.m.stage.number}</div>
      <div class="t">${esc(next.m.title)}</div>
      <div class="s">${next.m.quiz.length} questions · pass with ${PASS}%</div></a>`;
  } else {
    cont = `<div class="continue"><div class="k">Path complete</div><div class="t">You've finished every module.</div><div class="s">Keep it fresh with the daily review.</div></div>`;
  }

  const reviewCard = due ? `<a class="card review-card" href="#/review">
      <div class="row-gap" style="justify-content:space-between"><div><div class="k">Daily review · do this first</div>
      <div class="t">${due} card${due === 1 ? "" : "s"} due</div>
      <div class="small muted">Spaced retrieval of what you've already learned, about ${Math.max(1, Math.round(Math.min(due, store.settings().dailyLimit) * 0.4))} min</div></div>
      <span class="pill">${ICONS.play.replace("<svg", '<svg width="14" height="14"')} Start</span></div></a>` : "";

  view.innerHTML = `
    <div class="large-title">HAI Scholar</div>
    <p class="lede">From zero to research-level Human-AI Interaction, using only established papers, lectures and essays. ${Math.round((got / Math.max(total, 1)) * 100)}% complete${store.streak() ? ` · ${store.streak()}-day streak` : ""}.</p>
    ${standalone ? "" : `<div class="card install-tip small"><b>Install on iPhone:</b> in Safari tap <b>Share</b> → <b>Add to Home Screen</b>. It then opens full-screen like an app and keeps your progress.</div>`}
    ${reviewCard}
    ${cont}
    <div class="section-label">The path</div>
    ${C.stages.map((s) => {
      const st = stageStatus(s);
      const done = st.complete === st.modules;
      return `<a class="card stage-card" href="#/stage/${s.id}">
        <div class="stage-head">
          <div class="stage-num ${done ? "done" : ""}">${done ? ICONS.check : s.number}</div>
          <div><div class="stage-title">${esc(s.title)}</div><div class="stage-sub">${esc(s.subtitle)}</div></div>
        </div>
        <div class="stage-meta"><span>${st.complete}/${st.modules} modules</span><span>~${fmtMin(st.minutes)} of core material</span></div>
        <div class="progress ${done ? "good" : ""}"><i style="width:${Math.round(st.frac * 100)}%"></i></div>
      </a>`;
    }).join("")}
  `;
}

// Download button shared by stage, module and settings screens.
function downloadButton(resources, label) {
  const list = downloadable(resources);
  const n = savedCount(list);
  const all = n === list.length;
  return `<button class="btn ${all ? "ghost" : "secondary"} dl-btn" ${all ? "disabled" : ""}>${ICONS.down} ${all ? `All ${list.length} texts saved offline` : `${label} (${n}/${list.length} saved)`}</button>`;
}

function wireDownload(resources, rerender) {
  const btn = view.querySelector(".dl-btn");
  if (!btn) { return; }
  btn.onclick = async () => {
    if (!navigator.onLine) { toast("Connect to the internet to download"); return; }
    btn.disabled = true;
    const state = await downloadAll(resources, (p) => {
      if (btn.isConnected) { btn.innerHTML = `${ICONS.down} Saving ${p.done}/${p.total}…`; }
    });
    toast(state.failed.length ? `Saved ${state.ok}. ${state.failed.length} couldn't be saved (publisher blocks apps).` : `Saved ${state.ok} text${state.ok === 1 ? "" : "s"} for offline listening`);
    rerender();
  };
}

function viewStage(id) {
  const s = C.stages.find((x) => x.id === id);
  if (!s) { return notFound(); }
  setTab("path");
  setTop({ title: `Stage ${s.number}`, back: { label: "Path", href: "#/" } });
  const allRes = s.modules.flatMap((m) => m.resources);
  const qN = s.modules.reduce((n, m) => n + m.quiz.length, 0);
  const tried = s.modules.filter((m) => store.quiz(m.id)).length;
  const ex = store.s.exams[s.id];
  view.innerHTML = `
    <div class="large-title">${esc(s.title)}</div>
    <p class="lede">${esc(s.subtitle)}</p>
    <div class="guide"><h3>Stage overview</h3>${paras(s.overview)}</div>
    <div class="section-label">Modules</div>
    <div class="list">
      ${s.modules.map((m, i) => {
        const st = moduleStatus(m);
        const q = st.quiz ? `${st.quiz.best}%` : "not taken";
        return `<a class="li" href="#/module/${m.id}">
          <span class="stage-num ${st.complete ? "done" : ""}" style="width:32px;height:32px;font-size:15px;border-radius:9px">${st.complete ? ICONS.check : i + 1}</span>
          <span class="li-body"><div class="li-title">${esc(m.title)}</div>
          <div class="li-sub">${st.done}/${st.total} sources · check-in ${q}</div></span>${ICONS.chev}</a>`;
      }).join("")}
    </div>
    <div class="section-label">Cumulative stage exam</div>
    <div class="card">
      <div class="row-gap" style="justify-content:space-between">
        <div><b>${Math.min(EXAM_N, qN)} mixed questions</b><div class="small muted">Questions from every module, shuffled together. Mixing topics (interleaving) makes you work out which idea applies, not just recall the latest one.</div></div>
        ${ex ? `<span class="pill ${ex.best >= PASS ? "good" : "bad"}">Best ${ex.best}%</span>` : ""}
      </div>
      <div class="btn-stack"><a class="btn ${tried === s.modules.length ? "" : "secondary"}" href="#/exam/${s.id}">${tried === s.modules.length ? "Take the stage exam" : `Take it anyway (${tried}/${s.modules.length} check-ins done)`}</a></div>
    </div>
    <div class="section-label">Offline</div>
    ${downloadButton(allRes, "Download this stage for offline")}
    <p class="tiny muted" style="margin:6px 4px">Saves the full text of every paper and essay in this stage so you can listen without a connection. Videos stream only.</p>`;
  wireDownload(allRes, () => viewStage(id));
}

function viewModule(id) {
  const m = C.modules.get(id);
  if (!m) { return notFound(); }
  setTab("path");
  setTop({ title: m.title, back: { label: `Stage ${m.stage.number}`, href: `#/stage/${m.stage.id}` } });
  const st = moduleStatus(m);
  const core = m.resources.filter((r) => !r.optional);
  const extra = m.resources.filter((r) => r.optional);
  const pre = store.pre(m.id);
  const recalled = (r) => (store.recall(r.id) ? ' · <span style="color:var(--accent)">recalled</span>' : "");

  const preCard = pre
    ? `<div class="card"><b>Listen for</b><div class="small muted" style="margin:2px 0 8px">Your prequestions. Answers are revealed in the check-in.</div>
        <ol class="small" style="margin:0;padding-left:20px">${pre.qs.map((qi) => `<li style="margin-bottom:6px">${esc(m.quiz[qi]?.q)}</li>`).join("")}</ol></div>`
    : `<a class="card prequest" href="#/pre/${m.id}"><b>Before you start: 3 prequestions</b>
        <div class="small muted" style="margin-top:4px">Commit to a guess before learning. Getting them wrong is fine and expected. Guessing first primes you to notice the answers as you listen (Pan &amp; Carpenter 2023).</div>
        <div class="btn-stack" style="margin-bottom:0"><span class="btn">Answer prequestions</span></div></a>`;

  view.innerHTML = `
    <div class="tiny muted" style="margin:0 2px">Stage ${m.stage.number} · ${esc(m.stage.title)}</div>
    <div class="large-title" style="font-size:28px">${esc(m.title)}</div>
    <p class="lede goal">${esc(m.goal)}</p>
    ${preCard}
    <div class="guide"><h3>Guide</h3>${paras(m.guide)}</div>
    <div class="section-label">Core sources · ${st.done}/${st.total} done</div>
    <div class="list">${core.map((r) => resRow(r, recalled(r))).join("")}</div>
    ${extra.length ? `<div class="section-label">Go deeper (optional)</div><div class="list">${extra.map((r) => resRow(r, recalled(r))).join("")}</div>` : ""}
    <div class="section-label">Check your understanding</div>
    <div class="card">
      <div class="row-gap" style="justify-content:space-between">
        <div><b>${m.quiz.length} questions</b><div class="small muted">Pass with ${PASS}% to complete the module. Every question then joins your spaced daily review.</div></div>
        ${st.quiz ? `<span class="pill ${st.passed ? "good" : "bad"}">Best ${st.quiz.best}%</span>` : `<span class="pill gray">Not taken</span>`}
      </div>
      <div class="btn-stack"><a class="btn" href="#/quiz/${m.id}">${st.quiz ? "Retake check-in" : "Start check-in"}</a></div>
    </div>
    ${m.exercise ? `<div class="section-label">Research exercise</div>
      <div class="guide" style="border-left-color:var(--warn)"><h3 style="color:var(--warn)">Try this</h3>${paras(m.exercise)}</div>
      <textarea id="ex-note" placeholder="Work through the exercise here (saved on this device)…">${esc(store.note(m.id))}</textarea>` : ""}
    <div class="section-label">Offline</div>
    ${downloadButton(m.resources, "Download module for offline")}
  `;
  const ta = $("#ex-note");
  if (ta) { ta.oninput = () => store.setNote(m.id, ta.value); }
  wireDownload(m.resources, () => viewModule(id));
}

function viewResource(id) {
  const r = C.resources.get(id);
  if (!r) { return notFound(); }
  setTab("path");
  setTop({ title: KIND_LABEL[r.kind], back: { label: r.module.title, href: `#/module/${r.module.id}` } });
  store.setLast(r.id);
  const done = store.isDone(r.id);
  const pos = store.pos(r.id);
  const listenable = r.kind !== "video";
  const pct = pos && pos.n ? Math.round((pos.i / pos.n) * 100) : 0;
  const rec = store.recall(r.id);
  const yt = r.youtube ? `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.youtube)}?playsinline=1&rel=0&modestbranding=1" title="${esc(r.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : "";

  view.innerHTML = `
    <div class="tiny muted" style="margin:0 2px">Stage ${r.stage.number} · ${esc(r.module.title)}${r.optional ? " · optional" : ""}</div>
    <div class="res-title">${esc(r.title)}</div>
    <div class="meta-line">${esc(r.authors)}${r.year ? ` (${esc(r.year)})` : ""}${r.venue ? ` · ${esc(r.venue)}` : ""}</div>
    <div class="row-gap" style="margin:10px 2px 4px">
      <span class="pill">${esc(KIND_LABEL[r.kind])}</span>
      ${r.minutes ? `<span class="pill gray">${fmtMin(r.minutes)}</span>` : ""}
      ${done ? `<span class="pill good">Done</span>` : pct ? `<span class="pill gray">${pct}% listened</span>` : ""}
      ${listenable && isSaved(r) ? `<span class="pill good">${ICONS.down} Offline</span>` : ""}
    </div>
    ${yt}
    <div class="btn-stack">
      ${listenable ? `<a class="btn" href="#/listen/${r.id}">${ICONS.play.replace("<svg", '<svg width="18" height="18"')} ${pct && !done ? "Resume listening" : "Listen & read along"}</a>` : ""}
      <div class="btn-row" style="margin:0">
        <a class="btn secondary" href="${esc(r.url)}" target="_blank" rel="noopener">${r.kind === "video" ? "Open in YouTube" : "Open original"}</a>
        <button class="btn ${done ? "ghost" : "secondary"}" id="toggle-done">${done ? "Mark not done" : "Done → recall"}</button>
      </div>
      ${done ? `<a class="btn ghost" href="#/recall/${r.id}">${rec ? "Redo free recall" : "Free recall (2 min)"}</a>` : ""}
    </div>
    <div class="guide"><h3>Why this matters</h3>${paras(r.why)}${r.focus ? `<p><b>Focus:</b> ${esc(r.focus)}</p>` : ""}</div>
    ${r.arxiv ? `<p class="small muted" style="margin:0 2px 14px">arXiv ${esc(r.arxiv)} · <a href="https://arxiv.org/pdf/${esc(r.arxiv)}" target="_blank" rel="noopener">PDF</a> · <a href="https://arxiv.org/html/${esc(r.arxiv)}" target="_blank" rel="noopener">HTML</a></p>` : ""}
    ${rec ? `<div class="section-label">Your free recall</div><div class="card small" style="white-space:pre-wrap">${esc(rec.text) || "<span class='muted'>(recalled out loud)</span>"}</div>` : ""}
    <div class="section-label">Your notes</div>
    <textarea id="note" placeholder="Key claims, methods, questions, how it connects to other work…">${esc(store.note(r.id))}</textarea>
  `;
  $("#toggle-done").onclick = () => {
    if (store.isDone(r.id)) { store.setDone(r.id, false); viewResource(id); return; }
    finishSource(r);
  };
  const ta = $("#note");
  ta.oninput = () => store.setNote(r.id, ta.value);
}

// Marking a source done leads into free recall (Karpicke & Blunt 2011) unless turned off.
function finishSource(r) {
  store.setDone(r.id, true);
  if (store.settings().freeRecall) { location.hash = `#/recall/${r.id}`; return; }
  toast("Marked as done ✓");
  render();
}

function prevSource(r) {
  const flat = C.order.flatMap((m) => m.resources);
  const i = flat.indexOf(r);
  for (let j = i - 1; j >= 0; j--) { if (store.isDone(flat[j].id)) { return flat[j]; } }
  return i > 0 ? flat[i - 1] : null;
}

// ---- free recall after a source
function viewRecall(id) {
  const r = C.resources.get(id);
  if (!r) { return notFound(); }
  setTab("path");
  setTop({ title: "Free recall", back: { label: "Source", href: `#/res/${r.id}` } });
  const prev = prevSource(r);
  const existing = store.recall(r.id);
  view.innerHTML = `
    <div class="tiny muted" style="margin:0 2px">Free recall · ${esc(KIND_LABEL[r.kind])}</div>
    <div class="res-title" style="font-size:22px">${esc(r.title)}</div>
    <div class="guide" style="margin-top:10px"><h3>Without looking back</h3>
      <p>Write, dictate (tap the 🎤 on the keyboard), or say out loud everything you remember. Retrieving it now is what makes it stick, and gaps are useful: they show you what to revisit.</p>
      <ol class="small" style="margin:8px 0 0;padding-left:20px">
        <li>The main claim or idea, in your own words.</li>
        <li>How they showed it: method, evidence, or the key example.</li>
        <li>Why it's true, or why it might not be. What would convince a skeptic?</li>
        ${prev && prev !== r ? `<li>How it connects to <i>${esc(prev.title)}</i>.</li>` : ""}
        <li>One question you still have.</li>
      </ol></div>
    <textarea id="recall-text" style="min-height:200px" placeholder="Start typing or dictating…">${esc(existing?.text || "")}</textarea>
    <div class="btn-stack"><button class="btn" id="check">Check against the source</button>
    <a class="btn ghost" href="#/module/${r.module.id}">Skip for now</a></div>
    <div id="compare"></div>`;
  const ta = $("#recall-text");
  $("#check").onclick = () => {
    $("#check").hidden = true;
    $("#compare").innerHTML = `
      <div class="section-label">Compare</div>
      <div class="guide"><h3>What this source is for</h3>${paras(r.why)}${r.focus ? `<p><b>Focus:</b> ${esc(r.focus)}</p>` : ""}</div>
      <div class="small muted" style="margin:0 4px 10px">Skim the source to check what you missed: ${r.kind === "video" ? `<a href="#/res/${r.id}">rewatch</a>` : `<a href="#/listen/${r.id}">open the read-along text</a>`}. Notice anything you got wrong, not just what you left out.</div>
      ${store.note(r.id) ? `<div class="card small" style="white-space:pre-wrap"><b>Your notes</b><br>${esc(store.note(r.id))}</div>` : ""}
      <div class="section-label">How complete was your recall?</div>
      <div class="grade-row">
        <button data-g="0">Missed most</button><button data-g="1">Got some</button><button data-g="2">Got most</button><button data-g="3">Nailed it</button>
      </div>
      <p class="tiny muted" style="margin:8px 4px">This schedules a recall prompt for this source in your daily review: sooner if it was patchy, later if it was solid.</p>`;
    $("#compare").querySelectorAll("[data-g]").forEach((b) => {
      b.onclick = () => {
        const g = Number(b.dataset.g);
        store.setRecall(r.id, ta.value.trim(), g);
        srsGrade(`r:${r.id}`, "r", g);
        const next = required(r.module).find((x) => !store.isDone(x.id));
        toast("Recall saved and scheduled for review");
        location.hash = next ? `#/res/${next.id}` : `#/module/${r.module.id}`;
      };
    });
    $("#compare").scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

// ---- listen / read-along
let listenCleanup = null;

function viewListen(id) {
  const r = C.resources.get(id);
  if (!r) { return notFound(); }
  setTab("path");
  document.body.classList.add("listening");
  const doneBtn = () => ({ label: store.isDone(r.id) ? "Recall →" : "Done", onClick: () => { player.pause(); finishSource(r); } });
  const top = () => ({ title: r.title, back: { label: "Back", href: `#/res/${r.id}` }, right: [doneBtn()] });
  setTop(top());
  document.documentElement.style.setProperty("--reader-size", `${store.settings().textSize}px`);

  view.innerHTML = `<div class="reader-status"><div class="spinner"></div><div id="status">Fetching text…</div></div>`;

  const controls = document.createElement("div");
  controls.className = "controls";
  controls.innerHTML = `<div class="controls-inner">
      <div id="sheet"></div>
      <div class="scrub"><span id="c-pos">0%</span><input id="c-range" type="range" min="0" max="0" value="0" aria-label="Position"><span id="c-left"></span></div>
      <div class="ctrl-row">
        <button class="ctrl txt" id="c-rate" aria-label="Speed">1×</button>
        <button class="ctrl" id="c-back" aria-label="Back a few sentences">${ICONS.back15}</button>
        <button class="ctrl play" id="c-play" aria-label="Play">${ICONS.play}</button>
        <button class="ctrl" id="c-fwd" aria-label="Forward a few sentences">${ICONS.fwd15}</button>
        <button class="ctrl txt" id="c-size" aria-label="Text size">Aa</button>
      </div></div>`;
  document.body.appendChild(controls);

  const RATES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];
  const range = $("#c-range", controls);
  const sheet = $("#sheet", controls);
  let userScrolling = 0;
  const onScroll = () => { userScrolling = Date.now(); };
  window.addEventListener("touchmove", onScroll, { passive: true });
  window.addEventListener("wheel", onScroll, { passive: true });

  const sync = () => {
    if (!player.isLoaded(r)) { return; }
    $("#c-play", controls).innerHTML = player.playing ? ICONS.pause : ICONS.play;
    $("#c-rate", controls).textContent = `${store.settings().rate}×`;
    range.max = String(player.items.length - 1);
    range.value = String(player.i);
    $("#c-pos", controls).textContent = `${Math.round((player.i / Math.max(1, player.items.length - 1)) * 100)}%`;
    $("#c-left", controls).textContent = `${fmtMin(player.minutesLeft()) || "0 min"} left`;
    const prev = view.querySelector(".s.cur");
    const cur = view.querySelector(`.s[data-i="${player.i}"]`);
    if (prev && prev !== cur) { prev.classList.remove("cur"); }
    if (cur) {
      cur.classList.add("cur");
      const rect = cur.getBoundingClientRect();
      const out = rect.top < 70 || rect.bottom > window.innerHeight - 170;
      if (player.playing && out && Date.now() - userScrolling > 4000) {
        cur.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    if (player.playing && sheet.innerHTML) { sheet.innerHTML = ""; }
    setTop(top());
  };

  // Interpolated recall at section breaks (Szpunar et al. 2013).
  const onCheckpoint = (e) => {
    sheet.innerHTML = `<div class="sheet">
      <div class="k">Pause &amp; recall</div>
      <div class="sheet-t">What were the key ideas in “${esc(e.detail.section.slice(0, 90))}”?</div>
      <div class="small muted">Say them out loud or jot them down before moving on. A few seconds is enough.</div>
      <textarea id="cp-text" rows="2" placeholder="Optional: jot it here (saved to your notes)"></textarea>
      <div class="btn-row" style="margin:8px 0 0"><button class="btn" id="cp-go">Continue</button><button class="btn ghost" id="cp-off">No more pauses</button></div></div>`;
    const go = () => {
      const t = $("#cp-text", sheet).value.trim();
      if (t) { store.setNote(r.id, `${store.note(r.id)}${store.note(r.id) ? "\n" : ""}§ ${e.detail.section}: ${t}`); }
      sheet.innerHTML = "";
      player.play();
    };
    $("#cp-go", sheet).onclick = go;
    $("#cp-off", sheet).onclick = () => { player.noPauses = true; go(); };
  };

  const onCompleted = () => {
    if (!store.settings().freeRecall) { toast("Marked as done ✓"); return; }
    sheet.innerHTML = `<div class="sheet"><div class="k">Finished</div>
      <div class="sheet-t">Now do a 2-minute free recall</div>
      <div class="small muted">Writing down what you remember right after listening roughly doubles what sticks compared with relistening (Roediger &amp; Karpicke 2006; Karpicke &amp; Blunt 2011).</div>
      <div class="btn-stack" style="margin-bottom:0"><a class="btn" href="#/recall/${r.id}">Start free recall</a></div></div>`;
  };

  const renderText = () => {
    const groups = [];
    player.items.forEach((it, i) => {
      if (!groups[it.b]) { groups[it.b] = { h: it.h, parts: [] }; }
      groups[it.b].parts.push(`<span class="s" data-i="${i}">${esc(it.text)}</span> `);
    });
    view.innerHTML = `<div class="reader-source">Text from: ${esc(player.source)} · tap any sentence to start there${store.settings().recallPauses ? " · pauses for a quick recall at section breaks" : ""}</div>
      <div class="reader">${groups.filter(Boolean).map((g) => (g.h ? `<h2 class="rh">${g.parts.join("")}</h2>` : `<p>${g.parts.join("")}</p>`)).join("")}</div>`;
    view.querySelector(".reader").addEventListener("click", (e) => {
      const s = e.target.closest(".s");
      if (!s) { return; }
      sheet.innerHTML = "";
      player.play(Number(s.dataset.i));
    });
    sync();
    const cur = view.querySelector(".s.cur");
    if (cur && player.i > 0) { cur.scrollIntoView({ block: "center" }); }
  };

  $("#c-play", controls).onclick = () => { sheet.innerHTML = ""; player.toggle(); };
  $("#c-back", controls).onclick = () => player.skip(-3);
  $("#c-fwd", controls).onclick = () => player.skip(3);
  $("#c-rate", controls).onclick = () => {
    const cur = store.settings().rate;
    const idx = RATES.findIndex((x) => x >= cur - 0.001);
    player.setRate(RATES[(idx + 1) % RATES.length]);
  };
  $("#c-size", controls).onclick = () => {
    const sizes = [16, 17, 19, 21, 24];
    const cur = store.settings().textSize;
    const next = sizes[(sizes.indexOf(cur) + 1) % sizes.length] || 19;
    store.setSetting("textSize", next);
    document.documentElement.style.setProperty("--reader-size", `${next}px`);
  };
  range.oninput = () => { $("#c-pos", controls).textContent = `${Math.round((range.value / Math.max(1, player.items.length - 1)) * 100)}%`; };
  range.onchange = () => {
    player.seek(Number(range.value));
    const cur = view.querySelector(`.s[data-i="${player.i}"]`);
    if (cur) { cur.scrollIntoView({ block: "center" }); }
  };

  player.addEventListener("change", sync);
  player.addEventListener("checkpoint", onCheckpoint);
  player.addEventListener("completed", onCompleted);
  listenCleanup = () => {
    player.removeEventListener("change", sync);
    player.removeEventListener("checkpoint", onCheckpoint);
    player.removeEventListener("completed", onCompleted);
    window.removeEventListener("touchmove", onScroll);
    window.removeEventListener("wheel", onScroll);
    controls.remove();
    document.body.classList.remove("listening");
  };

  if (!player.supported) {
    view.innerHTML = `<div class="reader-status">This browser doesn't support speech. Open in Safari on iPhone.</div>`;
    return;
  }

  if (player.isLoaded(r)) { renderText(); return; }

  const token = location.hash;
  extractResource(r, { includeAppendix: store.settings().includeAppendix, onStatus: (s) => { const el = $("#status"); if (el) { el.textContent = s; } } })
    .then((out) => {
      markSaved(r);
      if (location.hash !== token) { return; }
      player.load(r, out.blocks, out.source + (out.cached ? " (saved on device)" : ""));
      renderText();
    })
    .catch((err) => {
      if (location.hash !== token) { return; }
      controls.remove();
      const offline = !navigator.onLine;
      view.innerHTML = `<div class="card" style="margin-top:20px">
        <b>${offline ? "You're offline and this source isn't downloaded." : esc(err.message)}</b>
        ${offline ? `<p class="small muted">Next time you're online, use “Download for offline” on the module or stage page.</p>` : `<p class="small muted">Some publishers block other apps from reading their pages. You can still listen with Safari's built-in reader:</p>
        <ol class="small"><li>Tap <b>Open original</b> below.</li><li>In Safari, tap the <b>page menu</b> (aA / ☰ in the address bar) → <b>Listen to Page</b>.</li><li>Come back and tap <b>Done → recall</b>.</li></ol>`}
        <div class="btn-stack"><a class="btn" href="${esc(r.listen || r.url)}" target="_blank" rel="noopener">Open original</a>
        <button class="btn ghost" id="retry">Try again</button></div>
        <details class="tiny muted"><summary>Details</summary>${(err.details || []).map(esc).join("<br>")}</details></div>`;
      $("#retry").onclick = () => render();
    });
}

// ---------------------------------------------------------------- questions
// One question at a time, with three evidence-based twists:
//  1. Recall first: choices stay hidden until you've formed an answer (generation effect).
//  2. Confidence rating before feedback (hypercorrection; calibration).
//  3. Immediate explanatory feedback naming the source.
function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

const CONF = [["guess", "Guessing"], ["think", "Fairly sure"], ["sure", "Certain"]];

function askQuestion({ q, header, reveal = true, confidence = true, onAnswered, nextLabel, onNext }) {
  const LETTERS = "ABCDEFG";
  const order = shuffle(q.choices.map((c, i) => i));
  const ref = q.ref ? C.resources.get(q.ref) : null;
  const hidden = store.settings().recallFirst && reveal;
  view.innerHTML = `${header}
    <div class="q-text">${esc(q.q)}</div>
    ${hidden ? `<div class="card recall-first" id="rf"><div class="small"><b>Answer in your head first.</b> <span class="muted">Generating an answer before seeing options strengthens memory more than recognizing one.</span></div>
      <div class="btn-stack" style="margin-bottom:0"><button class="btn" id="show">I have an answer, show choices</button></div></div>` : ""}
    <div id="choices" ${hidden ? "hidden" : ""}>${order.map((ci, n) => `<button class="choice" data-ci="${ci}"><span class="letter">${LETTERS[n]}</span><span>${esc(q.choices[ci])}</span></button>`).join("")}</div>
    <div id="conf"></div>
    <div id="after"></div>`;
  if (hidden) { $("#show").onclick = () => { $("#rf").remove(); $("#choices").hidden = false; }; }

  const finish = (ci, conf) => {
    const ok = ci === q.answer;
    view.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      const bi = Number(b.dataset.ci);
      if (reveal && bi === q.answer) { b.classList.add("correct"); }
      if (reveal && bi === ci && !ok) { b.classList.add("wrong"); }
      if (!reveal && bi === ci) { b.classList.add("picked"); }
    });
    $("#conf").innerHTML = "";
    onAnswered?.(ok, conf, ci);
    let note = "";
    if (reveal && !ok && conf === "sure") { note = `<div class="hyper">High-confidence error. These are the corrections most likely to stick: read the explanation, then say the right answer to yourself.</div>`; }
    if (reveal && ok && conf === "guess") { note = `<div class="small muted" style="margin-bottom:6px">Right, but a guess. It'll come back soon in review.</div>`; }
    $("#after").innerHTML = reveal
      ? `<div class="explain"><b style="color:var(${ok ? "--good" : "--bad"})">${ok ? "Correct" : "Not quite"}</b>${note}${esc(q.explain)}
          ${ref ? `<div class="small" style="margin-top:8px">Source: <a href="#/res/${ref.id}">${esc(ref.title)}</a></div>` : ""}</div>
          <button class="btn" id="next">${nextLabel}</button>`
      : `<div class="explain small muted">Guess recorded. The answer is in this module's sources, so listen for it.</div><button class="btn" id="next">${nextLabel}</button>`;
    $("#next").onclick = onNext;
    $("#after").scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  view.querySelectorAll(".choice").forEach((btn) => {
    btn.onclick = () => {
      const ci = Number(btn.dataset.ci);
      if (!confidence) { finish(ci, null); return; }
      view.querySelectorAll(".choice").forEach((b) => b.classList.toggle("selected", b === btn));
      $("#conf").innerHTML = `<div class="small muted" style="margin:2px 2px 6px">How sure are you?</div>
        <div class="conf-row">${CONF.map(([k, l]) => `<button data-conf="${k}">${l}</button>`).join("")}</div>`;
      $("#conf").querySelectorAll("[data-conf]").forEach((c) => { c.onclick = () => finish(ci, c.dataset.conf); });
      $("#conf").scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  });
}

// Run a list of question items. Missed items can be re-queued later in the same session
// (successive relearning: keep going until each item is recalled once).
function runSession({ title, back, items, relearn = false, graded = true, onFinish }) {
  setTop({ title, back });
  const queue = items.slice();
  const firstTry = new Map();
  const requeued = new Map();
  let k = 0;
  let correct = 0;
  const results = [];
  if (!queue.length) {
    view.innerHTML = `<div class="empty">Nothing here yet.</div>`;
    return;
  }

  const show = () => {
    const it = queue[k];
    const isRetry = firstTry.has(it.key);
    const header = `<div class="q-count"><span>${k + 1} of ${queue.length}${isRetry ? " · second chance" : ""}</span><span>${correct} correct</span></div>
      <div class="progress" style="margin-bottom:14px"><i style="width:${(k / queue.length) * 100}%"></i></div>
      ${it.showModule ? `<div class="tiny muted">Stage ${it.m.stage.number} · ${esc(it.m.title)}</div>` : ""}`;
    if (it.type === "r") { return showRecallCard(it, header); }
    askQuestion({
      q: it.q,
      header,
      onAnswered: (ok, conf) => {
        store.recordConfidence(conf, ok);
        if (!isRetry) {
          firstTry.set(it.key, ok);
          if (ok) { correct++; }
          results.push({ ...it, ok, conf });
          if (graded) { srsGrade(it.key, "q", outcomeFrom(ok, conf)); }
        }
        if (!ok && relearn && (requeued.get(it.key) || 0) < 2) {
          requeued.set(it.key, (requeued.get(it.key) || 0) + 1);
          queue.splice(Math.min(queue.length, k + 4), 0, it);
        }
      },
      nextLabel: k + 1 < queue.length ? "Next" : "See results",
      onNext: advance,
    });
  };

  const showRecallCard = (it, header) => {
    const rec = store.recall(it.r.id);
    view.innerHTML = `${header}
      <div class="tiny muted">Free recall</div>
      <div class="q-text">What do you remember from <i>${esc(it.r.title)}</i> (${esc(it.r.authors)}, ${esc(it.r.year)})?</div>
      <div class="card small">The main claim, how they showed it, and why it matters for HAI. Say it or write it, then reveal.</div>
      <textarea id="rc" placeholder="Optional: write it here"></textarea>
      <div class="btn-stack"><button class="btn" id="reveal">Reveal</button></div><div id="after"></div>`;
    $("#reveal").onclick = () => {
      $("#reveal").hidden = true;
      $("#after").innerHTML = `<div class="guide"><h3>Why it matters</h3>${paras(it.r.why)}</div>
        ${rec?.text ? `<div class="card small" style="white-space:pre-wrap"><b>Your earlier recall</b><br>${esc(rec.text)}</div>` : ""}
        <div class="small" style="margin:0 4px 8px"><a href="#/res/${it.r.id}">Open the source</a> to check details.</div>
        <div class="grade-row"><button data-g="0">Missed most</button><button data-g="1">Got some</button><button data-g="2">Got most</button><button data-g="3">Nailed it</button></div>`;
      $("#after").querySelectorAll("[data-g]").forEach((b) => {
        b.onclick = () => {
          const g = Number(b.dataset.g);
          const t = $("#rc").value.trim();
          if (t) { store.setRecall(it.r.id, t, g); }
          srsGrade(it.key, "r", g);
          if (g >= 2) { correct++; }
          results.push({ ...it, ok: g >= 2 });
          advance();
        };
      });
    };
  };

  const advance = () => {
    k++;
    if (k < queue.length) { show(); window.scrollTo(0, 0); return; }
    onFinish(correct, results.length, results);
  };
  show();
}

function resultsScreen(score, total, results, { passMsg, actions, pass = PASS }) {
  const pct = total ? Math.round((score / total) * 100) : 0;
  const ok = pct >= pass;
  const missed = results.filter((x) => !x.ok);
  const missedRefs = [...new Set(missed.map((x) => x.q?.ref).filter(Boolean))].map((id) => C.resources.get(id)).filter(Boolean);
  const confErr = results.filter((x) => !x.ok && x.conf === "sure").length;
  view.innerHTML = `
    <div class="score-ring" style="background:var(${ok ? "--good-soft" : "--bad-soft"});color:var(${ok ? "--good" : "--bad"})">${pct}%</div>
    <p style="text-align:center;font-size:18px;font-weight:650;margin:0 0 4px">${score} of ${total} correct on the first try</p>
    <p class="muted" style="text-align:center;margin:0 0 18px">${ok ? passMsg : `You need ${pass}% to pass. Revisit the sources below, then try again. Waiting a day before retaking makes the retake count for more.`}</p>
    ${confErr ? `<div class="card small"><b>${confErr} high-confidence error${confErr === 1 ? "" : "s"}.</b> These were confident misconceptions, and they're scheduled to come back tomorrow.</div>` : ""}
    ${missedRefs.length ? `<div class="section-label">Worth revisiting</div><div class="list">${missedRefs.map((r) => resRow(r)).join("")}</div>` : ""}
    <div class="btn-stack">${actions}</div>`;
  window.scrollTo(0, 0);
}

function viewQuiz(id) {
  const m = C.modules.get(id);
  if (!m) { return notFound(); }
  setTab("path");
  const items = m.quiz.map((q, qi) => ({ q, m, qi, key: `${m.id}:${qi}` }));
  runSession({
    title: "Check-in",
    back: { label: m.title, href: `#/module/${m.id}` },
    items,
    onFinish: (score, total, results) => {
      store.recordQuiz(m.id, score, total);
      const next = C.order[C.order.indexOf(m) + 1];
      const pre = store.pre(m.id);
      const preGain = pre ? pre.qs.filter((qi) => results.find((x) => x.qi === qi)?.ok).length : null;
      resultsScreen(score, total, results, {
        passMsg: `Module check-in passed. All ${total} questions are now in your spaced daily review.${pre ? ` Prequestions: you got ${preGain} of ${pre.qs.length} right after guessing beforehand.` : ""}`,
        actions: `${next ? `<a class="btn" href="#/${store.pre(next.id) ? "module" : "pre"}/${next.id}">Next module: ${esc(next.title)}</a>` : ""}
          <a class="btn secondary" href="#/module/${m.id}">Back to module</a>
          <button class="btn ghost" id="retake">Retake</button>`,
      });
      $("#retake").onclick = () => viewQuiz(id);
    },
  });
}

// Prequestions: commit to a guess before learning (no feedback yet).
function viewPre(id) {
  const m = C.modules.get(id);
  if (!m) { return notFound(); }
  setTab("path");
  setTop({ title: "Prequestions", back: { label: m.title, href: `#/module/${m.id}` } });
  // Spread prequestions across different sources in the module.
  const byRef = new Map();
  m.quiz.forEach((q, qi) => { if (!byRef.has(q.ref)) { byRef.set(q.ref, qi); } });
  let qs = [...byRef.values()];
  if (qs.length < 3) { qs = qs.concat(m.quiz.map((q, qi) => qi).filter((qi) => !qs.includes(qi))); }
  qs = qs.slice(0, 3);
  const picks = {};
  let k = 0;
  const show = () => {
    askQuestion({
      q: m.quiz[qs[k]],
      reveal: false,
      confidence: false,
      header: `<div class="q-count"><span>Prequestion ${k + 1} of ${qs.length}</span><span>${esc(m.title)}</span></div>
        <div class="progress" style="margin-bottom:14px"><i style="width:${(k / qs.length) * 100}%"></i></div>
        ${k === 0 ? `<div class="card small">You haven't studied this yet, so guess. Committing to an answer now makes you notice the real answer when you meet it.</div>` : ""}`,
      onAnswered: (ok, conf, ci) => { picks[qs[k]] = ci; },
      nextLabel: k + 1 < qs.length ? "Next prequestion" : "Start the module",
      onNext: () => {
        k++;
        if (k < qs.length) { show(); window.scrollTo(0, 0); return; }
        store.setPre(m.id, qs, picks);
        const first = required(m).find((r) => !store.isDone(r.id));
        location.hash = first ? `#/res/${first.id}` : `#/module/${m.id}`;
      },
    });
  };
  show();
}

// Cumulative, interleaved stage exam.
const EXAM_N = 15;
function viewExam(id) {
  const s = C.stages.find((x) => x.id === id);
  if (!s) { return notFound(); }
  setTab("path");
  // Stratified sample: round-robin across modules, then shuffle so topics are interleaved.
  const pools = s.modules.map((m) => shuffle(m.quiz.map((q, qi) => ({ q, m, qi, key: `${m.id}:${qi}`, showModule: true }))));
  const picked = [];
  while (picked.length < EXAM_N && pools.some((p) => p.length)) {
    for (const p of pools) { if (p.length && picked.length < EXAM_N) { picked.push(p.pop()); } }
  }
  runSession({
    title: `Stage ${s.number} exam`,
    back: { label: `Stage ${s.number}`, href: `#/stage/${s.id}` },
    items: shuffle(picked),
    onFinish: (score, total, results) => {
      const pct = Math.round((score / total) * 100);
      store.recordExam(s.id, pct);
      resultsScreen(score, total, results, {
        passMsg: "Stage exam passed. Retrieval across mixed topics is the strongest sign the material has stuck.",
        actions: `<a class="btn" href="#/stage/${s.id}">Back to stage</a><button class="btn ghost" id="retake">New exam</button>`,
      });
      $("#retake").onclick = () => viewExam(id);
    },
  });
}

// Spaced daily review: due cards (questions + free-recall prompts), interleaved.
function reviewItems(ahead = false) {
  const toItem = (key) => {
    if (key.startsWith("r:")) {
      const r = C.resources.get(key.slice(2));
      return r ? { type: "r", r, key } : null;
    }
    const [mid, qi] = key.split(":");
    const m = C.modules.get(mid);
    return m?.quiz[qi] ? { q: m.quiz[qi], m, qi: Number(qi), key, showModule: true } : null;
  };
  const limit = store.settings().dailyLimit;
  if (!ahead) {
    // Most overdue first, then interleave.
    const keys = dueKeys().sort((a, b) => store.s.cards[a].due - store.s.cards[b].due).slice(0, limit);
    return shuffle(keys.map(toItem).filter(Boolean));
  }
  const keys = Object.entries(store.s.cards).sort((a, b) => a[1].due - b[1].due).map(([k]) => k).slice(0, 10);
  return shuffle(keys.map(toItem).filter(Boolean));
}

function viewReview(ahead = false) {
  setTab("progress");
  const items = reviewItems(ahead);
  if (!items.length) {
    setTop({ title: "Review", back: { label: "Progress", href: "#/progress" } });
    const n = cardCount();
    view.innerHTML = `<div class="empty">${n ? "Nothing is due today. Spacing works because of the gaps, so come back tomorrow." : "Your review deck is empty. Take a module check-in or do a free recall and the cards appear here."}</div>
      ${n ? `<div class="btn-stack"><button class="btn secondary" id="ahead">Practice ahead (10 soonest cards)</button></div>` : ""}`;
    const a = $("#ahead");
    if (a) { a.onclick = () => viewReview(true); }
    return;
  }
  runSession({
    title: ahead ? "Practice ahead" : "Daily review",
    back: { label: "Progress", href: "#/progress" },
    items,
    relearn: true,
    graded: !ahead,
    onFinish: (score, total, results) => {
      const left = dueCount();
      resultsScreen(score, total, results, {
        pass: 0,
        passMsg: left ? `${left} more due. Keep going or come back later.` : "All caught up. Missed items return tomorrow, solid ones in days to weeks.",
        actions: `${left ? `<a class="btn" href="#/review" id="again">Continue review</a>` : ""}<a class="btn secondary" href="#/">Back to path</a>`,
      });
      const again = $("#again");
      if (again) { again.onclick = (e) => { e.preventDefault(); viewReview(); }; }
    },
  });
}

// ---- library
let libState = { q: "", kind: "all" };
function viewLibrary() {
  setTab("library");
  setTop({ title: "Library" });
  const kinds = [["all", "All"], ["paper", "Papers"], ["video", "Videos"], ["essay", "Essays"], ["book", "Books & courses"], ["todo", "Not done"], ["done", "Done"], ["offline", "Offline"]];
  view.innerHTML = `
    <input type="search" id="lib-q" placeholder="Search titles, authors, venues, years" value="${esc(libState.q)}" autocomplete="off">
    <div class="chips" style="margin-top:10px">${kinds.map(([k, l]) => `<button class="chip ${libState.kind === k ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
    <div id="lib-list"></div>`;
  const draw = () => {
    const q = libState.q.toLowerCase().trim();
    const all = [...C.resources.values()].filter((r) => {
      if (libState.kind === "done" && !store.isDone(r.id)) { return false; }
      if (libState.kind === "todo" && store.isDone(r.id)) { return false; }
      if (libState.kind === "offline" && !(r.kind !== "video" && isSaved(r))) { return false; }
      if (libState.kind === "book" && !["book", "course", "tool"].includes(r.kind)) { return false; }
      if (!["all", "done", "todo", "book", "offline"].includes(libState.kind) && r.kind !== libState.kind) { return false; }
      if (!q) { return true; }
      return `${r.title} ${r.authors} ${r.venue || ""} ${r.year} ${r.module.title}`.toLowerCase().includes(q);
    });
    $("#lib-list").innerHTML = all.length ? `<div class="small muted" style="margin:0 4px 8px">${all.length} sources</div><div class="list">${all.map((r) => resRow(r, `<br>Stage ${r.stage.number} · ${esc(r.module.title)}`)).join("")}</div>` : `<div class="empty">No matches.</div>`;
  };
  $("#lib-q").oninput = (e) => { libState.q = e.target.value; draw(); };
  view.querySelectorAll(".chip").forEach((c) => { c.onclick = () => { libState.kind = c.dataset.k; view.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); draw(); }; });
  draw();
}

// ---- progress
function viewProgress() {
  setTab("progress");
  setTop({ title: "Progress" });
  const all = [...C.resources.values()];
  const req = all.filter((r) => !r.optional);
  const doneReq = req.filter((r) => store.isDone(r.id));
  const minutesDone = all.filter((r) => store.isDone(r.id)).reduce((n, r) => n + (r.minutes || 0), 0);
  const quizzes = C.order.map((m) => store.quiz(m.id)).filter(Boolean);
  const passed = C.order.filter((m) => moduleStatus(m).passed).length;
  const due = dueCount();
  const fc = forecast(7);
  const maxF = Math.max(1, ...fc);
  const calib = store.s.calib;
  const noted = Object.keys(store.s.notes).map((id) => C.resources.get(id) || C.modules.get(id)).filter(Boolean);
  const dayName = (i) => (i === 0 ? "Today" : new Date(Date.now() + i * 86400000).toLocaleDateString(undefined, { weekday: "short" }));

  view.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="v">${store.streak()}</div><div class="l">day streak</div></div>
      <div class="stat"><div class="v">${fmtMin(minutesDone) || "0 min"}</div><div class="l">of material completed</div></div>
      <div class="stat"><div class="v">${doneReq.length}<span class="muted" style="font-size:16px">/${req.length}</span></div><div class="l">core sources done</div></div>
      <div class="stat"><div class="v">${passed}<span class="muted" style="font-size:16px">/${C.order.length}</span></div><div class="l">check-ins passed</div></div>
    </div>
    <div class="card">
      <div class="row-gap" style="justify-content:space-between"><b>Spaced review</b><span class="pill ${due ? "" : "good"}">${due ? `${due} due` : "All caught up"}</span></div>
      <p class="small muted" style="margin:4px 0 10px">${cardCount()} cards · ${matureCount()} long-term (interval ≥ 3 weeks). Missed items come back in the same session until you get them, then on a growing schedule (successive relearning).</p>
      <div class="forecast">${fc.map((n, i) => `<div><i style="height:${Math.round((n / maxF) * 48) + 2}px"></i><span>${n}</span><em>${dayName(i)}</em></div>`).join("")}</div>
      <div class="btn-stack"><a class="btn ${due ? "" : "ghost"}" href="#/review">${due ? "Start daily review" : "Review"}</a></div>
    </div>
    ${Object.keys(calib).length ? `<div class="card"><b>Calibration</b>
      <p class="small muted" style="margin:4px 0 8px">How often you're right at each confidence level. Well-calibrated learners are right about 90%+ of the time when “Certain”. Overconfidence is a signal to slow down and test yourself more.</p>
      ${CONF.map(([k, l]) => { const c = calib[k]; if (!c) { return ""; } const p = Math.round((c.c / c.n) * 100); return `<div class="calib"><span>${l}</span><div class="progress ${p >= 80 ? "good" : ""}"><i style="width:${p}%"></i></div><span>${p}% <em>(${c.n})</em></span></div>`; }).join("")}</div>` : ""}
    <div class="section-label">By stage</div>
    <div class="list">${C.stages.map((s) => { const st = stageStatus(s); const ex = store.s.exams[s.id]; return `<a class="li" href="#/stage/${s.id}"><span class="li-body"><div class="li-title">${s.number}. ${esc(s.title)}</div><div class="progress ${st.complete === st.modules ? "good" : ""}" style="margin-top:8px"><i style="width:${Math.round(st.frac * 100)}%"></i></div>${ex ? `<div class="li-sub">Stage exam best ${ex.best}%</div>` : ""}</span><span class="small muted">${Math.round(st.frac * 100)}%</span></a>`; }).join("")}</div>
    ${noted.length ? `<div class="section-label">Your notes</div><div class="list">${noted.map((x) => `<a class="li" href="${x.resources ? `#/module/${x.id}` : `#/res/${x.id}`}"><span class="li-body"><div class="li-title">${esc(x.title)}</div><div class="li-sub">${esc(store.note(x.id).slice(0, 110))}${store.note(x.id).length > 110 ? "…" : ""}</div></span>${ICONS.chev}</a>`).join("")}</div>` : ""}
  `;
}

// ---- settings
async function viewSettings() {
  setTab("settings");
  setTop({ title: "Settings" });
  const s = store.settings();
  const voices = englishVoices().slice().sort((a, b) => a.name.localeCompare(b.name));
  const auto = pickVoice();
  const allRes = [...C.resources.values()];
  const sw = (key, label, hint) => `<div class="setting"><label for="sw-${key}">${label}${hint ? `<div class="tiny muted">${hint}</div>` : ""}</label><input type="checkbox" class="switch" id="sw-${key}" ${s[key] ? "checked" : ""}></div>`;
  view.innerHTML = `
    <div class="section-label">How you learn</div>
    <div class="list">
      ${sw("recallFirst", "Answer before seeing choices", "Choices stay hidden until you've formed an answer in your head (generation effect).")}
      ${sw("recallPauses", "Recall pauses while listening", "Pauses at section breaks so you recall the section before moving on (interpolated testing).")}
      ${sw("freeRecall", "Free recall after each source", "A 2-minute brain dump when you finish a source, then scheduled for review (retrieval practice).")}
      <div class="setting"><label for="limit">Max cards per review session</label><select id="limit" style="width:auto">${[15, 20, 30, 50, 100].map((n) => `<option ${n === s.dailyLimit ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    </div>
    <a class="card stage-card" href="#/stage/s00" style="display:block"><b>The science behind these features →</b><div class="small muted">Stage 0 covers the research on retrieval practice, spacing, prequestions, hypercorrection and successive relearning, with sources.</div></a>
    <div class="section-label">Listening</div>
    <div class="list">
      <div class="setting" style="flex-direction:column;align-items:stretch">
        <label for="voice">Voice</label>
        <select id="voice"><option value="">Automatic${auto ? ` (${esc(auto.name)})` : ""}</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? "selected" : ""}>${esc(v.name)} — ${esc(v.lang)}</option>`).join("")}</select>
        <div class="tiny muted">For a much more natural voice, download one on iPhone: Settings → Accessibility → Spoken Content → Voices → English → pick an “Enhanced” or “Premium” voice. Then choose it here.</div>
      </div>
      <div class="setting"><label for="rate">Speed</label><select id="rate" style="width:auto">${[0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2].map((r) => `<option value="${r}" ${r === s.rate ? "selected" : ""}>${r}×</option>`).join("")}</select></div>
      <div class="setting"><button class="btn secondary" id="test-voice">Test voice</button></div>
      ${sw("skipCitations", "Skip citations when speaking", "Silences “[12]” and “(Smith et al., 2019)” in audio; they stay visible in the text.")}
      ${sw("includeAppendix", "Include appendices", "Papers stop at the references by default.")}
      ${sw("keepAwake", "Keep screen on while listening", "iOS pauses speech when a web app's screen locks, so this keeps it awake.")}
    </div>
    <div class="section-label">Offline</div>
    <div class="list">
      <div class="setting" style="flex-direction:column;align-items:stretch">
        <div class="small muted" id="storage">Checking storage…</div>
        ${downloadButton(allRes, "Download everything")}
        <div class="tiny muted">Saves the full text of every paper and essay (about ${downloadable(allRes).length}) so you can listen anywhere. iPhone voices run on-device, so audio works offline. Videos need a connection. Some publisher pages block apps and can't be saved.</div>
      </div>
      <div class="setting"><button class="btn ghost" id="clear-cache">Clear saved paper texts</button></div>
    </div>
    <div class="section-label">Your data</div>
    <div class="list">
      <div class="setting"><button class="btn secondary" id="export">Export progress backup</button></div>
      <div class="setting"><label class="btn secondary" style="cursor:pointer">Import backup<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      <div class="setting"><button class="btn danger" id="reset">Reset all progress</button></div>
    </div>
    <div class="section-label">About</div>
    <div class="card small">
      <p style="margin-top:0"><b>What's here.</b> Every source in HAI Scholar is a real, published work: peer-reviewed papers, canonical preprints, textbooks, university-level courses, and widely respected explainers and lectures. Titles, authors and links were checked against arXiv, Crossref and YouTube records. The app writes only the short guides that say what to look for, the check-in questions and the exercises.</p>
      <p><b>How listening works.</b> Text comes live from the original source (arXiv's HTML or PDF, the author's site, or a public reader service for pages that block other apps), and your iPhone's built-in voice reads it aloud.</p>
      <p style="margin-bottom:0"><b>Curriculum:</b> ${C.stages.length} stages · ${C.order.length} modules · ${C.resources.size} sources · ${C.order.reduce((n, m) => n + m.quiz.length, 0)} questions.</p>
    </div>`;

  for (const key of ["recallFirst", "recallPauses", "freeRecall", "skipCitations", "includeAppendix", "keepAwake"]) {
    $(`#sw-${key}`).onchange = (e) => store.setSetting(key, e.target.checked);
  }
  $("#limit").onchange = (e) => store.setSetting("dailyLimit", Number(e.target.value));
  $("#voice").onchange = (e) => store.setSetting("voiceURI", e.target.value);
  $("#rate").onchange = (e) => store.setSetting("rate", Number(e.target.value));
  $("#test-voice").onclick = () => {
    const u = new SpeechSynthesisUtterance("This is how papers will sound. Human-AI interaction studies how people and AI systems work together.");
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = store.settings().rate;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  wireDownload(allRes, () => viewSettings());
  $("#export").onclick = async () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const file = new File([blob], `hai-scholar-backup-${new Date().toLocaleDateString("en-CA")}.json`, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "HAI Scholar backup" }); return; } catch { /* cancelled */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
  };
  $("#import").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) { return; }
    try { store.importJSON(await f.text()); toast("Progress restored"); } catch (err) { toast(err.message); }
  };
  $("#clear-cache").onclick = async () => {
    if (!confirm("Delete all saved paper texts from this device? Your progress and notes are kept.")) { return; }
    await textCache.clear();
    location.reload();
  };
  $("#reset").onclick = () => {
    if (!confirm("Reset all progress, review cards, quiz scores and notes? This can't be undone.")) { return; }
    store.reset();
    toast("Progress reset");
    viewSettings();
  };
  const est = await storageEstimate();
  const el = $("#storage");
  if (el) {
    const saved = savedCount(allRes);
    el.textContent = `${saved} of ${downloadable(allRes).length} texts saved on this device${est ? ` · ${(est.usage / 1048576).toFixed(1)} MB used` : ""}.`;
  }
}

function notFound() {
  setTop({ title: "Not found", back: { label: "Path", href: "#/" } });
  view.innerHTML = `<div class="empty">That page doesn't exist.</div>`;
}

// ---------------------------------------------------------------- router
const scrollMem = new Map();
let lastHash = null;

function render() {
  if (listenCleanup) { listenCleanup(); listenCleanup = null; }
  const hash = location.hash || "#/";
  const [, route, arg] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  switch (route) {
    case "": case undefined: viewPath(); break;
    case "stage": viewStage(arg); break;
    case "module": viewModule(arg); break;
    case "res": viewResource(arg); break;
    case "listen": viewListen(arg); break;
    case "recall": viewRecall(arg); break;
    case "quiz": viewQuiz(arg); break;
    case "pre": viewPre(arg); break;
    case "exam": viewExam(arg); break;
    case "review": viewReview(); break;
    case "library": viewLibrary(); break;
    case "progress": viewProgress(); break;
    case "settings": viewSettings(); break;
    default: notFound();
  }
  updateMini();
  if (!["listen", "quiz", "pre", "exam", "review", "recall"].includes(route)) { window.scrollTo(0, scrollMem.get(hash) || 0); } else if (route !== "listen") { window.scrollTo(0, 0); }
}

window.addEventListener("hashchange", () => {
  if (lastHash) { scrollMem.set(lastHash, window.scrollY); }
  render();
  lastHash = location.hash || "#/";
});
window.addEventListener("scroll", () => { scrollMem.set(location.hash || "#/", window.scrollY); }, { passive: true });

if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
  window.speechSynthesis.addEventListener("voiceschanged", () => { if (location.hash === "#/settings") { viewSettings(); } });
}

(async function boot() {
  try {
    await loadCurriculum();
  } catch (e) {
    view.innerHTML = `<div class="empty">Couldn't load the curriculum. Check your connection and reopen the app.<br><span class="tiny">${esc(e.message)}</span></div>`;
    return;
  }
  await loadSavedIndex();
  lastHash = location.hash || "#/";
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
