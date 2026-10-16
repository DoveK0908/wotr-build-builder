/**
 * 构筑推导与规则校验。
 *
 * 原则：能用游戏数据的都用数据 —— 升级表、变体增删、BAB/豁免、生命骰、技能点、
 * 法术位、法术表、前置条件全部来自 web/public/data/。
 * 只有游戏数据里确实没有的（技能关键属性、点买花费表）才写死，并在注释里说明。
 */
import type {
  AttrId, BackgroundEntry, ClassEntry, Db, FeatureEntry, Prereq,
  RaceEntry, SpellEntry,
} from "./types";
import { ATTRS, MAX_LEVEL, MAX_RANK, type Build } from "./store";

export type Verdict = "ok" | "no" | "unknown";

export const attrMod = (v: number) => Math.floor((v - 10) / 2);

/** 技能的关键属性 —— 游戏蓝图里没有这个映射，是固定的规则表 */
export const SKILL_ATTR: Record<string, AttrId> = {
  SkillAthletics: "Strength",
  SkillMobility: "Dexterity",
  SkillTrickery: "Dexterity",
  SkillStealth: "Dexterity",
  SkillKnowledgeArcana: "Intelligence",
  SkillKnowledgeWorld: "Intelligence",
  SkillLoreNature: "Wisdom",
  SkillLoreReligion: "Wisdom",
  SkillPerception: "Wisdom",
  SkillPersuasion: "Charisma",
  SkillUseMagicDevice: "Charisma",
};

/** 游戏里有几个「检定」型加值其实算在沟通上 */
const CHECK_ALIAS: Record<string, string> = {
  CheckDiplomacy: "SkillPersuasion",
  CheckBluff: "SkillPersuasion",
  CheckIntimidate: "SkillPersuasion",
  CheckIntimidation: "SkillPersuasion",
  SkillThievery: "SkillTrickery",
};

export const SAVE_KEYS = ["SaveFortitude", "SaveReflex", "SaveWill"] as const;

export function num(n: number | undefined, d = 0): number {
  return typeof n === "number" && isFinite(n) ? n : d;
}

/** 依次取 name / nameEn，名字缺失时给个可读的占位 */
export function label(e: { name?: string; nameEn?: string; id?: string } | null | undefined): string {
  if (!e) return "（未知）";
  return e.name || e.nameEn || (e.id ? e.id.slice(0, 8) : "（未知）");
}

// ── 职业等级 / 变体 ──────────────────────────────────────────────────────
export function classLevels(build: Build): Record<string, number> {
  const m: Record<string, number> = {};
  for (const l of build.levels) if (l.classId) m[l.classId] = (m[l.classId] || 0) + 1;
  return m;
}

export function charLevel(build: Build): number {
  return build.levels.filter((l) => l.classId).length;
}

export function archSel(db: Db, build: Build): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [cid, list] of Object.entries(build.classArchetypes || {})) {
    const valid = (list || []).filter((a) => db.archetypes[a] && (db.archetypes[a].classes || []).includes(cid));
    if (valid.length) out[cid] = valid;
  }
  return out;
}

export function archLevels(db: Db, build: Build): Record<string, number> {
  const cl = classLevels(build);
  const sel = archSel(db, build);
  const out: Record<string, number> = {};
  for (const [cid, list] of Object.entries(sel)) {
    for (const a of list) out[a] = (out[a] || 0) + num(cl[cid]);
  }
  return out;
}

/**
 * 某职业到第 n 个职业等级时实际获得的特性：升级表 − 变体移除 + 变体添加。
 * 变体字段为 null 表示继承主职业，这里只处理 AddFeatures / RemoveFeatures。
 */
export function featuresAtClassLevel(
  db: Db, classId: string, classLevel: number, archetypes: string[],
): string[] {
  const c = db.classes[classId];
  if (!c || classLevel < 1) return [];
  const rm = new Set<string>();
  const add: string[] = [];
  for (const a of archetypes) {
    const ar = db.archetypes[a];
    if (!ar) continue;
    for (const e of ar.removeFeatures || []) if (e.level === classLevel) e.features.forEach((f) => rm.add(f));
    for (const e of ar.addFeatures || []) if (e.level === classLevel) e.features.forEach((f) => add.push(f));
  }
  const base = (c.progression || []).find((x) => x.level === classLevel)?.features || [];
  return [...base.filter((f) => !rm.has(f)), ...add];
}

/** 角色通用升级表（Classes/Basic/BasicFeatsProgression.jbp）在第 n 级给的特性 */
export function universalFeatures(db: Db, level: number): string[] {
  const cp = db.rules.characterProgression;
  if (!cp) return [];
  return cp.find((e) => e.level === level)?.features || [];
}

