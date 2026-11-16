// Turns a resource into readable blocks of text ({type: "h" | "p", text}) for the read-along player.
// Strategy, in order:
//   1. arXiv papers: arxiv.org/html/<id> (CORS-enabled, clean structure), then the arXiv PDF via pdf.js
//   2. resource.listen URL (open HTML or PDF that allows cross-origin reads)
//   3. the canonical URL directly (works when the site allows cross-origin reads)
//   4. r.jina.ai reader proxy (public page -> plain text), for sites that block cross-origin reads
// Nothing is bundled: text is always fetched from the original source at read time.

import { textCache } from "./store.js";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const CACHE_VERSION = 4;

export async function extractResource(res, { includeAppendix = false, onStatus = () => {}, fresh = false } = {}) {
  const cacheKey = `${res.textId || res.id}|${includeAppendix ? 1 : 0}`;
  const cached = fresh ? null : await textCache.get(cacheKey);
  if (cached && cached.blocks?.length && (cached.v === CACHE_VERSION || cached.hosted)) {
    return { ...cached, cached: true };
  }

  const attempts = [];
  if (res.hosted && !includeAppendix) {
    attempts.push(["HAI Scholar library", () => fromHosted(res)]);
  }
  if (res.arxiv) {
    attempts.push(["arXiv HTML", () => fromArxivHTML(res.arxiv, includeAppendix)]);
    attempts.push(["arXiv PDF", () => fromPDF(`https://arxiv.org/pdf/${res.arxiv}`, includeAppendix)]);
  }
  if (res.listen) {
    attempts.push(["Original page", () => fromURL(res.listen, includeAppendix)]);
  }
  if (!res.arxiv && res.url && res.url !== res.listen && !isDOI(res.url)) {
    attempts.push(["Original page", () => fromURL(res.url, includeAppendix)]);
  }
  const proxied = res.listen || res.url;
  if (proxied) {
    attempts.push(["Reader proxy (r.jina.ai)", () => fromJina(proxied, includeAppendix)]);
  }

  const errors = [];
  for (const [label, fn] of attempts) {
    try {
      onStatus(`Fetching text · ${label}…`);
      const raw = await fn();
      const blocks = tidy(raw);
      const shown = raw.label || label;
      if (wordCount(blocks) < 150) { throw new Error("too little text"); }
      if (!looksLikeProse(blocks)) { throw new Error("text looks garbled"); }
      const out = { v: CACHE_VERSION, blocks, source: shown, ts: Date.now() };
      textCache.set(cacheKey, out);
      return out;
    } catch (e) {
      errors.push(`${label}: ${e.message || e}`);
    }
  }
  const err = new Error("Couldn't load the text of this source in-app.");
  err.details = errors;
  throw err;
}

