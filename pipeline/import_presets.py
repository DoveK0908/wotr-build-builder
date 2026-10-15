#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把中文 BD 合集（ZJUZBW/-Wotr-BD- 的 README.md）解析成规划器可一键载入的预置构筑。

用法：
    python pipeline/import_presets.py                     # 用默认路径
    python pipeline/import_presets.py --src <README.md> --out web/public/data

解析目标（尽力而为，凡是没认出来的名字都会记进报告，不猜）：
  * `## **席拉**`           → 构筑归属（队友/角色名）
  * `### 14圣武士1传统武僧…` → 职业与变体配比（变体名会回溯到它的母职业）
  * 代码块里的 `1圣武士：闪避、盾牌专攻` → 逐级专长（认不出的记 unmatched）
  * `**升级属性加点**：5魅力` → 属性提升
  * `- 1屹立不倒、2神话盔甲专攻（中甲耐受）…` → 神话能力/专长
输出：presets.json（含 stats 与每个构筑的 match 报告）
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import sys
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = r"D:\DSH\temp\Wotr-BD-\README.md"

# ── 文本清洗 ────────────────────────────────────────────────────────────────
PAREN = re.compile(r"[（(][^）)]*[）)]")
BRACKET = re.compile(r"[【\[][^】\]]*[】\]]")
TAIL = re.compile(r"\s*(?:-{2,}|—{2,}|~{2,}).*$")


def norm(name: str) -> str:
    """把一条名字压成查表用的形式：去掉括号/方括号内容与后缀注释。"""
    s = (name or "").strip()
    s = s.replace("\u3000", " ")
    s = TAIL.sub("", s)
    s = PAREN.sub("", s)
    s = BRACKET.sub("", s)
    s = s.replace("*", "").replace("：", "").strip()
    return s


def norm_keep_inner(name: str) -> list[str]:
    """除整体外，再给出「括号里的内容」当成候选名（如 魔宠【野兔】→ 野兔）。

    注意：整体那一条**保留括号**（游戏里很多专长就叫 `超魔（法术延时）`），
    所以这里不能把它整条丢进 norm()。
    """
    s = (name or "").strip()
    out = [TAIL.sub("", s).replace("*", "").strip()]
    for m in BRACKET.finditer(s):
        out.append(norm(m.group(0)[1:-1]))
    for m in PAREN.finditer(s):
        out.append(norm(m.group(0)[1:-1]))
    return [x for x in out if x]


def split_alt(text: str) -> list[str]:
    """按 `/` 切候选，但括号里的 `/` 不算（`技能专攻（世界/神秘）` 是一条）。"""
    out: list[str] = []
    buf: list[str] = []
    stack: list[str] = []
    for ch in text:
        if ch in DEPT:
            stack.append(DEPT[ch])
            buf.append(ch)
            continue
        if stack and ch == stack[-1]:
            stack.pop()
            buf.append(ch)
            continue
        if not stack and ch in "/／":
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    out.append("".join(buf))
    return [x for x in (s.strip() for s in out) if x]


SHORTHAND = [
    re.compile(r"^技能专攻[（(](.{2,9})[）)]$"),
    re.compile(r"^(.{2,8})[-—](.{2,12})$"),
]


def shorthand(cand: str) -> list[str]:
    """把攻略里的简写补成游戏里的正式名（技能专攻（世界）→ 技能专攻-知识（世界）等）。"""
    out: list[str] = []
    m = SHORTHAND[0].match(cand)
    if m:
        x = m.group(1)
        if x.startswith("知识"):
            out.append(f"技能专攻-知识（{x[2:].lstrip('/／')}）")
        elif x.startswith("学识"):
            out.append(f"技能专攻-学识（{x[2:].lstrip('/／')}）")
        else:
            out += [f"技能专攻-知识（{x}）", f"技能专攻-学识（{x}）", f"技能专攻-{x}"]
        if "/" in x or "／" in x:
            for y in re.split(r"[/／]", x):
                out += [f"技能专攻-知识（{y}）", f"技能专攻-学识（{y}）", f"技能专攻-{y}"]
    m = SHORTHAND[1].match(cand)
    if m:
        out += [m.group(2), m.group(1)]
    return out