/** 通用升级表里需要玩家做选择的槽位（背景/神祇有专门界面，这里排除掉） */
export function universalSlots(db: Db, level: number): FeatureEntry[] {
  const skip = new Set(
    [db.rules.backgroundSelection, db.rules.deitySelection].filter(Boolean) as string[],
  );
  return universalFeatures(db, level)
    .map((id) => db.features[id])
    .filter((f): f is FeatureEntry => !!f && !!f.choices && !skip.has(f.id));
}

/** 选出来的特性本身还可能是个「进程表」，要把里面的特性展开成一层的 id 列表 */
export function expandFeature(db: Db, id: string, depth = 0): string[] {
  if (depth > 4) return [];
  const f = db.features[id];
  if (!f || !f.progression) return [id];
  const out = [id];
  for (const e of f.progression) for (const sub of e.features) out.push(...expandFeature(db, sub, depth + 1));
  return out;
}

// ── 槽位与嵌套链 ────────────────────────────────────────────────────────
/**
 * 「槽位里选中的那个东西本身还是个选择表」时，往下继续要的那一层。
 * 游戏里这种嵌套很常见：战斗专长 › 战斗流派专长 › 弓术；
 * 神话能力 › 巅峰元素；种族传承 › 基本 › 一技之长；学者 › 自然学者 › 光亮术。
 */
export interface LivePick {
  /** 选择表（槽位）id */
  slot: string;
  /** 选中的特性 id */
  choice: string;
}

/** 从一组根槽位出发，沿「选中的东西还是不是选择表」一路向下，收集真正活着的那条链 */
export function livePicks(
  db: Db, roots: (FeatureEntry | undefined)[], picks: Record<string, string> | undefined,
): LivePick[] {
  const out: LivePick[] = [];
  if (!picks) return out;
  for (const r of roots) {
    if (!r) continue;
    let slotId = r.id;
    let node: FeatureEntry | undefined = r;
    for (let guard = 0; node && guard < 8; guard += 1) {
      const choice = picks[slotId];
      if (!choice) break;
      out.push({ slot: slotId, choice });
      const f = db.features[choice];
      if (!f || !f.choices || !f.choices.length) break;
      slotId = choice;
      node = f;
    }
  }
  return out;
}

/** 某一级真正要玩家做选择的根槽位：职业升级表给的 + 角色通用升级表给的 */
export function levelRootSlots(db: Db, build: Build, level: number): FeatureEntry[] {
  const lv = build.levels[level - 1];
  const sel = archSel(db, build);
  const out: FeatureEntry[] = [];
  const seen = new Set<string>();
  const push = (f?: FeatureEntry) => {
    if (f && f.choices && f.choices.length && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
  };
  if (lv && lv.classId) {
    let cl = 0;
    for (let i = 0; i < level; i += 1) if (build.levels[i].classId === lv.classId) cl += 1;
    for (const id of featuresAtClassLevel(db, lv.classId, cl, sel[lv.classId] || [])) push(db.features[id]);
  }
  for (const f of universalSlots(db, level)) push(f);
  return out;
}

/** 某个神话等级要玩家做选择的槽位（道途自家内容优先，没有就走通用神话能力/专长） */
export function rankRootSlots(db: Db, build: Build, rank: number): FeatureEntry[] {
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  const ids = (path?.progression || []).find((x) => x.level === rank)?.features || [];
  const slots = ids.map((id) => db.features[id]).filter((f): f is FeatureEntry => !!f && !!f.choices && f.choices.length > 0);
  if (slots.length) return slots;
  // 奇数等级给神话能力、偶数等级给神话专长
  const sel = db.mythic.selections || {};
  const want = rank % 2 === 1 ? sel.MythicAbilitySelection : sel.MythicFeatSelection;
  const alt = rank % 2 === 1 ? sel.MythicFeatSelection : sel.MythicAbilitySelection;
  const pick = (want || alt) as unknown as FeatureEntry | undefined;
  return pick && pick.choices && pick.choices.length ? [pick] : [];
}

/** 种族自带的传承/子选择槽位 */
export function raceRootSlots(db: Db, build: Build): FeatureEntry[] {
  const race = build.race ? db.races[build.race] : null;
  return (race?.heritageSelections || [])
    .map((id) => db.features[id])
    .filter((f): f is FeatureEntry => !!f && !!f.choices && f.choices.length > 0);
}

/** 背景树的根（「选择背景」那张选择表） */
export function backgroundRoot(db: Db): FeatureEntry | undefined {
  const id = db.rules.backgroundSelection;
  return id ? db.features[id] : undefined;
}

/** 旧存档只存了最深那一个背景 id：顺着 children 反查，把中间路径补回来 */
export function legacyBackgroundPicks(db: Db, deepest: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!deepest) return out;
  const parentOf: Record<string, string> = {};
  for (const b of Object.values(db.backgrounds)) {
    for (const c of b.children || []) parentOf[c] = b.id;
  }
  const root = db.rules.backgroundSelection;
  const path: string[] = [];
  const guard = new Set<string>();
  let cur: string | undefined = deepest;
  while (cur && !guard.has(cur)) { guard.add(cur); path.unshift(cur); cur = parentOf[cur]; }
  while (path.length && path[0] === root) path.shift();
  if (!path.length) return out;
  if (root) out[root] = path[0];
  for (let i = 0; i + 1 < path.length; i += 1) out[path[i]] = path[i + 1];
  return out;
}

