// Runs the Kokoro-82M neural text-to-speech model on-device (open source, Apache-2.0) via kokoro-js.
// No server and no API key: the ~90 MB model downloads once from Hugging Face and is cached by the browser.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null;
let chain = Promise.resolve(); // generate one sentence at a time

async function hasGPU() {
  try { return !!(self.navigator.gpu && await self.navigator.gpu.requestAdapter()); } catch { return false; }
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);
}

// GPU (WebGPU, fp32 weights ~326 MB) is many times faster than real time; CPU (WASM, q8 ~92 MB) is the fallback.
async function loadModel(prefer) {
  const files = {};
  const progress_callback = (p) => {
    if (p.status !== "progress" || !p.total) { return; }
    files[p.file] = [p.loaded, p.total];
    const vals = Object.values(files);
    self.postMessage({ type: "progress", loaded: vals.reduce((n, v) => n + v[0], 0), total: vals.reduce((n, v) => n + v[1], 0) });
  };
  if (prefer !== "cpu" && await hasGPU()) {
    try {
      const model = await KokoroTTS.from_pretrained(MODEL, { dtype: "fp32", device: "webgpu", progress_callback });
      // Mobile WebGPU can load fine but then hang or return nothing; prove it works before using it.
      const test = await withTimeout(model.generate("Hello.", { voice: "af_heart" }), 20000);
      if (!test || !test.audio || !test.audio.length) { throw new Error("GPU produced no audio"); }
      return { model, device: "gpu" };
    } catch { /* fall back to CPU */ }
  }
  const model = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback });
  return { model, device: "cpu" };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "load") {
    if (tts) { self.postMessage({ type: "ready" }); return; }
    loadModel(msg.prefer || "auto")
      .then(({ model, device }) => { tts = model; self.postMessage({ type: "ready", device }); })
      .catch((err) => self.postMessage({ type: "error", error: String(err && err.message || err) }));
    return;
  }
  if (msg.type === "gen") {
    chain = chain.then(async () => {
      if (msg.stale) { return; }
      try {
        const t0 = performance.now();
        const audio = await withTimeout(tts.generate(msg.text, { voice: msg.voice }), 60000);
        const blob = audio.toBlob();
        self.postMessage({ type: "audio", id: msg.id, blob, seconds: audio.audio.length / audio.sampling_rate, ms: performance.now() - t0 });
      } catch (err) {
        self.postMessage({ type: "audio-error", id: msg.id, error: String(err && err.message || err) });
      }
    });
  }
};