def inner(name: str) -> str:
    m = PAREN.search(name or "")
    return m.group(0)[1:-1] if m else ""


# ── 数据字典 ────────────────────────────────────────────────────────────────
class Dict_:
    def __init__(self, data_dir: str) -> None:
        self.load(data_dir)

    def load(self, d: str) -> None:
        def j(n):
            with io.open(os.path.join(d, n), encoding="utf-8") as f:
                return json.load(f)

        self.classes = j("classes.json")
        self.archetypes = j("archetypes.json")
        self.features = j("features.json")
        self.spells = j("spells.json")
        self.mythic = j("mythic.json")
        self.rules = j("rules.json")

        self.class_by_name = {v.get("name", ""): k for k, v in self.classes.items() if v.get("name")}
        self.arch_by_name: dict[str, tuple[str, str]] = {}
        for aid, a in self.archetypes.items():
            n = a.get("name")
            if not n:
                continue
            cs = a.get("classes") or []
            self.arch_by_name[n] = (aid, cs[0] if cs else "")

        # 特性：同名可能有好几条（特性 + 能力壳子），按「像正经专长」的程度排序
        self.feat_by_name: dict[str, list[str]] = {}
        for fid, f in self.features.items():
            n = f.get("name")
            if not n:
                continue
            self.feat_by_name.setdefault(n, []).append(fid)
        for n, ids in self.feat_by_name.items():
            ids.sort(key=self._feat_rank, reverse=True)

        self.spell_by_name: dict[str, str] = {}
        for sid, s in self.spells.items():
            n = s.get("name")
            if n and n not in self.spell_by_name:
                self.spell_by_name[n] = sid

        # 神话能力/专长的候选名 → id
        self.mythic_by_name: dict[str, str] = {}
        for sel in (self.mythic.get("selections") or {}).values():
            for cid in sel.get("choices") or []:
                f = self.features.get(cid)
                if f and f.get("name"):
                    self.mythic_by_name.setdefault(f["name"], cid)

        # 每级该做哪些选择（通用升级表 + 职业升级表里的选择表）
        self.slots_by_level = self._slots()

    def _feat_rank(self, fid: str) -> int:
        f = self.features.get(fid) or {}
        r = 0
        if f.get("type") == "feature":
            r += 4
        if f.get("classFeature"):
            r += 2
        if f.get("groups"):
            r += 2
        if f.get("prereq"):
            r += 1
        if f.get("desc"):
            r += 1
        if f.get("choices"):
            r += 3
        if f.get("type") in ("ability", "activatableability"):
            r -= 2
        return r

    # 通用升级表：level -> [feature id]
    def universal(self, level: int) -> list[str]:
        for e in self.rules.get("characterProgression") or []:
            if e.get("level") == level:
                return list(e.get("features") or [])
        return []

    def _expand(self, fid: str, depth: int = 0) -> list[str]:
        f = self.features.get(fid)
        if not f or depth > 3 or not f.get("progression"):
            return [fid]
        out = [fid]
        for lv in f.get("progression") or []:
            for x in lv.get("features") or []:
                out.extend(self._expand(x, depth + 1))
        return out

    def _slots(self) -> dict[int, list[dict]]:
        """level -> [{slotId, choices:set, classId?}] 只包含「要选东西」的槽位"""
        by_level: dict[int, list[dict]] = {}
        for lv in range(1, 21):
            slots: list[dict] = []
            seen: set[str] = set()

            def add(sid: str) -> None:
                if sid in seen:
                    return
                f = self.features.get(sid)
                if not f or not f.get("choices"):
                    return
                seen.add(sid)
                slots.append({"id": sid, "choices": set(f["choices"])})

            for fid in self.universal(lv):
                for x in self._expand(fid):
                    add(x)
            by_level[lv] = slots

        # 职业升级表：classId -> level -> [slotId]
        self.class_slots: dict[str, dict[int, list[str]]] = {}
        for cid, c in self.classes.items():
            per: dict[int, list[str]] = {}
            for lv in c.get("progression") or []:
                out: list[str] = []
                for fid in lv.get("features") or []:
                    for x in self._expand(fid):
                        f = self.features.get(x)
                        if f and f.get("choices"):
                            out.append(x)
                    out.append(fid)
                per[lv.get("level")] = out
            self.class_slots[cid] = per
        return by_level