// ── 拥有哪些特性 ────────────────────────────────────────────────────────
export interface Owned {
  /** 全部拥有的特性 id（含选择表本身与选择结果） */
  ids: Set<string>;
  /** 选择表 id -> 选中的特性 id（含种族/职业/神话） */
  picks: Record<string, string>;
  /** 参数化专长 id -> 参数 */
  params: Record<string, string>;
  /** 升级/变体自动给予的（不含选择结果） */
  auto: Set<string>;
}

export function ownedFeatures(db: Db, build: Build): Owned {
  const ids = new Set<string>();
  const picks: Record<string, string> = {};
  const params: Record<string, string> = {};
  const auto = new Set<string>();
  const sel = archSel(db, build);

  const addAuto = (id: string) => {
    auto.add(id);
    for (const x of expandFeature(db, id)) ids.add(x);
  };

  // 种族特性 + 种族自带选择表
  const race = build.race ? db.races[build.race] : null;
  if (race) for (const t of race.traits || []) addAuto(t);
  // 种族传承（可能还有下一层，例如「基本 › 一技之长」）
  for (const p of livePicks(db, raceRootSlots(db, build), build.racePicks)) {
    picks[p.slot] = p.choice;
    ids.add(p.slot);
    for (const x of expandFeature(db, p.choice)) ids.add(x);
  }
  for (const [f, p] of Object.entries(build.raceParams || {})) {
    if (!p || !ids.has(f)) continue;
    params[f] = p;
  }

  // 背景：一条链「大类 → 具体 → 子选择（如德鲁伊戏法）」，只取真正选中的那条
  const bgRoot = backgroundRoot(db);
  const bgPicks = build.bgPicks && Object.keys(build.bgPicks).length
    ? build.bgPicks
    // 兼容旧存档：只有最深的那一个背景 id，没有中间路径
    : legacyBackgroundPicks(db, build.background);
  if (bgRoot) ids.add(bgRoot.id);
  for (const p of livePicks(db, [bgRoot], bgPicks)) {
    picks[p.slot] = p.choice;
    ids.add(p.slot);
    for (const x of expandFeature(db, p.choice)) ids.add(x);
  }

  // 种族 + 职业 + 通用升级表
  const cl: Record<string, number> = {};
  for (let i = 0; i < build.levels.length; i += 1) {
    const lv = build.levels[i];
    // 通用升级表（每个角色都走）：奇数级给通用专长
    for (const fid of universalFeatures(db, i + 1)) addAuto(fid);
    if (lv.classId) {
      cl[lv.classId] = (cl[lv.classId] || 0) + 1;
      for (const fid of featuresAtClassLevel(db, lv.classId, cl[lv.classId], sel[lv.classId] || [])) {
        addAuto(fid);
      }
    }
    // 本级的挑选：从「活着的根槽位」往下走，只收真正达得到的选择
    // （换了职业/变体/改写上层选择后，残留在存档里的旧选择不会再泄漏进来）
    for (const p of livePicks(db, levelRootSlots(db, build, i + 1), lv.picks)) {
      picks[p.slot] = p.choice;
      ids.add(p.slot);
      for (const x of expandFeature(db, p.choice)) ids.add(x);
    }
    for (const [f, p] of Object.entries(lv.params || {})) {
      if (!p || !ids.has(f)) continue;
      params[f] = p;
    }
  }

  // 神祇
  if (build.deity) {
    const sel2 = db.rules.deitySelection;
    if (sel2) ids.add(sel2);
    ids.add(build.deity);
    for (const x of expandFeature(db, build.deity)) ids.add(x);
  }

  // 神话道途
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  if (path) {
    for (let r = 1; r <= MAX_RANK; r += 1) {
      const lv = build.ranks[r - 1];
      if (!lv) continue;
      for (const fid of (path.progression || []).find((x) => x.level === r)?.features || []) addAuto(fid);
      for (const p of livePicks(db, rankRootSlots(db, build, r), lv.picks)) {
        picks[p.slot] = p.choice;
        ids.add(p.slot);
        for (const x of expandFeature(db, p.choice)) ids.add(x);
      }
      for (const [f, p] of Object.entries(lv.params || {})) {
        if (!p || !ids.has(f)) continue;
        params[f] = p;
      }
    }
  }

  return { ids, picks, params, auto };
}

