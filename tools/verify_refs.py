#!/usr/bin/env python3
"""Validate curriculum stage files and verify that every reference is real.

Checks, per stage file:
  * schema: required fields, unique ids, quiz answers in range, quiz refs exist
  * arXiv ids: title from the arXiv API matches the stated title
  * DOIs (doi.org / dl.acm.org / any 10.xxxx/ path): title from Crossref matches
  * YouTube ids: title from YouTube oEmbed matches (video must exist)
  * every other URL: resolves with HTTP < 400 (page <title> printed for eyeballing)

Usage: python3 tools/verify_refs.py [data/stages/s01.json ...]
Exit code 1 if any FAIL.
"""
import difflib
import glob
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
KINDS = {"paper", "video", "essay", "book", "course", "tool"}
cache = {}


def get(url, timeout=30):
    if url in cache:
        return cache[url]
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(400_000)
            res = (r.status, body.decode("utf-8", "replace"), dict(r.headers))
    except urllib.error.HTTPError as e:
        res = (e.code, "", dict(e.headers or {}))
    except Exception as e:  # noqa: BLE001
        res = (0, str(e), {})
    cache[url] = res
    return res


def norm(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def arxiv_title(aid):
    status, body, _ = get("https://export.arxiv.org/api/query?id_list=" + aid)
    if status != 200:
        return None
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return None
    ns = {"a": "http://www.w3.org/2005/Atom"}
    entry = root.find("a:entry", ns)
    if entry is None:
        return None
    t = entry.find("a:title", ns)
    return " ".join(t.text.split()) if t is not None and t.text else None


def doi_of(url):
    m = re.search(r"(10\.\d{4,9}/[^\s?#]+)", urllib.parse.unquote(url))
    if not m:
        return None
    d = m.group(1).rstrip("/")
    d = re.sub(r"\.pdf$", "", d)
    return d


def crossref_title(doi):
    status, body, _ = get("https://api.crossref.org/works/" + urllib.parse.quote(doi, safe="/"))
    if status != 200:
        return None
    try:
        msg = json.loads(body)["message"]
        return (msg.get("title") or [None])[0]
    except Exception:  # noqa: BLE001
        return None


def yt_title(vid):
    status, body, _ = get("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid))
    if status != 200:
        return None
    try:
        return json.loads(body)["title"]
    except Exception:  # noqa: BLE001
        return None


def page_title(body):
    m = re.search(r"<title[^>]*>(.*?)</title>", body, re.S | re.I)
    return " ".join(m.group(1).split())[:120] if m else ""


def check_resource(r):
    """Return (level, message). level in OK, CHECK, FAIL."""
    title = r.get("title", "")
    if r.get("arxiv"):
        t = arxiv_title(r["arxiv"])
        time.sleep(0.4)
        if not t:
            return "FAIL", f"arXiv {r['arxiv']} not found"
        s = sim(title, t)
        return ("OK" if s >= 0.8 else "FAIL"), f"arXiv {r['arxiv']}: '{t}' (sim {s:.2f})"
    if r.get("youtube"):
        t = yt_title(r["youtube"])
        if not t:
            return "FAIL", f"YouTube {r['youtube']} not found"
        s = sim(title, t)
        return ("OK" if s >= 0.6 else "CHECK"), f"YouTube: '{t}' (sim {s:.2f})"
    url = r.get("url", "")
    doi = doi_of(url)
    if doi:
        t = crossref_title(doi)
        if not t:
            return "FAIL", f"DOI {doi} not in Crossref"
        s = sim(title, t)
        return ("OK" if s >= 0.8 else "FAIL"), f"DOI {doi}: '{t}' (sim {s:.2f})"
    status, body, _ = get(url)
    if status and status < 400:
        return "OK", f"HTTP {status} '{page_title(body)}'"
    if status in (401, 403, 429, 503):
        return "CHECK", f"HTTP {status} (bot-blocked? verify in a browser)"
    return "FAIL", f"HTTP {status} {body[:80] if status == 0 else ''}"


def check_listen(url):
    # Browsers send an Origin header on cross-origin fetches; some servers only answer CORS when it's present.
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Origin": "https://leviv.cool"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, headers = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        status, headers = e.code, dict(e.headers or {})
    except Exception:  # noqa: BLE001
        status, headers = 0, {}
    acao = {k.lower(): v for k, v in headers.items()}.get("access-control-allow-origin")
    if status in (401, 403, 429, 503):
        return "CHECK", f"listen URL HTTP {status} to scripts (bot-blocked; reader proxy may still work)"
    if status >= 400 or status == 0:
        return "FAIL", f"listen URL HTTP {status}"
    if not acao:
        return "CHECK", "listen URL has no CORS header (in-app listen will fall back to reader proxy)"
    return "OK", "listen URL CORS ok"


def validate(stage, path, ids):
    errs = []
    for k in ("id", "number", "title", "subtitle", "overview", "modules"):
        if k not in stage:
            errs.append(f"stage missing {k}")
    for m in stage.get("modules", []):
        for k in ("id", "title", "goal", "guide", "resources", "quiz"):
            if k not in m:
                errs.append(f"{m.get('id')} missing {k}")
        rids = set()
        for r in m.get("resources", []):
            for k in ("id", "kind", "title", "authors", "year", "url", "minutes", "why"):
                if k not in r:
                    errs.append(f"{r.get('id')} missing {k}")
            if r.get("kind") not in KINDS:
                errs.append(f"{r.get('id')} bad kind {r.get('kind')}")
            if r.get("kind") == "video" and not r.get("youtube"):
                errs.append(f"{r.get('id')} video without youtube id")
            rids.add(r.get("id"))
            if r.get("id") in ids:
                errs.append(f"duplicate id {r.get('id')}")
            ids.add(r.get("id"))
        if m.get("id") in ids:
            errs.append(f"duplicate id {m.get('id')}")
        ids.add(m.get("id"))
        answers = []
        for i, q in enumerate(m.get("quiz", [])):
            for k in ("q", "choices", "answer", "explain"):
                if k not in q:
                    errs.append(f"{m['id']} q{i} missing {k}")
            if not (0 <= q.get("answer", -1) < len(q.get("choices", []))):
                errs.append(f"{m['id']} q{i} answer out of range")
            if q.get("ref") and q["ref"] not in rids:
                errs.append(f"{m['id']} q{i} ref {q['ref']} not in module")
            answers.append(q.get("answer"))
        if len(m.get("quiz", [])) < 4:
            errs.append(f"{m['id']} has fewer than 4 quiz questions")
    return errs


def main():
    paths = sys.argv[1:] or sorted(glob.glob("data/stages/s*.json"))
    ids, failed = set(), False
    for path in paths:
        with open(path) as f:
            try:
                stage = json.load(f)
            except json.JSONDecodeError as e:
                print(f"FAIL {path}: invalid JSON: {e}")
                failed = True
                continue
        print(f"\n### {path}: {stage.get('title')}")
        for e in validate(stage, path, ids):
            print("FAIL schema:", e)
            failed = True
        for m in stage.get("modules", []):
            for r in m.get("resources", []):
                level, msg = check_resource(r)
                failed |= level == "FAIL"
                print(f"{level:5} {r['id']} [{r['title'][:60]}] -> {msg}")
                if r.get("listen"):
                    level, msg = check_listen(r["listen"])
                    if level != "OK":
                        print(f"{level:5} {r['id']} -> {msg}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