# ── 解析 ────────────────────────────────────────────────────────────────────
CLASS_TOKEN = re.compile(r"(\d+)\s*([\u4e00-\u9fffA-Za-z]{1,12})")
NOTE_SPLIT = re.compile(r"[、,，;；]")
ALT_SPLIT = re.compile(r"[/／]")
DEPT = {"（": "）", "(": ")", "【": "】", "[": "]"}


def split_items(text: str) -> list[str]:
    """按顿号/逗号切分，但括号里的顿号不算分隔符（`技能专攻（世界、神秘）` 是一条）。"""
    out: list[str] = []
    buf: list[str] = []
    stack: list[str] = []
    for ch in text:
        if ch in DEPT:
            stack.append(DEPT[ch])
            buf.append(ch)
            continue
        if stack and ch == stack[-1]:
            stack.pop()
            buf.append(ch)
            continue
        if not stack and NOTE_SPLIT.match(ch):
            out.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    out.append("".join(buf))
    return [x for x in (s.strip() for s in out) if x]


def parse_plan(text: str, D: Dict_) -> dict:
    """`14圣武士1传统武僧1受诅巫师3突变斗士1原怒者` → 职业/变体配比

    按游标扫描：数字 + 「剩余文本开头能命中的最长名字」。这样 `禅宗`/`原怒`/`奥法暴徒新加点`
    这类简写只要**是**某个已知名字的前缀就能认出来（旧版按固定长度截词会截断）。
    """
    text = PAREN.sub("", text)
    known: list[tuple[str, str, str]] = []
    for n, cid in D.class_by_name.items():
        known.append((n, "class", cid))
    for n, (aid, cid) in D.arch_by_name.items():
        if cid:
            known.append((n, "arch", aid))
    for n in ("可变兼职", "自选", "兼职"):
        known.append((n, "skip", ""))
    known.sort(key=lambda x: -len(x[0]))

    order: list[str] = []
    arch: dict[str, list[str]] = {}
    unknown: list[str] = []
    total = 0
    i = 0
    while i < len(text):
        m = re.compile(r"\d+").match(text, i)
        if not m:
            i += 1
            continue
        n = int(m.group(0))
        j = m.end()
        hit = None
        for name, kind, ident in known:
            if text.startswith(name, j):
                hit = (name, kind, ident)
                break
        if not hit:
            k = j
            while k < len(text) and not text[k].isdigit():
                k += 1
            unknown.append(f"{n}{text[j:k]}")
            i = k
            continue
        name, kind, ident = hit
        if kind == "class":
            for _ in range(n):
                order.append(ident)
        elif kind == "arch":
            cid = D.arch_by_name[name][1]
            arch.setdefault(cid, []).append(ident)
            # 变体也占掉 n 个职业等级（职业配比要铺满 20 级）
            if cid:
                for _ in range(n):
                    order.append(cid)
        total += n
        i = j + len(name)
    return {"order": order, "archetypes": arch, "unknown": unknown, "total": total}


NOISE = {"自选", "可变兼职", "兼职", "新", "新加点", "加点", "技能", "法术", "无"}
NOISE_RE = re.compile(r"^[×xX*\s\d.、，,;；:：~\-—]+$")


