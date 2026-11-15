// Sentence-by-sentence text-to-speech with read-along position tracking (Web Speech API).

import { sentences, speakable } from "./extract.js";
import { store } from "./store.js";

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

  get supported() { return !!synth; }

  emit() { this.dispatchEvent(new Event("change")); }

  load(res, blocks, source) {
    this.stop();
    this.res = res;
    this.source = source;
    this.items = [];
    blocks.forEach((b, bi) => {
      for (const text of sentences(b.text)) {
        this.items.push({ text, b: bi, h: b.type === "h" });
      }
    });
    const saved = store.pos(res.id);
    this.i = saved && saved.n === this.items.length && saved.i < this.items.length ? saved.i : 0;
    this.blocks = blocks;
    this.updateMediaMetadata();
    this.emit();
  }

  isLoaded(res) { return this.res && res && this.res.id === res.id && this.items.length > 0; }

  play(i = this.i) {
    if (!synth || !this.items.length) { return; }
    this.i = Math.max(0, Math.min(i, this.items.length - 1));
    this.playing = true;
    this.gen++;
    const gen = this.gen;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(() => { if (gen === this.gen) { this.speakCurrent(gen); } }, 80);
    } else {
      this.speakCurrent(gen);
    }
    this.acquireWake();
    this.setPlaybackState();
    this.emit();
  }

  speakCurrent(gen) {
    const item = this.items[this.i];
    if (!item) { this.finish(); return; }
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
    this.speakCurrent(gen);
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
    if (synth) { synth.cancel(); }
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
