import { store, textCache } from "./store.js";
import { extractResource } from "./extract.js";
import { player, englishVoices, pickVoice } from "./player.js";

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
const PASS = 70;

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
player.addEventListener("completed", () => toast("Marked as done ✓"));

// ---------------------------------------------------------------- views
function viewPath() {
  setTab("path");
  setTop({ title: "" });
  const next = nextStep();
  let total = 0;
  let got = 0;
  for (const s of C.stages) { const st = stageStatus(s); total += 1; got += st.frac; }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;

  let cont = "";
  if (next?.kind === "res") {
    const pos = store.pos(next.r.id);
    const started = pos && pos.i > 0;
    cont = `<a class="continue" href="#/res/${next.r.id}">
      <div class="k">${started ? "Continue listening" : "Up next"} · Stage ${next.m.stage.number}</div>
      <div class="t">${esc(next.r.title)}</div>
      <div class="s">${esc(next.m.title)} · ${esc(KIND_LABEL[next.r.kind])} · ${fmtMin(next.r.minutes)}</div></a>`;
  } else if (next?.kind === "quiz") {
    cont = `<a class="continue" href="#/quiz/${next.m.id}">
      <div class="k">Check your understanding · Stage ${next.m.stage.number}</div>
      <div class="t">${esc(next.m.title)}</div>
      <div class="s">${next.m.quiz.length} questions · pass with ${PASS}%</div></a>`;
  } else {
    cont = `<div class="continue"><div class="k">Path complete</div><div class="t">You've finished every module.</div><div class="s">Keep sharp with Review in the Progress tab.</div></div>`;
  }

  view.innerHTML = `
    <div class="large-title">HAI Scholar</div>
    <p class="lede">From zero to research-level Human-AI Interaction, using only established papers, lectures and essays. ${Math.round((got / Math.max(total, 1)) * 100)}% complete.</p>
    ${standalone ? "" : `<div class="card install-tip small"><b>Install on iPhone:</b> in Safari tap <b>Share</b> → <b>Add to Home Screen</b>. It then opens full-screen like an app and keeps your progress.</div>`}
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

function viewStage(id) {
  const s = C.stages.find((x) => x.id === id);
  if (!s) { return notFound(); }
  setTab("path");
  setTop({ title: `Stage ${s.number}`, back: { label: "Path", href: "#/" } });
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
    </div>`;
}

