import { store, textCache } from "./store.js";
import { extractResource } from "./extract.js";
import { player, englishVoices, pickVoice } from "./player.js";
import { natural, NATURAL_VOICES } from "./natural.js";
import { pack, doneIds, totalBytes, clearAll, exportAudio, importAudio } from "./audiopack.js";
import { grade as srsGrade, outcomeFrom, dueKeys, forecast, cardCount, matureCount } from "./srs.js";
import { loadSavedIndex, isSaved, markSaved, downloadable, savedCount, downloadAll, storageEstimate, importLibrary } from "./offline.js";

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
        r.textId = seen.get(key);
      }
    }
  }
  C.stages = stages;
  try {
    const hosted = new Set((await (await fetch("data/texts/index.json", { cache: "no-cache" })).json()).ids);
    for (const r of C.resources.values()) { r.hosted = hosted.has(r.textId); }
  } catch { /* no bundled texts */ }
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
  const onListen = location.hash === `#/lesson/${player.res?.id}`;
  const show = !!player.res && player.items.length > 0 && !onListen;
  mini.hidden = !show;
  document.body.classList.toggle("has-mini", show);
  if (!show) { return; }
  $("#mini-title").textContent = player.res.title;
  $("#mini-toggle").innerHTML = player.playing ? ICONS.pause : ICONS.play;
  $("#mini-toggle").querySelector("svg").setAttribute("width", "22");
}
$("#mini-toggle").onclick = () => player.toggle();
$("#mini-open").onclick = () => { location.hash = `#/lesson/${player.res.id}`; };
player.addEventListener("change", updateMini);
player.addEventListener("completed", () => { if (!location.hash.startsWith("#/lesson")) { toast("Marked as done ✓"); } });

// ---------------------------------------------------------------- views
function offlineTag(r) {
  return r.kind !== "video" && isSaved(r) ? ` · <span style="color:var(--good)">${ICONS.down} offline</span>` : "";
}

