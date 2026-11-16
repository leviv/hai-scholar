#!/usr/bin/env python3
"""Build the app's text library from collected extractions.

Input:  <lib>/raw/<id>.json   (from tools/collect_server.py + the in-browser collector)
        <lib>/licenses.json   (from tools/licenses.py)
Output: data/texts/<id>.json + data/texts/index.json  -> openly licensed (Creative Commons / public
                                                         domain) texts, published with the app
        <lib>/hai-scholar-personal-library.json      -> everything else, for the owner's own device
                                                         only (Settings -> Import personal library)
Usage: python3 tools/build_library.py <lib>
"""
import glob
import json
import os
import re
import sys
import subprocess
import time

LIB = os.path.expanduser(sys.argv[1])
res = {}
for p in sorted(glob.glob("data/stages/s*.json")):
    for m in json.load(open(p))["modules"]:
        for r in m["resources"]:
            res.setdefault(r["id"], r)
licenses = json.load(open(os.path.join(LIB, "licenses.json")))

CRUFT = re.compile(
    r"^(subscribe|sign ?in|sign ?up|log ?in|share|discover more.*|skip to (main )?content|menu|search|"
    r"an official website of the united states government|here'?s how you know|official websites use \.gov.*|"
    r"secure \.gov websites use https.*|cookie.*|accept( all)?|copy link|facebook|twitter|linkedin|email|print|"
    r"download pdf|view article|open in a new tab|close|back to top|table of contents|"
    r"thanks for reading.*|subscribe for free.*|type your email.*|already a subscriber.*|continue reading.*|"
    r"read more|comments?|like|restack|previous|next|home|archive|about)$",
    re.I,
)


BOILER = re.compile(r"(your use of the jstor archive|jstor is a not-for-profit|this copy is for your personal, non-commercial use|"
                    r"downloaded from https?://|all use subject to https?://about\.jstor|for personal use only)", re.I)


def prose_ratio(blocks):
    ws = " ".join(b["text"] for b in blocks).split()
    if not ws:
        return 0
    return sum(1 for w in ws if re.fullmatch(r"[A-Za-z][A-Za-z'’-]*[.,;:!?)]*", w)) / len(ws)


def words(t):
    return len(t.split())


def clean(blocks, source):
    out = [b for b in blocks if not CRUFT.match(b["text"].strip()) and not BOILER.search(b["text"])]
    # Drop scan/OCR noise lines (mostly symbols) anywhere in the text.
    out = [b for b in out if words(b["text"]) < 4 or prose_ratio([b]) >= 0.4]
    if "jina" in source or "Original page" in source:
        # Trim navigation cruft before the first real paragraph.
        first = next((i for i, b in enumerate(out) if b["type"] == "p" and words(b["text"]) >= 25), 0)
        start = first
        while start > 0 and out[start - 1]["type"] == "h" and words(out[start - 1]["text"]) <= 15:
            start -= 1
        out = out[start:]
        # Trim trailing cruft after the last real paragraph.
        last = max((i for i, b in enumerate(out) if b["type"] == "p" and words(b["text"]) >= 25), default=len(out) - 1)
        out = out[: last + 1]
    return out


def main():
    # Clean with the same JS cleaner the app uses (js/clean.js).
    subprocess.run(["node", "tools/clean_cli.mjs", os.path.join(LIB, "raw"), os.path.join(LIB, "clean")], check=True, stdout=subprocess.DEVNULL)
    public, personal, report = {}, {}, []
    os.makedirs("data/texts", exist_ok=True)
    for f in sorted(glob.glob(os.path.join(LIB, "clean", "*.json"))):
        d = json.load(open(f))
        rid = d["id"]
        r = res.get(rid)
        if not r:
            continue
        blocks = d["blocks"]
        n = sum(words(b["text"]) for b in blocks)
        if r["kind"] in ("course", "tool") or n < 800:
            continue  # landing pages of courses/tools/books are meant to be visited, not read aloud
        pr = prose_ratio(blocks)
        if pr < 0.72:
            print(f"SKIP garbled {rid} prose={pr:.2f} {r['title'][:50]}")
            continue
        lic = (licenses.get(rid) or {}).get("license") or ""
        open_lic = "creativecommons.org" in lic
        flag = "SHORT" if n < 1200 and r["kind"] in ("paper", "essay") else ""
        report.append((rid, n, d["source"][:28], "PUBLIC" if open_lic else "personal", flag, r["title"][:50]))
        entry = {
            "id": rid, "title": r["title"], "authors": r["authors"], "year": r.get("year"), "url": r["url"],
            "license": lic or None, "source": d["source"], "blocks": blocks,
        }
        if open_lic:
            public[rid] = entry
        else:
            personal[rid] = entry

    for old in glob.glob("data/texts/*.json"):
        os.remove(old)
    for rid, e in public.items():
        with open(f"data/texts/{rid}.json", "w") as fh:
            json.dump(e, fh, ensure_ascii=False, separators=(",", ":"))
    with open("data/texts/index.json", "w") as fh:
        json.dump({"ids": sorted(public)}, fh, indent=0)
    pack = {"kind": "hai-scholar-library", "built": time.strftime("%Y-%m-%d"),
            "note": "Personal study copies of papers whose licenses don't allow public redistribution. Do not publish.",
            "texts": {rid: {"blocks": e["blocks"], "source": e["source"]} for rid, e in personal.items()}}
    with open(os.path.join(LIB, "hai-scholar-personal-library.json"), "w") as fh:
        json.dump(pack, fh, ensure_ascii=False, separators=(",", ":"))

    for row in sorted(report):
        print("%-11s %6d  %-28s %-8s %-5s %s" % row)
    print(f"\npublic: {len(public)}  personal: {len(personal)}  short: {sum(1 for x in report if x[4])}")


main()
