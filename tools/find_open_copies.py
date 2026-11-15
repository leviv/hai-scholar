#!/usr/bin/env python3
"""For resources with no in-app text source (no arXiv id / listen URL), look up open-access
copies via the Semantic Scholar Graph API and report candidates (arXiv id or OA PDF)."""
import glob, json, sys, time, urllib.request, urllib.parse, re
sys.path.insert(0, "tools")
from verify_refs import sim, arxiv_title

def s2(doi):
    url = "https://api.semanticscholar.org/graph/v1/paper/DOI:" + urllib.parse.quote(doi, safe="/") + "?fields=title,externalIds,openAccessPdf"
    for _ in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "hai-scholar-refcheck/1.0"}), timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(4); continue
            return None
        except Exception:
            return None
    return None

out = {}
for p in sorted(glob.glob("data/stages/s*.json")):
    for m in json.load(open(p))["modules"]:
        for r in m["resources"]:
            if r["kind"] == "video" or r.get("arxiv") or r.get("listen"): continue
            mm = re.search(r"(10\.\d{4,9}/\S+)", r["url"])
            if not mm: print("NODOI", r["id"], r["url"]); continue
            d = s2(mm.group(1)); time.sleep(1.2)
            if not d: print("NOS2 ", r["id"], r["title"][:60]); continue
            ax = (d.get("externalIds") or {}).get("ArXiv")
            pdf = (d.get("openAccessPdf") or {}).get("url")
            cand = {}
            if ax:
                t = arxiv_title(ax); s = sim(r["title"], t or "")
                cand["arxiv"] = (ax, round(s, 2), t)
            if pdf: cand["pdf"] = pdf
            out[r["id"]] = cand
            print("CAND " if cand else "NONE ", r["id"], r["title"][:55], cand)
json.dump(out, open(sys.argv[1], "w"), indent=1)