function resRow(r, sub = "") {
  return `<a class="li" href="#/lesson/${r.id}">${kindIcon(r)}
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

function flatLessons() { return C.order.flatMap((m) => m.resources); }

function nextLessonAfter(r) {
  const list = flatLessons().filter((x) => !x.optional || x.module === r.module);
  const i = list.indexOf(r);
  return list.slice(i + 1).find((x) => !store.isDone(x.id)) || null;
}

function currentStageId() {
  const n = nextStep();
  return n ? n.m.stage.id : C.stages[C.stages.length - 1]?.id;
}

let openStages = null; // stage ids expanded on the home screen (per session)

function viewPath() {
  setTab("path");
  setTop({ title: "" });
  const next = nextStep();
  const due = dueCount();
  const t = store.today();
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let total = 0;
  let got = 0;
  for (const s of C.stages) { total += 1; got += stageStatus(s).frac; }
  const curStage = next ? next.m.stage.id : null;
  if (!openStages) { openStages = new Set([currentStageId()]); }

  // ---- Today's plan
  const steps = [];
  const reviewMin = Math.max(1, Math.round(Math.min(due, store.settings().dailyLimit) * 0.4));
  if (due) {
    steps.push({ state: "todo", title: `Review ${due} card${due === 1 ? "" : "s"}`, sub: `~${reviewMin} min · spaced retrieval of earlier material. Do this first.`, href: "#/review", cta: "Start" });
  } else if (t.reviews) {
    steps.push({ state: "done", title: `Review done · ${t.reviews} card${t.reviews === 1 ? "" : "s"}`, sub: "Missed ones come back tomorrow." });
  } else {
    steps.push({ state: "done", title: cardCount() ? "No reviews due today" : "Reviews start after your first check-in", sub: cardCount() ? `${cardCount()} cards in rotation · ${matureCount()} in long-term memory` : "Every question you answer joins a spaced schedule." });
  }
  if (next?.kind === "res") {
    const m = next.m;
    const fresh = !store.pre(m.id) && required(m).every((r) => !store.isDone(r.id));
    const req = required(m);
    const left = req.filter((r) => !store.isDone(r.id));
    const pos = store.pos(next.r.id);
    if (fresh) {
      steps.push({ state: "todo", title: `Start “${m.title}”`, sub: `Stage ${m.stage.number} · 3 prequestions, then ${req.length} lesson${req.length === 1 ? "" : "s"} (~${fmtMin(req.reduce((n, r) => n + (r.minutes || 0), 0))})`, href: `#/pre/${m.id}`, cta: "Begin" });
    } else {
      steps.push({ state: "todo", title: `${pos && pos.i > 0 ? "Continue" : "Lesson"}: ${next.r.title}`, sub: `${KIND_LABEL[next.r.kind]} · ${fmtMin(next.r.minutes)}${pos && pos.n ? ` · ${Math.round((pos.i / pos.n) * 100)}% done` : ""} · lesson ${req.indexOf(next.r) + 1} of ${req.length} in “${m.title}”`, href: `#/lesson/${next.r.id}`, cta: pos && pos.i > 0 ? "Resume" : "Open" });
    }
    steps.push({ state: "later", title: `Then: check-in for “${m.title}”`, sub: `${left.length} lesson${left.length === 1 ? "" : "s"} left · ~${fmtMin(left.reduce((n, r) => n + (r.minutes || 0), 0))} · pass with ${PASS}%` });
  } else if (next?.kind === "quiz") {
    steps.push({ state: "todo", title: `Check-in: ${next.m.title}`, sub: `${next.m.quiz.length} questions · pass with ${PASS}% to finish the module`, href: `#/quiz/${next.m.id}`, cta: "Start" });
  } else {
    steps.push({ state: "done", title: "Path complete", sub: "Keep it fresh with the daily review and stage exams." });
  }
  const pace = t.lessons >= 2 ? `<div class="pace">You've finished ${t.lessons} lessons today. Stopping here is fine: spaced sessions beat one long one.</div>` : "";

  // ---- Upcoming lessons
  const upcoming = [];
  if (next?.r) {
    for (const r of flatLessons()) {
      if (upcoming.length >= 4) { break; }
      if (r.optional || store.isDone(r.id) || r === next.r) { continue; }
      if (flatLessons().indexOf(r) < flatLessons().indexOf(next.r)) { continue; }
      upcoming.push(r);
    }
  }

  view.innerHTML = `
    <div class="home-head">
      <div><div class="large-title">Today</div>
      <div class="muted small">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${store.streak() ? ` · ${store.streak()}-day streak` : ""} · ${Math.round((got / Math.max(total, 1)) * 100)}% of the path</div></div>
    </div>
    ${standalone ? "" : `<div class="card install-tip small"><b>Install on iPhone:</b> in Safari tap <b>Share</b> → <b>Add to Home Screen</b>.</div>`}
    <div class="card plan">
      ${steps.map((s, i) => `<div class="step ${s.state}${s === steps.find((x) => x.state === "todo") ? " now" : ""}">
        <span class="dot">${s.state === "done" ? ICONS.check : i + 1}</span>
        <div class="step-body"><div class="step-t">${esc(s.title)}</div><div class="step-s">${esc(s.sub)}</div></div>
        ${s.href ? `<a class="step-cta" href="${s.href}">${s.cta}</a>` : ""}
      </div>`).join("")}
      ${pace}
    </div>
    ${upcoming.length ? `<div class="section-label">Coming up</div><div class="list">${upcoming.map((r) => `<a class="li" href="#/lesson/${r.id}">${kindIcon(r)}<span class="li-body"><div class="li-title">${esc(r.title)}</div><div class="li-sub">${esc(r.module.title)} · ${fmtMin(r.minutes)}</div></span>${ICONS.chev}</a>`).join("")}</div>` : ""}
    <div class="section-label">The path</div>
    <div class="path">${C.stages.map((s) => {
      const st = stageStatus(s);
      const done = st.complete === st.modules;
      const ex = store.s.exams[s.id];
      const allRes = s.modules.flatMap((m) => m.resources);
      return `<details class="stage-group ${s.id === curStage ? "current" : ""}" data-sid="${s.id}" ${openStages.has(s.id) ? "open" : ""}>
        <summary>
          <span class="stage-num ${done ? "done" : ""}">${done ? ICONS.check : s.number}</span>
          <span class="sg-body"><span class="stage-title">${esc(s.title)}</span>
            <span class="sg-meta">${st.complete}/${st.modules} modules · ~${fmtMin(st.minutes)}</span>
            <span class="progress ${done ? "good" : ""}"><i style="width:${Math.round(st.frac * 100)}%"></i></span></span>
          <span class="sg-chev">${ICONS.chev}</span>
        </summary>
        <p class="sg-overview small muted">${esc(s.overview)}</p>
        <div class="list">${s.modules.map((m, i) => {
          const ms = moduleStatus(m);
          const here = next && next.m === m;
          return `<a class="li ${here ? "here" : ""}" href="#/module/${m.id}">
            <span class="mod-num ${ms.complete ? "done" : ""}">${ms.complete ? ICONS.check : `${s.number}.${i + 1}`}</span>
            <span class="li-body"><div class="li-title">${esc(m.title)}</div>
            <div class="li-sub">${here ? "You are here · " : ""}${ms.done}/${ms.total} lessons · ${ms.quiz ? `check-in ${ms.quiz.best}%` : "check-in not taken"}</div></span>${ICONS.chev}</a>`;
        }).join("")}</div>
        <div class="sg-actions">
          <a class="btn secondary" href="#/exam/${s.id}">Stage exam${ex ? ` · best ${ex.best}%` : ""}</a>
          ${downloadButton(allRes, "Save stage offline", `stage:${s.id}`, true)}
        </div>
      </details>`;
    }).join("")}</div>
  `;
  view.querySelectorAll(".stage-group").forEach((d) => {
    d.addEventListener("toggle", () => { if (d.open) { openStages.add(d.dataset.sid); } else { openStages.delete(d.dataset.sid); } });
  });
  wireDownloads(() => viewPath());
}

// Download buttons: data-scope = "all" | "stage:<id>" | "module:<id>".
function downloadButton(resources, label, scope, compact = false) {
  const list = downloadable(resources);
  const n = savedCount(list);
  const all = n === list.length;
  const text = all ? (compact ? "Saved offline" : `All ${list.length} texts saved offline`) : compact ? `${label} (${n}/${list.length})` : `${label} (${n}/${list.length} saved)`;
  return `<button class="btn ${all ? "ghost" : "secondary"} dl-btn" data-scope="${scope}" ${all ? "disabled" : ""}>${ICONS.down} ${text}</button>`;
}

function scopeResources(scope) {
  const [kind, id] = scope.split(":");
  if (kind === "stage") { return C.stages.find((s) => s.id === id).modules.flatMap((m) => m.resources); }
  if (kind === "module") { return C.modules.get(id).resources; }
  return [...C.resources.values()];
}

function wireDownloads(rerender) {
  view.querySelectorAll(".dl-btn").forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      if (!navigator.onLine) { toast("Connect to the internet to download"); return; }
      btn.disabled = true;
      const state = await downloadAll(scopeResources(btn.dataset.scope), (p) => {
        if (btn.isConnected) { btn.innerHTML = `${ICONS.down} Saving ${p.done}/${p.total}…`; }
      });
      toast(state.failed.length ? `Saved ${state.ok}. ${state.failed.length} couldn't be saved (publisher blocks apps).` : `Saved ${state.ok} text${state.ok === 1 ? "" : "s"} for offline listening`);
      rerender();
    };
  });
}

