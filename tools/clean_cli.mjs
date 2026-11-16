// Clean every collected raw text with the same cleaner the app uses.
// Usage: node tools/clean_cli.mjs <lib>/raw <lib>/clean
import fs from "node:fs";
import path from "node:path";
import { cleanBlocks } from "../js/clean.js";

const [rawDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const titles = {};
for (const f of fs.readdirSync("data/stages").filter((x) => /^s\d+\.json$/.test(x))) {
  for (const m of JSON.parse(fs.readFileSync(path.join("data/stages", f))).modules) {
    for (const r of m.resources) { titles[r.id] = r.title; }
  }
}
for (const f of fs.readdirSync(rawDir).filter((x) => x.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(rawDir, f)));
  const before = d.blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  d.blocks = cleanBlocks(d.blocks, { title: titles[d.id] || d.title || "" });
  const after = d.blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  d.words = after;
  fs.writeFileSync(path.join(outDir, f), JSON.stringify(d));
  console.log(`${d.id.padEnd(11)} ${String(before).padStart(6)} -> ${String(after).padStart(6)}  ${Math.round((1 - after / Math.max(1, before)) * 100)}% removed`);
}
