#!/usr/bin/env python3
"""Look up the reuse license of every text source, so only openly licensed works are hosted publicly.

  arXiv papers  -> license chosen by the authors (arXiv OAI-PMH 'arXiv' metadata)
  DOIs          -> Crossref license URLs (Creative Commons only)
  other pages   -> creativecommons.org/licenses link on the page itself (or its listen URL)

Writes {resourceId: {"license": url-or-null, "how": "..."}} to the path given.
Usage: python3 tools/licenses.py out.json
"""
import glob
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
CC = re.compile(r"(https?://creativecommons\.org/(?:licenses|publicdomain)/[a-z0-9.\-/]+)", re.I)


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(800_000).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""


def arxiv_license(aid):
    body = get(f"https://export.arxiv.org/oai2?verb=GetRecord&identifier=oai:arXiv.org:{aid}&metadataPrefix=arXiv")
    m = re.search(r"<license>([^<]+)</license>", body)
    time.sleep(3)  # arXiv asks for 3 s between OAI requests
    return m.group(1).strip() if m else None


def crossref_license(doi):
    body = get("https://api.crossref.org/works/" + urllib.parse.quote(doi, safe="/"))
    try:
        lic = json.loads(body)["message"].get("license") or []
    except Exception:  # noqa: BLE001
        return None
    for item in lic:
        if CC.match(item.get("URL", "")):
            return item["URL"]
    return None


def page_license(url):
    m = CC.search(get(url))
    return m.group(1) if m else None


def main():
    out = {}
    seen = set()
    for p in sorted(glob.glob("data/stages/s*.json")):
        for mod in json.load(open(p))["modules"]:
            for r in mod["resources"]:
                if r["kind"] == "video":
                    continue
                key = r.get("arxiv") or r["url"]
                if key in seen:
                    continue
                seen.add(key)
                lic, how = None, ""
                if r.get("arxiv"):
                    lic, how = arxiv_license(r["arxiv"]), "arXiv"
                    if not lic:
                        how = "arXiv default (non-exclusive distribution license)"
                else:
                    d = re.search(r"(10\.\d{4,9}/[^\s?#]+)", urllib.parse.unquote(r["url"]))
                    if d:
                        lic, how = crossref_license(d.group(1)), "Crossref"
                    if not lic and r.get("listen"):
                        lic, how = page_license(r["listen"]), "listen page"
                    if not lic and not d:
                        lic, how = page_license(r["url"]), "page"
                out[r["id"]] = {"license": lic, "how": how, "title": r["title"]}
                print(f"{r['id']:12} {str(lic):60} {how}", flush=True)
    json.dump(out, open(sys.argv[1], "w"), indent=1)


if __name__ == "__main__":
    main()