// Rejects PDF extractions that came out as symbol soup or broken encodings.
export function looksLikeProse(blocks) {
  const words = blocks.map((b) => b.text).join(" ").split(/\s+/).filter(Boolean);
  if (!words.length) { return false; }
  const alpha = words.filter((w) => /^[A-Za-z][A-Za-z'’-]*[.,;:!?)]*$/.test(w)).length / words.length;
  const avg = words.reduce((n, w) => n + w.length, 0) / words.length;
  return alpha > 0.6 && avg > 3 && avg < 9;
}

// Texts bundled with the app (openly licensed works only; see tools/build_library.py).
async function fromHosted(res) {
  const data = await (await fetchOK(`data/texts/${res.textId || res.id}.json`)).json();
  const lic = (data.license || "").match(/licenses\/([a-z-]+)\/([\d.]+)/);
  const blocks = data.blocks;
  blocks.label = `Bundled with the app · ${lic ? `CC ${lic[1].toUpperCase()} ${lic[2]}` : "open license"} · © the authors`;
  return blocks;
}

function isDOI(url) { return /doi\.org\//.test(url); }

function wordCount(blocks) {
  return blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
}

async function fetchOK(url, opts) {
  const r = await fetch(url, { mode: "cors", ...opts });
  if (!r.ok) { throw new Error(`HTTP ${r.status}`); }
  return r;
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

function tidy(blocks) {
  const out = [];
  for (const b of blocks) {
    const text = norm(b.text);
    if (!text) { continue; }
    if (b.type === "p" && text.split(" ").length < 3 && !/[.!?]$/.test(text)) { continue; }
    if (out.length && out[out.length - 1].text === text) { continue; }
    out.push({ type: b.type, text });
  }
  return out;
}

const REF_HEAD = /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|notes and references)$/i;
const APPX_HEAD = /^(appendix|appendices|supplementary material|[A-Z](\.\d+)?\s+\S)/;

// ---------- arXiv HTML ----------
async function fromArxivHTML(id, includeAppendix) {
  const html = await (await fetchOK(`https://arxiv.org/html/${id}`)).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("article.ltx_document") || doc.querySelector(".ltx_page_main");
  if (!root) { throw new Error("no arXiv HTML rendering"); }

  const drop = [".ltx_bibliography", ".ltx_TOC", "nav", "figure", ".ltx_figure", ".ltx_table", ".ltx_authors",
    ".ltx_note", ".ltx_note_outer", ".ltx_page_footer", ".ltx_role_affiliation", ".ltx_dates", ".ltx_keywords",
    ".ltx_acknowledgements", "button", ".ltx_equation", ".ltx_equationgroup", ".ltx_listing"];
  if (!includeAppendix) { drop.push(".ltx_appendix"); }
  root.querySelectorAll(drop.join(",")).forEach((n) => n.remove());

  root.querySelectorAll("math").forEach((m) => {
    m.replaceWith(doc.createTextNode(mathText(m.getAttribute("alttext") || m.textContent || "")));
  });

  const blocks = [];
  root.querySelectorAll("h1.ltx_title, h2.ltx_title, h3.ltx_title, h4.ltx_title, h5.ltx_title, h6.ltx_title, p.ltx_p, .ltx_abstract > p, .ltx_abstract h6").forEach((el) => {
    const isHead = /^H\d$/.test(el.tagName);
    const text = norm(el.textContent);
    if (isHead) {
      if (REF_HEAD.test(text)) { return; }
      blocks.push({ type: "h", text });
      return;
    }
    blocks.push({ type: "p", text });
  });
  return blocks;
}

function mathText(tex) {
  const t = tex.replace(/\\(mathrm|mathbf|mathit|text|textbf|operatorname|mathcal|bm|boldsymbol)\s*/g, "")
    .replace(/\\[,;:! ]/g, " ").replace(/[{}]/g, "").replace(/\\/g, "").trim();
  if (t.length <= 14) { return ` ${t} `; }
  return " [equation] ";
}

// ---------- generic URL (HTML or PDF) ----------
async function fromURL(url, includeAppendix) {
  const r = await fetchOK(url);
  const type = r.headers.get("content-type") || "";
  if (type.includes("pdf") || /\.pdf($|\?)/i.test(url)) {
    return pdfBlocks(await r.arrayBuffer(), includeAppendix);
  }
  return htmlBlocks(await r.text());
}

function htmlBlocks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, iframe, svg, figure, .footnotes, .comments, #comments, .sidebar, .share, .nav, .toc, #TOC, d-footnote-list, d-citation-list, d-appendix, d-bibliography, .post-nav, .related").forEach((n) => n.remove());
  const candidates = ["d-article", "article", "main", "[role=main]", ".post-content", ".post", ".content", "#content", ".entry-content", "body"];
  let root = null;
  for (const sel of candidates) {
    const el = doc.querySelector(sel);
    if (el && norm(el.textContent).length > 1500) { root = el; break; }
  }
  root = root || doc.body;

  const taken = new Set();
  const blocks = [];
  root.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, dd").forEach((el) => {
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      if (taken.has(p)) { return; }
    }
    const text = norm(el.textContent);
    if (!text) { return; }
    const isHead = /^H\d$/.test(el.tagName);
    if (isHead && REF_HEAD.test(text)) { return; }
    taken.add(el);
    blocks.push({ type: isHead ? "h" : "p", text });
  });
  return blocks;
}

// ---------- PDF via pdf.js ----------
let pdfjsReady = null;
function loadPdfJs() {
  if (pdfjsReady) { return pdfjsReady; }
  pdfjsReady = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const s = document.createElement("script");
    s.src = PDFJS;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfjsReady = null; reject(new Error("couldn't load PDF reader")); };
    document.head.appendChild(s);
  });
  return pdfjsReady;
}

async function fromPDF(url, includeAppendix) {
  const r = await fetchOK(url);
  return pdfBlocks(await r.arrayBuffer(), includeAppendix);
}

