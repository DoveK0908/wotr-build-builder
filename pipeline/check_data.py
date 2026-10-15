# -*- coding: utf-8 -*-
"""数据体检：校验 build_data.py 落盘的 web/public/data/*.json。

用法：
    python pipeline/check_data.py            # 打印报告，硬错误时退出码 1

这里只做「写出来的文件」层面的断言——引用闭包、硬校验已经在 build_data.py
内部做过一次；本脚本的作用是防止 JSON 被截断/改坏，以及回归检查。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "public", "data")

PROBLEMS: list[str] = []
NOTES: list[str] = []


def bad(msg: str) -> None:
    PROBLEMS.append(msg)


def load(name: str):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        bad("缺少文件 %s" % name)
        return None
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    rules = load("rules.json")
    classes = load("classes.json")
    archetypes = load("archetypes.json")
    features = load("features.json")
    spells = load("spells.json")
    spell_lists = load("spellLists.json")
    spellbooks = load("spellbooks.json")
    races = load("races.json")
    backgrounds = load("backgrounds.json")
    mythic = load("mythic.json")
    meta = load("meta.json")
    if PROBLEMS:
        for p in PROBLEMS:
            print("✗", p)
        return 1

    print("=" * 74)
    print("数据体检  %s" % DATA)
    print("  生成时间 %s   用时 %ss   蓝图 %d"
          % (meta.get("generated"), meta.get("seconds"), meta.get("blueprints", 0)))
    print("-" * 74)
    sizes = meta.get("sizes") or {}
    total = 0
    for k in sorted(sizes):
        total += sizes[k]
        print("  %-18s %9.1f KB" % (k, sizes[k] / 1024))
    print("  %-18s %9.1f KB" % ("合计", total / 1024))
    print("-" * 74)
    counts = meta.get("counts") or {}
    for k in counts:
        print("  %-24s %d" % (k, counts[k]))
    print("  %-24s %d" % ("features(实际)", len(features)))
    print("  %-24s %d" % ("spells(实际)", len(spells)))
    print("-" * 74)

    # ── 规模下限 ────────────────────────────────────────────────────────
    for label, got, want in (
        ("职业", len(classes), 40),
        ("种族", len(races), 12),
        ("变体", len(archetypes), 190),
        ("特性", len(features), 10000),
        ("法术", len(spells), 690),
        ("法术列表", len(spell_lists), 60),
        ("法术书", len(spellbooks), 40),
        ("背景条目", len(backgrounds), 50),
    ):
        if got < want:
            bad("%s数量异常：%d < %d" % (label, got, want))
    sel = [v for v in mythic["paths"].values() if v.get("selectable")]
    if len(sel) != 10:
        bad("可选神话道途应为 10 个，实际 %d" % len(sel))

    # ── 规则表 ──────────────────────────────────────────────────────────
    if len(rules["attributes"]) != 6:
        bad("属性应为 6 项")
    if len(rules["skills"]) != 11:
        bad("技能应为 11 项")
    if len(rules["alignments"]) != 9:
        bad("阵营应为 9 项")
    if len(rules["pointBuy"]) != 12:
        bad("点买表应为 12 档（7..18）")
    skill_ids = {s["id"] for s in rules["skills"]}
    attr_ids = {a["id"] for a in rules["attributes"]}

    # ── 职业 ────────────────────────────────────────────────────────────
    for cid, c in classes.items():
        if not c.get("name") or not c.get("nameEn"):
            bad("职业 %s 缺名字" % cid)
        if len(c.get("bab") or []) != 21:
            bad("职业 %s bab 长度不是 21" % c["name"])
        prog = c.get("progression") or []
        mx = c.get("maxLevel")
        if not isinstance(mx, int) or mx != (10 if c.get("prestige") else 20):
            bad("职业 %s 的 maxLevel 应为 %d，实际 %r"
                % (c["name"], 10 if c.get("prestige") else 20, mx))
        elif [lv["level"] for lv in prog] != list(range(1, mx + 1)):
            bad("职业 %s 的升级表不是 1..%d（%d 级）" % (c["name"], mx, len(prog)))
        cs = set(c.get("classSkills") or [])
        if not cs:
            bad("职业 %s 没有本职技能" % c["name"])
        for s in sorted(cs - skill_ids):
            bad("职业 %s 的本职技能 %s 不在技能表里" % (c["name"], s))
        if c.get("spellbookId") and c["spellbookId"] not in spellbooks:
            bad("职业 %s 的法术书没导出" % c["name"])
        for aid in c.get("archetypes") or []:
            if aid not in archetypes:
                bad("职业 %s 的变体 %s 没导出" % (c["name"], aid))
        if c.get("prestige") and (c.get("archetypes") or []):
            NOTES.append("进阶职业 %s 带变体？" % c["name"])

    # ── 变体 ────────────────────────────────────────────────────────────
    for aid, a in archetypes.items():
        if not a.get("name"):
            bad("变体 %s 缺名字" % aid)
        cls = a.get("classes") or []
        if not cls:
            bad("变体 %s（%s）没有归属职业" % (a.get("name"), a.get("path")))
        for c in cls:
            if c not in classes:
                bad("变体 %s 归属的职业 %s 不在职业表里" % (a.get("name"), c))

    # ── 特性：引用与前置 ────────────────────────────────────────────────
    known = (set(features) | set(spells) | set(classes) | set(archetypes)
             | set(races) | set(backgrounds) | set(spellbooks) | set(spell_lists)
             | {v["id"] for v in mythic["paths"].values()}
             | {v["id"] for v in mythic["selections"].values()})
    # 游戏数据里本来就存在的两处悬挂引用（一条指向不存在的蓝图、一条指向
    # 非玩家种族混种人），确认过无害，白名单放行。
    KNOWN_DANGLING = {"02b4bdf2ef7b4296923219f361caec92",
                      "daca06a3f3355664bba1e87e67f3b5b3"}
    dangling = []
    for fid, f in features.items():
        for c in f.get("choices") or []:
            if c not in known:
                dangling.append(c)
        for p in f.get("prereq") or []:
            if p.get("id") and p["id"] not in known:
                dangling.append(p["id"])
            for c in p.get("ids") or []:
                if c not in known:
                    dangling.append(c)
        for ks in f.get("knownSpells") or []:
            if ks["id"] not in known:
                dangling.append(ks["id"])
        for lid in f.get("spellLists") or []:
            if lid not in known:
                dangling.append(lid)
    for aid, a in archetypes.items():
        for key in ("addFeatures", "removeFeatures"):
            for lv in a.get(key) or []:
                for x in lv["features"]:
                    if x not in known:
                        dangling.append(x)
    for cid, c in classes.items():
        for lv in (c.get("progression") or []):
            for x in lv["features"]:
                if x not in known:
                    dangling.append(x)
    unknown = sorted(set(dangling) - KNOWN_DANGLING)
    if unknown:
        bad("引用里有 %d 处指向不存在的东西：%s" % (len(unknown), unknown[:8]))

    # ── 法术 ────────────────────────────────────────────────────────────
    miss_level = [s for s in spells.values()
                  if not (s.get("levels") or s.get("mythicLevels") or "listLevel" in s)]
    if miss_level:
        bad("%d 条法术没有任何等级" % len(miss_level))
    for sid, s in spells.items():
        for cid, lvl in (s.get("levels") or {}).items():
            if cid not in classes:
                bad("法术 %s 的等级挂在未知职业 %s 上" % (s.get("name"), cid))
            if not isinstance(lvl, int) or not 0 <= lvl <= 10:
                bad("法术 %s 的环位异常：%r" % (s.get("name"), lvl))
        for cid in (s.get("mythicLevels") or {}):
            if cid not in {v["id"] for v in mythic["paths"].values()}:
                bad("法术 %s 的神话等级挂在未知道途 %s 上" % (s.get("name"), cid))

    # ── 文本：不能残留 Owlcat 富文本标记 ─────────────────────────────────
    tag = re.compile(r"\{[a-z]\|")
    markups = 0
    for coll in (classes, archetypes, features, spells, races, backgrounds):
        for e in coll.values():
            for key in ("name", "desc", "short"):
                if tag.search(str(e.get(key) or "")):
                    markups += 1
    if markups:
        bad("有 %d 处文本残留 {g|...} 之类的富文本标记" % markups)

    # ── 点名抽检 ────────────────────────────────────────────────────────
    by_name = {}
    for f in features.values():
        by_name.setdefault(f.get("name"), f)
    pa = by_name.get("猛力攻击")
    if not pa:
        bad("找不到专长「猛力攻击」")
    else:
        got = [(p.get("k"), p.get("stat"), p.get("v")) for p in (pa.get("prereq") or [])]
        if ("stat", "Strength", 13) not in got:
            bad("猛力攻击的前置不是力量 13：%r" % got)

    wis = classes.get("ba34257984f4c41408ce1dc2004e342e") or {}
    if (wis.get("bab") or [None] * 21)[20] != 10:
        bad("法师 20 级 BAB 应为 10，实际 %r" % (wis.get("bab") or [None] * 21)[20])
    fig = classes.get("48ac8db94d5de7645906c7d0ad3bcfbd") or {}
    if (fig.get("bab") or [None] * 21)[20] != 20:
        bad("战士 20 级 BAB 应为 20")

    fireball = [s for s in spells.values() if s.get("name") == "火球术"]
    if not fireball:
        bad("找不到法术「火球术」")
    elif not any((s.get("levels") or {}).get("ba34257984f4c41408ce1dc2004e342e") == 3
                 for s in fireball):
        bad("火球术不在法师 3 环：%r"
            % [(s.get("path"), s.get("levels")) for s in fireball])

    mirror = [s for s in spells.values() if s.get("name") == "镜影术"]
    if not mirror:
        bad("找不到法术「镜影术」")
    elif not any((s.get("levels") or {}).get("ba34257984f4c41408ce1dc2004e342e") == 2
                 for s in mirror):
        bad("镜影术不在法师 2 环")

    # ── 输出 ────────────────────────────────────────────────────────────
    print("可选神话道途：%s" % "、".join(sorted(v["name"] for v in sel)))
    print("种族：%s" % "、".join(sorted(r["name"] for r in races.values())))
    print("专长/特性分组前 12：")
    grp: dict = {}
    for f in features.values():
        for gr in f.get("groups") or []:
            grp[gr] = grp.get(gr, 0) + 1
    for k, v in sorted(grp.items(), key=lambda kv: -kv[1])[:12]:
        print("    %-28s %d" % (k, v))
    print("法术列表（前 8）：")
    for lid, L in list(spell_lists.items())[:8]:
        kinds = sum(len(v) for v in L["levels"].values())
        print("    %-34s 环位 %d 个 / 法术 %d 条  %s"
              % (L.get("name") or "(无名)", len(L["levels"]), kinds,
                 ",".join(sorted(L["levels"])[:4])))
    print("-" * 74)
    for n in NOTES:
        print("  ·", n)
    if PROBLEMS:
        print("✗ 体检不通过，共 %d 项：" % len(PROBLEMS))
        for p in PROBLEMS:
            print("   -", p)
        return 1
    print("✓ 体检通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