def is_noise(s: str) -> bool:
    if not s or s in NOISE:
        return True
    if NOISE_RE.match(s):
        return True
    return not re.search(r"[\u4e00-\u9fff]", s)


ROMAN = re.compile(r"^[IVXivx]{1,4}[\.、]?\s*(?=\S)")
LEAD_VERB = re.compile(r"^(?:获得|送|选|点|加|拿|换|改成|洗成)")


def tidy(cand: str) -> str:
    """去掉罗马数字序号（`I超魔（法术延时）`）与句首动词（`获得动物伙伴`→动物伙伴）。"""
    s = cand
    for _ in range(2):
        s2 = ROMAN.sub("", s)
        s2 = LEAD_VERB.sub("", s2)
        if s2 == s:
            break
        s = s2
    return s.strip()


def parse_feat_item(item: str, D: Dict_) -> tuple[str, str, str]:
    """返回 (kind, id, paramText)：kind ∈ feat|spell|mythic|none"""
    raw = item.strip()
    if is_noise(raw):
        return ("none", "", "")
    param = inner(raw)
    # 候选名：整体（保括号）→「A：B」两半 → 去括号/取括号内容 → 简写补全
    cands: list[str] = []
    for part in re.split(r"[：:]", raw):
        cands.extend(norm_keep_inner(part))
        cands.append(norm(part))
    cands.extend(norm_keep_inner(raw))
    cands.append(norm(raw))
    extra: list[str] = []
    for c in cands:
        extra.extend(shorthand(c))
        t = tidy(c)
        if t != c:
            extra.append(t)
            extra.extend(shorthand(t))
    cands.extend(extra)
    seen: set[str] = set()
    for cand in cands:
        if cand in seen or is_noise(cand):
            continue
        seen.add(cand)
        if cand in D.feat_by_name and D.feat_by_name[cand]:
            return ("feat", D.feat_by_name[cand][0], param)
        if cand in D.mythic_by_name:
            return ("mythic", D.mythic_by_name[cand], param)
        if cand in D.spell_by_name:
            return ("spell", D.spell_by_name[cand], param)
    return ("none", "", raw)


def parse_attribute_line(text: str, D: Dict_) -> list[str]:
    """`5魅力` / `全力量` / `2感知 3魅力` → [AttrId,...]（20 级共 10 点：5 次提升×2 点？不，5 次各 +1）"""
    attrs = {a["name"]: a["id"] for a in D.rules["attributes"]}
    out: list[str] = []
    body = text.replace("：", ":").split(":", 1)[-1]
    for m in re.finditer(r"(\d+|全)\s*([\u4e00-\u9fff]{2})", body):
        cnt, name = m.group(1), m.group(2)
        aid = attrs.get(name)
        if not aid:
            continue
        n = 5 if cnt == "全" else min(int(cnt), 10)
        out.extend([aid] * n)
    return out


def parse_mythic_line(text: str, D: Dict_) -> list[tuple[int, str, str]]:
    """`1屹立不倒、2神话盔甲专攻（中甲耐受）` → [(rank, kind, id/name)]"""
    out: list[tuple[int, str, str]] = []
    for part in re.split(r"[、,，]", text):
        m = re.match(r"\s*(\d+)\s*(.+)", part.strip())
        if not m:
            continue
        rank = int(m.group(1))
        kind, fid, param = parse_feat_item(m.group(2), D)
        out.append((rank, kind if kind != "none" else "unmatched", fid if kind != "none" else m.group(2).strip()))
    return out


