#!/usr/bin/env python3
"""Regenerate data/stages/index.json from the stage files present."""
import glob, json, os
files = sorted(os.path.basename(p) for p in glob.glob("data/stages/s[0-9]*.json"))
with open("data/stages/index.json", "w") as f:
    json.dump({"files": files}, f, indent=2)
print("index:", files)
