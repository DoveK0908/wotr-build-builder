# -*- coding: utf-8 -*-
"""《开拓者：正义之怒》数据管线 v2

把本机游戏安装（blueprints.zip + 官方 zhCN.json / enGB.json）导成网页版
构筑规划器需要的静态 JSON，输出到 web/public/data/。

用法：
    python pipeline\\build_data.py
    python pipeline\\build_data.py --game "D:\\...\\Pathfinder Second Adventure" --out web\\public\\data

设计要点
--------
* 权威名单来自 Root/BlueprintRoot.jbp 的 Progression 字段：
    m_CharacterClasses (40) / m_CharacterMythics (14) / m_CharacterRaces (12)
  这是游戏自己给出的角色创建可选清单，比用启发式过滤可靠。
* 类型识别只用蓝图 Data.$type（形如 "<guid>, BlueprintFeature"）。
* 本地化解析顺序：m_Key → Shared.stringkey → 沿 PrototypeLink 上溯。
  Shared.assetguid 不是本地化键。
* 法术只收录「玩家职业法术书里真正出现过的法术」，避免剧本/怪物专用的重名法术。
* 收尾做引用来路自检：任何升级表 / 选择表 / 前置条件引用到但没导出的蓝图都会被报出来。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import zipfile
from collections import Counter, OrderedDict

DEFAULT_GAME = r"D:\SteamLibrary\steamapps\common\Pathfinder Second Adventure"

# ── 蓝图类型 ────────────────────────────────────────────────────────────────
FEATURE_TYPES = {
    "BlueprintFeature",
    "BlueprintFeatureSelection",
    "BlueprintParametrizedFeature",
    "BlueprintProgression",
    "BlueprintActivatableAbility",
    "BlueprintAbility",
    # 神话道途用这类特性把道途法术书并入职业法术书（天使/巫妖）
    "BlueprintFeatureReplaceSpellbook",
    "BlueprintFeatureSelectMythicSpellbook",
}
CLASS_TYPES = {"BlueprintCharacterClass", "BlueprintArchetype", "BlueprintRace"}
MISC_TYPES = {
    "BlueprintSpellbook",
    "BlueprintSpellList",
    "BlueprintSpellsTable",
    "BlueprintStatProgression",
    "BlueprintAbilityResource",
    "BlueprintUnitFact",
}
INTERESTING = FEATURE_TYPES | CLASS_TYPES | MISC_TYPES

# 允许出现在 features.json 里的顶层目录（其余一律不算「特性」）
FEATURE_DIRS = (
    "Classes/",
    "Feats/",
    "Mythic/",
    "Backgrounds/",
    "Races/",
    "Traits/",
    "CreatureAbilities/",
    "Buffs/",
    "Weapons/Types/Special/",
    "Spells/Level0/",
)

# 技能的枚举名 → 本地化/显示规则。SkillThievery 是游戏里巧手的另一个枚举名，
# CheckIntimidate 不是技能（是威吓检定），直接丢弃。
SKILL_ALIAS = {"SkillThievery": "SkillTrickery"}
SKILL_DROP = {"CheckIntimidate"}

ATTR_ORDER = [
    ("Strength", "力量", "STR"),
    ("Dexterity", "敏捷", "DEX"),
    ("Constitution", "体质", "CON"),
    ("Intelligence", "智力", "INT"),
    ("Wisdom", "感知", "WIS"),
    ("Charisma", "魅力", "CHA"),
]
SKILL_ORDER = [
    ("SkillAthletics", "运动", "Athletics"),
    ("SkillKnowledgeArcana", "知识：神秘", "Knowledge (arcana)"),
    ("SkillKnowledgeWorld", "知识：世界", "Knowledge (world)"),
    ("SkillLoreNature", "学识：自然", "Lore (nature)"),
    ("SkillLoreReligion", "学识：宗教", "Lore (religion)"),
    ("SkillMobility", "灵巧", "Mobility"),
    ("SkillPerception", "察觉", "Perception"),
    ("SkillPersuasion", "沟通", "Persuasion"),
    ("SkillStealth", "隐匿", "Stealth"),
    ("SkillTrickery", "巧手", "Trickery"),
    ("SkillUseMagicDevice", "使用魔法装置", "Use Magic Device"),
]
ALIGNMENTS = [
    ("LawfulGood", "守序善良"),
    ("LawfulNeutral", "守序中立"),
    ("LawfulEvil", "守序邪恶"),
    ("NeutralGood", "中立善良"),
    ("TrueNeutral", "绝对中立"),
    ("NeutralEvil", "中立邪恶"),
    ("ChaoticGood", "混乱善良"),
    ("ChaoticNeutral", "混乱中立"),
    ("ChaoticEvil", "混乱邪恶"),
]
# 标准 Pathfinder 25 点购买表（游戏数据里没有这张表，硬编码）
POINT_BUY = {7: -4, 8: -2, 9: -1, 10: 0, 11: 1, 12: 2, 13: 3, 14: 5, 15: 7, 16: 10, 17: 13, 18: 17}
MYTHIC_PATH_NAMES = {"GoldenDragonClass": "金龙"}  # 蓝图里 LocalizedName 为空
# 玩家真正能选的神话道途（m_CharacterMythics 里还混着「神话英雄/神话伙伴」和
# 传奇的假职业 FakeLegendClass，这些不是可选道途）
MYTHIC_PLAYER_KEYS = {
    "AngelMythicClass", "LichMythicClass", "AzataMythicClass", "AeonMythicClass",
    "DemonMythicClass", "TricksterMythicClass", "SwarmThatWalksClass", "LegendClass",
    "DevilMythicClass", "GoldenDragonClass",
}
# 只属于同伴、玩家角色创建时选不到的背景
BACKGROUND_COMPANION_ONLY = {
    "BackgroundRekarthDLC2", "Penta_Numerian_Background",
}

TYPE_RE = re.compile(rb'"\$type"\s*:\s*"([0-9a-fA-F]{32}),\s*([A-Za-z]+)"')
GUID_RE = re.compile(rb'"AssetId"\s*:\s*"([0-9a-fA-F]{32})"')

# ── 前置条件组件 ────────────────────────────────────────────────────────────
PREREQ_KINDS = {
    "PrerequisiteFeature": "feat",
    "PrerequisiteNoFeature": "nofeat",
    "PrerequisiteFeaturesFromList": "oneof",
    "PrerequisiteStatValue": "stat",
    "PrerequisiteFullStatValue": "statfull",
    "PrerequisiteClassLevel": "clvl",
    "PrerequisiteNoClassLevel": "nocl",
    "PrerequisiteArchetypeLevel": "alvl",
    "PrerequisiteNoArchetype": "noarch",
    "PrerequisiteProficiency": "prof",
    "PrerequisiteNotProficient": "notprof",
    "PrerequisiteAlignment": "align",
    "PrerequisiteCharacterLevel": "chlvl",
    "PrerequisiteClassSpellLevel": "classspell",
    "PrerequisiteAnySpellsInSpellbook": "spellbook",
    "PrerequisiteParametrizedFeature": "paramfeat",
    "PrerequisiteCasterTypeSpellLevel": "casterspell",
    "PrerequisiteCasterType": "castertype",
    "PrerequisiteCondition": "condition",
    "PrerequisiteIsPet": "ispet",
    "PrerequisitePet": "pet",
    "PrerequisiteSelectionPossible": "selpossible",
    "PrerequisitePlayerHasFeature": "hasfeature",
    "PrerequisiteConditionForWeaponCategory": "weaponcond",
    "PrerequisiteParametrizedWeaponSubcategory": "paramweapon",
    "ClassLevelsForPrerequisites": "classlevels",
    "ReplaceStatForPrerequisites": "replacestat",
    # 后三类 2026-10 补：原先被静默丢掉（神话等级门槛、主角/同伴限定、剧情 etude）
    "PrerequisiteMythicLevel": "mrank",
    "PrerequisiteMainCharacter": "mainchar",
    "PrerequisiteEtude": "etude",
}


def strip_markup(s: str | None) -> str:
    """去掉 Owlcat 的内联标记，留下可读文本。"""
    if not s:
        return ""
    s = s.replace("\\n", "\n")
    s = re.sub(r"\{[gdbcp]?\|[^{}]*\}", "", s)      # {g|Encyclopedia:X} {d|...}
    s = re.sub(r"\{/\w+\}", "", s)                   # {/g}
    s = re.sub(r"\{[^{}]{0,120}\}", "", s)           # 其余花括号宏
    s = s.replace("\u00a0", " ").replace("\u200b", "")
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def ref(x) -> str | None:
    """把 '!bp_<guid>' 或 {'guid': ...} 统一成小写 guid。"""
    if isinstance(x, str) and x.startswith("!bp_"):
        return x[4:].lower()
    if isinstance(x, dict) and isinstance(x.get("guid"), str):
        return x["guid"].lower()
    return None


def refs(x) -> list[str]:
    if not isinstance(x, list):
        return []
    out = []
    for it in x:
        g = ref(it)
        if g:
            out.append(g)
    return out


def level_entries(lst) -> list[dict]:
    """[{'Level':N,'m_Features':[...]}] → [{'level':N,'features':[guid...]}]"""
    out = []
    for e in lst or []:
        if not isinstance(e, dict):
            continue
        out.append({"level": e.get("Level"), "features": refs(e.get("m_Features"))})
    return sorted(out, key=lambda e: (e["level"] is None, e["level"]))


def pad_levels(entries: list, mx: int) -> list[dict]:
    """把稀疏的 LevelEntries 补成 1..mx 每一级都有一条（缺的给空表）。

    游戏数据里只登记「有内容」的等级：巫师只有 1,2,4,6…20 这 11 条，
    进阶职业只有 1..10。前端按等级渲染时需要一个完整、连续的数组。
    """
    by = {}
    for e in entries or []:
        lv = e.get("level")
        if isinstance(lv, int):
            by[lv] = e.get("features") or []
    return [{"level": i, "features": by.get(i, [])} for i in range(1, mx + 1)]


class Game:
    def __init__(self, game_dir: str):
        self.dir = game_dir
        self.zip = os.path.join(game_dir, "blueprints.zip")
        loc = os.path.join(game_dir, "Wrath_Data", "StreamingAssets", "Localization")
        self.zh_file = os.path.join(loc, "zhCN.json")
        self.en_file = os.path.join(loc, "enGB.json")
        for p in (self.zip, self.zh_file, self.en_file):
            if not os.path.exists(p):
                raise SystemExit("缺少文件：%s" % p)
        self.zf = zipfile.ZipFile(self.zip)
        self._data: dict[str, dict] = {}
        self.guid_path: dict[str, str] = {}
        self.types: dict[str, str] = {}
        self.skip_deleted = 0
        self.parse_errors = 0
        self.no_type = 0

    # ── 载入 ────────────────────────────────────────────────────────────
    def index(self) -> None:
        t0 = time.time()
        for name in self.zf.namelist():
            if not name.endswith(".jbp"):
                continue
            head = self.zf.read(name)[:900]
            m = GUID_RE.search(head)
            if not m:
                self.parse_errors += 1
                continue
            g = m.group(1).decode().lower()
            self.guid_path[g] = name
            t = TYPE_RE.search(head)
            if t:
                self.types[g] = t.group(2).decode()
            else:
                self.no_type += 1
        print("  蓝图索引：%d 个 AssetId（头部认不出类型的 %d 个），%.1fs"
              % (len(self.guid_path), self.no_type, time.time() - t0))

    def locale(self, path: str) -> dict:
        with open(path, encoding="utf-8") as fh:
            return {k.lower(): v for k, v in json.load(fh)["strings"].items()}

    # ── 读取 ────────────────────────────────────────────────────────────
    def raw(self, path: str) -> dict | None:
        if path in self._data:
            return self._data[path]
        try:
            obj = json.loads(self.zf.read(path).decode("utf-8"))
        except Exception:
            self.parse_errors += 1
            obj = None
        if isinstance(obj, dict) and (obj.get("Meta") or {}).get("ShadowDeleted"):
            self.skip_deleted += 1
            obj = None
        self._data[path] = obj
        return obj

    def data(self, path: str) -> dict:
        obj = self.raw(path)
        return (obj or {}).get("Data") or {}

    def by_guid(self, g: str) -> dict:
        p = self.guid_path.get(g)
        return self.data(p) if p else {}

    def path_of(self, g: str) -> str | None:
        return self.guid_path.get(g)

    def type_of(self, g: str) -> str:
        t = self.types.get(g)
        if t:
            return t
        p = self.guid_path.get(g)
        if not p:
            return ""
        d = self.data(p)
        t = str(d.get("$type") or "").split(", ")[-1]
        self.types[g] = t
        return t

    # ── 本地化 ──────────────────────────────────────────────────────────
    def text(self, obj, locale: dict, depth: int = 0) -> str:
        """LocalizedString → 文本；必要时沿 PrototypeLink 上溯。"""
        if not isinstance(obj, dict):
            return ""
        for key in (obj.get("m_Key"), (obj.get("Shared") or {}).get("stringkey")):
            if key:
                v = locale.get(str(key).lower())
                if v:
                    return v
        if depth < 4:
            link = ref(obj.get("PrototypeLink"))
            if link:
                d = self.by_guid(link)
                for field in ("LocalizedName", "m_DisplayName", "LocalizedDescription", "m_Description"):
                    if field in d:
                        v = self.text(d.get(field), locale, depth + 1)
                        if v:
                            return v
        return ""

    def name(self, d: dict, locale: dict) -> str:
        for f in ("LocalizedName", "m_DisplayName"):
            v = self.text(d.get(f), locale)
            if v:
                return strip_markup(v)
        return ""


class Extractor:
    def __init__(self, game: Game):
        self.g = game
        self.zh = game.locale(game.zh_file)
        self.en = game.locale(game.en_file)
        self.out: dict[str, dict] = {}
        self.warn: list[str] = []
        self.missing: Counter = Counter()

    # ── 通用小工具 ──────────────────────────────────────────────────────
    def nm(self, d: dict) -> tuple[str, str]:
        return self.g.name(d, self.zh), self.g.name(d, self.en)

    def desc(self, d: dict, field: str = "LocalizedDescription") -> str:
        for f in (field, "LocalizedDescriptionShort", "m_Description"):
            v = self.g.text(d.get(f), self.zh)
            if v:
                return strip_markup(v)[:800]
        return ""

    def title(self, d: dict) -> str:
        for f in ("LocalizedName", "m_DisplayName"):
            v = self.g.text(d.get(f), self.zh)
            if v:
                return strip_markup(v)[:200]
        return ""

    def require(self, g: str, why: str) -> dict:
        if g not in self.g.guid_path:
            self.missing[g] += 1
            return {}
        return self.g.by_guid(g)

    # ── 前置条件 ────────────────────────────────────────────────────────
    # ── 前置里的「条件」组件 ────────────────────────────────────────────
    # PrerequisiteCondition 挂的是一个 ContextCondition* 对象：
    #   OrAndLogic{Operation: And/Or, ConditionsChecker:{Conditions:[...]}}
    #   ContextConditionHasFact{m_Fact, Not}           → 有没有某个特性
    #   ContextConditionCharacterClass{m_Class, MinLevel, Not} → 某职业等级
    # 这里把它们压成 {op, not, conds:[{t:"fact"|"class", id, min?, not}]}，
    # 前端就能真的算出来，而不是一律显示「条件复杂」。
    def condition_tree(self, c) -> dict | None:
        if not isinstance(c, dict):
            return None
        t = (c.get("$type") or "").split(", ")[-1]
        not_ = bool(c.get("Not"))
        if t == "OrAndLogic":
            chk = c.get("ConditionsChecker") or {}
            subs = [self.condition_tree(x) for x in (chk.get("Conditions") or [])]
            subs = [x for x in subs if x]
            if not subs:
                return None
            return {"op": str(chk.get("Operation") or "And").lower(), "not": not_, "conds": subs}
        if t == "ContextConditionHasFact":
            fid = ref(c.get("m_Fact"))
            return {"t": "fact", "id": fid, "not": not_} if fid else None
        if t == "ContextConditionCharacterClass":
            cid = ref(c.get("m_Class"))
            lvl = c.get("MinLevel")
            if not cid:
                return None
            return {"t": "class", "id": cid, "min": lvl if isinstance(lvl, int) else 1, "not": not_}
        if t == "ContextConditionAlignment":
            return {"t": "align", "v": str(c.get("Alignment") or ""), "not": not_}
        if t == "ContextConditionBuffRank":
            # UseFactInsteadBuff: 该「特性」的层数（= 拿了几遍）要 ≥ RankValue
            src = c.get("Fact") if c.get("UseFactInsteadBuff") else c.get("Buff")
            rv = (c.get("RankValue") or {}).get("Value")
            fid = ref(src)
            if fid and isinstance(rv, int):
                return {"t": "factrank", "id": fid, "min": rv, "not": not_}
        if t == "IsUnitMythicLevel" and c.get("CheckMinLevel"):
            mn = (c.get("MinLevel") or {}).get("Value")
            if isinstance(mn, int):
                return {"t": "mrank", "min": mn, "not": not_}
        return {"t": "other", "type": t, "not": not_}

    def prereqs(self, d: dict) -> list[dict]:
        out = []
        for c in d.get("Components") or []:
            if not isinstance(c, dict):
                continue
            t = (c.get("$type") or "").split(", ")[-1]
            kind = PREREQ_KINDS.get(t)
            if not kind:
                continue
            p = {"k": kind, "group": c.get("Group") or "All", "hide": bool(c.get("HideInUI"))}
            if kind in ("feat", "nofeat", "paramfeat", "hasfeature"):
                p["id"] = ref(c.get("m_Feature"))
            elif kind == "oneof":
                p["ids"] = refs(c.get("m_Features"))
                p["amount"] = c.get("Amount")
            elif kind in ("stat", "statfull"):
                p["stat"] = c.get("Stat")
                p["v"] = c.get("Value")
                p["full"] = kind == "statfull"
            elif kind in ("clvl", "nocl", "classspell"):
                p["class"] = ref(c.get("m_CharacterClass"))
                if kind == "clvl":
                    p["v"] = c.get("Level")
                    p["not"] = bool(c.get("Not"))
                if kind == "classspell":
                    p["v"] = c.get("RequiredSpellLevel")
            elif kind == "alvl":
                p["class"] = ref(c.get("m_CharacterClass"))
                p["arch"] = ref(c.get("m_Archetype"))
                p["v"] = c.get("Level")
            elif kind == "noarch":
                p["class"] = ref(c.get("m_CharacterClass"))
                p["arch"] = ref(c.get("m_Archetype"))
            elif kind in ("prof", "notprof"):
                p["armor"] = list(c.get("ArmorProficiencies") or [])
                p["weapon"] = list(c.get("WeaponProficiencies") or [])
            elif kind == "align":
                p["v"] = [s.strip() for s in str(c.get("Alignment") or "").split(",") if s.strip()]
            elif kind == "chlvl":
                p["v"] = c.get("Level")
            elif kind == "casterspell":
                p["arcane"] = bool(c.get("IsArcane"))
                p["spont"] = bool(c.get("OnlySpontaneous"))
                p["v"] = c.get("RequiredSpellLevel")
            elif kind == "condition":
                p["cond"] = self.condition_tree(c.get("Condition"))
            elif kind == "castertype":
                p["arcane"] = bool(c.get("IsArcane"))
            elif kind == "classlevels":
                p["fake"] = ref(c.get("m_FakeClass"))
                p["class"] = ref(c.get("m_ActualClass"))
                p["mod"] = c.get("Modifier")
                p["sum"] = c.get("Summand")
            elif kind == "replacestat":
                p["old"] = c.get("OldStat")
                p["new"] = c.get("NewStat")
                p["class"] = ref(c.get("m_CharacterClass"))
            elif kind == "selpossible":
                p["id"] = ref(c.get("m_FeatureSelection"))
            elif kind == "paramweapon":
                p["id"] = ref(c.get("m_Feature"))
                p["sub"] = c.get("WeaponSubCategory")
            elif kind == "weaponcond":
                cond = c.get("Condition")
                if cond is not None:
                    p["raw"] = json.dumps(cond, ensure_ascii=False)[:300]
            elif kind == "mrank":
                p["v"] = c.get("Level")
            elif kind == "mainchar":
                p["companion"] = bool(c.get("Companion"))
            elif kind == "etude":
                p["id"] = ref(c.get("Etude"))
            out.append(p)
        return out

    # ── 特性 ────────────────────────────────────────────────────────────
    def feature_entry(self, g: str) -> dict:
        d = self.require(g, "feature")
        if not d:
            return {"id": g, "name": "", "nameEn": "", "missing": True}
        zn, en = self.nm(d)
        t = self.g.type_of(g)
        e = {
            "id": g,
            "name": zn,
            "nameEn": en,
            "type": t.replace("Blueprint", "").lower(),
            "path": self.g.path_of(g),
        }
        desc = self.desc(d)
        if desc:
            e["desc"] = desc
        groups = d.get("Groups")
        if groups:
            e["groups"] = groups
        if d.get("Ranks"):
            e["ranks"] = d["Ranks"]
        if t in ("BlueprintFeatureSelection", "BlueprintParametrizedFeature"):
            ch = refs(d.get("m_AllFeatures"))
            if ch:
                e["choices"] = ch
        if t == "BlueprintParametrizedFeature":
            e["param"] = d.get("ParameterType")
            if d.get("WeaponSubCategory"):
                e["paramSub"] = d["WeaponSubCategory"]
        if t == "BlueprintProgression":
            e["progression"] = level_entries(d.get("LevelEntries"))
        if t == "BlueprintActivatableAbility":
            e["activatable"] = True
        if t == "BlueprintAbility":
            e["ability"] = True
        if t in ("BlueprintFeatureReplaceSpellbook", "BlueprintFeatureSelectMythicSpellbook"):
            e["spellbookFeature"] = True
            nsb = ref(d.get("m_Spellbook")) or ref(d.get("m_ReplaceSpellbook"))
            if nsb:
                e["newSpellbook"] = nsb
            allowed = refs(d.get("m_AllowedSpellbooks"))
            if allowed:
                e["allowedSpellbooks"] = allowed
            mlist = ref(d.get("m_MythicSpellList"))
            if mlist:
                e["mythicSpellList"] = mlist
        icon = d.get("m_Icon")
        if isinstance(icon, dict) and icon.get("guid"):
            e["icon"] = icon["guid"].lower()
        pr = self.prereqs(d)
        if pr:
            e["prereq"] = pr
        # 这个槽位本身不检查候选的前置条件（战士/牧师的额外专长类槽位等，88 个）
        if d.get("IgnorePrerequisites"):
            e["ignorePrereq"] = True
        if t == "BlueprintParametrizedFeature" and d.get("IgnoreParameterFeaturePrerequisites"):
            e["ignoreParamPrereq"] = True
        if d.get("IsClassFeature"):
            e["classFeature"] = True
        sb = self.stat_bonuses(d)
        if sb:
            e["statBonuses"] = sb
        sp = self.skill_points(d)
        if sp:
            e["skillPointsPerLevel"] = sp
        pf = self.proficiencies(d)
        if pf:
            e["proficiencies"] = pf
        # AddFacts：组件级「顺带给你这些特性」——职业的擅长就是这么来的
        # （FighterProficiencies 只挂 AddFacts，真正给擅长的是它引用的那些擅长特性）
        facts: list[str] = []
        for c in d.get("Components") or []:
            t = str(c.get("$type") or "").split(", ")[-1]
            if t == "AddFacts":
                for x in c.get("m_Facts") or []:
                    r = ref(x)
                    if r and r not in facts:
                        facts.append(r)
        if facts:
            e["addFacts"] = facts
        gr = self.grants(d)
        if gr:
            e.update(gr)
        return e

    # ── 属性/技能加值、每级技能点、熟练（全部来自组件，纯数据）───────────
    STAT_COMPONENTS = ("AddStatBonus", "AddStatBonusIfHasFact",
                       "AddStatBonusFromClassLevel")

    def stat_bonuses(self, d: dict) -> list[dict]:
        """种族属性调整、专长给的点数等都在组件里。stat 可能是属性名
        （Dexterity）、技能枚举名（SkillPerception）或别的（Speed），
        这里原样导出，由前端按 rules.json 决定怎么用。"""
        out: list[dict] = []
        for c in d.get("Components") or []:
            t = str(c.get("$type") or "").split(", ")[-1]
            if t not in self.STAT_COMPONENTS:
                continue
            stat = c.get("Stat")
            val = c.get("Value")
            if isinstance(val, dict):          # AddStatBonusIfHasFact 把值包了一层
                val = val.get("Value")
            if not isinstance(stat, str) or not isinstance(val, int) or not val:
                continue
            e = {"stat": stat, "value": val}
            if t.endswith("IfHasFact"):
                e["cond"] = True
            out.append(e)
        return out

    def skill_points(self, d: dict) -> int:
        n = 0
        for c in d.get("Components") or []:
            t = str(c.get("$type") or "").split(", ")[-1]
            if t in ("AddSkillPointPerCharacterLevel", "AddSkillPointPerLevel"):
                v = c.get("Value", c.get("m_Value", 1))
                if isinstance(v, int):
                    n += v
        return n

    def proficiencies(self, d: dict) -> dict:
        out: dict = {}
        for c in d.get("Components") or []:
            t = str(c.get("$type") or "").split(", ")[-1]
            if t != "AddProficiencies":
                continue
            arm = c.get("ArmorProficiencies") or c.get("ArmorProficiency") or []
            wep = c.get("WeaponProficiencies") or c.get("WeaponProficiency") or []
            if isinstance(arm, str):
                arm = [arm]
            if isinstance(wep, str):
                wep = [wep]
            for x in arm:
                out.setdefault("armor", [])
                if x not in out["armor"]:
                    out["armor"].append(x)
            for x in wep:
                out.setdefault("weapon", [])
                if x not in out["weapon"]:
                    out["weapon"].append(x)
        return out

    # ── 特性通过组件授予的法术 / 法术列表 ───────────────────────────────
    KNOWN_ONE = ("AddKnownSpell", "AddSpellKnownTemporary")
    KNOWN_MANY = ("LearnSpells", "AddSpellsToDescription")
    LIST_COMP = ("AddSpecialSpellList", "AddSpecialSpellListForArchetype",
                 "LearnSpellList", "LearnSpellParametrized")

    def grants(self, d: dict) -> dict:
        known: list = []
        lists: list = []
        for c in d.get("Components") or []:
            t = str(c.get("$type") or "").split(", ")[-1]
            if t in self.KNOWN_ONE:
                sid = ref(c.get("m_Spell"))
                if sid:
                    known.append({"id": sid, "level": c.get("SpellLevel") or 0})
            elif t in self.KNOWN_MANY:
                for sid in refs(c.get("m_Spells")):
                    known.append({"id": sid, "level": c.get("SpellLevel") or 0})
            elif t in self.LIST_COMP:
                lid = ref(c.get("m_SpellList"))
                if lid and lid not in lists:
                    lists.append(lid)
        out: dict = {}
        if known:
            out["knownSpells"] = known
        if lists:
            out["spellLists"] = lists
        return out

    # ── 法术 ────────────────────────────────────────────────────────────
    def spell_entry(self, g: str) -> dict:
        d = self.require(g, "spell")
        if not d:
            return {"id": g, "name": "", "nameEn": "", "missing": True}
        zn, en = self.nm(d)
        e = {"id": g, "name": zn, "nameEn": en, "path": self.g.path_of(g)}
        desc = self.desc(d)
        if desc:
            e["desc"] = desc
        short = self.g.text(d.get("m_DescriptionShort"), self.zh)
        if short:
            e["short"] = strip_markup(short)[:300]

        # 游戏「法术详情」那一栏的字段：类型/射程/施法时间/持续时间/法术抗力/豁免检定
        for k, f in (("type", "Type"), ("range", "Range"), ("action", "ActionType")):
            v = d.get(f)
            if isinstance(v, str) and v:
                e[k] = v
        if d.get("SpellResistance"):
            e["sr"] = True
        if d.get("m_IsFullRoundAction") or d.get("IsFullRound"):
            e["fullRound"] = True
        if isinstance(d.get("MaterialComponent"), dict) and (d["MaterialComponent"] or {}).get("Count"):
            e["material"] = True
        dur = self.g.text(d.get("LocalizedDuration"), self.zh)
        if dur:
            e["duration"] = strip_markup(dur)[:120]
        sv = self.g.text(d.get("LocalizedSavingThrow"), self.zh)
        if sv:
            e["saveText"] = strip_markup(sv)[:120]

        # 目标：能打谁 + 能否指定地点（游戏里显示成「1个敌方生物 近距」）
        tgt = {}
        for key, flag in (("enemies", "CanTargetEnemies"), ("friends", "CanTargetFriends"),
                          ("self", "CanTargetSelf"), ("point", "CanTargetPoint")):
            if d.get(flag):
                tgt[key] = True
        if tgt:
            e["targets"] = tgt

        # 这些都在 Components[] 里，不是蓝图根字段
        comps = d.get("Components") or []
        for c in comps:
            t = str(c.get("$type", "")).split(",")[-1].strip()
            if t == "SpellComponent":
                if c.get("School"):
                    e["school"] = c["School"]
            elif t == "SpellDescriptorComponent":
                val = c.get("Descriptor")
                if isinstance(val, dict):
                    val = val.get("m_IntValue")
                if val:
                    e["descriptor"] = val
            elif t == "AbilityTargetsAround":
                rad = (c.get("m_Radius") or {}).get("m_Value")
                if rad:
                    e["radius"] = round(float(rad), 1)
                if c.get("m_TargetType") and c["m_TargetType"] != "Any":
                    e["areaTarget"] = c["m_TargetType"]
            elif t == "AbilityEffectRunAction" and c.get("SavingThrowType"):
                e["save"] = c["SavingThrowType"]
        e["components"] = len(comps)
        if d.get("IsMythic"):
            e["mythic"] = True
        return e


def build(game_dir: str, out_dir: str) -> dict:
    t_all = time.time()
    print("游戏目录：%s" % game_dir)
    g = Game(game_dir)
    print("[1/6] 建立 AssetId / 类型索引…")
    g.index()

    ex = Extractor(g)
    root = g.data("Root/BlueprintRoot.jbp")
    if not root:
        raise SystemExit("读不到 Root/BlueprintRoot.jbp")
    prog = root.get("Progression") or {}
    class_ids = refs(prog.get("m_CharacterClasses"))
    mythic_ids = refs(prog.get("m_CharacterMythics"))
    race_ids = refs(prog.get("m_CharacterRaces"))
    print("  权威名单：职业 %d / 神话 %d / 种族 %d" % (len(class_ids), len(mythic_ids), len(race_ids)))

    # 角色通用的升级表（每个角色都会走一遍）：奇数级给通用专长，
    # 另外 1 级还带「选择背景」「神祇选择」等槽位。
    char_prog_id = ref(prog.get("m_FeatsProgression"))
    basic_feat_sel = ref(prog.get("m_BasicFeatSelection"))
    deity_sel = ref(prog.get("m_DeitySelection"))
    char_prog: list[dict] = []
    if char_prog_id:
        d = g.by_guid(char_prog_id)
        if d:
            char_prog = pad_levels(level_entries(d.get("LevelEntries")), 20)
            print("  角色通用升级表 %s：%d 级（奇数级给通用专长）"
                  % (os.path.basename(g.path_of(char_prog_id) or "?"), len(char_prog)))
        else:
            ex.warn.append("角色通用升级表 %s 找不到蓝图" % char_prog_id)

    stats: dict[str, object] = {}
    classes: "OrderedDict[str, dict]" = OrderedDict()
    archetypes: "OrderedDict[str, dict]" = OrderedDict()
    features: "OrderedDict[str, dict]" = OrderedDict()
    spells: "OrderedDict[str, dict]" = OrderedDict()
    races: "OrderedDict[str, dict]" = OrderedDict()

    def skill_list(d: dict) -> list[str]:
        out = []
        for s in d.get("ClassSkills") or []:
            if s in SKILL_DROP:
                continue
            out.append(SKILL_ALIAS.get(s, s))
        return out

    # ── 职业 ────────────────────────────────────────────────────────────
    print("[2/6] 导出职业…")
    for gid in class_ids:
        d = g.by_guid(gid)
        if not d:
            ex.warn.append("职业 %s 找不到蓝图" % gid)
            continue
        zn, en = ex.nm(d)
        e = OrderedDict()
        e["id"] = gid
        e["name"] = zn
        e["nameEn"] = en
        fname = os.path.basename(g.path_of(gid) or "")
        e["key"] = fname[:-4]
        e["path"] = g.path_of(gid)
        e["prestige"] = bool(d.get("PrestigeClass"))
        e["mythic"] = bool(d.get("IsMythic"))
        e["hitDie"] = d.get("HitDie")
        e["skillPoints"] = d.get("SkillPoints")
        e["classSkills"] = skill_list(d)
        e["startingGold"] = d.get("StartingGold")
        # 游戏属性页会在每项属性旁打「推荐 / 不推荐」（绿拇指 / 红拇指）
        rec = [str(x) for x in (d.get("RecommendedAttributes") or [])]
        if rec:
            e["recommended"] = rec
        norec = [str(x) for x in (d.get("NotRecommendedAttributes") or [])]
        if norec:
            e["notRecommended"] = norec
        pr = ex.prereqs(d)
        if pr:
            e["prereq"] = pr
        if d.get("IsArcaneCaster"):
            e["caster"] = "arcane"
        elif d.get("IsDivineCaster"):
            e["caster"] = "divine"
        desc = ex.desc(d)
        if desc:
            e["desc"] = desc
        short = g.text(d.get("LocalizedDescriptionShort"), ex.zh)
        if short:
            e["short"] = strip_markup(short)[:300]
        for key, field in (("bab", "m_BaseAttackBonus"), ("fort", "m_FortitudeSave"),
                           ("ref", "m_ReflexSave"), ("will", "m_WillSave")):
            sg = ref(d.get(field))
            if sg:
                sd = g.by_guid(sg)
                e[key] = (sd.get("Bonuses") or [])[:21]
        ped = d.get("m_Progression")
        pg = ref(ped)
        e["progression"] = []
        if pg:
            pd = g.by_guid(pg)
            entries = level_entries(pd.get("LevelEntries"))
            mx = max([lv["level"] for lv in entries if isinstance(lv["level"], int)] or [0])
            e["maxLevel"] = mx or (10 if e["prestige"] else 20)
            e["progression"] = pad_levels(entries, e["maxLevel"])
            ui = []
            for grp in (pd.get("UIGroups") or []):
                ids = refs((grp or {}).get("m_Features"))
                if ids:
                    ui.append(ids)
            det = refs(pd.get("m_UIDeterminatorsGroup"))
            if det:
                ui.append(det)
            if ui:
                e["uiGroups"] = ui
        arch = refs(d.get("m_Archetypes"))
        e["archetypes"] = arch
        # 法术书
        sb = ref(d.get("m_Spellbook"))
        if sb:
            e["spellbookId"] = sb
        icon = d.get("m_Icon")
        if isinstance(icon, dict) and icon.get("guid"):
            e["icon"] = icon["guid"].lower()
        classes[gid] = e

    # ── 变体 ────────────────────────────────────────────────────────────
    print("[3/6] 导出变体…")
    # 全局变体（不在任何职业 m_Archetypes 里，但被升级表引用），例如狂欢龙
    referenced_arch: set[str] = set()
    for c in classes.values():
        referenced_arch.update(c["archetypes"])
        for lv in c["progression"]:
            for f in lv["features"]:
                if g.type_of(f) == "BlueprintArchetype":
                    referenced_arch.add(f)
        for grp in c.get("uiGroups") or []:
            for f in grp:
                if g.type_of(f) == "BlueprintArchetype":
                    referenced_arch.add(f)

    arch_to_class: dict[str, list[str]] = {}
    for cid, c in classes.items():
        for a in c["archetypes"]:
            arch_to_class.setdefault(a, []).append(cid)

    for aid in sorted(referenced_arch):
        if g.type_of(aid) != "BlueprintArchetype":
            continue
        d = g.by_guid(aid)
        if not d:
            ex.warn.append("变体 %s 找不到蓝图" % aid)
            continue
        zn, en = ex.nm(d)
        e = OrderedDict()
        e["id"] = aid
        e["name"] = zn
        e["nameEn"] = en
        e["path"] = g.path_of(aid)
        e["classes"] = arch_to_class.get(aid, [])
        e["addFeatures"] = level_entries(d.get("AddFeatures"))
        e["removeFeatures"] = level_entries(d.get("RemoveFeatures"))
        if d.get("OverrideAttributeRecommendations"):
            arec = [str(x) for x in (d.get("RecommendedAttributes") or [])]
            if arec:
                e["recommended"] = arec
            anorec = [str(x) for x in (d.get("NotRecommendedAttributes") or [])]
            if anorec:
                e["notRecommended"] = anorec
        pr = ex.prereqs(d)
        if pr:
            e["prereq"] = pr
        if d.get("BuildChanging"):
            e["buildChanging"] = True
        if d.get("ReplaceSpellbook"):
            e["replaceSpellbook"] = True
        if d.get("m_ReplaceSpellbook"):
            e["newSpellbook"] = ref(d.get("m_ReplaceSpellbook"))
        if d.get("RemoveSpellbook"):
            e["removeSpellbook"] = True
        if d.get("ChangeCasterType"):
            e["changeCasterType"] = True
            if d.get("IsArcaneCaster"):
                e["caster"] = "arcane"
            elif d.get("IsDivineCaster"):
                e["caster"] = "divine"
        if d.get("ReplaceClassSkills"):
            e["classSkills"] = skill_list(d)
        if d.get("AddSkillPoints"):
            e["addSkillPoints"] = d.get("AddSkillPoints")
        for key, field in (("bab", "m_BaseAttackBonus"), ("fort", "m_FortitudeSave"),
                           ("ref", "m_ReflexSave"), ("will", "m_WillSave")):
            sg = ref(d.get(field))
            if sg:
                sd = g.by_guid(sg)
                e[key] = (sd.get("Bonuses") or [])[:21]
        desc = ex.desc(d)
        if desc:
            e["desc"] = desc
        short = g.text(d.get("LocalizedDescriptionShort"), ex.zh)
        if short:
            e["short"] = strip_markup(short)[:300]
        archetypes[aid] = e

    # ── 特性 ────────────────────────────────────────────────────────────
    print("[4/6] 导出特性 / 专长 / 选择表…")
    picked = 0
    for gid, t in g.types.items():
        if t not in FEATURE_TYPES:
            continue
        p = g.path_of(gid) or ""
        if not p.startswith(FEATURE_DIRS):
            continue
        if p.startswith("Spells/") and t == "BlueprintAbility":
            continue
        picked += 1
    print("  目录内候选 %d 个" % picked)
    for gid, t in list(g.types.items()):
        if t not in FEATURE_TYPES:
            continue
        p = g.path_of(gid) or ""
        if not p.startswith(FEATURE_DIRS):
            continue
        if p.startswith("Spells/") and t == "BlueprintAbility":
            continue
        features[gid] = ex.feature_entry(gid)

    # ── 法术 ────────────────────────────────────────────────────────────
    print("[5/6] 从职业法术书导出法术…")
    spell_levels: dict[str, dict[str, int]] = {}
    mythic_spells: dict[str, dict[str, int]] = {}
    spellbook_info: dict[str, dict] = {}

    def read_spellbook(cid: str, sbid: str, from_mythic: bool = False) -> None:
        sd = g.by_guid(sbid)
        if not sd:
            ex.warn.append("法术书 %s 找不到" % sbid)
            return
        info = spellbook_info.setdefault(sbid, OrderedDict())
        info["id"] = sbid
        info["name"] = g.name(sd, ex.zh)
        info["castingAttribute"] = sd.get("CastingAttribute")
        info["spontaneous"] = bool(sd.get("Spontaneous"))
        info["allSpellsKnown"] = bool(sd.get("AllSpellsKnown"))
        info["spellsPerLevel"] = sd.get("SpellsPerLevel")
        info["cantripsType"] = sd.get("CantripsType")
        info["isArcane"] = bool(sd.get("IsArcane"))
        spd = ref(sd.get("m_SpellsPerDay"))
        if spd:
            tbl = g.by_guid(spd)
            info["spellsPerDay"] = [ (l or {}).get("Count") or [] for l in (tbl.get("Levels") or []) ][:41]
        known = ref(sd.get("m_SpellsKnown"))
        if known:
            tbl = g.by_guid(known)
            info["spellsKnown"] = [ (l or {}).get("Count") or [] for l in (tbl.get("Levels") or []) ][:41]
        sl = ref(sd.get("m_SpellList"))
        if sl:
            sld = g.by_guid(sl)
            for grp in sld.get("SpellsByLevel") or []:
                lvl = grp.get("SpellLevel")
                for sid in refs(grp.get("m_Spells")):
                    (mythic_spells if from_mythic else spell_levels).setdefault(sid, {})[cid] = lvl
        msl = ref(sd.get("m_MythicSpellList"))
        if msl:
            md = g.by_guid(msl)
            for grp in md.get("SpellsByLevel") or []:
                lvl = grp.get("SpellLevel")
                for sid in refs(grp.get("m_Spells")):
                    mythic_spells.setdefault(sid, {})[cid] = lvl

    for cid, c in classes.items():
        if c.get("spellbookId"):
            read_spellbook(cid, c["spellbookId"])
        for aid in c["archetypes"]:
            a = archetypes.get(aid)
            if a and a.get("newSpellbook"):
                read_spellbook(cid, a["newSpellbook"])
    # 神话道途的法术书
    for mid in mythic_ids:
        md = g.by_guid(mid)
        sb = ref(md.get("m_Spellbook"))
        if sb:
            read_spellbook(mid, sb, True)

    print("  职业法术书 %d 本；法术条目 职业 %d / 神话 %d"
          % (len(spellbook_info), len(spell_levels), len(mythic_spells)))
    for sid in sorted(set(spell_levels) | set(mythic_spells)):
        e = ex.spell_entry(sid)
        if spell_levels.get(sid):
            e["levels"] = spell_levels[sid]
        if mythic_spells.get(sid):
            e["mythicLevels"] = mythic_spells[sid]
        spells[sid] = e

    # ── 种族 / 背景 / 神话 ──────────────────────────────────────────────
    print("[6/6] 导出种族 / 背景 / 神话…")
    for rid in race_ids:
        d = g.by_guid(rid)
        zn, en = ex.nm(d)
        e = OrderedDict()
        e["id"] = rid
        e["name"] = zn
        e["nameEn"] = en
        e["path"] = g.path_of(rid)
        e["size"] = d.get("Size")
        tr = refs(d.get("m_Features"))
        e["traits"] = tr
        sb = ex.stat_bonuses(d)
        if sb:
            e["statBonuses"] = sb
        sp = ex.skill_points(d)
        if sp:
            e["skillPointsPerLevel"] = sp
        # 种族自带的选择表（人类额外专长、精灵血统、矮人血统…）
        her = [t for t in tr if g.type_of(t) == "BlueprintFeatureSelection"]
        if her:
            e["heritageSelections"] = her
        desc = ex.desc(d)
        if desc:
            e["desc"] = desc
        if d.get("SelectableRaceStat"):
            e["selectableStat"] = True
        races[rid] = e

    # 背景：从 BackgroundsBaseSelection 递归展开
    bg_root = None
    for gid, p in g.guid_path.items():
        if p.endswith("BackgroundsBaseSelection.jbp"):
            bg_root = gid
            break
    backgrounds: "OrderedDict[str, dict]" = OrderedDict()

    def walk_backgrounds(gid: str, depth: int = 0) -> list[str]:
        d = g.by_guid(gid)
        t = g.type_of(gid)
        zn, en = ex.nm(d)
        if t == "BlueprintFeatureSelection" and depth < 3:
            children = []
            for c in refs(d.get("m_AllFeatures")):
                children.append(walk_backgrounds(c, depth + 1))
            backgrounds[gid] = {
                "id": gid, "name": zn, "nameEn": en, "kind": "group",
                "path": g.path_of(gid), "children": children,
            }
        else:
            e = OrderedDict()
            e["id"] = gid
            e["name"] = zn
            e["nameEn"] = en
            e["kind"] = "item"
            e["path"] = g.path_of(gid)
            desc = ex.desc(d)
            if desc:
                e["desc"] = desc
            if d.get("Groups"):
                e["groups"] = d["Groups"]
            if os.path.basename(g.path_of(gid) or "")[:-4] in BACKGROUND_COMPANION_ONLY:
                e["companionOnly"] = True
            backgrounds[gid] = e
        return gid

    if bg_root:
        walk_backgrounds(bg_root)

    mythic: "OrderedDict[str, dict]" = OrderedDict()
    for mid in mythic_ids:
        d = g.by_guid(mid)
        zn, en = ex.nm(d)
        fname = os.path.basename(g.path_of(mid) or "")[:-4]
        if not zn:
            zn = MYTHIC_PATH_NAMES.get(fname, "")
        e = OrderedDict()
        e["id"] = mid
        e["name"] = zn
        e["nameEn"] = en
        e["key"] = fname
        e["path"] = g.path_of(mid)
        e["higher"] = bool(d.get("m_IsHigherMythic"))
        e["selectable"] = fname in MYTHIC_PLAYER_KEYS
        desc = ex.desc(d)
        if desc:
            e["desc"] = desc
        pg = ref(d.get("m_Progression"))
        if pg:
            pd = g.by_guid(pg)
            entries = level_entries(pd.get("LevelEntries"))
            mx = max([lv["level"] for lv in entries if isinstance(lv["level"], int)] or [0])
            e["maxLevel"] = mx or 10
            e["progression"] = pad_levels(entries, e["maxLevel"])
            ui = [refs(x.get("m_Features")) for x in (pd.get("UIGroups") or [])]
            ui = [u for u in ui if u]
            det = refs(pd.get("m_UIDeterminatorsGroup"))
            if det:
                ui.append(det)
            if ui:
                e["uiGroups"] = ui
        if d.get("m_Spellbook"):
            e["spellbookId"] = ref(d.get("m_Spellbook"))
        pr = ex.prereqs(d)
        if pr:
            e["prereq"] = pr
        mythic[mid] = e

    mythic_selections: "OrderedDict[str, dict]" = OrderedDict()
    for gid, p in g.guid_path.items():
        base = os.path.basename(p)
        if p.startswith("Mythic/") and g.type_of(gid) == "BlueprintFeatureSelection" \
                and base in ("MythicFeatSelection.jbp", "MythicAbilitySelection.jbp",
                             "FirstAscensionSelection.jbp"):
            d = g.by_guid(gid)
            mythic_selections[base[:-4]] = {
                "id": gid, "name": g.name(d, ex.zh), "nameEn": g.name(d, ex.en),
                "choices": refs(d.get("m_AllFeatures")),
            }

    # ── 引用闭包：被引用到、但不在白名单目录里的特性补进来 ──────────────
    before = len(features)

    def feature_refs(e: dict) -> set:
        out = set(e.get("choices") or [])
        for p in e.get("prereq") or []:
            if p.get("id"):
                out.add(p["id"])
            out.update(p.get("ids") or [])
        for lv in e.get("progression") or []:
            out.update(lv["features"])
        return out

    def wanted() -> set:
        w: set = set()
        for coll in (classes, archetypes, mythic):
            for e in coll.values():
                for lv in e.get("progression") or []:
                    w.update(lv["features"])
                for lv in e.get("addFeatures") or []:
                    w.update(lv["features"])
                for lv in e.get("removeFeatures") or []:
                    w.update(lv["features"])
                for grp in e.get("uiGroups") or []:
                    w.update(grp)
                w.update(e.get("traits") or [])
                w.update(e.get("archetypes") or [])
                w.update(e.get("classes") or [])
                if e.get("newSpellbook"):
                    w.add(e["newSpellbook"])
        for e in features.values():
            w |= feature_refs(e)
        for e in mythic_selections.values():
            w.update(e.get("choices") or [])
        for e in backgrounds.values():
            w.update(e.get("children") or [])
        return w

    known_all = (lambda: set(features) | set(spells) | set(classes) | set(archetypes)
                 | set(races) | set(mythic) | set(backgrounds) | set(spellbook_info))
    not_feature: dict[str, tuple] = {}
    for _ in range(6):
        k = known_all()
        miss = [gid for gid in wanted() if gid not in k]
        add = []
        for gid in miss:
            t = g.type_of(gid)
            if t in FEATURE_TYPES:
                add.append(gid)
            else:
                not_feature[gid] = (t or "未知", g.path_of(gid) or "?? 不在库中")
        if not add:
            break
        for gid in add:
            features[gid] = ex.feature_entry(gid)
    print("  引用闭包：补入 %d 个特性；非特性引用 %d 种"
          % (len(features) - before, len(not_feature)))

    # ── 特性授予的法术列表 / 指定法术：补进 spells.json ──────────────────
    granted_lists: dict[str, dict] = {}
    granted_spells: dict[str, int] = {}
    for e in features.values():
        for lid in e.get("spellLists") or []:
            if lid in granted_lists:
                continue
            d = g.by_guid(lid)
            if not d:
                continue
            by: dict[str, list] = OrderedDict()
            for grp in d.get("SpellsByLevel") or []:
                lvl = str(grp.get("SpellLevel"))
                for sid in refs(grp.get("m_Spells")):
                    by.setdefault(lvl, []).append(sid)
                    granted_spells.setdefault(sid, grp.get("SpellLevel") or 0)
            granted_lists[lid] = {
                "id": lid,
                "name": g.name(d, ex.zh),
                "nameEn": g.name(d, ex.en),
                "levels": by,
            }
        for ks in e.get("knownSpells") or []:
            granted_spells.setdefault(ks["id"], ks["level"])
    added = 0
    for sid, lvl in granted_spells.items():
        if sid not in spells:
            se = ex.spell_entry(sid)
            se["listLevel"] = lvl
            spells[sid] = se
            added += 1
    print("  特性授予：法术列表 %d 个，补充法术 %d 条（现有 %d 条）"
          % (len(granted_lists), added, len(spells)))

    # ── 自检：引用能不能全部落地 ────────────────────────────────────────
    known = known_all()
    unresolved: Counter = Counter()
    for gid in wanted():
        if gid not in known:
            unresolved[gid] += 1
    unresolved_info = OrderedDict()
    for gid, cnt in unresolved.most_common():
        t, p = not_feature.get(gid, ("?", "?? 不在库中"))
        unresolved_info[gid] = {"count": cnt, "type": t, "path": p}

    # ── 硬校验：这些引用必须全部落地，否则不写出数据 ─────────────────────
    hard: list[str] = []

    def chk(label: str, guids) -> None:
        bad = sorted({x for x in guids if x and x not in known})
        if bad:
            where = "，".join("%s→%s" % (b, not_feature.get(b, ("?", "?"))[1]) for b in bad[:4])
            hard.append("%s 有 %d 个未解析引用：%s" % (label, len(bad), where))

    def feats_of(e: dict) -> list:
        out: list = []
        for key in ("progression", "addFeatures", "removeFeatures"):
            for lv in e.get(key) or []:
                out += lv["features"]
        for grp in e.get("uiGroups") or []:
            out += grp
        return out

    for cid, c in classes.items():
        chk("职业「%s」升级表" % c["name"], feats_of(c))
        chk("职业「%s」变体" % c["name"], c.get("archetypes") or [])
        chk("职业「%s」法术书" % c["name"], [c["spellbookId"]] if c.get("spellbookId") else [])
    for aid, a in archetypes.items():
        chk("变体「%s」增删特性" % a["name"], feats_of(a))
        chk("变体「%s」法术书" % a["name"], [a["newSpellbook"]] if a.get("newSpellbook") else [])
    for mid, m in mythic.items():
        chk("神话道途「%s」升级表" % m["name"], feats_of(m))
    for rid, r in races.items():
        chk("种族「%s」特性" % r["name"], r.get("traits") or [])
    for bid, b in backgrounds.items():
        chk("背景「%s」子项" % b["name"], b.get("children") or [])
    for sid, e in spells.items():
        if not (e.get("levels") or e.get("mythicLevels") or "listLevel" in e):
            hard.append("法术「%s」没有任何职业/道途等级（%s）"
                        % (e.get("name"), g.path_of(sid) or "?"))

    if hard:
        print()
        print("✗ 硬校验未通过，共 %d 项，不写出数据：" % len(hard))
        for h in hard[:40]:
            print("   -", h)
        raise SystemExit(2)
    print("  硬校验通过：职业/变体/种族/背景/神话的引用与法术等级全部落地")

    # ── 参数化专长的可选参数（武器种类 / 法术学派 / 具体法术）─────────────
    # 游戏并没有把变体列表放在 BlueprintParametrizedFeature 上（该蓝图的两个
    # Variants 字段都是空数组），但每个具体变体都以「基名（变体名）」的形式
    # 独立存在，例如「武器专攻（弯刀）」。因此用名字反推可选参数。
    var_map: dict = {}
    for f in features.values():
        n = f.get("name") or ""
        i, j = n.find("（"), n.rfind("）")
        if 0 < i and j == len(n) - 1:
            base, v = n[:i], n[i + 1:j]
            lst = var_map.setdefault(base, [])
            if v and v not in lst:
                lst.append(v)
    SPELL_SCHOOLS = ["防护", "咒法", "预言", "附魔", "塑能", "幻术", "死灵", "变化"]
    spell_names = sorted({s["name"] for s in spells.values() if s.get("name")})
    param_kinds: dict = {}
    for f in features.values():
        p = f.get("param")
        if not p:
            continue
        opts = var_map.get(f.get("name") or "")
        if p == "SpellSchool":
            # 名字反推只能拿到零星几条（如「法术专攻（神话）」），八个学派必须内置
            opts = SPELL_SCHOOLS + [o for o in (opts or []) if o not in SPELL_SCHOOLS]
        if not opts and p in ("LearnSpell", "SpellSpecialization"):
            opts = spell_names
        if opts:
            f["paramVariants"] = opts
        param_kinds[p] = param_kinds.get(p, 0) + 1
    print("  参数化专长 %d 个，参数类型 %s；%d 个带可选参数"
          % (sum(param_kinds.values()),
             "，".join("%s×%d" % kv for kv in sorted(param_kinds.items())),
             sum(1 for f in features.values() if f.get("paramVariants"))))

    # ── 落盘 ────────────────────────────────────────────────────────────
    os.makedirs(out_dir, exist_ok=True)

    def dump(name: str, obj) -> int:
        p = os.path.join(out_dir, name)
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        return os.path.getsize(p)

    rules = {
        "attributes": [{"id": a, "name": n, "short": s} for a, n, s in ATTR_ORDER],
        "skills": [{"id": s, "name": n, "nameEn": en} for s, n, en in SKILL_ORDER],
        "alignments": [{"id": a, "name": n} for a, n in ALIGNMENTS],
        "spellSchools": SPELL_SCHOOLS,
        "pointBuy": {str(k): v for k, v in POINT_BUY.items()},
        "pointBuyTotal": 25,
        "levelRange": [1, 20],
        "mythicRankRange": [1, 10],
        # 角色通用升级表：1 级给「选择背景/神祇选择」等，奇数级给通用专长
        "characterProgressionId": char_prog_id,
        "characterProgression": char_prog,
        "basicFeatSelection": basic_feat_sel,
        "deitySelection": deity_sel,
        "backgroundSelection": bg_root,
        # 游戏角色创建名单里的种族顺序（人类优先，不是拼音序）
        "raceOrder": race_ids,
    }
    sizes = {}
    sizes["rules.json"] = dump("rules.json", rules)
    sizes["classes.json"] = dump("classes.json", classes)
    sizes["archetypes.json"] = dump("archetypes.json", archetypes)
    sizes["features.json"] = dump("features.json", features)
    # 特性库太大（解压后 8.6 MB / 压缩后约 1.4 MB），浏览器端按 4 片并行下载，
    # 见 web/src/load.ts；features.json 本身保留，给工具与自检脚本用。
    # 描述文本占 2.7 MB（约三分之一），网页端首屏不需要它：拆成 featureDesc.json 后台再取。
    ids = list(features.keys())
    desc = {k: features[k].pop("desc") for k in ids if "desc" in features[k]}
    sizes["featureDesc.json"] = dump("featureDesc.json", desc)
    FEATURE_SHARDS = 4
    per = (len(ids) + FEATURE_SHARDS - 1) // FEATURE_SHARDS
    for i in range(FEATURE_SHARDS):
        part = {k: features[k] for k in ids[i * per:(i + 1) * per]}
        sizes[f"features-{i}.json"] = dump(f"features-{i}.json", part)
    sizes["spells.json"] = dump("spells.json", spells)
    sizes["spellLists.json"] = dump("spellLists.json", granted_lists)
    sizes["spellbooks.json"] = dump("spellbooks.json", spellbook_info)
    sizes["races.json"] = dump("races.json", races)
    sizes["backgrounds.json"] = dump("backgrounds.json", backgrounds)
    sizes["mythic.json"] = dump("mythic.json", {"paths": mythic, "selections": mythic_selections})

    meta = {
        "gameDir": game_dir,
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "blueprints": len(g.guid_path),
        "localization": {"zh": len(ex.zh), "en": len(ex.en)},
        "counts": {
            "classes": len(classes),
            "mythicPaths": len(mythic),
            "mythicPathsSelectable": sum(1 for v in mythic.values() if v.get("selectable")),
            "archetypes": len(archetypes),
            "features": len(features),
            "spells": len(spells),
            "spellLists": len(granted_lists),
            "spellbooks": len(spellbook_info),
            "races": len(races),
            "backgrounds": len(backgrounds),
        },
        "unresolved": OrderedDict(list(unresolved_info.items())[:60]),
        "warnings": ex.warn[:60],
        "skippedShadowDeleted": g.skip_deleted,
        "parseErrors": g.parse_errors,
        "sizes": sizes,
        "seconds": round(time.time() - t_all, 1),
    }
    sizes["meta.json"] = dump("meta.json", meta)
    meta["sizes"] = sizes
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)

    print()
    print("=" * 70)
    print("完成，用时 %.1fs" % meta["seconds"])
    for k, v in meta["counts"].items():
        print("  %-14s %d" % (k, v))
    print("  非特性引用未解析 %d 种（前端按原样展示）" % len(unresolved_info))
    for k, v in list(unresolved_info.items())[:15]:
        print("    %s ×%d  %s  %s" % (k, v["count"], v["type"], v["path"]))
    print("  输出目录 %s" % os.path.abspath(out_dir))
    for k, v in sizes.items():
        print("    %-18s %8.1f KB" % (k, v / 1024))
    return meta


def main() -> None:
    ap = argparse.ArgumentParser(description="导出《正义之怒》数据为规划器用 JSON")
    ap.add_argument("--game", default=os.environ.get("WOTR_GAME_DIR", DEFAULT_GAME))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "web", "public", "data"))
    a = ap.parse_args()
    build(a.game, a.out)


if __name__ == "__main__":
    main()
