// Progress + settings persistence (localStorage) and a tiny IndexedDB cache for extracted texts.

const KEY = "hai-scholar:v1";

const DEFAULTS = {
  done: {},        // resourceId -> timestamp
  quiz: {},        // moduleId -> { best, last, attempts, ts }
  missed: {},      // "moduleId:qIndex" -> timestamp (questions to review)
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
    autoAdvance: false,
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
    return { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
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
  settings() { return state.settings; },
  setSetting(k, v) { state.settings[k] = v; save(); },

  alias(id, canonical) { aliases[id] = canonical; },
  isDone(id) { return !!state.done[k(id)]; },
  setDone(id, on = true) {
    if (on) { state.done[k(id)] = Date.now(); touchDay(); } else { delete state.done[k(id)]; }
    save();
  },

  quiz(mid) { return state.quiz[mid]; },
  recordQuiz(mid, score, total, missedIdx, correctIdx) {
    const pct = total ? Math.round((score / total) * 100) : 0;
    const prev = state.quiz[mid] || { best: 0, attempts: 0 };
    state.quiz[mid] = { best: Math.max(prev.best, pct), last: pct, attempts: prev.attempts + 1, ts: Date.now() };
    for (const i of missedIdx) { state.missed[`${mid}:${i}`] = Date.now(); }
    for (const i of correctIdx) { delete state.missed[`${mid}:${i}`]; }
    touchDay();
    save();
  },
  resolveMissed(key, correct) {
    if (correct) { delete state.missed[key]; } else { state.missed[key] = Date.now(); }
    save();
  },

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
    state = { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) } };
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
  async clear() {
    try {
      const d = await db();
      d.transaction("texts", "readwrite").objectStore("texts").clear();
    } catch { /* ignore */ }
  },
};
