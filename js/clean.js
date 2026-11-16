// Cleans extracted article text so it reads well aloud: removes site chrome (navigation, cookie banners,
// subscribe prompts), front matter (affiliations, emails, ACM/journal boilerplate), figure/table captions,
// reference lists and back matter, non-prose fragments, and inline citations / figure pointers / URLs.
// Pure functions (no DOM) so the same code runs in the app and in tools/clean_cli.mjs at build time.

const STOP = new Set(("the of and to a in is that for it as with was on be by are this are an or which from at not have has " +
  "we they their these those can more but our its than also such when how what do does were been into other one may " +
  "will would there if so about who use used using between both each only most some very then them").split(" "));

const words = (t) => t.split(/\s+/).filter(Boolean);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const CHROME = new RegExp([
  "^(subscribe|sign ?in|sign ?up|log ?in|share|search|menu|navigation|home|archive|about|close|print|email|comments?|like|restack|previous|next|read more|back to top|table of contents|contents|skip to (main )?content)\\b.{0,40}$",
  "cookies?\\b.*(consent|accept|preferences|essential|optional)", "your privacy, your choice", "privacy policy", "terms of (use|service)",
  "already (have an account|a subscriber)", "by subscribing", "discover more from", "\\d[\\d,]* subscribers", "subscribe (for free|now)",
  "thanks for reading", "type your email", "continue reading", "share this (post|article)", "copy link",
  "find a journal", "publish with us", "track your research", "learn more about website changes", "^\\d\\. home \\d\\.",
  "download (pdf|citation|article)", "cite this article", "^metrics$", "accesses$", "altmetric", "rights and permissions",
  "reprints and permissions", "about this article", "^(received|accepted|published|issue date):?\\s", "check for updates",
  "^an official website of the united states government", "here'?s how you know", "official websites use \\.gov", "secure \\.gov websites",
  "permission to make digital or hard copies", "acm reference format", "^ccs concepts", "^keywords?\\b", "^index terms",
  "this work is licensed under a creative commons", "^©|copyright ©|all rights reserved", "publication rights licensed",
  "^arxiv:\\s?\\d", "^preprint\\b", "under review", "^proceedings of", "^correspondence:?", "corresponding author",
  "your use of the jstor archive", "jstor is a not-for-profit", "this copy is for your personal, non-commercial use",
  "downloaded from https?://", "for personal use only", "^vol\\.?:?\\(", "hacker news \\(\\d+ points", "^translations?:",
  "collaborating with jstor", "^https?://\\S+$", "^stable url", "author\\(s\\):.*source:", "explore related subjects",
  "discover the latest articles", "similar content being viewed", "^article\\s+\\d{1,2}\\s+\\w+\\s+\\d{4}$",
  "^[A-Z][a-z]{2} \\d{1,2}(, \\d{4})?\\s?•", "^this article is also available in", "^(\\d+\\s+)?(likes?|restacks?|comments?)$",
].join("|"), "i");

// Headings whose whole section is dropped (until the next heading).
const DROP_SECTION = /^(\d+(\.\d+)*\.?\s*)?(acknowledge?ments?|funding|author contributions?|contributions?( statement)?|competing interests|conflicts? of interest|ethics declarations?|data availability( statement)?|rights and permissions|about this article|author information|authors? and affiliations|additional information|supplementary (information|material)|footnotes|notes|publisher'?s note|declaration of competing interest|credit authorship contribution statement|related (posts|articles)|comments|share this|further reading|citation|cite as)\b/i;
// Headings after which everything is dropped.
const STOP_AT = /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|notes and references|reference list|sources|discussion about this post|ready for more\??|you might also like|recommended( posts| for you)?|more from .{0,40}|related (posts|articles))\s*:?$/i;
const APPENDIX = /^(appendix|appendices|supplementary materials?)\b|^[A-H]\.\d/i;

const CAPTION = /^(figure|fig\.?|table|algorithm|listing|exhibit|panel)\s*[A-Z]?\d+[a-z]?\s*[.:|—–-]/i;

