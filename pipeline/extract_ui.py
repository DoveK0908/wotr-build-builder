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
# Bundles/ui 是界面自己的大 package（约 146 MB，1656 个 Sprite）。全量导出太大，只挑还在用的那几样。
#
# 说明：界面已经改成只有暗色主题一套皮，羊皮纸那套（牌匾条、书页、按钮、图标框、阵营花体字、
# 神话能力花纹框…）连同它的贴图一起弃用了。现在只剩下面这些会在暗色底上出现的东西。
UI_BUNDLE = os.path.join("Bundles", "ui")
UI_KEEP_PREFIXES = (
    "UI_Mythic_SelectPortrait_",    # 神话道途立绘横卡（13 张，神话步骤左栏）
    "UI_Mythic_SelectFrameArrow",   # 选中道途时压在卡片上的金色箭头
    "UI_CharGen_IconLike",          # 候选列表里「已经拥有了」的绿叶子
    "UI_Search_Icon",               # 列表搜索框右边的放大镜
    "UI_Icon",                      # 攻击 / 强韧 / 反射 / 意志 / 生命 等数值小图标
    "UI_CharScreen_SpellBook",      # 法术位那一行的小图标
    "UI_spellbook_v3_2_export_Icon_",  # 法术书图标（备用）
)
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
#
# 实测结论（2026-10-16，见 docs/game-ui-spec.md §6）：
#   蓝图里的 "m_Icon": {"guid": "<32hex>", "fileid": 21300000} 是 Unity 的资产引用，
#   fileid 恒为 Sprite 的类别号，guid 是 sprite 的资产 guid；但游戏安装里**没有**
#   可用的 guid → sprite 对照（Bundles 里既没有 <guid>.unit，guid 也不在
#   blueprint.assets / icons / ui 的 container 里，dependencylist.json / cheatdata.json
#   也不含它）。所以只能按名字约定对位；对不上就用「统一底纹 + 首字」占位
#   （游戏自己对背景就是这么做的）。
#   因此这里做两轮：① 原名精确匹配；② 去掉所有分隔符并小写后再匹配
#   （游戏 sprite 名会把空格写成连字符，如 "Spell-Focus"）。
ROMAN = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X")
SUFFIXES = ("FeatureSelection", "ActivatableAbility", "ParametrizedFeature", "ToggleAbility",
            "Feature", "Selection", "Progression", "Ability", "Cast", "Buff",
            "Effect", "Toggle", "Rank", "Spell", "Trait")


def norm(name: str) -> str:
    """去掉一切非字母数字并小写 —— "Spell-Focus" 与 "Spell Focus" 视为同名。"""
    return "".join(ch for ch in name.lower() if ch.isalnum())


def candidates(entry: dict) -> list[str]:
    """给一条实体记录生成候选 sprite 名（按优先级从高到低）。"""
    out: list[str] = []
    name_en = (entry.get("nameEn") or "").replace(" ", "")
    key = entry.get("key") or ""
    path = (entry.get("path") or "").replace("\\", "/")
    base = os.path.basename(path)
    if base.endswith(".jbp"):
        base = base[:-4]
    segs = [s for s in path.split("/") if s and s.lower() != "blueprints"][-4:]
    raws = [name_en, key, base] + segs
    for raw in raws:
        if not raw:
            continue
        out.append(raw)
        out.append(raw + "Feature")
        out.append(raw + "Cast")
        out.append(raw + "Ability")
        out.append(raw + "Icon")
        stem = raw
        for suf in SUFFIXES:
            if stem.endswith(suf) and len(stem) > len(suf):
                stem = stem[: -len(suf)]
                out.append(stem)
                out.append(stem + "Feature")
        for rom in ROMAN:
            if raw.endswith(rom) and len(raw) > len(rom):
                out.append(raw[: -len(rom)])
        if raw.endswith("Class"):
            out.append(raw[: -len("Class")])
        if raw.endswith("Race"):
            out.append(raw[: -len("Race")])
    seen: OrderedDict[str, None] = OrderedDict()
    for c in out:
        if c:
            seen.setdefault(c, None)
    return list(seen)


class SpriteIndex:
    """sprite 名索引：先精确（不分大小写），再忽略分隔符。"""

    def __init__(self, names):
        self.exact: dict[str, str] = {}
        self.folded: dict[str, str] = {}
        for n in names:
            self.exact.setdefault(n.lower(), n)
            self.folded.setdefault(norm(n), n)

    def find(self, cand: str) -> str | None:
        hit = self.exact.get(cand.lower())
        if hit:
            return hit
        if len(cand) >= 4:
            return self.folded.get(norm(cand))
        return None


def build_icon_map(data_dir: str, sprites) -> dict:
    """实体 id → sprite 名。返回 {byId, stats, missing}。sprites 是 SpriteIndex。"""
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
                got = sprites.find(cand)
                if got:
                    found = got
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
        want = {n for n in names if n.startswith(UI_KEEP_PREFIXES)} - all_ui_names
        all_ui_names.update(want)
        res = save_sprites(p, ui_dir, only=want or {"__none__"})
        per_file[rel] = res["written"]
        total_ui += res["written"]
        print(f"  {rel}: sprite {len(names)} 个，写出 {res['written']}（跳过 {res['skipped']}，失败 {res['failed']}）")
    if args.list_ui:
        print(json.dumps({"perFile": per_file, "unique": len(all_ui_names),
                          "names": sorted(all_ui_names)[:400]}, ensure_ascii=False, indent=1))
        return 0

    # ── 1b. Bundles/ui 里的大件（神话道途立绘卡等，按前缀挑） ──────
    ui_bundle = os.path.join(gd, UI_BUNDLE)
    if os.path.exists(ui_bundle):
        names = sprite_names(ui_bundle)
        want = {n for n in names if n.startswith(UI_KEEP_PREFIXES) and n not in all_ui_names}
        res = save_sprites(ui_bundle, ui_dir, only=want or {"__none__"})
        per_file["Bundles/ui"] = res["written"]
        total_ui += res["written"]
        print(f"  Bundles/ui: sprite {len(names)} 个 → 命中前缀 {len(want)}，写出 {res['written']}"
              f"（跳过 {res['skipped']}，失败 {res['failed']}）")
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
    icon_map = build_icon_map(args.data, SpriteIndex(sprite_set))
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