function viewModule(id) {
  const m = C.modules.get(id);
  if (!m) { return notFound(); }
  setTab("path");
  setTop({ title: `Stage ${m.stage.number}.${m.stage.modules.indexOf(m) + 1}`, back: { label: "Today", href: "#/" } });
  openStages = openStages || new Set();
  openStages.add(m.stage.id);
  const st = moduleStatus(m);
  const core = m.resources.filter((r) => !r.optional);
  const extra = m.resources.filter((r) => r.optional);
  const pre = store.pre(m.id);
  const idx = C.order.indexOf(m);
  const prevM = C.order[idx - 1];
  const nextM = C.order[idx + 1];
  const row = (r, i) => `<a class="li" href="#/lesson/${r.id}">${kindIcon(r)}
    <span class="li-body"><div class="li-title">${i !== undefined ? `${i + 1}. ` : ""}${esc(r.title)}</div>
    <div class="li-sub">${resMeta(r)}${r.minutes ? ` · ${fmtMin(r.minutes)}` : ""}${offlineTag(r)}${store.recall(r.id) ? ' · <span style="color:var(--accent)">recalled</span>' : ""}</div></span>${ICONS.chev}</a>`;

  const preCard = pre
    ? `<details class="card listen-for"><summary><b>Listen for</b> <span class="small muted">your 3 prequestions</span></summary>
        <ol class="small" style="margin:8px 0 0;padding-left:20px">${pre.qs.map((qi) => `<li style="margin-bottom:6px">${esc(m.quiz[qi]?.q)}</li>`).join("")}</ol></details>`
    : `<a class="card prequest" href="#/pre/${m.id}"><b>Step 1 · 3 prequestions</b>
        <div class="small muted" style="margin-top:4px">Commit to a guess before learning; wrong guesses are expected. It primes you to notice the answers (Pan &amp; Carpenter 2023).</div>
        <div class="btn-stack" style="margin-bottom:0"><span class="btn">Answer prequestions</span></div></a>`;

  view.innerHTML = `
    <div class="tiny muted" style="margin:0 2px">Stage ${m.stage.number} · ${esc(m.stage.title)}</div>
    <div class="large-title" style="font-size:28px">${esc(m.title)}</div>
    <p class="lede goal">${esc(m.goal)}</p>
    ${preCard}
    <details class="guide" ${st.done ? "" : "open"}><summary><h3 style="display:inline">Guide</h3></summary>${paras(m.guide)}</details>
    <div class="section-label">Lessons · ${st.done}/${st.total} done</div>
    <div class="list">${core.map((r, i) => row(r, i)).join("")}</div>
    ${extra.length ? `<div class="section-label">Go deeper (optional)</div><div class="list">${extra.map((r) => row(r)).join("")}</div>` : ""}
    <div class="section-label">Check-in</div>
    <div class="card">
      <div class="row-gap" style="justify-content:space-between">
        <div><b>${m.quiz.length} questions</b><div class="small muted">Pass with ${PASS}% to complete the module. The questions then join your daily review.</div></div>
        ${st.quiz ? `<span class="pill ${st.passed ? "good" : "bad"}">Best ${st.quiz.best}%</span>` : `<span class="pill gray">Not taken</span>`}
      </div>
      <div class="btn-stack"><a class="btn" href="#/quiz/${m.id}">${st.quiz ? "Retake check-in" : "Start check-in"}</a></div>
    </div>
    ${m.exercise ? `<div class="section-label">Research exercise</div>
      <div class="guide" style="border-left-color:var(--warn)"><h3 style="color:var(--warn)">Try this</h3>${paras(m.exercise)}</div>
      <textarea id="ex-note" placeholder="Work through the exercise here (saved on this device)…">${esc(store.note(m.id))}</textarea>` : ""}
    <div class="btn-stack">${downloadButton(m.resources, "Save module offline", `module:${m.id}`)}</div>
    <div class="mod-nav">
      ${prevM ? `<a href="#/module/${prevM.id}">‹ ${esc(prevM.title)}</a>` : "<span></span>"}
      ${nextM ? `<a href="#/module/${nextM.id}">${esc(nextM.title)} ›</a>` : "<span></span>"}
    </div>
  `;
  const ta = $("#ex-note");
  if (ta) { ta.oninput = () => store.setNote(m.id, ta.value); }
  wireDownloads(() => viewModule(id));
}

// Marking a lesson done leads into free recall (Karpicke & Blunt 2011) unless turned off.
function finishSource(r) {
  player.pause();
  store.setDone(r.id, true);
  if (store.settings().freeRecall) { location.hash = `#/recall/${r.id}`; return; }
  toast("Marked as done ✓");
  const nx = nextLessonAfter(r);
  location.hash = nx && nx.module === r.module ? `#/lesson/${nx.id}` : `#/module/${r.module.id}`;
}

function prevSource(r) {
  const flat = flatLessons();
  const i = flat.indexOf(r);
  for (let j = i - 1; j >= 0; j--) { if (store.isDone(flat[j].id)) { return flat[j]; } }
  return i > 0 ? flat[i - 1] : null;
}