function stopRatio(t) {
  const w = words(t.toLowerCase().replace(/[^a-z\s'-]/g, " "));
  if (!w.length) { return 0; }
  return w.filter((x) => STOP.has(x)).length / w.length;
}

function looksLikeReference(t) {
  if (/^\[\d+\]\s/.test(t) || /^\d{1,3}\.\s+[A-Z][a-z]+,\s+[A-Z]\./.test(t)) { return true; }
  let s = 0;
  s += (t.match(/\b(19|20)\d{2}[a-z]?\b/g) || []).length >= 1 ? 1 : 0;
  s += /\bdoi\b|doi\.org|https?:\/\//i.test(t) ? 1 : 0;
  s += /\bet al\.?/.test(t) ? 1 : 0;
  s += /\b(pp?\.\s?\d|vol\.|no\.\s?\d|In Proceedings|Proc\.|Journal of|Conference on|Transactions on|arXiv preprint|Retrieved from)\b/i.test(t) ? 1 : 0;
  s += (t.match(/\b[A-Z]\.\s?[A-Z]?\.?,?\s/g) || []).length >= 3 ? 1 : 0; // initials "A. B. Smith,"
  return s >= 3 && words(t).length < 90;
}

const YEAR = /\b(19|20)\d{2}[a-z]?\b/;
const FIGREF = /^\s*(see\s+)?(fig\.|figs\.|figure|figures|table|tables|appendix|app\.|section|sec\.|eq\.|equation)s?\s*[a-z]?[\d.]*/i;

// Linear-time inline cleanup (no nested quantifiers: parenthetical contents are checked by callbacks).
function tex(m) {
  const t = m.replace(/\\(mathbf|mathrm|mathit|text|textbf|boldsymbol|bm|operatorname|mathcal|hat|tilde|bar)\s*/g, "").replace(/[{}\\$]/g, "").trim();
  return t.length <= 12 ? t : "[equation]";
}

export function cleanInline(t) {
  return t
    .replace(/\$\$[^$]{0,600}\$\$/g, " [equation] ")
    .replace(/\\\[[^\]]{0,600}?\\\]/g, " [equation] ")
    .replace(/\$([^$]{1,160})\$/g, (m) => tex(m))
    .replace(/\\\(([^)]{1,160}?)\\\)/g, (m) => tex(m))
    .replace(/This work is licensed under a Creative Commons[^.]{0,120}\.( To view a copy[^.]{0,200}\.)?/g, "")
    .replace(/Permission to make digital or hard copies[^]{0,900}?(fee\.|permissions@acm\.org\.?)/g, "")
    .replace(/©\s?\d{4}[^.]{0,160}\./g, "")
    .replace(/ACM ISBN [\d-]+\.?/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s\d{1,2}[a-z]\d{0,2}[a-z]?\d{0,2}$/, "")   // trailing paragraph IDs (e.g. Engelbart's "1a", "8b2")
    .replace(/\[([^\[\]]{0,160})\]/g, (m, inner) => {
      if (/^[\s\d,–-]+$/.test(inner)) { return ""; }                  // [12], [3, 4], [5–7]
      if (YEAR.test(inner) || /et al/.test(inner)) { return ""; }     // [Silver et al., 2017]
      return m;
    })
    .replace(/\(([^()]{0,240})\)/g, (m, inner) => {
      const s = inner.trim();
      if (FIGREF.test(s) && s.length < 40) { return ""; }             // (Figure 3), (see Table 2)
      // Author-year citations: every ;-separated part ends in a year and starts with a name.
      const parts = s.replace(/^(e\.g\.,?|see|cf\.|i\.e\.,?)\s+/i, "").split(/;\s*/);
      if (parts.length && parts.every((p) => /^[A-Z][^;]{0,80}?,?\s(19|20)\d{2}[a-z]?(,\s*(19|20)\d{2}[a-z]?)*(,\s*p+\.\s*\d+(–\d+)?)?$/.test(p.trim()))) { return ""; }
      return m;
    })
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function cleanBlocks(blocks, { title = "", includeAppendix = false } = {}) {
  let out = blocks.map((b) => ({ type: b.type, text: String(b.text || "").replace(/\s+/g, " ").trim() })).filter((b) => b.text);

  // 1. Start at the title (drops site chrome and breadcrumbs before it).
  const nt = norm(title).slice(0, 40);
  if (nt) {
    const ti = out.findIndex((b, i) => i < 60 && norm(b.text).startsWith(nt.slice(0, Math.min(30, nt.length))));
    if (ti > 0) { out = out.slice(ti); }
  }
  // 2. Merge a title split over several heading lines (common in PDFs).
  const ntFull = norm(title);
  while (out.length > 1 && out[0].type === "h" && out[1].type === "h" && ntFull &&
    ntFull.startsWith(norm(out[0].text)) && ntFull.includes(norm(out[1].text).slice(0, 15))) {
    out[0] = { type: "h", text: `${out[0].text} ${out[1].text}` };
    out.splice(1, 1);
  }
  // 3. Front matter: between the title and the abstract/introduction, keep nothing else.
  const ai = out.findIndex((b, i) => i > 0 && i < 40 && /^(abstract|summary|introduction|1\.?\s+introduction)\b/i.test(b.text));
  if (ai > 1) {
    const frontIsJunk = out.slice(1, ai).every((b) => words(b.text).length < 45 || /@|universit|institute|research|department|college|laborator/i.test(b.text));
    if (frontIsJunk) { out = [out[0], ...out.slice(ai)]; }
  }

  // 4. Walk blocks: drop sections, captions, chrome, references, non-prose.
  const kept = [];
  let dropping = false;
  for (const b of out) {
    const t = b.text;
    if (STOP_AT.test(t)) { break; }
    if (b.type === "h") {
      if (STOP_AT.test(t)) { break; }
      if (!includeAppendix && APPENDIX.test(t) && kept.length > 20) { break; }
      dropping = DROP_SECTION.test(t);
      if (dropping || (words(t).length < 30 && CHROME.test(t))) { continue; }
      kept.push({ type: "h", text: t.replace(/\s*\[\s*edit\s*\]\s*$/i, "").replace(/#+\s*$/, "").trim() });
      continue;
    }
    if (dropping) { continue; }
    if ((words(t).length < 60 && CHROME.test(t)) || CAPTION.test(t) || looksLikeReference(t)) { continue; }
    if (/\S+@\S+\.\w+/.test(t) && words(t).length < 40) { continue; }
    const n = words(t).length;
    if (n < 4 && !/[.!?]$/.test(t)) { continue; }
    if (n >= 6 && stopRatio(t) < 0.12) { continue; } // navigation lists, keyword lists, tables, equations
    const text = cleanInline(t);
    if (words(text).length < 3) { continue; }
    kept.push({ type: "p", text });
  }

  // 4b. Re-join paragraphs split mid-sentence (PDF column/page breaks).
  for (let i = kept.length - 1; i > 0; i--) {
    const a = kept[i - 1];
    const b = kept[i];
    if (a.type !== "p" || b.type !== "p") { continue; }
    if (/[.!?:"”)]$/.test(a.text) || !/^[a-z(]/.test(b.text)) { continue; }
    a.text = /[a-z]-$/.test(a.text) ? a.text.slice(0, -1) + b.text : `${a.text} ${b.text}`;
    kept.splice(i, 1);
  }

  // 5. Drop headings that ended up with no text under them, and duplicate blocks.
  const final = [];
  for (let i = 0; i < kept.length; i++) {
    const b = kept[i];
    if (b.type === "h" && i > 0 && (i === kept.length - 1 || kept[i + 1].type === "h")) {
      // keep only if the next heading is a sub-heading with content (e.g. "3 Method" -> "3.1 Data")
      if (i === kept.length - 1) { continue; }
      if (!/^\d/.test(b.text) || !/^\d/.test(kept[i + 1].text)) { continue; }
    }
    if (final.length && final[final.length - 1].text === b.text) { continue; }
    final.push(b);
  }
  // Trailing short chrome after the last real paragraph.
  while (final.length && (final[final.length - 1].type === "h" || words(final[final.length - 1].text).length < 12)) { final.pop(); }
  return final;
}
