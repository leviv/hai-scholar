#!/usr/bin/env python3
"""For sources whose text couldn't be collected, find legitimate open-access copies
(OpenAlex + Semantic Scholar: publisher OA, PubMed Central, institutional and author repositories)
and download them into LIB/files/<id>.<pdf|html> so tools/collect_texts can extract them locally.
Skips anything behind bot checks; never bypasses them.

Usage: python3 tools/fetch_open_copies.py <library-dir> <id> [<id> ...]
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import glob

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
LIB = sys.argv[1]
IDS = set(sys.argv[2:])
os.makedirs(os.path.join(LIB, "files"), exist_ok=True)


def get(url, binary=False, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(40_000_000)
        return data if binary else data.decode("utf-8", "replace"), r.headers.get("content-type", ""), r.geturl()


def candidates(doi, title):
    out = []
    try:
        body, _, _ = get("https://api.openalex.org/works/doi:" + urllib.parse.quote(doi, safe="/"))
        w = json.loads(body)
        locs = [w.get("best_oa_location") or {}] + (w.get("locations") or [])
        for loc in locs:
            for k in ("pdf_url", "landing_page_url"):
                u = (loc or {}).get(k)
                if u and loc.get("is_oa") and u not in out:
                    out.append(u)
    except Exception as e:  # noqa: BLE001
        print("  openalex:", e)
    try:
        body, _, _ = get("https://api.semanticscholar.org/graph/v1/paper/DOI:" + urllib.parse.quote(doi, safe="/") + "?fields=openAccessPdf,externalIds")
        d = json.loads(body)
        u = (d.get("openAccessPdf") or {}).get("url")
        if u and u not in out:
            out.append(u)
        ax = (d.get("externalIds") or {}).get("ArXiv")
        if ax:
            out.insert(0, f"https://arxiv.org/pdf/{ax}")
    except Exception as e:  # noqa: BLE001
        print("  s2:", e)
    time.sleep(1.2)
    return out


def main():
    res = {}
    for p in sorted(glob.glob("data/stages/s*.json")):
        for m in json.load(open(p))["modules"]:
            for r in m["resources"]:
                if r["id"] in IDS:
                    res[r["id"]] = r
    report = {}
    for rid, r in res.items():
        d = re.search(r"(10\.\d{4,9}/[^\s?#]+)", urllib.parse.unquote(r["url"]))
        cands = candidates(d.group(1), r["title"]) if d else []
        if r.get("listen"):
            cands.insert(0, r["listen"])
        if not d and r["url"] not in cands:
            cands.append(r["url"])
        got = None
        for u in cands:
            if "doi.org/" in u or "dl.acm.org" in u:
                continue  # resolver / bot-checked hosts
            try:
                data, ctype, final = get(u, binary=True)
            except Exception as e:  # noqa: BLE001
                print(f"  {rid} x {u[:80]} {e}")
                continue
            head = data[:2048].decode("latin-1").lower()
            if data[:4] == b"%PDF":
                ext = "pdf"
            elif "<html" in head or "<!doctype html" in head:
                if re.search(r"just a moment|captcha|verify you are human|not a bot", head):
                    continue
                ext = "html"
            else:
                continue
            if len(data) < 15000:
                continue
            path = os.path.join(LIB, "files", f"{rid}.{ext}")
            open(path, "wb").write(data)
            got = {"file": f"{rid}.{ext}", "from": final}
            break
        report[rid] = got or {"file": None, "tried": cands}
        print(rid, "->", (got or {}).get("from", "NONE"), flush=True)
    json.dump(report, open(os.path.join(LIB, "open_copies.json"), "w"), indent=1)


main()