// ---- free recall after a lesson
function viewRecall(id) {
  const r = C.resources.get(id);
  if (!r) { return notFound(); }
  setTab("path");
  setTop({ title: "Free recall", back: { label: "Lesson", href: `#/lesson/${r.id}` } });
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
    <button class="btn ghost" id="skip">Skip for now</button></div>
    <div id="compare"></div>`;
  const ta = $("#recall-text");
  const goNext = () => {
    const nx = nextLessonAfter(r);
    location.hash = nx && nx.module === r.module ? `#/lesson/${nx.id}` : `#/module/${r.module.id}`;
  };
  $("#skip").onclick = goNext;
  $("#check").onclick = () => {
    $("#check").hidden = true;
    $("#compare").innerHTML = `
      <div class="section-label">Compare</div>
      <div class="guide"><h3>What this source is for</h3>${paras(r.why)}${r.focus ? `<p><b>Focus:</b> ${esc(r.focus)}</p>` : ""}</div>
      <div class="small muted" style="margin:0 4px 10px">Skim <a href="#/lesson/${r.id}">the lesson</a> to check what you missed. Notice anything you got wrong, not just what you left out.</div>
      ${store.note(r.id) ? `<div class="card small" style="white-space:pre-wrap"><b>Your notes</b><br>${esc(store.note(r.id))}</div>` : ""}
      <div class="section-label">How complete was your recall?</div>
      <div class="grade-row">
        <button data-g="0">Missed most</button><button data-g="1">Got some</button><button data-g="2">Got most</button><button data-g="3">Nailed it</button>
      </div>
      <p class="tiny muted" style="margin:8px 4px">This schedules a recall prompt for this lesson in your daily review: sooner if it was patchy, later if it was solid.</p>`;
    $("#compare").querySelectorAll("[data-g]").forEach((b) => {
      b.onclick = () => {
        const g = Number(b.dataset.g);
        store.setRecall(r.id, ta.value.trim(), g);
        srsGrade(`r:${r.id}`, "r", g);
        toast("Recall saved and scheduled for review");
        goNext();
      };
    });
    $("#compare").scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

// Spoken introduction before the reading: stage overview (first lesson of a stage), module overview
// (first lesson of a module) and why this lesson matters.
function introBlocks(r) {
  const m = r.module;
  const req = required(m);
  const first = req[0] === r;
  const stageFirst = first && m.stage.modules[0] === m;
  const out = [];
  if (stageFirst) {
    out.push({ type: "h", text: `Stage ${m.stage.number}: ${m.stage.title}`, intro: true });
    out.push({ type: "p", text: m.stage.overview, intro: true });
  }
  if (first) {
    out.push({ type: "h", text: `Module overview: ${m.title}`, intro: true });
    out.push({ type: "p", text: `Goal: ${m.goal}`, intro: true });
    for (const p of String(m.guide).split(/\n\s*\n/)) { out.push({ type: "p", text: p, intro: true }); }
  }
  out.push({ type: "h", text: "Why this matters", intro: true });
  out.push({ type: "p", text: r.why, intro: true });
  if (r.focus) { out.push({ type: "p", text: `What to focus on: ${r.focus}`, intro: true }); }
  out.push({ type: "h", text: `Now the reading: ${r.title}`, intro: true });
  return out;
}

// The blocks the player reads for a lesson (intro + text), so pre-generated audio matches playback.
async function lessonBlocks(r) {
  const out = await extractResource(r, { includeAppendix: store.settings().includeAppendix });
  markSaved(r);
  return [...introBlocks(r), ...out.blocks];
}

// Settings: pre-generate natural-voice audio per stage or for everything.
function wireAudioPack() {
  const status = $("#apack-status");
  const stopBtn = $("#apack-stop");
  const stageRes = (st) => st.modules.flatMap((m) => m.resources).filter((r) => r.kind !== "video");
  const render = async () => {
    if (!status.isConnected) { pack.removeEventListener("change", render); natural.removeEventListener("change", render); return; }
    const done = await doneIds();
    for (const st of C.stages) {
      const list = stageRes(st);
      const n = list.filter((r) => done.has(r.id)).length;
      const el = view.querySelector(`[data-apack-count="${st.id}"]`);
      if (el) { el.textContent = `${n}/${list.length} sources saved${n === list.length ? " ✓" : ""}`; }
    }
    const busy = pack.running;
    view.querySelectorAll("[data-apack], #apack-all, #apack-clear").forEach((b) => { b.disabled = busy; });
    stopBtn.hidden = !busy;
    const p = pack.state;
    if (busy && p) {
      status.textContent = pack.stopping ? "Stopping after this sentence…"
        : natural.state === "loading" ? `Downloading natural voice… ${Math.round(natural.progress * 100)}%`
        : `${p.label}: source ${Math.min(p.done + 1, p.total)} of ${p.total} · sentence ${p.sentence}/${p.sentences} · ${p.current}`;
    } else if (p) {
      status.textContent = p.error ? `Stopped: ${p.error}` : p.stopped ? `Paused. Saved ${p.done - p.failed.length} of ${p.total} sources; tap Generate to continue. ${fmtMB(await totalBytes())} used.` : `${p.label}: saved ${p.done - p.failed.length} of ${p.total} sources${p.failed.length ? ` · ${p.failed.length} couldn't be loaded` : ""}. ${fmtMB(await totalBytes())} used.`;
    } else {
      status.textContent = `${done.size} sources saved · ${fmtMB(await totalBytes())} used.`;
    }
  };
  const fmtMB = (b) => `${Math.round(b / 1e6)} MB`;
  const run = (list, label) => {
    natural.unlock();
    pack.generate(list, lessonBlocks, label).then(() => toast("Natural voice audio saved")).catch(() => {});
  };
  pack.addEventListener("change", render);
  natural.addEventListener("change", render);
  $("#apack-all").onclick = () => run(C.stages.flatMap(stageRes), "All stages");
  view.querySelectorAll("[data-apack]").forEach((b) => {
    b.onclick = () => { const st = C.stages.find((x) => x.id === b.dataset.apack); run(stageRes(st), `Stage ${st.number}`); };
  });
  stopBtn.onclick = () => pack.stop();
  $("#apack-export").onclick = async () => {
    status.textContent = "Packing audio…";
    const blob = await exportAudio();
    const file = new File([blob], `hai-scholar-audio-${new Date().toLocaleDateString("en-CA")}.haia`, { type: "application/octet-stream" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "HAI Scholar audio" }); render(); return; } catch { /* cancelled */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    render();
  };
  $("#apack-import").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) { return; }
    try {
      const r = await importAudio(f, (n, t) => { status.textContent = `Importing… ${n} of ${t} clips`; });
      toast(`Imported audio for ${r.sources} sources`);
    } catch (err) { toast(err.message); }
    e.target.value = "";
    render();
  };
  $("#apack-clear").onclick = async () => {
    if (!confirm("Delete all saved natural-voice audio?")) { return; }
    await clearAll();
    render();
  };
  render();
}