function viewModule(id) {
  const m = C.modules.get(id);
  if (!m) { return notFound(); }
  setTab("path");
  setTop({ title: m.title, back: { label: `Stage ${m.stage.number}`, href: `#/stage/${m.stage.id}` } });
  const st = moduleStatus(m);
  const core = m.resources.filter((r) => !r.optional);
  const extra = m.resources.filter((r) => r.optional);
  const row = (r) => `<a class="li" href="#/res/${r.id}">${kindIcon(r)}
      <span class="li-body"><div class="li-title">${esc(r.title)}</div>
      <div class="li-sub">${resMeta(r)}${r.minutes ? ` · ${fmtMin(r.minutes)}` : ""}</div></span>${ICONS.chev}</a>`;

  view.innerHTML = `
    <div class="tiny muted" style="margin:0 2px">Stage ${m.stage.number} · ${esc(m.stage.title)}</div>
    <div class="large-title" style="font-size:28px">${esc(m.title)}</div>
    <p class="lede goal">${esc(m.goal)}</p>
    <div class="guide"><h3>Guide</h3>${paras(m.guide)}</div>
    <div class="section-label">Core sources · ${st.done}/${st.total} done</div>
    <div class="list">${core.map(row).join("")}</div>
    ${extra.length ? `<div class="section-label">Go deeper (optional)</div><div class="list">${extra.map(row).join("")}</div>` : ""}
    <div class="section-label">Check your understanding</div>
    <div class="card">
      <div class="row-gap" style="justify-content:space-between">
        <div><b>${m.quiz.length} questions</b><div class="small muted">Pass with ${PASS}% to complete the module.</div></div>
        ${st.quiz ? `<span class="pill ${st.passed ? "good" : "bad"}">Best ${st.quiz.best}%</span>` : `<span class="pill gray">Not taken</span>`}
      </div>
      <div class="btn-stack"><a class="btn" href="#/quiz/${m.id}">${st.quiz ? "Retake check-in" : "Start check-in"}</a></div>
    </div>
    ${m.exercise ? `<div class="section-label">Research exercise</div>
      <div class="guide" style="border-left-color:var(--warn)"><h3 style="color:var(--warn)">Try this</h3>${paras(m.exercise)}</div>
      <textarea id="ex-note" placeholder="Work through the exercise here (saved on this device)…">${esc(store.note(m.id))}</textarea>` : ""}
  `;
  const ta = $("#ex-note");
  if (ta) { ta.oninput = () => store.setNote(m.id, ta.value); }
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
  const yt = r.youtube ? `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.youtube)}?playsinline=1&rel=0&modestbranding=1" title="${esc(r.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : "";

  view.innerHTML = `
    <div class="tiny muted" style="margin:0 2px">Stage ${r.stage.number} · ${esc(r.module.title)}${r.optional ? " · optional" : ""}</div>
    <div class="res-title">${esc(r.title)}</div>
    <div class="meta-line">${esc(r.authors)}${r.year ? ` (${esc(r.year)})` : ""}${r.venue ? ` · ${esc(r.venue)}` : ""}</div>
    <div class="row-gap" style="margin:10px 2px 4px">
      <span class="pill">${esc(KIND_LABEL[r.kind])}</span>
      ${r.minutes ? `<span class="pill gray">${fmtMin(r.minutes)}</span>` : ""}
      ${done ? `<span class="pill good">Done</span>` : pct ? `<span class="pill gray">${pct}% listened</span>` : ""}
    </div>
    ${yt}
    <div class="btn-stack">
      ${listenable ? `<a class="btn" href="#/listen/${r.id}">${ICONS.play.replace("<svg", '<svg width="18" height="18"')} ${pct && !done ? "Resume listening" : "Listen & read along"}</a>` : ""}
      <div class="btn-row" style="margin:0">
        <a class="btn secondary" href="${esc(r.url)}" target="_blank" rel="noopener">${r.kind === "video" ? "Open in YouTube" : "Open original"}</a>
        <button class="btn ${done ? "ghost" : "secondary"}" id="toggle-done">${done ? "Mark not done" : "Mark done"}</button>
      </div>
    </div>
    <div class="guide"><h3>Why this matters</h3>${paras(r.why)}${r.focus ? `<p><b>Focus:</b> ${esc(r.focus)}</p>` : ""}</div>
    ${r.arxiv ? `<p class="small muted" style="margin:0 2px 14px">arXiv ${esc(r.arxiv)} · <a href="https://arxiv.org/pdf/${esc(r.arxiv)}" target="_blank" rel="noopener">PDF</a> · <a href="https://arxiv.org/html/${esc(r.arxiv)}" target="_blank" rel="noopener">HTML</a></p>` : ""}
    <div class="section-label">Your notes</div>
    <textarea id="note" placeholder="Key claims, methods, questions, how it connects to other work…">${esc(store.note(r.id))}</textarea>
  `;
  $("#toggle-done").onclick = () => { store.setDone(r.id, !store.isDone(r.id)); viewResource(id); };
  const ta = $("#note");
  ta.oninput = () => store.setNote(r.id, ta.value);
}

// ---- listen / read-along
let listenCleanup = null;

function viewListen(id) {
  const r = C.resources.get(id);
  if (!r) { return notFound(); }
  setTab("path");
  document.body.classList.add("listening");
  const doneBtn = () => ({ label: store.isDone(r.id) ? "Done ✓" : "Mark done", onClick: () => { store.setDone(r.id, !store.isDone(r.id)); setTop(top()); } });
  const top = () => ({ title: r.title, back: { label: "Back", href: `#/res/${r.id}` }, right: [doneBtn()] });
  setTop(top());
  document.documentElement.style.setProperty("--reader-size", `${store.settings().textSize}px`);

  view.innerHTML = `<div class="reader-status"><div class="spinner"></div><div id="status">Fetching text…</div></div>`;

  const controls = document.createElement("div");
  controls.className = "controls";
  controls.innerHTML = `<div class="controls-inner">
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
    setTop(top());
  };

  const renderText = () => {
    const groups = [];
    player.items.forEach((it, i) => {
      if (!groups[it.b]) { groups[it.b] = { h: it.h, parts: [] }; }
      groups[it.b].parts.push(`<span class="s" data-i="${i}">${esc(it.text)}</span> `);
    });
    view.innerHTML = `<div class="reader-source">Text from: ${esc(player.source)} · tap any sentence to start there</div>
      <div class="reader">${groups.filter(Boolean).map((g) => (g.h ? `<h2 class="rh">${g.parts.join("")}</h2>` : `<p>${g.parts.join("")}</p>`)).join("")}</div>`;
    view.querySelector(".reader").addEventListener("click", (e) => {
      const s = e.target.closest(".s");
      if (!s) { return; }
      player.play(Number(s.dataset.i));
    });
    sync();
    const cur = view.querySelector(".s.cur");
    if (cur && player.i > 0) { cur.scrollIntoView({ block: "center" }); }
  };

  $("#c-play", controls).onclick = () => player.toggle();
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
  listenCleanup = () => {
    player.removeEventListener("change", sync);
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
      if (location.hash !== token) { return; }
      player.load(r, out.blocks, out.source + (out.cached ? " (saved on device)" : ""));
      renderText();
    })
    .catch((err) => {
      if (location.hash !== token) { return; }
      controls.remove();
      view.innerHTML = `<div class="card" style="margin-top:20px">
        <b>${esc(err.message)}</b>
        <p class="small muted">Some publishers block other apps from reading their pages. You can still listen with Safari's built-in reader:</p>
        <ol class="small"><li>Tap <b>Open original</b> below.</li><li>In Safari, tap the <b>page menu</b> (aA / ☰ in the address bar) → <b>Listen to Page</b>.</li><li>Come back and mark it done.</li></ol>
        <div class="btn-stack"><a class="btn" href="${esc(r.listen || r.url)}" target="_blank" rel="noopener">Open original</a>
        <button class="btn ghost" id="retry">Try again</button></div>
        <details class="tiny muted"><summary>Details</summary>${(err.details || []).map(esc).join("<br>")}</details></div>`;
      $("#retry").onclick = () => render();
    });
}

// ---- quiz
function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

function runQuiz({ title, back, items, onFinish }) {
  // items: [{ q, m, qi }]
  let k = 0;
  let score = 0;
  const results = [];
  const LETTERS = "ABCDEFG";
  setTop({ title, back });

  const show = () => {
    const { q, m } = items[k];
    const order = shuffle(q.choices.map((c, i) => i));
    const ref = q.ref ? C.resources.get(q.ref) : null;
    view.innerHTML = `
      <div class="q-count"><span>Question ${k + 1} of ${items.length}</span><span>${score} correct</span></div>
      <div class="progress" style="margin-bottom:14px"><i style="width:${(k / items.length) * 100}%"></i></div>
      ${title === "Review" ? `<div class="tiny muted">${esc(m.title)}</div>` : ""}
      <div class="q-text">${esc(q.q)}</div>
      <div id="choices">${order.map((ci, n) => `<button class="choice" data-ci="${ci}"><span class="letter">${LETTERS[n]}</span><span>${esc(q.choices[ci])}</span></button>`).join("")}</div>
      <div id="after"></div>`;
    view.querySelectorAll(".choice").forEach((btn) => {
      btn.onclick = () => {
        const ci = Number(btn.dataset.ci);
        const ok = ci === q.answer;
        if (ok) { score++; }
        results.push({ ...items[k], ok });
        view.querySelectorAll(".choice").forEach((b) => {
          b.disabled = true;
          const bi = Number(b.dataset.ci);
          if (bi === q.answer) { b.classList.add("correct"); }
          if (bi === ci && !ok) { b.classList.add("wrong"); }
        });
        $("#after").innerHTML = `<div class="explain"><b style="color:var(${ok ? "--good" : "--bad"})">${ok ? "Correct" : "Not quite"}</b>${esc(q.explain)}
          ${ref ? `<div class="small" style="margin-top:8px">Source: <a href="#/res/${ref.id}">${esc(ref.title)}</a></div>` : ""}</div>
          <button class="btn" id="next">${k + 1 < items.length ? "Next question" : "See results"}</button>`;
        $("#next").onclick = () => { k++; if (k < items.length) { show(); window.scrollTo(0, 0); } else { onFinish(score, results); } };
        $("#after").scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
    });
  };
  if (!items.length) {
    view.innerHTML = `<div class="empty">Nothing to review yet. Take a few check-ins first.</div>`;
    return;
  }
  show();
}

function resultsScreen(score, total, results, { passMsg, actions }) {
  const pct = Math.round((score / total) * 100);
  const ok = pct >= PASS;
  const missed = results.filter((x) => !x.ok);
  const missedRefs = [...new Set(missed.map((x) => x.q.ref).filter(Boolean))].map((id) => C.resources.get(id)).filter(Boolean);
  view.innerHTML = `
    <div class="score-ring" style="background:var(${ok ? "--good-soft" : "--bad-soft"});color:var(${ok ? "--good" : "--bad"})">${pct}%</div>
    <p style="text-align:center;font-size:18px;font-weight:650;margin:0 0 4px">${score} of ${total} correct</p>
    <p class="muted" style="text-align:center;margin:0 0 18px">${ok ? passMsg : `You need ${PASS}% to pass. Revisit the sources below, then try again.`}</p>
    ${missedRefs.length ? `<div class="section-label">Worth revisiting</div><div class="list">${missedRefs.map((r) => `<a class="li" href="#/res/${r.id}">${kindIcon(r)}<span class="li-body"><div class="li-title">${esc(r.title)}</div><div class="li-sub">${resMeta(r)}</div></span>${ICONS.chev}</a>`).join("")}</div>` : ""}
    <div class="btn-stack">${actions}</div>`;
  window.scrollTo(0, 0);
}

function viewQuiz(id) {
  const m = C.modules.get(id);
  if (!m) { return notFound(); }
  setTab("path");
  runQuiz({
    title: "Check-in",
    back: { label: m.title, href: `#/module/${m.id}` },
    items: m.quiz.map((q, qi) => ({ q, m, qi })),
    onFinish: (score, results) => {
      store.recordQuiz(m.id, score, m.quiz.length, results.filter((x) => !x.ok).map((x) => x.qi), results.filter((x) => x.ok).map((x) => x.qi));
      const next = C.order[C.order.indexOf(m) + 1];
      resultsScreen(score, m.quiz.length, results, {
        passMsg: "Module check-in passed. Nice work.",
        actions: `${next ? `<a class="btn" href="#/module/${next.id}">Next module: ${esc(next.title)}</a>` : ""}
          <a class="btn secondary" href="#/module/${m.id}">Back to module</a>
          <button class="btn ghost" id="retake">Retake</button>`,
      });
      $("#retake").onclick = () => viewQuiz(id);
    },
  });
}

