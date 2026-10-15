# -*- coding: utf-8 -*-
import collections
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(HERE, "..", "web", "public", "data", "meta.json"), encoding="utf-8"))
up = meta["unresolvedPaths"]
c = collections.Counter(p.split("/")[0] for p in up.values())
print("未解析路径顶层目录分布：", dict(c))
for g, p in up.items():
    print("  ×%-4s %s" % (meta["unresolved"][g], p))
print()
print("warnings:", json.dumps(meta["warnings"], ensure_ascii=False, indent=1)[:2000])
