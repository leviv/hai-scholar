// Makes the natural-voice audio that ships with the app, so phones never have to run the voice model.
// Reads tools/audio-plan.json (every sentence of every core lesson), speaks each one with Kokoro-82M,
// and writes data/audio/<voice>/<hash>.mp3 plus data/audio/<voice>/index.json.
//
// Run on a computer (a Mac is fine; it takes many hours, so leave it overnight):
//   cd tools && npm install
//   node make_audio.mjs            # safe to stop and re-run: finished sentences are skipped
//
// Rebuild the plan after texts change: serve the repo, open the app, run `await haiAudioPlan()` in the
// console (or tools/make_plan.mjs with Playwright) and save the result as tools/audio-plan.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";
import * as lame from "@breezystack/lamejs";

const VOICE = process.argv[2] || "af_heart";
const KBPS = 16; // mono speech; ~7 MB per hour
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "data", "audio", VOICE);
fs.mkdirSync(outDir, { recursive: true });

const plan = JSON.parse(fs.readFileSync(path.join(here, "audio-plan.json"), "utf8"));
const clips = new Map(plan.flatMap((r) => r.clips));
const limit = Number(process.env.LIMIT) || Infinity; // LIMIT=20 for a quick test
const todo = [...clips].filter(([h]) => !fs.existsSync(path.join(outDir, `${h}.mp3`))).slice(0, limit);
console.log(`${plan.length} lessons, ${clips.size} sentences, ${todo.length} left to make.`);

function writeIndex() {
  const ids = plan.filter((r) => r.clips.every(([h]) => fs.existsSync(path.join(outDir, `${h}.mp3`)))).map((r) => r.id);
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ voice: VOICE, ids }) + "\n");
  return ids.length;
}

function toMp3(f32, rate) {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { pcm[i] = Math.max(-1, Math.min(1, f32[i])) * 32767; }
  const enc = new lame.Mp3Encoder(1, rate, KBPS);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (b.length) { parts.push(Buffer.from(b)); }
  }
  parts.push(Buffer.from(enc.flush()));
  return Buffer.concat(parts);
}

if (todo.length) {
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
  const t0 = Date.now();
  let done = 0;
  for (const [h, text] of todo) {
    try {
      const a = await tts.generate(text, { voice: VOICE });
      const file = path.join(outDir, `${h}.mp3`);
      fs.writeFileSync(`${file}.tmp`, toMp3(a.audio, a.sampling_rate));
      fs.renameSync(`${file}.tmp`, file); // never leave a half-written clip behind
    } catch (e) {
      console.warn(`\nSkipped: ${text.slice(0, 60)}… (${e.message})`);
    }
    done++;
    if (done % 25 === 0 || done === todo.length) {
      const left = ((Date.now() - t0) / done) * (todo.length - done) / 3.6e6;
      process.stdout.write(`\r${done}/${todo.length} sentences · about ${left.toFixed(1)} h left · ${writeIndex()} lessons complete   `);
    }
  }
  console.log();
}
console.log(`Done. ${writeIndex()} of ${plan.length} lessons have audio in data/audio/${VOICE}/.`);
