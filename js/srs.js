// Spaced-repetition scheduling for quiz questions and free-recall prompts.
//
// Evidence base (see Stage 0):
//  - Spaced retrieval beats massed retrieval; expanding vs. equal intervals matters little
//    (Latimier, Peyre & Ramus 2021), so this uses simple SM-2-style growing intervals.
//  - Successive relearning (Rawson & Dunlosky 2011): items you miss are re-asked later in the
//    same session until recalled, then come back in later spaced sessions.
//  - Confidence feeds the grade: a correct guess comes back sooner than a confident correct answer.

import { store } from "./store.js";

const DAY = 86400000;
const MAX_IVL = 240;

function startOfDay(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// outcome: 0 = again (wrong / missed most), 1 = hard (correct guess / got some),
//          2 = good (fairly sure / got most), 3 = easy (certain / nailed it)
export function outcomeFrom(correct, conf) {
  if (!correct) { return 0; }
  if (conf === "guess") { return 1; }
  if (conf === "think") { return 2; }
  return 3;
}

export function grade(key, type, outcome) {
  const cards = store.s.cards;
  const c = cards[key] || { type, ivl: 0, ease: 2.5, reps: 0, lapses: 0, seen: 0 };
  c.seen = (c.seen || 0) + 1;
  if (outcome === 0) {
    c.lapses++;
    c.reps = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.ivl = 1;
  } else {
    c.reps++;
    if (c.ivl < 1 || c.reps === 1) {
      c.ivl = [1, 1, 2, 4][outcome];
    } else if (outcome === 1) {
      c.ivl = Math.max(c.ivl + 1, c.ivl * 1.2);
      c.ease = Math.max(1.3, c.ease - 0.15);
    } else if (outcome === 2) {
      c.ivl = c.ivl * c.ease;
    } else {
      c.ivl = c.ivl * c.ease * 1.3;
      c.ease = Math.min(3.2, c.ease + 0.15);
    }
  }
  c.ivl = Math.min(MAX_IVL, c.ivl);
  const fuzz = c.ivl >= 4 ? 1 + (Math.random() * 0.1 - 0.05) : 1;
  const days = Math.max(1, Math.round(c.ivl * fuzz));
  c.due = startOfDay() + days * DAY;
  c.last = Date.now();
  c.lastOutcome = outcome;
  cards[key] = c;
  store.save();
  return c;
}

export function dueKeys(now = Date.now()) {
  const end = startOfDay(now) + DAY;
  return Object.entries(store.s.cards).filter(([, c]) => c.due < end).map(([k]) => k);
}

export function forecast(days = 7) {
  const out = new Array(days).fill(0);
  const today = startOfDay();
  for (const c of Object.values(store.s.cards)) {
    const d = Math.max(0, Math.floor((c.due - today) / DAY));
    if (d < days) { out[d]++; }
  }
  return out;
}

export function cardCount() { return Object.keys(store.s.cards).length; }

export function matureCount() {
  return Object.values(store.s.cards).filter((c) => c.ivl >= 21).length;
}
