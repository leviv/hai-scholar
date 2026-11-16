// Natural (neural) voice engine: Kokoro-82M running in a Web Worker, played through an <audio> element.

export const NATURAL_VOICES = [
  ["af_heart", "Heart · US English, warm (best)"],
  ["af_bella", "Bella · US English"],
  ["am_michael", "Michael · US English"],
  ["am_fenrir", "Fenrir · US English"],
  ["bf_emma", "Emma · British English"],
  ["bm_george", "George · British English"],
];

// A tiny silent WAV used to "unlock" audio playback inside a user tap (iOS requires a gesture).
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

class Natural extends EventTarget {
  constructor() {
    super();
    this.worker = null;
    this.state = "idle"; // idle | loading | ready | error
    this.progress = 0;
    this.pending = new Map(); // id -> { resolve, reject }
    this.nextId = 1;
    this.el = new Audio();
    this.el.preload = "auto";
    this.unlocked = false;
    this.stats = { audio: 0, ms: 0 };
  }

  emit() { this.dispatchEvent(new Event("change")); }

  // Real-time factor so far (generation time / audio time); < 1 means faster than real time.
  get rtf() { return this.stats.audio ? this.stats.ms / 1000 / this.stats.audio : null; }

  load() {
    if (this.state === "ready" || this.state === "loading") { return this.ready; }
    this.state = "loading";
    this.emit();
    this.ready = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(new URL("./tts-worker.js", import.meta.url), { type: "module" });
      } catch (e) {
        this.state = "error";
        this.error = String(e);
        this.emit();
        reject(e);
        return;
      }
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "progress") {
          this.progress = m.total ? m.loaded / m.total : 0;
          this.emit();
        } else if (m.type === "ready") {
          this.state = "ready";
          this.device = m.device;
          this.emit();
          resolve();
        } else if (m.type === "error") {
          this.state = "error";
          this.error = m.error;
          this.emit();
          reject(new Error(m.error));
        } else if (m.type === "audio" || m.type === "audio-error") {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (!p) { return; }
          if (m.type === "audio") {
            this.stats.audio += m.seconds;
            this.stats.ms += m.ms;
            p.resolve({ url: URL.createObjectURL(m.blob), seconds: m.seconds });
          } else {
            p.reject(new Error(m.error));
          }
        }
      };
      this.worker.onerror = (e) => {
        this.state = "error";
        this.error = e.message || "Worker failed";
        this.emit();
        reject(new Error(this.error));
      };
      this.worker.postMessage({ type: "load" });
    });
    return this.ready;
  }

  synth(text, voice) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "gen", id, text, voice });
    });
  }

  // Call synchronously inside a user tap so later programmatic play() calls are allowed on iOS.
  unlock() {
    if (this.unlocked) { return; }
    this.unlocked = true;
    this.el.src = SILENT;
    this.el.play().catch(() => { this.unlocked = false; });
  }
}

export const natural = new Natural();