// ── 属性 ────────────────────────────────────────────────────────────────
/** 属性提升（4/8/12/16/20 与偶数神话等级）里选过的 */
function increases(build: Build): { level: Record<AttrId, number>[]; rank: Record<AttrId, number>[] } {
  const mk = () => ({ Strength: 0, Dexterity: 0, Constitution: 0, Intelligence: 0, Wisdom: 0, Charisma: 0 });
  const level = build.levels.map((l) => {
    const m = mk();
    if (l.ability) m[l.ability] = 1;
    return m;
  });
  const rank = build.ranks.map((r) => {
    const m = mk();
    if (r.ability) m[r.ability] = 1;
    return m;
  });
  return { level, rank };
}

/** 到第 i 个等级（1 起）为止的属性值 */
export function attrsAtLevel(db: Db, build: Build, level: number): Record<AttrId, number> {
  const out = { ...build.attributes } as Record<AttrId, number>;
  const race = build.race ? db.races[build.race] : null;
  if (race) {
    for (const b of race.statBonuses || []) {
      if ((ATTRS as string[]).includes(b.stat)) out[b.stat as AttrId] += b.value;
    }
    for (const cid of Object.values(build.racePicks || {})) {
      for (const b of db.features[cid]?.statBonuses || []) {
        if ((ATTRS as string[]).includes(b.stat)) out[b.stat as AttrId] += b.value;
      }
    }
    // 人类 / 半精灵 / 半兽人：任选一项属性 +2（蓝图里只有 SelectableRaceStat=true）
    if (race.selectableStat && build.raceStatPick) out[build.raceStatPick] += 2;
  }
  const inc = increases(build);
  for (let i = 0; i < Math.min(level, inc.level.length); i += 1) {
    for (const a of ATTRS) out[a] += inc.level[i][a];
  }
  for (const a of ATTRS) out[a] += num(build.attrManual[a]);
  return out;
}

/** 用构建时选的点买数（不含种族/升级）算点买花费 */
export function pointBuySpent(db: Db, build: Build): number {
  const table = db.rules.pointBuy || {};
  let sum = 0;
  for (const a of ATTRS) sum += num(table[String(build.attributes[a])]);
  return sum;
}

/** 每个等级内的上下文（用来算前置条件能不能满足） */
export function levelCtxList(db: Db, build: Build, d: Derived): LevelCtx[] {
  const skillRanks: Record<string, number> = {};
  for (const s of d.skills) skillRanks[s.id] = s.ranks;
  const profArmor: string[] = [];
  const profWeapon: string[] = [];
  for (const id of d.owned.ids) {
    const p = db.features[id]?.proficiencies;
    if (!p) continue;
    for (const a of p.armor || []) profArmor.push(a);
    for (const w of p.weapon || []) profWeapon.push(w);
  }
  const out: LevelCtx[] = [];
  for (let L = 1; L <= MAX_LEVEL; L += 1) {
    const trunc: Build = {
      ...build,
      levels: build.levels.slice(0, L),
      ranks: build.ranks.slice(0, Math.max(0, Math.floor(L / 2))),
    };
    const o = ownedFeatures(db, trunc);
    const clv: Record<string, number> = {};
    const curArch: string[] = [];
    for (let i = 0; i < L; i += 1) {
      const c = build.levels[i]?.classId;
      if (c) clv[c] = (clv[c] || 0) + 1;
    }
    const sel = archSel(db, build);
    for (const [cid, list] of Object.entries(sel)) {
      if (clv[cid]) curArch.push(...list);
    }
    out.push({
      atLevel: L,
      classLevels: clv,
      attrs: attrsAtLevel(db, build, L),
      idSet: o.ids,
      alignment: build.alignment,
      race: build.race,
      background: build.background,
      mythicPath: build.mythicPath,
      skillRanks,
      archLevels: archLevels(db, trunc),
      currentArchetypes: curArch,
      profArmor,
      profWeapon,
      maxSpellLevel: d.maxSpellLevel,
    });
  }
  return out;
}

// ── 汇总推导 ────────────────────────────────────────────────────────────
export interface SkillInfo {
  id: string; name: string; nameEn: string;
  attr: AttrId; ranks: number; bonus: number; total: number;
  classSkill: boolean;
}