function reviewItems() {
  const items = [];
  const seen = new Set();
  for (const key of Object.keys(store.s.missed)) {
    const [mid, qi] = key.split(":");
    const m = C.modules.get(mid);
    if (m && m.quiz[qi]) { items.push({ q: m.quiz[qi], m, qi: Number(qi), key }); seen.add(key); }
  }
  const attempted = C.order.filter((m) => store.quiz(m.id));
  const pool = shuffle(attempted.flatMap((m) => m.quiz.map((q, qi) => ({ q, m, qi, key: `${m.id}:${qi}` }))).filter((x) => !seen.has(x.key)));
  const missedPart = shuffle(items).slice(0, 10);
  return missedPart.concat(pool.slice(0, Math.max(0, 10 - missedPart.length)));
}

function viewReview() {
  setTab("progress");
  const items = reviewItems();
  runQuiz({
    title: "Review",
    back: { label: "Progress", href: "#/progress" },
    items,
    onFinish: (score, results) => {
      for (const x of results) { store.resolveMissed(x.key, x.ok); }
      resultsScreen(score, results.length, results, {
        passMsg: "Spaced review done. Missed questions will come back next time.",
        actions: `<button class="btn" id="again">Another round</button><a class="btn secondary" href="#/progress">Done</a>`,
      });
      $("#again").onclick = () => viewReview();
    },
  });
}

