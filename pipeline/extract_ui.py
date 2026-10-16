# -*- coding: utf-8 -*-
"""从本机《开拓者：正义之怒》安装里提取网页版要用的真实 UI 素材。

产出（默认写到 web/public/assets/）：
  ui/<SpriteName>.png     —— Wrath_Data 里的界面贴图（牌匾条、按钮、图标框、搜索图标、图集…）
  icons/<SpriteName>.png  —— Bundles/blueprint.assets 里 64×64 的内容图标（只导出真的被引用到的）
  ../data/icons.json      —— 实体 id → 图标名 的对照表（features/spells/classes/... 各自一节）

用法：
  python pipeline\\extract_ui.py                  # 提取 UI 贴图 + 需要的图标 + 写对照表
  python pipeline\\extract_ui.py --list-ui        # 只列 UI 贴图名（不写文件）
  python pipeline\\extract_ui.py --no-icons       # 只提 UI 贴图
  python pipeline\\extract_ui.py --game <游戏目录> --out <输出目录>

依赖：UnityPy（本机已装 1.25.4）。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, OrderedDict

try:
    import UnityPy
except ImportError:  # pragma: no cover
    print("需要 UnityPy：python -m pip install UnityPy", file=sys.stderr)
    raise SystemExit(3)

DEFAULT_GAME = r"D:\SteamLibrary\steamapps\common\Pathfinder Second Adventure"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "web", "public", "assets")
DEFAULT_DATA = os.path.join(ROOT, "web", "public", "data")

# 带界面贴图的 Unity 资源文件（实测这三个里有 Sprite）
UI_FILES = ("sharedassets0.assets", "resources.assets", "sharedassets2.assets")
# 内容图标都在这个 bundle 里
ICON_BUNDLE = os.path.join("Bundles", "blueprint.assets")


def game_dir(arg: str | None) -> str:
    return arg or os.environ.get("WOTR_GAME_DIR") or DEFAULT_GAME


def sprite_names(path: str) -> list[str]:
    """只列 Sprite 的名字，不解码图片（很快）。"""
    env = UnityPy.load(path)
    names: list[str] = []
    for obj in env.objects:
        if obj.type.name != "Sprite":
            continue
        try:
            nm = obj.read().m_Name or ""
        except Exception:
            nm = ""
        if nm:
            names.append(nm)
    return names


def save_sprites(path: str, out_dir: str, only: set[str] | None = None) -> dict[str, int]:
    """把 Sprite 导成 PNG。only 非空时只导名字在集合里的。"""
    os.makedirs(out_dir, exist_ok=True)
    env = UnityPy.load(path)
    written = 0
    skipped = 0
    failed = 0
    for obj in env.objects:
        if obj.type.name != "Sprite":
            continue
        try:
            data = obj.read()
            nm = data.m_Name or ""
            if not nm or (only is not None and nm not in only):
                skipped += 1
                continue
            img = data.image
            if img is None:
                failed += 1
                continue
            img.save(os.path.join(out_dir, f"{nm}.png"))
            written += 1
        except Exception:
            failed += 1
    return {"written": written, "skipped": skipped, "failed": failed}


# ── 图标对位：把实体名变成若干候选 sprite 名 ──────────────────────────────
SUFFIXES = ("Feature", "Selection", "Progression", "Ability", "Cast", "Buff",
            "Effect", "Toggle", "ActivatableAbility", "AbilityFeature", "Rank")


def candidates(entry: dict) -> list[str]:
    """给一条实体记录生成候选 sprite 名（按优先级从高到低）。"""
    out: list[str] = []
    name_en = (entry.get("nameEn") or "").replace(" ", "")
    key = entry.get("key") or ""
    base = os.path.basename(entry.get("path") or "")
    if base.endswith(".jbp"):
        base = base[:-4]
    for raw in (name_en, key, base):
        if not raw:
            continue
        out.append(raw)
        out.append(raw + "Feature")
        out.append(raw + "Cast")
        out.append(raw + "Ability")
        stem = raw
        for suf in SUFFIXES:
            if stem.endswith(suf) and len(stem) > len(suf):
                stem = stem[: -len(suf)]
                out.append(stem)
                out.append(stem + "Feature")
        if raw.endswith("Class"):
            out.append(raw[: -len("Class")])
        if raw.endswith("Race"):
            out.append(raw[: -len("Race")])
    seen: OrderedDict[str, None] = OrderedDict()
    for c in out:
        if c:
            seen.setdefault(c, None)
    return list(seen)


def build_icon_map(data_dir: str, sprites: set[str]) -> dict:
    """实体 id → sprite 名。返回 {byId, stats, missing}。"""
    by_id: dict[str, str] = {}
    stats: dict[str, dict] = {}
    missing: dict[str, list] = {}

    def handle(filename: str, label: str) -> None:
        path = os.path.join(data_dir, filename)
        if not os.path.exists(path):
            return
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        # mythic.json 是 {paths, selections}，取 paths
        if label == "mythic":
            entries = [(k, v) for k, v in (raw.get("paths") or {}).items()]
        else:
            entries = list(raw.items())
        hit = 0
        miss: list[str] = []
        for eid, e in entries:
            if not isinstance(e, dict):
                continue
            found = None
            for cand in candidates(e):
                if cand in sprites:
                    found = cand
                    break
            if found:
                by_id[eid] = found
                hit += 1
            elif len(miss) < 40:
                miss.append(e.get("nameEn") or e.get("name") or eid)
        total = len(entries)
        stats[label] = {"total": total, "hit": hit,
                        "pct": round(hit / total * 100, 1) if total else 0.0}
        missing[label] = miss

    handle("features.json", "features")
    handle("spells.json", "spells")
    handle("spellbooks.json", "spellbooks")
    handle("classes.json", "classes")
    handle("archetypes.json", "archetypes")
    handle("races.json", "races")
    handle("backgrounds.json", "backgrounds")
    handle("mythic.json", "mythic")
    # 规则里的技能/属性/阵营没有图标，跳过
    return {"byId": by_id, "stats": stats, "missing": missing}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", default=None)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--data", default=DEFAULT_DATA)
    ap.add_argument("--no-icons", action="store_true")
    ap.add_argument("--list-ui", action="store_true")
    ap.add_argument("--prune", action="store_true", help="删掉没被 icons.json 引用到的图标文件")
    args = ap.parse_args()

    gd = game_dir(args.game)
    if not os.path.isdir(gd):
        print(f"游戏目录不存在：{gd}", file=sys.stderr)
        return 2
    ui_dir = os.path.join(args.out, "ui")
    icon_dir = os.path.join(args.out, "icons")

    # ── 1. UI 贴图 ────────────────────────────────────────────────
    total_ui = 0
    per_file: dict[str, int] = {}
    all_ui_names: set[str] = set()
    for rel in UI_FILES:
        p = os.path.join(gd, "Wrath_Data", rel)
        if not os.path.exists(p):
            continue
        if args.list_ui:
            names = sprite_names(p)
            all_ui_names.update(names)
            per_file[rel] = len(names)
            continue
        names = sprite_names(p)
        want = set(names) - all_ui_names
        all_ui_names.update(names)
        res = save_sprites(p, ui_dir, only=want or None)
        per_file[rel] = res["written"]
        total_ui += res["written"]
        print(f"  {rel}: sprite {len(names)} 个，写出 {res['written']}（跳过 {res['skipped']}，失败 {res['failed']}）")
    if args.list_ui:
        print(json.dumps({"perFile": per_file, "unique": len(all_ui_names),
                          "names": sorted(all_ui_names)[:400]}, ensure_ascii=False, indent=1))
        return 0
    print(f"UI 贴图：{total_ui} 张 → {ui_dir}")

    report: dict = {"ui": {"written": total_ui, "perFile": per_file}}
    if args.no_icons:
        print(json.dumps(report, ensure_ascii=False, indent=1))
        return 0

    # ── 2. 内容图标 ──────────────────────────────────────────────
    bundle = os.path.join(gd, ICON_BUNDLE)
    if not os.path.exists(bundle):
        print(f"找不到图标 bundle：{bundle}", file=sys.stderr)
        return 2
    sprite_set = set(sprite_names(bundle))
    print(f"图标 bundle 里 {len(sprite_set)} 个 sprite 名")

    # ── 3. 对照表 ────────────────────────────────────────────────
    icon_map = build_icon_map(args.data, sprite_set)
    by_id = icon_map["byId"]
    used = set(by_id.values())
    print("图标对位覆盖率：")
    for label, st in icon_map["stats"].items():
        print(f"  {label:12s} {st['hit']:5d}/{st['total']:5d}  {st['pct']:5.1f}%")
    print(f"  需要导出的图标 {len(used)} / {len(sprite_set)}")

    res = save_sprites(bundle, icon_dir, only=used)
    print(f"  写出 {res['written']} 张 → {icon_dir}（失败 {res['failed']}）")

    out_json = {
        "source": os.path.basename(bundle),
        "byId": by_id,
        "stats": icon_map["stats"],
        "missing": icon_map["missing"],
        "icons": sorted(used),
    }
    json_path = os.path.join(args.data, "icons.json")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(out_json, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  对照表 → {json_path}（{os.path.getsize(json_path)} B）")

    if args.prune:
        removed = 0
        for fn in os.listdir(icon_dir):
            if fn[:-4] not in used and fn.endswith(".png"):
                os.remove(os.path.join(icon_dir, fn))
                removed += 1
        print(f"  清理未引用图标 {removed} 个")

    sizes = {}
    for d in (ui_dir, icon_dir):
        if os.path.isdir(d):
            files = os.listdir(d)
            sizes[d] = {"files": len(files),
                        "bytes": sum(os.path.getsize(os.path.join(d, f)) for f in files)}
    report.update({"icons": {"written": res["written"], "needed": len(used),
                             "available": len(sprite_set)},
                   "stats": icon_map["stats"], "sizes": sizes})
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