export interface SpellPick {
  classId: string; className: string;
  spellbookId?: string;
  castingAttr?: AttrId;
  spontaneous: boolean;
  allSpellsKnown: boolean;
  maxSpellLevel: number;
  spellsPerDay: number[];
  knownCount: number | null;
  /** 可选法术：level -> 法术列表 */
  byLevel: Record<number, SpellEntry[]>;
  /** 已选（挑出来的 those） */
  chosen: string[];
}

export interface Derived {
  level: number;
  rank: number;
  classLevels: Record<string, number>;
  archLevels: Record<string, number>;
  archSel: Record<string, string[]>;
  attrs: Record<AttrId, number>;
  owned: Owned;
  bab: number;
  fort: number;
  ref: number;
  will: number;
  hp: number;
  skillPointsTotal: number;
  skills: SkillInfo[];
  skillSpent: number;
  ac: number;
  savesMisc: { fort: number; ref: number; will: number };
  maxSpellLevel: Record<string, number>;
  spells: SpellPick[];
  proficiencies: { armor: string[]; weapon: string[] };
  /** 没选完的槽位（按等级） */
  unfinished: string[];
}

/** 每个等级给多少技能点（职业基础 + 智力调整 + 特性加成，逐级算） */
export function skillPointsTotal(db: Db, build: Build): number {
  const sel = archSel(db, build);
  let sum = 0;
  let count = 0;
  const cl: Record<string, number> = {};
  for (let i = 0; i < build.levels.length; i += 1) {
    const lv = build.levels[i];
    if (!lv.classId) continue;
    count += 1;
    cl[lv.classId] = (cl[lv.classId] || 0) + 1;
    const c = db.classes[lv.classId];
    const attrs = attrsAtLevel(db, build, count);
    let n = num(c?.skillPoints, 2) + attrMod(attrs.Intelligence);
    for (const fid of featuresAtClassLevel(db, lv.classId, cl[lv.classId], sel[lv.classId] || [])) {
      n += db.features[fid]?.skillPointsPerLevel || 0;
    }
    for (const cid of Object.values(lv.picks || {})) {
      n += db.features[cid]?.skillPointsPerLevel || 0;
    }
    for (const fid of universalFeatures(db, i + 1)) {
      n += db.features[fid]?.skillPointsPerLevel || 0;
    }
    sum += n;
  }
  return Math.max(0, sum);
}

function spellLevelsForClass(db: Db, classId: string): Record<number, SpellEntry[]> {
  const out: Record<number, SpellEntry[]> = {};
  for (const s of Object.values(db.spells)) {
    const lv = s.levels?.[classId];
    if (typeof lv !== "number") continue;
    (out[lv] ||= []).push(s);
  }
  for (const k of Object.keys(out)) out[+k].sort((a, b) => label(a).localeCompare(label(b), "zh"));
  return out;
}

/** 该职业等级能施放的最高法术环位 */
function maxCastableLevel(c: ClassEntry | undefined, sbId: string | undefined, db: Db, classLevel: number): number {
  const sb = sbId ? db.spellbooks[sbId] : undefined;
  if (!sb) return 0;
  const row = sb.spellsPerDay?.[classLevel] || [];
  let mx = 0;
  for (let i = 0; i < row.length; i += 1) if (num(row[i]) > 0) mx = i;
  return mx;
}