// ---- library
let libState = { q: "", kind: "all" };
function viewLibrary() {
  setTab("library");
  setTop({ title: "Library" });
  const kinds = [["all", "All"], ["paper", "Papers"], ["video", "Videos"], ["essay", "Essays"], ["book", "Books & courses"], ["todo", "Not done"], ["done", "Done"]];
  view.innerHTML = `
    <input type="search" id="lib-q" placeholder="Search titles, authors, venues, years" value="${esc(libState.q)}" autocomplete="off">
    <div class="chips" style="margin-top:10px">${kinds.map(([k, l]) => `<button class="chip ${libState.kind === k ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
    <div id="lib-list"></div>`;
  const draw = () => {
    const q = libState.q.toLowerCase().trim();
    const all = [...C.resources.values()].filter((r) => {
      if (libState.kind === "done" && !store.isDone(r.id)) { return false; }
      if (libState.kind === "todo" && store.isDone(r.id)) { return false; }
      if (libState.kind === "book" && !["book", "course", "tool"].includes(r.kind)) { return false; }
      if (!["all", "done", "todo", "book"].includes(libState.kind) && r.kind !== libState.kind) { return false; }
      if (!q) { return true; }
      return `${r.title} ${r.authors} ${r.venue || ""} ${r.year} ${r.module.title}`.toLowerCase().includes(q);
    });
    $("#lib-list").innerHTML = all.length ? `<div class="small muted" style="margin:0 4px 8px">${all.length} sources</div><div class="list">${all.map((r) => `<a class="li" href="#/res/${r.id}">${kindIcon(r)}<span class="li-body"><div class="li-title">${esc(r.title)}</div><div class="li-sub">${resMeta(r)}<br>Stage ${r.stage.number} · ${esc(r.module.title)}</div></span>${ICONS.chev}</a>`).join("")}</div>` : `<div class="empty">No matches.</div>`;
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
  const avg = quizzes.length ? Math.round(quizzes.reduce((n, q) => n + q.best, 0) / quizzes.length) : 0;
  const missedN = Object.keys(store.s.missed).length;
  const noted = Object.keys(store.s.notes).map((id) => C.resources.get(id) || C.modules.get(id)).filter(Boolean);

  view.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="v">${store.streak()}</div><div class="l">day streak</div></div>
      <div class="stat"><div class="v">${fmtMin(minutesDone) || "0 min"}</div><div class="l">of material completed</div></div>
      <div class="stat"><div class="v">${doneReq.length}<span class="muted" style="font-size:16px">/${req.length}</span></div><div class="l">core sources done</div></div>
      <div class="stat"><div class="v">${passed}<span class="muted" style="font-size:16px">/${C.order.length}</span></div><div class="l">check-ins passed${quizzes.length ? ` · avg ${avg}%` : ""}</div></div>
    </div>
    <div class="card">
      <b>Review</b>
      <p class="small muted" style="margin:4px 0 0">${missedN ? `${missedN} question${missedN === 1 ? "" : "s"} you missed, mixed with questions from modules you've finished. Spaced review is one of the most reliable ways to make knowledge stick.` : "Questions you miss in check-ins come back here, mixed with earlier material."}</p>
      <div class="btn-stack"><a class="btn ${quizzes.length ? "" : "ghost"}" href="#/review">Start review</a></div>
    </div>
    <div class="section-label">By stage</div>
    <div class="list">${C.stages.map((s) => { const st = stageStatus(s); return `<a class="li" href="#/stage/${s.id}"><span class="li-body"><div class="li-title">${s.number}. ${esc(s.title)}</div><div class="progress ${st.complete === st.modules ? "good" : ""}" style="margin-top:8px"><i style="width:${Math.round(st.frac * 100)}%"></i></div></span><span class="small muted">${Math.round(st.frac * 100)}%</span></a>`; }).join("")}</div>
    ${noted.length ? `<div class="section-label">Your notes</div><div class="list">${noted.map((x) => `<a class="li" href="${x.resources ? `#/module/${x.id}` : `#/res/${x.id}`}"><span class="li-body"><div class="li-title">${esc(x.title)}</div><div class="li-sub">${esc(store.note(x.id).slice(0, 110))}${store.note(x.id).length > 110 ? "…" : ""}</div></span>${ICONS.chev}</a>`).join("")}</div>` : ""}
  `;
}

// ---- settings
function viewSettings() {
  setTab("settings");
  setTop({ title: "Settings" });
  const s = store.settings();
  const voices = englishVoices().slice().sort((a, b) => a.name.localeCompare(b.name));
  const auto = pickVoice();
  const sw = (key, label, hint) => `<div class="setting"><label for="sw-${key}">${label}${hint ? `<div class="tiny muted">${hint}</div>` : ""}</label><input type="checkbox" class="switch" id="sw-${key}" ${s[key] ? "checked" : ""}></div>`;
  view.innerHTML = `
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
    <div class="section-label">Your data</div>
    <div class="list">
      <div class="setting"><button class="btn secondary" id="export">Export progress backup</button></div>
      <div class="setting"><label class="btn secondary" style="cursor:pointer">Import backup<input type="file" id="import" accept="application/json,.json" hidden></label></div>
      <div class="setting"><button class="btn ghost" id="clear-cache">Clear saved paper texts</button></div>
      <div class="setting"><button class="btn danger" id="reset">Reset all progress</button></div>
    </div>
    <div class="section-label">About</div>
    <div class="card small">
      <p style="margin-top:0"><b>What's here.</b> Every source in HAI Scholar is a real, published work: peer-reviewed papers, canonical preprints, textbooks, university-level courses, and widely respected explainers and lectures. Titles, authors and links were checked against arXiv, Crossref and YouTube records. The app writes only the short guides that say what to look for, and the check-in questions.</p>
      <p><b>How listening works.</b> Text comes live from the original source (arXiv's HTML or PDF, the author's site, or a public reader service for pages that block other apps), and your iPhone's built-in voice reads it aloud. Papers you've opened are saved on this device so you can listen offline.</p>
      <p style="margin-bottom:0"><b>Curriculum:</b> ${C.stages.length} stages · ${C.order.length} modules · ${C.resources.size} sources · ${C.order.reduce((n, m) => n + m.quiz.length, 0)} questions.</p>
    </div>`;

  $("#voice").onchange = (e) => store.setSetting("voiceURI", e.target.value);
  $("#rate").onchange = (e) => store.setSetting("rate", Number(e.target.value));
  for (const key of ["skipCitations", "includeAppendix", "keepAwake"]) {
    $(`#sw-${key}`).onchange = (e) => store.setSetting(key, e.target.checked);
  }
  $("#test-voice").onclick = () => {
    const u = new SpeechSynthesisUtterance("This is how papers will sound. Human-AI interaction studies how people and AI systems work together.");
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = store.settings().rate;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
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
  $("#clear-cache").onclick = async () => { await textCache.clear(); toast("Saved texts cleared"); };
  $("#reset").onclick = () => {
    if (!confirm("Reset all progress, quiz scores and notes? This can't be undone.")) { return; }
    store.reset();
    toast("Progress reset");
    viewSettings();
  };
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
    case "quiz": viewQuiz(arg); break;
    case "review": viewReview(); break;
    case "library": viewLibrary(); break;
    case "progress": viewProgress(); break;
    case "settings": viewSettings(); break;
    default: notFound();
  }
  updateMini();
  if (route !== "listen") { window.scrollTo(0, scrollMem.get(hash) || 0); }
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
  lastHash = location.hash || "#/";
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
