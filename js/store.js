// Progress + settings persistence (localStorage) and a tiny IndexedDB cache for extracted texts.

const KEY = "hai-scholar:v1";

const DEFAULTS = {
  done: {},        // resourceId -> timestamp
  quiz: {},        // moduleId -> { best, last, attempts, ts }
  missed: {},      // legacy (v1): "moduleId:qIndex" -> timestamp; migrated into cards
  cards: {},       // spaced-repetition cards: "moduleId:qIndex" or "r:resourceId" -> schedule
  calib: {},       // confidence -> { n, c } answers / correct (calibration)
  recalls: {},     // resourceId -> { text, ts, outcome } free recall
  pre: {},         // moduleId -> { qs: [qIndex], picks: { qIndex: choiceIndex }, ts } prequestions
  exams: {},       // stageId -> { best, last, attempts }
  pos: {},         // resourceId -> { i, n } sentence index / total
  notes: {},       // resourceId or moduleId -> text
  days: [],        // ISO dates with activity (for streaks)
  last: null,      // last opened resource id
  settings: {
    rate: 1.0,
    voiceURI: "",
    skipCitations: true,
    includeAppendix: false,
    keepAwake: true,
    textSize: 19,
    recallPauses: true,   // pause at section breaks for a quick recall (interpolated testing)
    recallFirst: true,    // answer in your head before choices appear (generation)
    freeRecall: true,     // free-recall prompt after finishing a source
    dailyLimit: 30,       // max cards per review session
  },
};

let state = load();
const aliases = {}; // duplicate resource id -> canonical id (same source used in two modules)
const k = (id) => aliases[id] || id;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { return structuredClone(DEFAULTS); }
    const parsed = JSON.parse(raw);
    return migrate({ ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) } });
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function migrate(st) {
  // v1 kept a flat "missed" list; turn those into review cards that are due now.
  for (const key of Object.keys(st.missed || {})) {
    if (!st.cards[key]) { st.cards[key] = { type: "q", ivl: 0, ease: 2.3, reps: 0, lapses: 1, seen: 1, due: Date.now() }; }
  }
  st.missed = {};
  return st;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

function touchDay() {
  const d = new Date().toLocaleDateString("en-CA");
  if (state.days[state.days.length - 1] !== d) {
    state.days.push(d);
    if (state.days.length > 400) { state.days = state.days.slice(-400); }
  }
}

export const store = {
  get s() { return state; },
  save() { save(); },
  settings() { return state.settings; },
  setSetting(k, v) { state.settings[k] = v; save(); },

  alias(id, canonical) { aliases[id] = canonical; },
  isDone(id) { return !!state.done[k(id)]; },
  setDone(id, on = true) {
    if (on) { state.done[k(id)] = Date.now(); touchDay(); } else { delete state.done[k(id)]; }
    save();
  },

  quiz(mid) { return state.quiz[mid]; },
  recordQuiz(mid, score, total) {
    const pct = total ? Math.round((score / total) * 100) : 0;
    const prev = state.quiz[mid] || { best: 0, attempts: 0 };
    state.quiz[mid] = { best: Math.max(prev.best, pct), last: pct, attempts: prev.attempts + 1, ts: Date.now() };
    touchDay();
    save();
  },
  recordExam(sid, pct) {
    const prev = state.exams[sid] || { best: 0, attempts: 0 };
    state.exams[sid] = { best: Math.max(prev.best, pct), last: pct, attempts: prev.attempts + 1, ts: Date.now() };
    touchDay();
    save();
  },
  recordConfidence(conf, correct) {
    const c = state.calib[conf] || { n: 0, c: 0 };
    c.n++;
    if (correct) { c.c++; }
    state.calib[conf] = c;
    save();
  },
  recall(id) { return state.recalls[k(id)]; },
  setRecall(id, text, outcome) { state.recalls[k(id)] = { text, outcome, ts: Date.now() }; touchDay(); save(); },
  pre(mid) { return state.pre[mid]; },
  setPre(mid, qs, picks) { state.pre[mid] = { qs, picks, ts: Date.now() }; touchDay(); save(); },

  pos(id) { return state.pos[k(id)]; },
  setPos(id, i, n) { state.pos[k(id)] = { i, n }; state.last = id; save(); },

  note(id) { return state.notes[id] || ""; },
  setNote(id, text) {
    if (text) { state.notes[id] = text; } else { delete state.notes[id]; }
    save();
  },

  setLast(id) { state.last = id; touchDay(); save(); },

  streak() {
    const set = new Set(state.days);
    let n = 0;
    const d = new Date();
    if (!set.has(d.toLocaleDateString("en-CA"))) { d.setDate(d.getDate() - 1); }
    while (set.has(d.toLocaleDateString("en-CA"))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },

  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON(text) {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || !parsed.done) { throw new Error("Not a HAI Scholar backup"); }
    state = migrate({ ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) } });
    save();
  },
  reset() { state = structuredClone(DEFAULTS); save(); },
};

// ---------- IndexedDB text cache (so papers you've opened work offline) ----------
let dbp = null;
function db() {
  if (dbp) { return dbp; }
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open("hai-scholar-texts", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("texts");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export const textCache = {
  async get(key) {
    try {
      const d = await db();
      return await new Promise((resolve) => {
        const r = d.transaction("texts").objectStore("texts").get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      });
    } catch { return null; }
  },
  async set(key, value) {
    try {
      const d = await db();
      d.transaction("texts", "readwrite").objectStore("texts").put(value, key);
    } catch { /* ignore */ }
  },
  async keys() {
    try {
      const d = await db();
      return await new Promise((resolve) => {
        const r = d.transaction("texts").objectStore("texts").getAllKeys();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      });
    } catch { return []; }
  },
  async clear() {
    try {
      const d = await db();
      d.transaction("texts", "readwrite").objectStore("texts").clear();
    } catch { /* ignore */ }
  },
};