export function derive(db: Db, build: Build): Derived {
  const cl = classLevels(build);
  const sel = archSel(db, build);
  const owned = ownedFeatures(db, build);
  const level = charLevel(build);
  const rank = build.mythicPath ? MAX_RANK : 0;
  const attrs = attrsAtLevel(db, build, level);

  let bab = 0; let fort = 0; let ref = 0; let will = 0; let hp = 0;
  const casterLevelsMap: Record<string, number> = {};
  for (const [cid, n] of Object.entries(cl)) {
    const c = db.classes[cid];
    if (!c) continue;
    bab += num(c.bab?.[n]);
    fort += num(c.fort?.[n]);
    ref += num(c.ref?.[n]);
    will += num(c.will?.[n]);
    const sides = parseInt(String(c.hitDie || "d8").replace(/[^0-9]/g, ""), 10) || 8;
    hp += Math.max(1, Math.floor(sides / 2) + 1) * n;
    if (c.spellbookId) casterLevelsMap[cid] = n;
  }
  // 1 级的生命骰按满骰算
  for (const [cid, n] of Object.entries(cl)) {
    if (n < 1) continue;
    const c = db.classes[cid];
    const sides = parseInt(String(c?.hitDie || "d8").replace(/[^0-9]/g, ""), 10) || 8;
    hp += sides - (Math.floor(sides / 2) + 1);
  }
  if (level > 0) hp += attrMod(attrs.Constitution) * level;
  hp = Math.max(1, hp);

  // 特性给的非属性加值（技能 / 豁免 / AC 之类）
  const skillBonus: Record<string, number> = {};
  const savesMisc = { fort: 0, ref: 0, will: 0 };
  const proficiencies = { armor: new Set<string>(), weapon: new Set<string>() };
  let hpBonus = 0;
  let acMisc = 0;
  for (const id of owned.ids) {
    const f = db.features[id];
    if (!f) continue;
    for (const b of f.statBonuses || []) {
      const stat = CHECK_ALIAS[b.stat] || b.stat;
      if ((ATTRS as string[]).includes(stat)) continue;
      if (stat.startsWith("Skill")) skillBonus[stat] = (skillBonus[stat] || 0) + b.value;
      else if (stat === "SaveFortitude") savesMisc.fort += b.value;
      else if (stat === "SaveReflex") savesMisc.ref += b.value;
      else if (stat === "SaveWill") savesMisc.will += b.value;
      else if (stat === "AC") acMisc += b.value;
      else if (stat === "HitPoints" || stat === "HP") hpBonus += b.value;
    }
    const pf = (f as FeatureEntry & { proficiencies?: { armor?: string[]; weapon?: string[] } }).proficiencies;
    if (pf) {
      for (const a of pf.armor || []) proficiencies.armor.add(a);
      for (const w of pf.weapon || []) proficiencies.weapon.add(w);
    }
  }
  hp += hpBonus;

  const skillListSrc = db.rules.skills;
  const classSkillSet = new Set<string>();
  for (const cid of Object.keys(cl)) {
    const c = db.classes[cid];
    for (const s of c?.classSkills || []) classSkillSet.add(CHECK_ALIAS[s] || s);
  }

  const skills: SkillInfo[] = skillListSrc.map((s) => {
    const attr = SKILL_ATTR[s.id] || "Intelligence";
    const ranks = num(build.skills[s.id]);
    const bonus = num(skillBonus[s.id]);
    return {
      id: s.id, name: s.name, nameEn: s.nameEn, attr,
      ranks, bonus, total: ranks + attrMod(attrs[attr]) + bonus,
      classSkill: classSkillSet.has(s.id),
    };
  });
  const skillSpent = skills.reduce((a, s) => a + s.ranks, 0);
  const total = skillPointsTotal(db, build);

  // 法术
  const spells: SpellPick[] = [];
  const maxSpellLevel: Record<string, number> = {};
  for (const [cid, n] of Object.entries(cl)) {
    const c = db.classes[cid];
    if (!c) continue;
    let sbId = c.spellbookId;
    for (const a of sel[cid] || []) {
      const ar = db.archetypes[a];
      if (ar?.newSpellbook && !ar.replace) sbId = ar.newSpellbook;
    }
    if (!sbId) continue;
    const sb = db.spellbooks[sbId];
    const mx = maxCastableLevel(c, sbId, db, n);
    maxSpellLevel[cid] = mx;
    const byLevel = spellLevelsForClass(db, cid);
    const castingAttr = sb?.castingAttribute as AttrId | undefined;
    spells.push({
      classId: cid,
      className: label(c),
      spellbookId: sbId,
      castingAttr,
      spontaneous: !!sb?.spontaneous,
      allSpellsKnown: !!sb?.allSpellsKnown,
      maxSpellLevel: mx,
      spellsPerDay: (sb?.spellsPerDay?.[n] || []).map((x) => num(x)),
      knownCount: sb?.spellsKnown ? num(sb.spellsKnown[n], -1) : null,
      byLevel,
      chosen: build.spells[cid] || [],
    });
  }

  // 没选完的槽位
  const unfinished: string[] = [];
  if (!build.race) unfinished.push("未选种族");
  if (!build.background) unfinished.push("未选背景");
  if (!build.alignment) unfinished.push("未选阵营");
  if (build.name.trim() === "") unfinished.push("未填角色名");
  const remainingPointBuy = db.rules.pointBuyTotal - pointBuySpent(db, build);
  if (remainingPointBuy < 0) unfinished.push(`点买超支 ${-remainingPointBuy} 点`);
  if (skillSpent > total) unfinished.push(`技能点超支 ${skillSpent - total} 点`);
  for (let i = 0; i < MAX_LEVEL; i += 1) {
    const lv = build.levels[i];
    if (!lv.classId) unfinished.push(`第 ${i + 1} 级未选职业`);
  }

  return {
    level, rank, classLevels: cl, archLevels: archLevels(db, build), archSel: sel,
    attrs, owned, bab, fort: fort + savesMisc.fort, ref: ref + savesMisc.ref,
    will: will + savesMisc.will, hp, skillPointsTotal: total, skills,
    skillSpent, ac: 10 + attrMod(attrs.Dexterity) + acMisc, savesMisc,
    maxSpellLevel, spells, proficiencies: { armor: [...proficiencies.armor], weapon: [...proficiencies.weapon] },
    unfinished,
  };
}