def parse_readme(path: str, D: Dict_) -> list[dict]:
    with io.open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()

    skip_sections = ("目录", "BD收录原则", "关于", "合理的队伍", "想要撕卷轴", "动物伙伴", "附伤套娃")
    builds: list[dict] = []
    who = ""
    cur: dict | None = None
    in_code = False
    code_buf: list[str] = []

    def flush() -> None:
        nonlocal cur
        if cur and cur["plan"]:
            builds.append(cur)
        cur = None

    for raw in lines:
        line = raw.rstrip()
        if line.strip().startswith("```"):
            in_code = not in_code
            if not in_code and cur is not None and code_buf:
                cur["blocks"].append(list(code_buf))
                code_buf = []
            continue
        if in_code:
            code_buf.append(line)
            continue

        m2 = re.match(r"^##\s+(.+?)\s*$", line)
        m3 = re.match(r"^###\s+(.+?)\s*$", line)
        if m2:
            flush()
            who = norm(m2.group(1))
            if any(s in m2.group(1) for s in skip_sections):
                who = ""
            continue
        if m3:
            flush()
            title = m3.group(1).replace("*", "").strip()
            if not who or title.startswith("~~") or "动物伙伴" in title or "旧版本" in title:
                continue
            cur = {
                "who": who, "plan": title, "blocks": [], "attrs": [], "mythic": [],
                "levels": [], "notes": [],
            }
            continue
        if cur is None:
            continue
        if "**升级属性加点" in line or "升级属性加点" in line:
            cur["attrs"].extend(parse_attribute_line(line, D))
        elif re.search(r"^\s*-\s*\d+\s*\S+.*[、,]", line) and ("神话" in line or "屹立不倒" in line):
            cur["mythic"].extend(parse_mythic_line(line, D))
        elif "神话道途" in line or "道途选择" in line:
            cur["notes"].append(line.strip()[:160])
    flush()

    # 组装每一级
    out: list[dict] = []
    for b in builds:
        plan = parse_plan(b["plan"], D)
        order = plan["order"][:20]
        levels = [
            {"level": i + 1, "classId": order[i] if i < len(order) else None,
             "picks": {}, "params": {}, "feats": [], "spells": [],
             "unmatched": [], "notes": []}
            for i in range(20)
        ]
        # 逐级专长：只取第一个变体（-- xxx -- 之间的第一段）
        seen_level: set[int] = set()
        matched = 0
        total = 0
        for block in b["blocks"]:
            first = []
            started = False
            for ln in block:
                is_sep = re.match(r"^\s*-{2,}", ln)
                if is_sep:
                    if not started:
                        continue          # 变体标题行（--通用加点1----），跳过
                    break                 # 后面是另一个变体，只要第一套
                if re.match(r"^\s*\d{1,2}\s*\S", ln):
                    started = True
                if started:
                    first.append(ln)
            for ln in first:
                mm = re.match(r"^\s*(\d{1,2})\s*([^：:]{1,14})[：:](.*)$", ln)
                if not mm:
                    continue
                lv = int(mm.group(1))
                if not (1 <= lv <= 20) or lv in seen_level:
                    continue
                seen_level.add(lv)
                for item in split_items(mm.group(3)):
                    item = item.strip()
                    if not item:
                        continue
                    # `A---B`：`---` 后是真正要选的专长，`---` 前是来源说明；两边都当候选
                    parts = [item]
                    for sep in ("---", "——", "—"):
                        if sep in item:
                            pre, post = item.split(sep, 1)
                            parts = [post, pre]
                            break
                    done = False
                    for part in parts:
                        for alt in split_alt(part):
                            alt = alt.strip()
                            if not alt:
                                continue
                            kind, fid, param = parse_feat_item(alt, D)
                            if kind == "none":
                                # 长句多半是攻略正文（说明、吐槽），不是专长名
                                if len(alt) > 14:
                                    levels[lv - 1]["notes"].append(alt)
                                elif alt:
                                    total += 1
                                    levels[lv - 1]["unmatched"].append(alt)
                                continue
                            total += 1
                            matched += 1
                            rec = levels[lv - 1]
                            if kind == "spell":
                                rec["spells"].append(fid)
                            else:
                                rec["feats"].append({"id": fid, "param": param})
                            done = True
                            break
                        if done:
                            break
        # 职业配比按等级顺序铺满 20 级（攻略只在有专长的行上写了职业）
        order = plan["order"]
        for i, rec in enumerate(levels):
            if i < len(order):
                rec["classId"] = order[i]
        out.append({
            "who": b["who"], "plan": b["plan"], "levels": levels,
            "archetypes": plan["archetypes"], "attrs": b["attrs"][:10],
            "mythic": b["mythic"], "notes": b["notes"],
            "planUnknown": plan["unknown"],
            "match": {"feats": matched, "total": total},
        })
    return out


