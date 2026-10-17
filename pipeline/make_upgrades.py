"""找出「重复获得就升级」的职业能力。

游戏里的写法（以「直觉闪避 → 精通直觉闪避」为例）：
职业升级表给一个特性 F，F 自己挂着

    AddFactContextActions.Actions = [Conditional{
        ConditionsChecker: [ContextConditionBuffRank{ UseFactInsteadBuff: true,
                                                    Fact: "!bp_<F 自己的 guid>",
                                                    RankValue: 2 }],
        IfTrue.Actions:  [AddFact{ Fact: "!bp_<升级后的特性>" }]
    }]

也就是「自己已经有一份了（阶层 2）→ 自动给升级版」。这里把这个模式全库扫一遍，
产出 `web/public/data/upgrades.json`（扁平映射）：`{"<特性 id>": "<升级后的特性 id>"}`。

同一中文名的多个变体（野蛮人版 / 游荡者版 …）会一起指向同一个升级版。

用法：
    python pipeline/make_upgrades.py            # 扫 features.json 里登记的特性蓝图
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
from collections import defaultdict

DEFAULT_GAME = r"D:\SteamLibrary\steamapps\common\Pathfinder Second Adventure"


def want_value(node) -> int | None:
    if isinstance(node, dict):
        v = node.get("Value")
        if isinstance(v, (int, float)):
            return int(v)
    return None


def conditional_adds(comp) -> list[tuple[int, str]]:
    """从 AddFactContextActions 里抽出 [(自身阶层, 升级特性 id)]"""
    out: list[tuple[int, str]] = []
    groups = []
    for key in ("Activated", "Deactivated"):
        node = comp.get(key) or {}
        groups += node.get("Actions") or []
    for act in groups:
        if "Conditional" not in str(act.get("$type", "")):
            continue
        chk = act.get("ConditionsChecker") or {}
        rank = None
        self_fact = None
        for c in chk.get("Conditions") or []:
            if "ContextConditionBuffRank" in str(c.get("$type", "")):
                if c.get("UseFactInsteadBuff"):
                    r = want_value(c.get("RankValue"))
                    f = c.get("Fact")
                    if r is not None and isinstance(f, str) and f.startswith("!bp_"):
                        rank, self_fact = r, f[4:].lower()
        if rank is None or not self_fact:
            continue
        adds = []
        for a in (act.get("IfTrue") or {}).get("Actions") or []:
            if "AddFact" in str(a.get("$type", "")):
                f = a.get("m_Fact") or a.get("Fact")
                if isinstance(f, str) and f.startswith("!bp_"):
                    adds.append(f[4:].lower())
        if len(adds) == 1:
            out.append((rank, adds[0], self_fact))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="导出「重复获得就升级」的特性对照表")
    ap.add_argument("--game", default=os.environ.get("WOTR_GAME_DIR", DEFAULT_GAME))
    ap.add_argument("--data", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "web", "public", "data"))
    a = ap.parse_args()

    zp = os.path.join(a.game, "blueprints.zip")
    if not os.path.exists(zp):
        raise SystemExit("缺少文件：%s" % zp)
    with open(os.path.join(a.data, "features.json"), encoding="utf-8") as fh:
        features = json.load(fh)

    zf = zipfile.ZipFile(zp)
    raw: dict[str, str] = {}
    minimum: dict[str, int] = {}
    for fid, f in features.items():
        path = f.get("path")
        if not path:
            continue
        try:
            obj = json.loads(zf.read(path).decode("utf-8"))
        except Exception:
            continue
        d = obj.get("Data") or {}
        own = str(obj.get("AssetId") or "").lower()
        for comp in d.get("Components") or []:
            if "AddFactContextActions" not in str(comp.get("$type", "")):
                continue
            for rank, target, self_fact in conditional_adds(comp):
                if self_fact != own or target == fid:
                    continue
                raw[fid] = target
                minimum[fid] = min(rank, minimum.get(fid, 99))

    # 同一中文名的变体一起指向同一个升级版
    by_name: dict[str, list[str]] = defaultdict(list)
    for fid, f in features.items():
        nm = f.get("name") or ""
        if nm:
            by_name[nm].append(fid)
    table: dict[str, str] = {}
    for fid, target in raw.items():
        nm = features.get(fid, {}).get("name") or ""
        targets = {raw[other] for other in by_name.get(nm, []) if other in raw}
        table[fid] = target if len(targets) <= 1 else target
        for other in by_name.get(nm, []):
            if other != fid and other not in table:
                table[other] = target

    out = table
    os.makedirs(a.data, exist_ok=True)
    path = os.path.join(a.data, "upgrades.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("  「重复获得就升级」的特性 %d 条 → %s（%d 字节）"
          % (len(table), path, os.path.getsize(path)))
    for fid, target in sorted(table.items()):
        src = features.get(fid, {})
        dst = features.get(target, {})
        print("    %-12s %-10s → %s（阶层 ≥ %d）"
              % (src.get("name", "?"), src.get("nameEn", "")[:10], dst.get("name", "?"),
                 minimum.get(fid, 2)))


if __name__ == "__main__":
    sys.exit(main())