// ── 前置条件 ────────────────────────────────────────────────────────────
export interface LevelCtx {
  /** 评估点：到这一级为止 */
  atLevel: number;
  /** 职业等级（在评估点上的） */
  classLevels: Record<string, number>;
  attrs: Record<AttrId, number>;
  idSet: Set<string>;
  alignment: string | null;
  race: string | null;
  background: string | null;
  mythicPath: string | null;
  /** 技能点数（判定 SkillXxx ≥ N 用） */
  skillRanks?: Record<string, number>;
  /** 变体等级 */
  archLevels?: Record<string, number>;
  /** 该职业当前已选的变体（判定 noarch 用） */
  currentArchetypes?: string[];
  profArmor?: string[];
  profWeapon?: string[];
  /** classId -> 能施放的最高法术环位 */
  maxSpellLevel?: Record<string, number>;
}

export function evalPrereq(db: Db, ctx: LevelCtx, p: Prereq): Verdict {
  const has = (id?: string | null) => !!id && ctx.idSet.has(id);
  const num2 = (v: unknown) => (typeof v === "number" ? v : undefined);
  switch (p.k) {
    case "feat":
    case "hasfeature":
      return has(p.id as string) ? "ok" : "no";
    case "nofeat":
      return has(p.id as string) ? "no" : "ok";
    case "oneof": {
      const ids = (p.ids as string[]) || [];
      const need = num2(p.amount) ?? 1;
      const n = ids.filter((x) => ctx.idSet.has(x)).length;
      return n >= need ? "ok" : "no";
    }
    case "stat":
    case "statfull": {
      const stat = String(p.stat || "");
      const need = num2(p.v) ?? 1;
      const key = CHECK_ALIAS[stat] || stat;
      if ((ATTRS as string[]).includes(key)) return ctx.attrs[key as AttrId] >= need ? "ok" : "no";
      if (key.startsWith("Skill")) {
        // 这里比较的是技能点数，由调用方注入
        const ranks = ctx.skillRanks ? num(ctx.skillRanks[key]) : undefined;
        if (ranks === undefined) return "unknown";
        return ranks >= need ? "ok" : "no";
      }
      return "unknown";
    }
    case "clvl": {
      const n = num(ctx.classLevels[String(p.class)] || 0);
      return n >= (num2(p.v) ?? 1) ? "ok" : "no";
    }
    case "nocl":
      return num(ctx.classLevels[String(p.class)] || 0) === 0 ? "ok" : "no";
    case "alvl": {
      const arch = String(p.arch || "");
      return num(ctx.archLevels?.[arch]) >= (num2(p.v) ?? 1) ? "ok" : "no";
    }
    case "noarch":
      return (ctx.currentArchetypes || []).includes(String(p.arch)) ? "no" : "ok";
    case "chlvl":
      return ctx.atLevel >= (num2(p.v) ?? 1) ? "ok" : "no";
    case "align": {
      const want = (p.v as string[]) || [];
      if (!ctx.alignment) return "unknown";
      const a = ctx.alignment;
      if (want.includes(a)) return "ok";
      const L = a.startsWith("Lawful") ? "Lawful" : a.startsWith("Chaotic") ? "Chaotic" : "Neutral";
      const G = a.endsWith("Good") ? "Good" : a.endsWith("Evil") ? "Evil" : "Neutral";
      if (want.includes(L) || want.includes(G)) return "ok";
      return "no";
    }
    case "prof": {
      const arm = (p.armor as string[]) || [];
      const wep = (p.weapon as string[]) || [];
      if (!arm.length && !wep.length) return "unknown";
      const okA = arm.every((x) => (ctx.profArmor || []).includes(x));
      const okW = wep.every((x) => (ctx.profWeapon || []).includes(x));
      return okA && okW ? "ok" : "no";
    }
    case "notprof": {
      const arm = (p.armor as string[]) || [];
      const wep = (p.weapon as string[]) || [];
      const hasA = arm.some((x) => (ctx.profArmor || []).includes(x));
      const hasW = wep.some((x) => (ctx.profWeapon || []).includes(x));
      return hasA || hasW ? "no" : "ok";
    }
    case "ispet":
    case "pet":
      return "ok"; // 玩家角色不是宠物；这些条件只用于区分宠物界面
    case "paramfeat":
    case "paramweapon":
      return has(p.id as string) ? "ok" : "no";
    case "classspell": {
      const cid = String(p.class);
      const need = num2(p.v) ?? 1;
      const mx = ctx.maxSpellLevel?.[cid];
      if (mx === undefined) return "unknown";
      return mx >= need ? "ok" : "no";
    }
    case "casterspell":
    case "castertype":
    case "spellbook":
      return "unknown"; // 需要完整的法术书模型才能判定，先不拦
    case "condition":
    case "weaponcond":
    case "replacestat":
    case "selpossible":
    case "classlevels":
      return "unknown";
    default:
      return "unknown";
  }
}