def assign_slots(D: Dict_, p: dict) -> None:
    """把认出来的专长放进它唯一能落的槽位；多个槽位可选或没有槽位就不硬塞。"""
    for i, lv in enumerate(p["levels"], start=1):
        cls = lv["classId"]
        slots = list(D.slots_by_level.get(i, []))
        for sid in (D.class_slots.get(cls) or {}).get(i, []) if cls else []:
            f = D.features.get(sid)
            if f and f.get("choices"):
                slots.append({"id": sid, "choices": set(f["choices"])})
        for rec in lv["feats"]:
            cands = [s["id"] for s in slots if rec["id"] in s["choices"]]
            if len(cands) == 1:
                lv["picks"][cands[0]] = rec["id"]
                if rec.get("param"):
                    lv["params"][rec["id"]] = rec["param"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--data", default=os.path.join(ROOT, "web", "public", "data"))
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "data"))
    args = ap.parse_args()

    if not os.path.exists(args.src):
        print(f"找不到源文件：{args.src}", file=sys.stderr)
        return 2

    D = Dict_(args.data)
    presets = parse_readme(args.src, D)
    for p in presets:
        assign_slots(D, p)

    feats = sum(p["match"]["feats"] for p in presets)
    total = sum(p["match"]["total"] for p in presets)
    slots = sum(len(lv["picks"]) for p in presets for lv in p["levels"])
    print(f"来源：{args.src}")
    print(f"构筑 {len(presets)} 个；专长条目 {total} 条，认出 {feats} 条"
          f"（{feats * 100 // max(total, 1)}%）；自动落到槽位 {slots} 个")

    bad_plan = [p for p in presets if p["planUnknown"]]
    if bad_plan:
        print(f"职业配比里有认不出的词：{len(bad_plan)} 个构筑，样例：")
        for p in bad_plan[:5]:
            print(f"  {p['who']} / {p['plan']} → {p['planUnknown']}")
    nomatch = OrderedDict()
    for p in presets:
        for lv in p["levels"]:
            for u in lv["unmatched"]:
                nomatch[u] = nomatch.get(u, 0) + 1
    if nomatch:
        top = sorted(nomatch.items(), key=lambda kv: -kv[1])[:25]
        print(f"没认出来的专长名 {len(nomatch)} 个（前 25）：")
        print("  " + " · ".join(f"{k}×{v}" for k, v in top))

    doc = {
        "source": os.path.basename(os.path.dirname(args.src)) + "/" + os.path.basename(args.src),
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "stats": {"presets": len(presets), "feats": total, "matched": feats, "slotted": slots},
        "presets": [
            {
                "id": f"{p['who']}-{i + 1}",
                "who": p["who"], "plan": p["plan"], "archetypes": p["archetypes"],
                "attrs": p["attrs"], "mythic": p["mythic"], "notes": p["notes"],
                "levels": p["levels"], "match": p["match"],
            }
            for i, p in enumerate(presets)
        ],
    }
    os.makedirs(args.out, exist_ok=True)
    dst = os.path.join(args.out, "presets.json")
    with io.open(dst, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {dst}（{os.path.getsize(dst) / 1024:.1f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
