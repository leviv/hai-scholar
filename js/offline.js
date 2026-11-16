// Offline downloads: fetch and save the read-along text of many sources at once, so they can be
// listened to with no connection (iPhone voices run on-device). Videos can't be saved
// (YouTube doesn't allow it); the app itself and the curriculum are cached by the service worker.

import { extractResource } from "./extract.js";
import { store, textCache } from "./store.js";

const saved = new Set();
let loaded = false;

const keyFor = (r) => `${r.id}|${store.settings().includeAppendix ? 1 : 0}`;

export async function loadSavedIndex() {
  for (const k of await textCache.keys()) { saved.add(k); }
  loaded = true;
}

export function isSaved(r) { return loaded && saved.has(keyFor(r)); }
export function markSaved(r) { saved.add(keyFor(r)); }
export function downloadable(list) { return list.filter((r) => r.kind !== "video"); }
export function savedCount(list) { return downloadable(list).filter(isSaved).length; }

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) { return await navigator.storage.persist(); }
  } catch { /* unsupported */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) { return await navigator.storage.estimate(); }
  } catch { /* unsupported */ }
  return null;
}

let running = null;
export function isDownloading() { return !!running; }

// onProgress({ done, total, ok, failed, current })
export async function downloadAll(resources, onProgress = () => {}) {
  if (running) { return running; }
  const todo = downloadable(resources).filter((r) => !isSaved(r));
  const state = { done: 0, total: todo.length, ok: 0, failed: [], current: "" };
  requestPersistence();
  // Warm the PDF reader into the offline cache in case any saved paper needs it later.
  fetch("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js").catch(() => {});
  fetch("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js").catch(() => {});

  const queue = todo.slice();
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      state.current = r.title;
      onProgress({ ...state });
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          await extractResource(r, { includeAppendix: store.settings().includeAppendix });
          ok = true;
        } catch (e) {
          // The public reader proxy rate-limits; wait and retry once.
          if (attempt === 0 && /429/.test((e.details || []).join(" "))) {
            await new Promise((res) => setTimeout(res, 20000));
          } else {
            break;
          }
        }
      }
      if (ok) { markSaved(r); state.ok++; } else { state.failed.push(r); }
      state.done++;
      onProgress({ ...state });
    }
  };
  running = Promise.all([worker(), worker(), worker()]).then(() => { running = null; return state; });
  return running;
}
