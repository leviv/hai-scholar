// Sentence-by-sentence text-to-speech with read-along position tracking (Web Speech API).

import { sentences, speakable } from "./extract.js";
import { store } from "./store.js";
import { natural } from "./natural.js";

const synth = window.speechSynthesis;

export function englishVoices() {
  if (!synth) { return []; }
  return synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
}

function rankVoice(v) {
  let s = 0;
  if (/premium/i.test(v.name)) { s += 50; }
  if (/enhanced/i.test(v.name)) { s += 40; }
  if (/siri/i.test(v.name)) { s += 30; }
  if (/^(Ava|Zoe|Samantha|Evan|Nathan|Tom|Allison|Susan|Daniel|Karen|Serena|Alex)\b/.test(v.name)) { s += 15; }
  if (/en[-_]US/i.test(v.lang)) { s += 5; }
  if (v.localService) { s += 2; }
  if (/(Bad News|Bells|Boing|Bubbles|Cellos|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Albert|Bahh|Fred|Junior|Kathy|Ralph|Good News|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley)\b/.test(v.name)) { s -= 100; }
  return s;
}

export function pickVoice() {
  const voices = englishVoices();
  const want = store.settings().voiceURI;
  const chosen = want && voices.find((v) => v.voiceURI === want);
  if (chosen) { return chosen; }
  return voices.slice().sort((a, b) => rankVoice(b) - rankVoice(a))[0] || null;
}

