"""武器 / 护甲的「擅长」token → 中文名。

为什么单独一个脚本：`blueprints.zip` 里的 **武器类型蓝图自己没有本地化名字**，
但物品名（精制品匕首 / 寒铁巨剑 / +1炽焰细剑）稳定带着基名，所以按物品名反推。
护甲 / 盾牌 / 天生武器没有武器类型蓝图，用游戏里的固定叫法。

用法：
    python pipeline/make_prof_cn.py                 # 默认写到 web/public/data/proficiencies.json
    python pipeline/make_prof_cn.py --out <目录>
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile

DEFAULT_GAME = r"D:\SteamLibrary\steamapps\common\Pathfinder Second Adventure"

# 护甲 / 盾牌 / 天生武器：游戏里的固定叫法
ARMOR_PROF_CN = {
    "Light": "轻甲",
    "Medium": "中甲",
    "Heavy": "重甲",
    "Buckler": "小圆盾",
    "LightShield": "轻盾",
    "HeavyShield": "重盾",
    "TowerShield": "塔盾",
    "Shield": "盾牌",
}
# 物品名反推里补不到的（只 6 种，按游戏/桌面的通行叫法手工补）
MANUAL_PROF_CN = {
    "HandCrossbow": "手弩",
    "HookedHammer": "倒钩锤",
    "Shuriken": "手里剑",
    "Siangham": "西安汉",
    "Sling": "投石索",
    "Urgrosh": "乌格罗什斧",
}
# 天生武器 / 特殊：**覆盖**物品名反推的结果（物品名常常对不上，比如 ClawType 被认成「装甲拳」）
NATURAL_PROF_CN = {
    "None": "无",
    "Slam": "挥击",
    "SlamType": "挥击",
    "Talon": "爪击",
    "Tentacle": "触手",
    "Hoof": "蹄击",
    "ClawType": "爪",
    "Bomb": "炸弹",
    "KineticBlast": "念袭",
    "Unarmed": "徒手",
    "TorchType": "火把",
    "LionsClawType": "雄狮之爪",
    "BrassGolemFalchion": "弯刃大刀",
    "DwarvenUrgroshSpearHead": "矛",
    "GnomeHookedHammerHead": "锤",
    "GnomeHookedHammerHook": "钩",
}

# 物品名前缀：剥掉这些就剩武器基名（「寒铁精制品匕首」→「匕首」）
NAME_DESC = (
    "寒铁", "精制品", "精制", "秘银", "黑曜石", "生铁", "暗木",
    "炽焰", "烈酸", "寒霜", "震电", "锐锋", "灵巧", "神圣", "公正", "雷鸣",
    "上古", "焚炎", "强碱", "烈毒", "灵能", "暴怒", "血光", "死亡", "幽影",
)
PLUS_RE = re.compile(r"^\+\d+\s*")
GUID_RE = re.compile(rb'"AssetId"\s*:\s*"([0-9a-fA-F]{32})"')


def base_weapon_name(name: str) -> tuple[str, bool]:
    """物品名剥成武器基名；第二个返回值表示剥掉过前缀（带词缀的物品名）"""
    base, stripped = name, False
    while True:
        m = PLUS_RE.match(base)
        if m:
            base, stripped = base[m.end():], True
            continue
        for pre in NAME_DESC:
            if base.startswith(pre):
                base, stripped = base[len(pre):], True
                break
        else:
            break
    return base.strip(), stripped


def localized(obj, zh: dict) -> str:
    if not isinstance(obj, dict):
        return ""
    for key in (obj.get("m_Key"), (obj.get("Shared") or {}).get("stringkey")):
        if key:
            v = zh.get(str(key).lower())
            if v:
                return v
    return ""


def main() -> None:
    ap = argparse.ArgumentParser(description="导出武器/护甲擅长的中文名")
    ap.add_argument("--game", default=os.environ.get("WOTR_GAME_DIR", DEFAULT_GAME))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "web", "public", "data"))
    a = ap.parse_args()

    zp = os.path.join(a.game, "blueprints.zip")
    loc = os.path.join(a.game, "Wrath_Data", "StreamingAssets", "Localization", "zhCN.json")
    for p in (zp, loc):
        if not os.path.exists(p):
            raise SystemExit("缺少文件：%s" % p)
    with open(loc, encoding="utf-8") as fh:
        zh = {k.lower(): v for k, v in json.load(fh)["strings"].items()}
    zf = zipfile.ZipFile(zp)
    names = zf.namelist()

    # 1) 武器类型：guid → token（就是蓝图文件名，例如 Weapons/Types/Simple/Dagger.jbp → Dagger）
    types: dict[str, str] = {}
    for n in names:
        if n.startswith("Weapons/Types/") and n.endswith(".jbp"):
            m = GUID_RE.search(zf.read(n)[:400])
            if m:
                types[m.group(1).decode().lower()] = os.path.basename(n)[:-4]
    print("  武器类型蓝图 %d 个" % len(types))

    # 2) 物品名反推基名
    counts: dict[str, dict[str, int]] = {}
    for n in names:
        if not (n.startswith("Weapons/Items/") and n.endswith(".jbp")):
            continue
        try:
            obj = json.loads(zf.read(n).decode("utf-8"))
        except Exception:
            continue
        d = (obj.get("Data") or {})
        t = d.get("m_Type")
        guid = t[4:].lower() if isinstance(t, str) and t.startswith("!bp_") else None
        token = types.get(guid) if guid else None
        if not token:
            continue
        nm = localized(d.get("m_DisplayNameText"), zh) or localized(d.get("m_DisplayName"), zh)
        if not nm:
            continue
        base, stripped = base_weapon_name(nm)
        if not base or len(base) > 8:
            continue
        bucket = counts.setdefault(token, {})
        bucket[base] = bucket.get(base, 0) + (3 if stripped else 1)

    weapon: dict[str, str] = {}
    for token in types.values():
        cand = counts.get(token) or {}
        if cand:
            weapon[token] = max(cand.items(), key=lambda kv: (kv[1], -len(kv[0])))[0]
    for token, cn in MANUAL_PROF_CN.items():
        weapon.setdefault(token, cn)
    # 天生武器与特殊项一律以这张表为准（物品名反推对它们不可靠）
    for token, cn in NATURAL_PROF_CN.items():
        weapon[token] = cn
    missing = sorted(t for t in types.values() if t not in weapon)

    out = {"weapon": weapon, "armor": ARMOR_PROF_CN}
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, "proficiencies.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("  武器中文名 %d 条，护甲 %d 条 → %s（%d 字节）"
          % (len(weapon), len(ARMOR_PROF_CN), path, os.path.getsize(path)))
    if missing:
        print("  仍缺中文名 %d 种：%s" % (len(missing), "、".join(missing[:12])))
    for token in sorted(weapon)[:8]:
        print("    %-18s %s" % (token, weapon[token]))


if __name__ == "__main__":
    sys.exit(main())
