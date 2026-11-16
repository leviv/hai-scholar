#!/usr/bin/env python3
"""Download verified open copies listed in <lib>/found_*.json into .libtmp/ for local extraction."""
import glob, json, os, sys, urllib.request
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
LIB = sys.argv[1]
os.makedirs(".libtmp", exist_ok=True)
for f in sorted(glob.glob(os.path.join(LIB, "found_*.json"))):
    if f.endswith(("found_A.json", "found_B.json")) is False:
        continue
    for rid, v in json.load(open(f)).items():
        if not v or not v.get("url"):
            continue
        ext = "pdf" if v.get("kind") == "pdf" else "html"
        dest = f".libtmp/{rid}.{ext}"
        if os.path.exists(dest):
            continue
        try:
            req = urllib.request.Request(v["url"].replace(" ", "%20"), headers={"User-Agent": UA})
            data = urllib.request.urlopen(req, timeout=90).read()
            open(dest, "wb").write(data)
            print("ok ", rid, len(data))
        except Exception as e:  # noqa: BLE001
            print("ERR", rid, e)