async function pdfBlocks(buf, includeAppendix) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;

  // Pass 1: rebuild lines per page from text items.
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = [];
    let line = { text: "", y: null, h: 0 };
    for (const it of content.items) {
      if (!("str" in it)) { continue; }
      const y = it.transform[5];
      if (line.y !== null && Math.abs(y - line.y) > 2 && line.text) {
        lines.push(line);
        line = { text: "", y: null, h: 0 };
      }
      line.text += it.str;
      line.y = y;
      line.h = Math.max(line.h, it.height || 0);
      if (it.hasEOL) {
        lines.push(line);
        line = { text: "", y: null, h: 0 };
      }
    }
    if (line.text) { lines.push(line); }
    pages.push(lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text));
  }

  // Running headers/footers: short lines (digits ignored) that repeat on many pages.
  const key = (t) => t.replace(/\d+/g, "#").toLowerCase();
  const freq = new Map();
  for (const lines of pages) {
    for (const k of new Set(lines.filter((l) => l.text.length < 90).map((l) => key(l.text)))) {
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  const repeated = (t) => pages.length >= 3 && (freq.get(key(t)) || 0) >= Math.max(3, pages.length * 0.3);
  const pageNum = /^([-–—\s]*\d{1,4}[-–—\s]*|page \d+( of \d+)?)$/i;

  // Pass 2: group lines into paragraphs by vertical gaps.
  const paras = [];
  let cur = [];
  const flush = () => {
    if (cur.length) { paras.push(cur.join(" ")); cur = []; }
  };
  for (const lines of pages) {
    const heights = lines.map((l) => l.h).filter(Boolean).sort((a, b) => a - b);
    const typical = heights[Math.floor(heights.length / 2)] || 10;
    let prevY = null;
    for (const l of lines) {
      const t = l.text;
      if (pageNum.test(t) || repeated(t)) { continue; }
      if (REF_HEAD.test(t)) { flush(); return finishPdf(paras); }
      if (!includeAppendix && /^(appendix|appendices)\b/i.test(t) && t.length < 40) { flush(); return finishPdf(paras); }
      const gap = prevY === null ? 0 : Math.abs(prevY - l.y);
      if (prevY !== null && (gap > typical * 1.9 || gap > 40)) { flush(); }
      const last = cur[cur.length - 1];
      if (last && /[a-z]-$/.test(last) && /^[a-z]/.test(t)) {
        cur[cur.length - 1] = last.slice(0, -1) + t;
      } else if (last && /[A-Za-z]-$/.test(last)) {
        cur[cur.length - 1] = last + t;
      } else {
        cur.push(t);
      }
      prevY = l.y;
    }
    flush();
  }
  return finishPdf(paras);
}

function finishPdf(paras) {
  return paras.map((text) => ({ type: text.length < 70 && !/[.:,;]$/.test(text) ? "h" : "p", text }));
}

// ---------- Reader proxy ----------
async function fromJina(url, includeAppendix) {
  const r = await fetchOK(`https://r.jina.ai/${url}`, { headers: { "X-Return-Format": "markdown" } });
  const md = await r.text();
  if (/requiring CAPTCHA|Just a moment\.\.\.|Performing security verification|Making sure you.re not a bot/i.test(md.slice(0, 1500))) {
    throw new Error("site blocks automated readers");
  }
  const body = md.split(/\nMarkdown Content:\n/)[1] || md;
  const blocks = [];
  let inCode = false;
  for (const chunk of body.split(/\n\s*\n/)) {
    let t = chunk.trim();
    if (t.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode || !t) { continue; }
    if (/^\|/.test(t) || /^[-=*_]{3,}$/.test(t)) { continue; }
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/^\s*[*+-]\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/[*_`]{1,3}/g, "");
    const head = t.match(/^#{1,6}\s+(.*)$/) || t.match(/^(.*)\n[=-]{3,}$/);
    if (head) {
      const h = norm(head[1]);
      if (REF_HEAD.test(h)) { break; }
      if (!includeAppendix && /^appendi(x|ces)\b/i.test(h)) { break; }
      blocks.push({ type: "h", text: h });
      continue;
    }
    blocks.push({ type: "p", text: t });
  }
  return blocks;
}

// ---------- sentence splitting + speech cleanup ----------
const ABBREV = /\b(et al|e\.g|i\.e|Fig|Figs|Eq|Eqs|vs|cf|Sec|Secs|Tab|No|Dr|Mr|Ms|Mrs|Prof|approx|resp|ca|Jr|Sr|St|U\.S|Inc|Ltd|Vol|pp|Ch|al)\.$/i;

export function sentences(text) {
  let parts;
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter("en", { granularity: "sentence" });
    parts = Array.from(seg.segment(text), (s) => s.segment);
  } else {
    parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  }
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && (ABBREV.test(prev.trim()) || /^\s*[a-z0-9(\[]/.test(p) || prev.trim().length < 18)) {
      out[out.length - 1] = prev + p;
    } else {
      out.push(p);
    }
  }
  // Very long "sentences" (lists, run-ons) are split on semicolons so highlights stay useful.
  return out.flatMap((s) => (s.length > 420 ? s.split(/(?<=;)\s+/) : [s])).map((s) => s.trim()).filter(Boolean);
}

export function speakable(text, { skipCitations = true } = {}) {
  let t = text;
  if (skipCitations) {
    t = t.replace(/\[(\d+[\s,–-]*)+\]/g, "")
      .replace(/\((?:[^()]*?(?:et al\.?|&|and)[^()]*?,?\s*(?:19|20)\d{2}[a-z]?(?:[;,]\s*)?)+\)/g, "")
      .replace(/\((?:[A-Z][A-Za-z'’-]+,?\s+(?:19|20)\d{2}[a-z]?(?:[;,]\s*)?)+\)/g, "");
  }
  return t.replace(/https?:\/\/\S+/g, "link")
    .replace(/\[equation\]/g, "equation")
    .replace(/_/g, " sub ")
    .replace(/\^/g, " to the ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