// ---- lesson: overview + read-along player (or video) on one page
let listenCleanup = null;

function viewLesson(id) {
  const r = C.resources.get(id);
  if (!r) { return notFound(); }
  setTab("path");
  store.setLast(r.id);
  const m = r.module;
  const req = required(m);
  const n = req.indexOf(r);
  const top = () => ({
    title: n >= 0 ? `Lesson ${n + 1} of ${req.length}` : "Optional lesson",
    back: { label: "Module", href: `#/module/${m.id}` },
    right: [{ label: store.isDone(r.id) ? "Recall" : "Done", onClick: () => (store.isDone(r.id) ? (location.hash = `#/recall/${r.id}`) : finishSource(r)) }],
  });
  setTop(top());
  const nx = nextLessonAfter(r);
  const rec = store.recall(r.id);
  const header = `
    <div class="tiny muted" style="margin:0 2px"><a href="#/module/${m.id}">Stage ${r.stage.number} · ${esc(m.title)}</a>${r.optional ? " · optional" : ""}</div>
    <div class="res-title">${esc(r.title)}</div>
    <div class="meta-line">${esc(r.authors)}${r.year ? ` (${esc(r.year)})` : ""}${r.venue ? ` · ${esc(r.venue)}` : ""}</div>
    <div class="row-gap" style="margin:10px 2px 8px">
      <span class="pill">${esc(KIND_LABEL[r.kind])}</span>
      ${r.minutes ? `<span class="pill gray">${fmtMin(r.minutes)}</span>` : ""}
      ${store.isDone(r.id) ? `<span class="pill good">Done</span>` : ""}
      ${r.kind !== "video" && isSaved(r) ? `<span class="pill good">${ICONS.down} Offline</span>` : ""}
      <a class="pill gray" href="${esc(r.url)}" target="_blank" rel="noopener">Original ↗</a>
    </div>
    ${r.kind === "video" ? `<details class="guide why" open><summary><h3 style="display:inline">Why this matters</h3></summary>${paras(r.why)}${r.focus ? `<p><b>Focus:</b> ${esc(r.focus)}</p>` : ""}</details>` : ""}`;
  const footer = () => `
    <div class="card lesson-end">
      <b>${store.isDone(r.id) ? "Lesson done" : "Finished?"}</b>
      <div class="small muted">${store.isDone(r.id) ? (rec ? "You've done a free recall for this lesson." : "Do a 2-minute free recall to lock it in.") : "Mark it done, then do a 2-minute free recall. Writing down what you remember roughly doubles what sticks compared with relistening (Roediger & Karpicke 2006)."}</div>
      <div class="btn-stack" style="margin-bottom:0">
        ${store.isDone(r.id) ? `<a class="btn" href="#/recall/${r.id}">${rec ? "Redo free recall" : "Free recall"}</a>` : `<button class="btn" id="end-done">Done → free recall</button>`}
        ${nx ? `<a class="btn ghost" href="#/lesson/${nx.id}">Next: ${esc(nx.title)}</a>` : ""}
        ${!nx || nx.module !== m ? `<a class="btn secondary" href="#/quiz/${m.id}">Module check-in</a>` : ""}
      </div>
    </div>
    ${rec ? `<div class="section-label">Your free recall</div><div class="card small" style="white-space:pre-wrap">${esc(rec.text) || "<span class='muted'>(recalled out loud)</span>"}</div>` : ""}
    <div class="section-label">Your notes</div>
    <textarea id="note" placeholder="Key claims, methods, questions, how it connects to other work…">${esc(store.note(r.id))}</textarea>`;
  const wireFooter = () => {
    const d = $("#end-done");
    if (d) { d.onclick = () => finishSource(r); }
    const ta = $("#note");
    if (ta) { ta.oninput = () => store.setNote(r.id, ta.value); }
  };

  // ---- video lessons
  if (r.kind === "video") {
    view.innerHTML = `${header}
      <div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.youtube)}?playsinline=1&rel=0&modestbranding=1" title="${esc(r.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
      ${footer()}`;
    wireFooter();
    return;
  }

  // ---- text lessons: read-along
  document.body.classList.add("listening");
  document.documentElement.style.setProperty("--reader-size", `${store.settings().textSize}px`);
  view.innerHTML = `${header}<div id="reader-area"><div class="reader-status"><div class="spinner"></div><div id="status">Loading text…</div></div></div>`;

  const controls = document.createElement("div");
  controls.className = "controls";
  controls.innerHTML = `<div class="controls-inner">
      <div id="sheet"></div>
      <div class="voice-status" id="vstat" hidden></div>
      <div class="scrub"><span id="c-pos">0%</span><input id="c-range" type="range" min="0" max="0" value="0" aria-label="Position"><span id="c-left"></span></div>
      <div class="ctrl-row">
        <button class="ctrl txt" id="c-rate" aria-label="Speed">1×</button>
        <button class="ctrl" id="c-back" aria-label="Back a few sentences">${ICONS.back15}</button>
        <button class="ctrl play" id="c-play" aria-label="Play">${ICONS.play}</button>
        <button class="ctrl" id="c-fwd" aria-label="Forward a few sentences">${ICONS.fwd15}</button>
        <button class="ctrl txt" id="c-size" aria-label="Text size">Aa</button>
      </div></div>`;
  document.body.appendChild(controls);
  const area = $("#reader-area");

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
    const prev = area.querySelector(".s.cur");
    const cur = area.querySelector(`.s[data-i="${player.i}"]`);
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
    voiceStatus();
    setTop(top());
  };
  const vstat = $("#vstat", controls);
  const voiceStatus = () => {
    let msg = "";
    if (player.wantsNatural && !player.packed && natural.state === "loading") { msg = `Downloading natural voice… ${Math.round(natural.progress * 100)}% · one time · using iPhone voice meanwhile`; }
    else if (player.wantsNatural && !player.packed && natural.state === "error") { msg = "Natural voice couldn't load on this device, so using the iPhone voice."; }
    else if (player.wantsNatural && !player.packed && player.naturalTooSlow) { msg = "Natural voice is too slow on this device, so using the iPhone voice."; }
    else if (player.playing && player.buffering) { msg = "Preparing audio…"; }
    vstat.hidden = !msg;
    vstat.textContent = msg;
  };
  natural.addEventListener("change", voiceStatus);

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
    sheet.innerHTML = `<div class="sheet"><div class="k">Finished</div>
      <div class="sheet-t">Now do a 2-minute free recall</div>
      <div class="small muted">Retrieval right after listening is what turns it into memory.</div>
      <div class="btn-stack" style="margin-bottom:0"><a class="btn" href="#/recall/${r.id}">Start free recall</a></div></div>`;
  };

  const renderText = () => {
    const groups = [];
    player.items.forEach((it, i) => {
      if (!groups[it.b]) { groups[it.b] = { h: it.h, intro: it.intro, parts: [] }; }
      groups[it.b].parts.push(`<span class="s" data-i="${i}">${esc(it.text)}</span> `);
    });
    const g2h = (g) => (g.h ? `<h2 class="rh">${g.parts.join("")}</h2>` : `<p>${g.parts.join("")}</p>`);
    const all = groups.filter(Boolean);
    const intro = all.filter((g) => g.intro);
    const body = all.filter((g) => !g.intro);
    area.innerHTML = `<div class="reader">${intro.length ? `<div class="intro-read">${intro.map(g2h).join("")}</div>` : ""}
      <div class="reader-source">Text: ${esc(player.source)} · tap any sentence to start there${store.settings().recallPauses ? " · pauses for a quick recall at section breaks" : ""}</div>
      ${body.map(g2h).join("")}</div>
      ${footer()}`;
    wireFooter();
    area.querySelector(".reader").addEventListener("click", (e) => {
      const s = e.target.closest(".s");
      if (!s) { return; }
      sheet.innerHTML = "";
      player.play(Number(s.dataset.i));
    });
    sync();
    const cur = area.querySelector(".s.cur");
    if (cur && player.i > 0) { cur.scrollIntoView({ block: "center" }); }
  };

  $("#c-play", controls).onclick = () => { sheet.innerHTML = ""; if (player.isLoaded(r)) { player.toggle(); } };
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
    const cur = area.querySelector(`.s[data-i="${player.i}"]`);
    if (cur) { cur.scrollIntoView({ block: "center" }); }
  };

  player.addEventListener("change", sync);
  player.addEventListener("checkpoint", onCheckpoint);
  player.addEventListener("completed", onCompleted);
  listenCleanup = () => {
    player.removeEventListener("change", sync);
    player.removeEventListener("checkpoint", onCheckpoint);
    player.removeEventListener("completed", onCompleted);
    natural.removeEventListener("change", voiceStatus);
    window.removeEventListener("touchmove", onScroll);
    window.removeEventListener("wheel", onScroll);
    controls.remove();
    document.body.classList.remove("listening");
  };

  if (!player.supported) {
    area.innerHTML = `<div class="reader-status">This browser doesn't support speech. Open in Safari on iPhone.</div>`;
    return;
  }
  if (player.isLoaded(r)) { renderText(); return; }

  const token = location.hash;
  extractResource(r, { includeAppendix: store.settings().includeAppendix, onStatus: (s) => { const el = $("#status"); if (el) { el.textContent = s; } } })
    .then((out) => {
      markSaved(r);
      if (location.hash !== token) { return; }
      player.load(r, [...introBlocks(r), ...out.blocks], out.source);
      renderText();
    })
    .catch((err) => {
      if (location.hash !== token) { return; }
      controls.remove();
      document.body.classList.remove("listening");
      const offline = !navigator.onLine;
      area.innerHTML = `<div class="card">
        <b>${offline ? "You're offline and this lesson isn't saved on your phone." : "This text isn't in the app yet."}</b>
        ${offline ? `<p class="small muted">Next time you're online, use “Save module offline” on the module page.</p>` : `<p class="small muted">The publisher blocks other apps. If you've imported your personal library (Settings → Offline), it will be there. Otherwise use Safari's built-in reader:</p>
        <ol class="small"><li>Tap <b>Open original</b>.</li><li>In Safari, tap the <b>page menu</b> (aA / ☰ in the address bar) → <b>Listen to Page</b>.</li><li>Come back and tap <b>Done</b>.</li></ol>`}
        <div class="btn-stack"><a class="btn" href="${esc(r.listen || r.url)}" target="_blank" rel="noopener">Open original</a>
        <button class="btn ghost" id="retry">Try again</button></div>
        <details class="tiny muted"><summary>Details</summary>${(err.details || []).map(esc).join("<br>")}</details></div>
        ${footer()}`;
      wireFooter();
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
          ${ref ? `<div class="small" style="margin-top:8px">Source: <a href="#/lesson/${ref.id}">${esc(ref.title)}</a></div>` : ""}</div>
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
function runSession({ title, back, items, relearn = false, graded = true, countToday = false, onFinish }) {
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
          if (graded && countToday) { store.bumpToday("reviews"); }
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
        <div class="small" style="margin:0 4px 8px"><a href="#/lesson/${it.r.id}">Open the source</a> to check details.</div>
        <div class="grade-row"><button data-g="0">Missed most</button><button data-g="1">Got some</button><button data-g="2">Got most</button><button data-g="3">Nailed it</button></div>`;
      $("#after").querySelectorAll("[data-g]").forEach((b) => {
        b.onclick = () => {
          const g = Number(b.dataset.g);
          const t = $("#rc").value.trim();
          if (t) { store.setRecall(it.r.id, t, g); }
          srsGrade(it.key, "r", g);
          if (countToday) { store.bumpToday("reviews"); }
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
    back: { label: "Module", href: `#/module/${m.id}` },
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
  setTop({ title: "Prequestions", back: { label: "Module", href: `#/module/${m.id}` } });
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
        location.hash = first ? `#/lesson/${first.id}` : `#/module/${m.id}`;
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
    back: { label: "Today", href: "#/" },
    items: shuffle(picked),
    onFinish: (score, total, results) => {
      const pct = Math.round((score / total) * 100);
      store.recordExam(s.id, pct);
      resultsScreen(score, total, results, {
        passMsg: "Stage exam passed. Retrieval across mixed topics is the strongest sign the material has stuck.",
        actions: `<a class="btn" href="#/">Back to Today</a><button class="btn ghost" id="retake">New exam</button>`,
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
    countToday: !ahead,
    onFinish: (score, total, results) => {
      const left = dueCount();
      resultsScreen(score, total, results, {
        pass: 0,
        passMsg: left ? `${left} more due. Keep going or come back later.` : "All caught up. Missed items return tomorrow, solid ones in days to weeks.",
        actions: `${left ? `<a class="btn" href="#/review" id="again">Continue review</a>` : ""}<a class="btn secondary" href="#/">Back to Today</a>`,
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
    ${noted.length ? `<div class="section-label">Your notes</div><div class="list">${noted.map((x) => `<a class="li" href="${x.resources ? `#/module/${x.id}` : `#/lesson/${x.id}`}"><span class="li-body"><div class="li-title">${esc(x.title)}</div><div class="li-sub">${esc(store.note(x.id).slice(0, 110))}${store.note(x.id).length > 110 ? "…" : ""}</div></span>${ICONS.chev}</a>`).join("")}</div>` : ""}
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
    <div class="section-label">Listening</div>
    <div class="list">
      <div class="setting" style="flex-direction:column;align-items:stretch">
        <label>Voice type</label>
        <div class="seg"><button data-eng="natural" class="${s.voiceEngine === "natural" ? "on" : ""}">Natural (neural)</button><button data-eng="system" class="${s.voiceEngine === "system" ? "on" : ""}">iPhone voices</button></div>
        ${s.voiceEngine === "natural" ? `
        <label for="nvoice" style="margin-top:6px">Natural voice</label>
        <select id="nvoice">${NATURAL_VOICES.map(([id, l]) => `<option value="${id}" ${id === s.naturalVoice ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <div class="tiny muted" id="nstate"></div>
        <div class="btn-row" style="margin:4px 0 0"><button class="btn secondary" id="nload">Download voice</button><button class="btn ghost" id="npreview">Preview</button></div>
        <div class="tiny muted">Kokoro, an open-source neural speech model, runs entirely on your iPhone. It's free, needs no account, and nothing is sent anywhere. There's a one-time download: about 330 MB on phones with GPU support (iOS 26+, fast), otherwise 90 MB. After that it works offline. On older phones, if it can't keep up, switch to iPhone voices.</div>` : `
        <label for="voice" style="margin-top:6px">iPhone voice</label>
        <select id="voice"><option value="">Automatic${auto ? ` (${esc(auto.name)})` : ""}</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? "selected" : ""}>${esc(v.name)} — ${esc(v.lang)}</option>`).join("")}</select>
        <div class="tiny muted">For a better iPhone voice: Settings → Accessibility → Spoken Content → Voices → English → download an “Enhanced” or “Premium” voice, then choose it here.</div>`}
      </div>
      <div class="setting"><label for="rate">Speed</label><select id="rate" style="width:auto">${[0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2].map((r) => `<option value="${r}" ${r === s.rate ? "selected" : ""}>${r}×</option>`).join("")}</select></div>
      ${s.voiceEngine === "system" ? `<div class="setting"><button class="btn secondary" id="test-voice">Test voice</button></div>` : ""}
      ${sw("skipCitations", "Skip citations when speaking", "Silences “[12]” and “(Smith et al., 2019)” in audio; they stay visible in the text.")}
      ${sw("includeAppendix", "Include appendices", "Papers stop at the references by default.")}
      ${sw("keepAwake", "Keep screen on while listening", "iOS pauses speech when a web app's screen locks, so this keeps it awake.")}
    </div>
    ${s.voiceEngine === "natural" ? `<div class="section-label">Natural voice audio on this phone</div>
    <div class="list" id="apack">
      <div class="setting" style="flex-direction:column;align-items:stretch">
        <div class="tiny muted">Generates the natural-voice audio ahead of time and saves it on your phone, so lessons start instantly and play offline. Keep the app open with the screen on while it works. It's slow: roughly as long as the audio itself on GPU phones, and longer on others. About 14 MB per hour of audio (the whole path is ~${Math.round(downloadable(allRes).reduce((n, r) => n + (r.minutes || 0), 0) / 60)} h).</div>
        <div class="small" id="apack-status"></div>
        <div class="btn-row" style="margin:4px 0 0"><button class="btn secondary" id="apack-all">Generate all</button><button class="btn ghost" id="apack-stop" hidden>Stop</button></div>
      </div>
      ${C.stages.map((st) => `<div class="setting"><label>Stage ${st.number} · ${esc(st.title)}<div class="tiny muted" data-apack-count="${st.id}"></div></label><button class="btn secondary" data-apack="${st.id}" style="width:auto">Generate</button></div>`).join("")}
      <div class="setting" style="flex-direction:column;align-items:stretch">
        <div class="tiny muted"><b>Phone can't run the natural voice?</b> Open this app on a computer (Chrome or Safari), tap Generate there, then Export audio file. AirDrop the file to your phone and tap Import audio file. Use the same voice and citation settings on both.</div>
        <div class="btn-row" style="margin:4px 0 0"><button class="btn secondary" id="apack-export">Export audio file</button><label class="btn secondary" style="cursor:pointer">Import audio file<input type="file" id="apack-import" hidden></label></div>
      </div>
      <div class="setting"><button class="btn ghost" id="apack-clear">Delete saved audio</button></div>
    </div>` : ""}
    <div class="section-label">Offline</div>
    <div class="list">
      <div class="setting" style="flex-direction:column;align-items:stretch">
        <div class="small muted" id="storage">Checking storage…</div>
        ${downloadButton(allRes, "Download everything", "all")}
        <div class="tiny muted">Saves the full text of every paper and essay (about ${downloadable(allRes).length}) so you can listen anywhere. iPhone voices run on-device, so audio works offline. Videos need a connection. Some publisher pages block apps and can't be saved.</div>
      </div>
      <div class="setting" style="flex-direction:column;align-items:stretch"><label class="btn secondary" style="cursor:pointer">Import personal library file<input type="file" id="import-lib" accept="application/json,.json" hidden></label>
        <div class="tiny muted">For papers whose licenses don't allow public hosting. AirDrop <code>hai-scholar-personal-library.json</code> from your Mac to your iPhone, save it to Files, then pick it here.</div></div>
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
      <p><b>How listening works.</b> Most texts are bundled with the app. The rest come live from the original source (arXiv, the author's site, or a public reader service). The natural voice runs on your phone, and its audio can be generated ahead of time and saved (Settings → Natural voice audio).</p>
      <p style="margin-bottom:0"><b>Curriculum:</b> ${C.stages.length} stages · ${C.order.length} modules · ${C.resources.size} sources · ${C.order.reduce((n, m) => n + m.quiz.length, 0)} questions.</p>
    </div>`;

  if ($("#apack")) { wireAudioPack(); }
  for (const key of ["recallFirst", "recallPauses", "freeRecall", "skipCitations", "includeAppendix", "keepAwake"]) {
    $(`#sw-${key}`).onchange = (e) => store.setSetting(key, e.target.checked);
  }
  $("#limit").onchange = (e) => store.setSetting("dailyLimit", Number(e.target.value));
  view.querySelectorAll("[data-eng]").forEach((b) => { b.onclick = () => { store.setSetting("voiceEngine", b.dataset.eng); player.stop(); viewSettings(); }; });
  const vSel = $("#voice");
  if (vSel) { vSel.onchange = (e) => store.setSetting("voiceURI", e.target.value); }
  const nSel = $("#nvoice");
  if (nSel) {
    nSel.onchange = (e) => store.setSetting("naturalVoice", e.target.value);
    const nstate = $("#nstate");
    const showState = () => {
      if (!nstate.isConnected) { natural.removeEventListener("change", showState); return; }
      const st = natural.state;
      nstate.textContent = st === "ready" ? `Ready (${natural.device === "gpu" ? "GPU" : "CPU"})${natural.rtf ? ` · generates ${natural.rtf < 1 ? `${(1 / natural.rtf).toFixed(1)}× faster than real time` : `${natural.rtf.toFixed(1)}× slower than real time (try iPhone voices)`}` : ""}`
        : st === "loading" ? `Downloading… ${Math.round(natural.progress * 100)}%`
        : st === "error" ? `Couldn't load on this device: ${natural.error}` : "Not downloaded yet (downloads automatically the first time you press play).";
      $("#nload").hidden = st === "ready";
      $("#nload").disabled = st === "loading";
    };
    natural.addEventListener("change", showState);
    showState();
    $("#nload").onclick = () => { natural.load().catch(() => {}); };
    $("#npreview").onclick = async () => {
      natural.unlock();
      try {
        await natural.load();
        const c = await natural.synth("This is how papers will sound. Human-AI interaction studies how people and AI systems work together.", store.settings().naturalVoice);
        natural.el.src = c.url;
        natural.el.playbackRate = store.settings().rate;
        natural.el.play();
        showState();
      } catch (err) { toast(`Natural voice unavailable: ${err.message}`); }
    };
  }
  $("#rate").onchange = (e) => store.setSetting("rate", Number(e.target.value));
  const testBtn = $("#test-voice");
  if (testBtn) {
    testBtn.onclick = () => {
      const u = new SpeechSynthesisUtterance("This is how papers will sound. Human-AI interaction studies how people and AI systems work together.");
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = store.settings().rate;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    };
  }
  wireDownloads(() => viewSettings());
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
  $("#import-lib").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) { return; }
    try {
      const n = await importLibrary(await f.text());
      toast(`Imported ${n} paper texts`);
      viewSettings();
    } catch (err) { toast(err.message); }
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
  setTop({ title: "Not found", back: { label: "Today", href: "#/" } });
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
    case "stage": openStages = openStages || new Set([currentStageId()]); openStages.add(arg); location.replace("#/"); return;
    case "module": viewModule(arg); break;
    case "res": case "listen": case "lesson": viewLesson(arg); break;
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
  if (!["lesson", "res", "listen", "quiz", "pre", "exam", "review", "recall"].includes(route)) { window.scrollTo(0, scrollMem.get(hash) || 0); } else { window.scrollTo(0, 0); }
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