export function evalPrereqs(db: Db, ctx: LevelCtx, list: Prereq[] | undefined): {
  verdict: Verdict; details: { p: Prereq; v: Verdict }[];
} {
  if (!list || !list.length) return { verdict: "ok", details: [] };
  const details = list.map((p) => ({ p, v: evalPrereq(db, ctx, p) }));
  const all = details.filter((d) => (d.p.group || "All") !== "Any");
  const any = details.filter((d) => (d.p.group || "All") === "Any");
  let verdict: Verdict = "ok";
  for (const d of all) {
    if (d.v === "no") { verdict = "no"; break; }
    if (d.v === "unknown") verdict = "unknown";
  }
  if (verdict !== "no" && any.length) {
    const best = any.some((d) => d.v === "ok") ? "ok" : any.some((d) => d.v === "unknown") ? "unknown" : "no";
    if (best === "no") verdict = "no";
    else if (best === "unknown" && verdict === "ok") verdict = "unknown";
  }
  return { verdict, details };
}

/** 选择表里某个选项在当前构筑下能不能选 */
export function choiceVerdict(db: Db, ctx: LevelCtx, fid: string, opts?: {
  excludeIds?: Set<string>;
}): Verdict {
  const f = db.features[fid];
  if (!f) return "unknown";
  if (ctx.idSet.has(fid) && !(f.ranks && f.ranks > 1)) {
    // 已经拿过的专长不能再拿（Ranks>1 的可以叠）
    if (opts?.excludeIds?.has(fid)) return "unknown";
  }
  return evalPrereqs(db, ctx, f.prereq).verdict;
}

// ── 中文描述用的前置条件文本 ────────────────────────────────────────────
export function prereqText(db: Db, p: Prereq): string {
  const nm = (id?: unknown) => (typeof id === "string" ? label(db.features[id]) : "?");
  switch (p.k) {
    case "feat": return `需要：${nm(p.id)}`;
    case "hasfeature": return `需要：${nm(p.id)}`;
    case "nofeat": return `不能有：${nm(p.id)}`;
    case "oneof": return `需要以下之一：${((p.ids as string[]) || []).map(nm).join(" / ")}`;
    case "stat": {
      const s = String(p.stat || "");
      const attr = (ATTRS as string[]).includes(s) ? label(db.rules.attributes.find((a) => a.id === s)) : null;
      const sk = db.rules.skills.find((x) => x.id === (CHECK_ALIAS[s] || s));
      return `${attr || sk?.name || s} ≥ ${p.v}`;
    }
    case "statfull": return `${p.stat} ≥ ${p.v}`;
    case "clvl": return `${label(db.classes[String(p.class)])} 职业等级 ≥ ${p.v}`;
    case "nocl": return `非 ${label(db.classes[String(p.class)])}`;
    case "chlvl": return `角色等级 ≥ ${p.v}`;
    case "align": return `阵营：${((p.v as string[]) || []).join(" / ")}`;
    case "prof": return `擅长：${[...((p.armor as string[]) || []), ...((p.weapon as string[]) || [])].join(" / ")}`;
    case "notprof": return `不擅长：${[...((p.armor as string[]) || []), ...((p.weapon as string[]) || [])].join(" / ")}`;
    case "alvl": return `需要 ${label(db.classes[String(p.class)])} 的变体等级 ≥ ${p.v}`;
    case "noarch": return `不能是该职业的变体`;
    case "classspell": return `${label(db.classes[String(p.class)])} 能施放 ${p.v} 环法术`;
    case "classlevels": return `${label(db.classes[String(p.class)])} 等级按 ${label(db.classes[String(p.fake)])} 计算`;
    case "ispet":
    case "pet": return "（宠物专用条件）";
    case "paramfeat": return `需要：${nm(p.id)}（某一种选择）`;
    case "paramweapon": return `需要：${nm(p.id)}`;
    default: return "条件复杂，需在游戏内确认";
  }
}

// ── 其它小工具 ─────────────────────────────────────────────────────────
export function childFeatures(db: Db, f: FeatureEntry): FeatureEntry[] {
  return (f.choices || []).map((c) => db.features[c]).filter(Boolean) as FeatureEntry[];
}

export function traitList(db: Db, race: RaceEntry | null): FeatureEntry[] {
  if (!race) return [];
  return (race.traits || []).map((t) => db.features[t]).filter(Boolean) as FeatureEntry[];
}