class Player extends EventTarget {
  constructor() {
    super();
    this.res = null;
    this.items = [];
    this.i = 0;
    this.playing = false;
    this.gen = 0;
    this.wake = null;
    this.source = "";
    if (synth && "onvoiceschanged" in synth) {
      synth.addEventListener("voiceschanged", () => this.emit());
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.playing) { this.acquireWake(); }
    });
    this.setupMediaSession();
  }

  get supported() { return !!synth || typeof Audio !== "undefined"; }

  emit() { this.dispatchEvent(new Event("change")); }

  load(res, blocks, source) {
    this.stop();
    this.res = res;
    this.source = source;
    this.items = [];
    blocks.forEach((b, bi) => {
      for (const text of sentences(b.text)) {
        this.items.push({ text, b: bi, h: b.type === "h", intro: !!b.intro });
      }
    });
    this.resetClips();
    const saved = store.pos(res.id);
    this.i = saved && saved.n === this.items.length && saved.i < this.items.length ? saved.i : 0;
    const firstReading = this.items.findIndex((it) => !it.intro);
    this.lastCheck = Math.max(this.i, firstReading);
    this.noPauses = false;
    this.blocks = blocks;
    this.updateMediaMetadata();
    this.emit();
  }

  isLoaded(res) { return this.res && res && this.res.id === res.id && this.items.length > 0; }

  get wantsNatural() { return store.settings().voiceEngine === "natural"; }
  // Falls back to the iPhone voice if the neural model can't keep up with real time on this device.
  get naturalTooSlow() { return natural.stats.audio >= 20 && natural.rtf > 1.15; }
  get usingNatural() { return this.wantsNatural && natural.state === "ready" && !this.naturalTooSlow; }

  play(i = this.i) {
    if (!this.items.length) { return; }
    if (this.wantsNatural) {
      natural.unlock(); // must happen synchronously inside the tap
      if (natural.state === "idle") {
        natural.load().then(() => this.emit()).catch(() => this.emit());
      }
    }
    if (i !== this.i) { this.lastCheck = i; }
    const resume = i === this.i && this.usingNatural && this.elIndex === i && natural.el.currentTime > 0 && !natural.el.ended;
    this.i = Math.max(0, Math.min(i, this.items.length - 1));
    this.playing = true;
    this.gen++;
    const gen = this.gen;
    if (resume) {
      natural.el.playbackRate = store.settings().rate;
      natural.el.play().catch(() => this.speakCurrent(gen));
    } else if (natural.el && !natural.el.paused && (natural.el.pause(), false)) {
      // (stops any sentence still playing before switching)
    } else if (synth && (synth.speaking || synth.pending)) {
      synth.cancel();
      setTimeout(() => { if (gen === this.gen) { this.speakCurrent(gen); } }, 80);
    } else {
      this.speakCurrent(gen);
    }
    this.acquireWake();
    this.setPlaybackState();
    this.emit();
  }

  // ---- natural (neural) voice
  resetClips() {
    for (const p of (this.clips || new Map()).values()) { p.then((c) => URL.revokeObjectURL(c.url)).catch(() => {}); }
    this.clips = new Map();
    this.clipVoice = store.settings().naturalVoice;
    this.elIndex = -1;
  }

  clip(i) {
    if (this.clipVoice !== store.settings().naturalVoice) { this.resetClips(); }
    if (!this.clips.has(i) && this.items[i]) {
      const text = speakable(this.items[i].text, { skipCitations: store.settings().skipCitations }) || ".";
      const p = natural.synth(text, store.settings().naturalVoice);
      p.catch(() => {});
      this.clips.set(i, p);
    }
    return this.clips.get(i);
  }

  prefetch(i) {
    for (let k = 1; k <= 4; k++) { this.clip(i + k); }
    for (const [j, p] of this.clips) {
      if (j < i - 1 || j > i + 8) { p.then((c) => URL.revokeObjectURL(c.url)).catch(() => {}); this.clips.delete(j); }
    }
  }

  speakNatural(gen) {
    const i = this.i;
    const p = this.clip(i);
    this.prefetch(i);
    this.buffering = true;
    this.emit();
    // Never wait forever: if a sentence takes too long, speak it with the iPhone voice and reset the model.
    const limit = Math.max(15000, this.items[i].text.length * 150);
    const timer = setTimeout(() => {
      if (gen !== this.gen || !this.playing || !this.buffering) { return; }
      this.buffering = false;
      this.resetClips();
      natural.recover();
      this.speakSystem(gen);
    }, limit);
    p.then(({ url }) => {
      clearTimeout(timer);
      if (gen !== this.gen || !this.playing) { return; }
      this.buffering = false;
      const el = natural.el;
      el.src = url;
      el.playbackRate = store.settings().rate;
      this.elIndex = i;
      el.onended = () => { if (gen === this.gen && this.playing) { this.advance(gen); } };
      el.onerror = () => { if (gen === this.gen && this.playing) { this.speakSystem(gen); } };
      el.play().catch(() => { if (gen === this.gen && this.playing) { this.speakSystem(gen); } });
      this.emit();
    }).catch(() => {
      clearTimeout(timer);
      if (gen !== this.gen || !this.playing || !this.buffering) { return; }
      this.buffering = false;
      this.speakSystem(gen);
    });
  }

  speakCurrent(gen) {
    if (!this.items[this.i]) { this.finish(); return; }
    if (this.usingNatural) { this.speakNatural(gen); return; }
    this.speakSystem(gen);
  }

  speakSystem(gen) {
    const item = this.items[this.i];
    if (!item) { this.finish(); return; }
    if (!synth) { return; }
    const u = new SpeechSynthesisUtterance(speakable(item.text, { skipCitations: store.settings().skipCitations }) || " ");
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "en-US"; }
    u.rate = store.settings().rate;
    u.onend = () => {
      if (gen !== this.gen || !this.playing) { return; }
      this.advance(gen);
    };
    u.onerror = (e) => {
      if (gen !== this.gen || !this.playing) { return; }
      if (e.error === "interrupted" || e.error === "canceled") { return; }
      this.advance(gen);
    };
    synth.speak(u);
  }

  advance(gen) {
    this.i++;
    store.setPos(this.res.id, Math.min(this.i, this.items.length - 1), this.items.length);
    if (this.i >= this.items.length) { this.finish(); return; }
    if (this.i / this.items.length > 0.92 && !store.isDone(this.res.id)) {
      store.setDone(this.res.id, true);
      this.dispatchEvent(new Event("completed"));
    }
    this.emit();
    if (this.shouldCheckpoint()) { this.checkpoint(); return; }
    this.speakCurrent(gen);
  }

  // Interpolated recall (Szpunar, Khan & Schacter 2013): at a section break after a substantial
  // stretch of listening, pause and ask the listener to recall the section before moving on.
  shouldCheckpoint() {
    if (!store.settings().recallPauses || this.noPauses) { return false; }
    if (this.items[this.i - 1]?.intro) { this.lastCheck = this.i; return false; }
    const it = this.items[this.i];
    return !!it && it.h && this.i - this.lastCheck >= 12;
  }

  checkpoint() {
    let j = this.i - 1;
    while (j >= 0 && !this.items[j].h) { j--; }
    const section = j >= 0 ? this.items[j].text : this.res.title;
    this.lastCheck = this.i;
    this.pause();
    this.dispatchEvent(new CustomEvent("checkpoint", { detail: { section } }));
  }

  finish() {
    this.playing = false;
    this.i = Math.max(0, this.items.length - 1);
    if (this.res && !store.isDone(this.res.id)) {
      store.setDone(this.res.id, true);
      this.dispatchEvent(new Event("completed"));
    }
    this.releaseWake();
    this.setPlaybackState();
    this.emit();
  }

  pause() {
    this.gen++;
    this.playing = false;
    this.buffering = false;
    if (synth) { synth.cancel(); }
    natural.el.pause();
    if (this.res) { store.setPos(this.res.id, this.i, this.items.length); }
    this.releaseWake();
    this.setPlaybackState();
    this.emit();
  }

  stop() {
    if (this.playing) { this.pause(); }
  }

  toggle() {
    if (this.playing) { this.pause(); } else { this.play(); }
  }

  seek(i) {
    const was = this.playing;
    this.i = Math.max(0, Math.min(i, this.items.length - 1));
    this.lastCheck = this.i;
    if (this.res) { store.setPos(this.res.id, this.i, this.items.length); }
    if (was) { this.play(this.i); } else { this.emit(); }
  }

  skip(delta) { this.seek(this.i + delta); }

  skipSection(dir) {
    // Jump to the next/previous heading.
    let j = this.i + dir;
    while (j > 0 && j < this.items.length && !this.items[j].h) { j += dir; }
    this.seek(Math.max(0, Math.min(j, this.items.length - 1)));
  }

  setRate(r) {
    store.setSetting("rate", r);
    if (this.playing && this.usingNatural && this.elIndex === this.i) { natural.el.playbackRate = r; this.emit(); return; }
    if (this.playing) { this.play(this.i); } else { this.emit(); }
  }

  async acquireWake() {
    if (!store.settings().keepAwake || !("wakeLock" in navigator) || this.wake) { return; }
    try {
      this.wake = await navigator.wakeLock.request("screen");
      this.wake.addEventListener("release", () => { this.wake = null; });
    } catch { this.wake = null; }
  }

  releaseWake() {
    if (this.wake) { this.wake.release().catch(() => {}); this.wake = null; }
  }

  setupMediaSession() {
    if (!("mediaSession" in navigator)) { return; }
    const ms = navigator.mediaSession;
    const safe = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported */ } };
    safe("play", () => this.play());
    safe("pause", () => this.pause());
    safe("nexttrack", () => this.skip(5));
    safe("previoustrack", () => this.skip(-5));
  }

  updateMediaMetadata() {
    if (!("mediaSession" in navigator) || !this.res || typeof MediaMetadata === "undefined") { return; }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.res.title,
      artist: this.res.authors,
      album: "HAI Scholar",
      artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  }

  setPlaybackState() {
    if ("mediaSession" in navigator) { navigator.mediaSession.playbackState = this.playing ? "playing" : "paused"; }
  }

  // Rough time estimate: ~160 words/minute at 1x.
  minutesLeft() {
    let words = 0;
    for (let j = this.i; j < this.items.length; j++) { words += this.items[j].text.split(" ").length; }
    return words / (160 * store.settings().rate);
  }
}

export const player = new Player();
