/**
 * 构筑推导与规则校验。
 *
 * 原则：能用游戏数据的都用数据 —— 升级表、变体增删、BAB/豁免、生命骰、技能点、
 * 法术位、法术表、前置条件全部来自 web/public/data/。
 * 只有游戏数据里确实没有的（技能关键属性、点买花费表）才写死，并在注释里说明。
 */
import type {
  AttrId, BackgroundEntry, ClassEntry, Db, FeatureEntry, MythicPathEntry, Prereq,
  RaceEntry, SpellEntry, SpellbookEntry,
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
  return e.name || e.nameEn || "（未命名）";
}

/** 有没有可显示的名字。游戏里有些内部占位特性（射线/接触命中计算、法术书包装、宠物特性……）压根没有名字，
 *  它们会出现在职业升级表里；按游戏的做法，这些不列进「本级获得」，只当内部数据用。 */
export function isNamed(e: { name?: string; nameEn?: string } | null | undefined): boolean {
  return !!(e && (e.name || e.nameEn));
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

/**
 * 神话英雄：选道途之前的那几阶走的就是它（`Mythic/MythicStartingClass.jbp`，7 级）。
 * 第 1 阶选「超凡飞升」+ 一项神话能力，第 2 阶一项神话专长，之后逐阶交替。
 */
export function mythicHeroPath(db: Db): MythicPathEntry | undefined {
  return Object.values(db.mythic.paths).find(
    (p) => !p.selectable && /MythicStartingClass/.test(p.path || ""),
  );
}

/**
 * 道途从第几阶开始生效。
 * 数据事实：主道途（天使/恶魔/御衡者/灵使/诡计大师/巫妖）升级表 8 级，晚期道途（金龙/虫群/魔鬼）3 级，
 * 神话英雄 7 级；7+3=10、2+8=10，所以主道途从第 3 阶起、晚期道途从第 8 阶起。
 * 社区记录一致：1-2 阶是通用「神话英雄」，第 3 阶（第 2 章结尾）选道途，第 8 阶可换晚期道途。
 */
export function pathStartRank(db: Db, path?: MythicPathEntry | null): number {
  if (!path) return 1;
  if (/MythicStartingClass/.test(path.path || "")) return 1;
  const levels = (path.progression || []).length;
  if (levels >= 8) return 3;
  return 8; // 金龙 / 虫群行者 / 魔鬼 / 传奇 / 碎片之力
}

/** 第 rank 阶由谁提供内容：神话英雄（还没到道途起点）还是已选道途，以及对应它的第几级 */
export function mythicSource(
  db: Db,
  build: Build,
  rank: number,
): { owner: MythicPathEntry | null; level: number; features: string[] } {
  const hero = mythicHeroPath(db);
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  const start = pathStartRank(db, path);
  const useHero = !path || rank < start;
  const owner = useHero ? hero || null : path;
  const level = useHero ? rank : rank - start + 1;
  const features = (owner?.progression || []).find((x) => x.level === level)?.features || [];
  return { owner, level, features };
}

/** 某个神话等级要玩家做选择的槽位（英雄/道途自家的内容优先，没有就走通用神话能力/专长） */
export function rankRootSlots(db: Db, build: Build, rank: number): FeatureEntry[] {
  const ids = mythicSource(db, build, rank).features;
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

/**
 * 神话道途自己的法术书（天使 / 灵使 / 巫妖 / 恶魔 / 御衡者 / 诡计大师 / 金龙）。
 *
 * 数据事实：法术池写在**法术**上的 `mythicLevels[<道途 id>]`（不是法术书 id）——
 * 天使 85 条、巫妖 131 条、灵使 85 条…；道途蓝图的 `spellbookId` 给的是
 * 那张 `spellsPerDay` 表（按等级索引 1..20）。
 *
 * 天使与巫妖的法术书会**并进**施法职业的法术书（所以可施放环位跟着角色等级走），
 * 其余道途是独立的法术书（跟神话阶层走）。
 */
export interface MythicSpellbook {
  pathId: string;
  pathName: string;
  spellbookId: string;
  book: SpellbookEntry;
  /** 法术 id → 环位 */
  pool: Record<string, number>;
  /** 环位 → 法术 */
  byLevel: Record<number, SpellEntry[]>;
  maxLevel: number;
  merged: boolean;
}

/** 会并进职业法术书的两条道途（其余都是独立法术书） */
const MERGED_MYTHIC_BOOKS = new Set(["AngelMythicClass", "LichMythicClass"]);

export function mythicSpellbook(db: Db, build: Build): MythicSpellbook | null {
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  const sbId = path?.spellbookId;
  if (!path || !sbId) return null;
  const book = db.spellbooks[sbId];
  if (!book) return null;

  const pool: Record<string, number> = {};
  for (const s of Object.values(db.spells)) {
    const lv = s.mythicLevels?.[path.id];
    if (lv === undefined || lv === null) continue;
    pool[s.id] = num(lv);
  }
  const byLevel: Record<number, SpellEntry[]> = {};
  for (const [sid, lv] of Object.entries(pool)) {
    const L = num(lv);
    const e = db.spells[sid];
    if (!e) continue;
    (byLevel[L] = byLevel[L] || []).push(e);
  }

  const merged = MERGED_MYTHIC_BOOKS.has(String(path.key || ""));
  // 实测：所有道途法术书的 spellsPerDay 都是按**角色等级**（1..20）索引的 ——
  // 合并的两条从 1 级就有（天使 1 级 1 个 1 环），独立的四条从 6 级起（灵使 6 级 [1=2]）。
  const idx = Math.max(1, Math.min(20, charLevel(build)));
  const row = (book.spellsPerDay?.[idx] || []).map((x) => num(x));
  let maxLevel = 0;
  row.forEach((n, l) => {
    if (n > 0) maxLevel = Math.max(maxLevel, l);
  });

  return {
    pathId: path.id,
    pathName: path.name || path.nameEn || "",
    spellbookId: sbId,
    book,
    pool,
    byLevel,
    maxLevel,
    merged,
  };
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

  // 神话：1–2 阶（晚期道途是 1–7 阶）都还是「神话英雄」，之后才是道途自己的升级表。
  // 只认已经走到的阶层，否则选了道途就把 10 阶特性全算上。
  {
    const reached = Math.max(1, mythicRank(build));
    for (let r = 1; r <= Math.min(MAX_RANK, reached); r += 1) {
      const lv = build.ranks[r - 1];
      if (!lv) continue;
      for (const fid of mythicSource(db, build, r).features) addAuto(fid);
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

/** 神话阶层：已填过内容的最高那一阶（什么都没填就是 0）。没有道途也能有 1–2 阶神话英雄 */
export function mythicRank(build: Build): number {
  let last = 0;
  for (let i = 0; i < build.ranks.length; i += 1) {
    if (Object.keys(build.ranks[i]?.picks || {}).length > 0) last = i + 1;
  }
  return last;
}

/** 非玩家单位的属性加值（宠物升级 / 怪物模板）不算在角色头上 */
const NON_PC_FEATURE = /\/(?:Pets|Monsters|Units|CreatureAbilities)\/|AnimalCompanion/i;

/**
 * 恶魔的高等恶魔之相：蓝图里只有文字「属性获得等于神话阶层一半加上一的加值」，没有数值组件。
 * 沤泥魔相（DR）与食魂厉魔相（快速回复）不给属性，故不在此表内。
 */
const DEMON_ASPECT_ATTR: Record<string, AttrId> = {
  "威加魔相": "Strength",
  "霸烙魔相": "Constitution",
  "空奢魔相": "Intelligence",
  "遁影魔相": "Wisdom",
};

/** 一条属性的来源拆分（基础 / 种族 / 升级 / 特性与道途 / 手工） */
export interface AttrBreak {
  base: number; race: number; level: number; feat: number; manual: number; total: number;
}

const inAttrs = (s: string) => (ATTRS as string[]).includes(s);

/** 属性拆分：每一栏都各自算，界面照这个显示，`attrsAtLevel()` 只是它的 total */
export function attrBreakdown(
  db: Db,
  build: Build,
  level?: number,
  ownedIds?: Set<string>,
): Record<AttrId, AttrBreak> {
  const lv = level ?? charLevel(build);
  const ids = ownedIds || ownedFeatures(db, build).ids;
  const out = {} as Record<AttrId, AttrBreak>;
  for (const a of ATTRS) {
    out[a] = { base: num(build.attributes[a]), race: 0, level: 0, feat: 0, manual: num(build.attrManual[a]), total: 0 };
  }
  const race = build.race ? db.races[build.race] : null;
  // 种族一栏：种族自身的属性调整 + 传承/氏族等选择的加值 + 任选一项 +2
  const raceIds = new Set<string>();
  if (race) {
    for (const b of race.statBonuses || []) if (inAttrs(b.stat)) out[b.stat as AttrId].race += b.value;
    for (const p of livePicks(db, raceRootSlots(db, build), build.racePicks)) {
      for (const x of expandFeature(db, p.choice)) raceIds.add(x);
    }
    if (race.selectableStat && build.raceStatPick) out[build.raceStatPick].race += 2;
  }
  // 已获得特性带来的属性加值：种族传承 / 背景 / 专长 / 职业特性 / 神话道途特性
  for (const id of ids) {
    const f = db.features[id];
    if (!f || NON_PC_FEATURE.test(f.path || "")) continue;
    for (const b of f.statBonuses || []) {
      if (inAttrs(b.stat)) out[b.stat as AttrId][raceIds.has(id) ? "race" : "feat"] += b.value;
    }
  }
  const inc = increases(build);
  for (let i = 0; i < Math.min(lv, inc.level.length); i += 1) {
    for (const a of ATTRS) out[a].level += inc.level[i][a];
  }
  // 神话道途里「按文字生效」的属性加值（蓝图没给数值）
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  const mr = mythicRank(build);
  // 传奇的全属性 +4 也要道途真的生效（阶层走到它的起点）才算，晚期道途起点是第 8 阶
  if (path?.name === "传奇" && mr >= pathStartRank(db, path)) {
    for (const a of ATTRS) out[a].feat += 4;
  }
  if (mr > 0) {
    const v = Math.floor(mr / 2) + 1;
    for (const id of ids) {
      const a = DEMON_ASPECT_ATTR[db.features[id]?.name || ""];
      if (a) out[a].feat += v;
    }
  }
  for (const a of ATTRS) out[a].total = out[a].base + out[a].race + out[a].level + out[a].feat + out[a].manual;
  return out;
}

/** 到第 i 个等级（1 起）为止的属性值 */
export function attrsAtLevel(
  db: Db,
  build: Build,
  level: number,
  ownedIds?: Set<string>,
): Record<AttrId, number> {
  const br = attrBreakdown(db, build, level, ownedIds);
  const out = {} as Record<AttrId, number>;
  for (const a of ATTRS) out[a] = br[a].total;
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
      rank: mythicRank(trunc),
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
  const rank = mythicRank(build);
  const attrs = attrsAtLevel(db, build, level, owned.ids);

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

  // 神话道途自己的法术书（天使/灵使/巫妖/恶魔/御衡者/诡计大师/金龙）：与职业法术书并列出现，
  // `classId` 用这张法术书的 id 当 key（选择存在 build.spells[spellbookId]）。
  const mb = mythicSpellbook(db, build);
  if (mb) {
    const idx = mb.merged ? Math.max(1, Math.min(20, level)) : Math.max(1, rank);
    maxSpellLevel[mb.spellbookId] = mb.maxLevel;
    spells.push({
      classId: mb.spellbookId,
      className: `${mb.pathName} 法术书`,
      spellbookId: mb.spellbookId,
      castingAttr: mb.book.castingAttribute as AttrId | undefined,
      spontaneous: !!mb.book.spontaneous,
      allSpellsKnown: !!mb.book.allSpellsKnown,
      maxSpellLevel: mb.maxLevel,
      spellsPerDay: (mb.book.spellsPerDay?.[idx] || []).map((x) => num(x)),
      knownCount: null,
      byLevel: mb.byLevel,
      chosen: build.spells[mb.spellbookId] || [],
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
  for (const w of alignConflicts(db, build)) unfinished.push(`阵营不符：${w}`);
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
  /** 评估点上的神话阶层（判定 PrerequisiteMythicLevel 用） */
  rank?: number;
}

// ── 阵营限制 ────────────────────────────────────────────────────────────────
// 蓝图里 PrerequisiteAlignment 的 Alignment 字段是「token 列表」，token 既可能是
// 具体阵营（LawfulGood / TrueNeutral），也可能是轴（Lawful / Good / Evil / Chaotic）。
const ALIGN_AXIS: Record<string, string[]> = {
  Lawful: ["LawfulGood", "LawfulNeutral", "LawfulEvil"],
  Chaotic: ["ChaoticGood", "ChaoticNeutral", "ChaoticEvil"],
  Good: ["LawfulGood", "NeutralGood", "ChaoticGood"],
  Evil: ["LawfulEvil", "NeutralEvil", "ChaoticEvil"],
  Neutral: ["TrueNeutral"],
  TrueNeutral: ["TrueNeutral"],
};

export function alignTokensOf(list: Prereq[] | undefined | null): string[] {
  const out: string[] = [];
  for (const p of list || []) {
    if (p.k !== "align") continue;
    for (const t of (p.v as string[]) || []) if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 空 token = 无限制；没选阵营时不拦人（按「未知」处理） */
export function alignAllows(alignment: string | null | undefined, tokens: string[]): boolean {
  if (!tokens.length || !alignment) return true;
  for (const t of tokens) {
    if (t === alignment) return true;
    const axis = ALIGN_AXIS[t];
    if (axis && axis.includes(alignment)) return true;
  }
  return false;
}

export function alignNeedText(db: Db, tokens: string[]): string {
  const known = new Map(db.rules.alignments.map((a) => [a.id, a.name]));
  return tokens.map((t) => known.get(t) || t).join(" / ");
}

/**
 * 职业 + 已选变体合起来的阵营要求。
 *
 * 规则：**变体自带的阵营要求会取代母职业的阵营要求**。全库 197 个变体 × 39 个职业里，
 * 只有一处出现互斥：武僧（守序）× 醉拳大师（NeutralGood, TrueNeutral, NeutralEvil, Chaotic）——
 * 两个集合交集为空，如果按「同时满足」判定，醉拳大师对任何角色都不可选，
 * 而游戏自己给这个变体标的阵营就是「任意非守序」，所以取变体为准（详见 docs/data-format.md）。
 */
export function classAlignTokens(db: Db, classId: string | null | undefined, archIds?: string[]): string[] {
  const arch: string[] = [];
  for (const a of archIds || []) {
    for (const t of alignTokensOf(db.archetypes[a]?.prereq)) if (!arch.includes(t)) arch.push(t);
  }
  if (arch.length) return arch;
  return classId ? alignTokensOf(db.classes[classId]?.prereq) : [];
}

/** 变体的阵营要求覆盖了母职业时返回详情（给界面写说明用），否则 null */
export function alignOverrideOf(
  db: Db,
  classId: string | null | undefined,
  archIds?: string[],
): { archId: string; archName: string; tokens: string[]; classTokens: string[] } | null {
  const hit = (archIds || []).find((a) => alignTokensOf(db.archetypes[a]?.prereq).length > 0);
  if (!hit) return null;
  const classTokens = classId ? alignTokensOf(db.classes[classId]?.prereq) : [];
  if (!classTokens.length) return null;
  return {
    archId: hit,
    archName: db.archetypes[hit]?.name || hit,
    tokens: alignTokensOf(db.archetypes[hit]?.prereq),
    classTokens,
  };
}

export function deityAlignTokens(db: Db, deityId: string | null | undefined): string[] {
  return deityId ? alignTokensOf(db.features[deityId]?.prereq) : [];
}

/**
 * 这个职业在当前阵营下能不能选。
 *
 * 母职业的阵营要求满足 → 可以；否则，如果它有一个自带阵营要求、且当前阵营满足那个要求的变体
 * → 也可以（因为选了那个变体，要求就被取代了；游戏里也是这样，武僧 + 醉拳大师 = 任意非守序）。
 * 调用方拿到 viaArchetype 时应当提示「需要 X，或选 Y 则任意非守序」。
 */
export function classSelectableAt(
  db: Db,
  classId: string,
  alignment: string | null | undefined,
): { ok: boolean; reason: string; viaArchetype?: string } {
  const toks = alignTokensOf(db.classes[classId]?.prereq);
  if (alignAllows(alignment, toks)) return { ok: true, reason: "" };
  for (const aid of db.classes[classId]?.archetypes || []) {
    const at = alignTokensOf(db.archetypes[aid]?.prereq);
    if (at.length && alignAllows(alignment, at)) {
      return { ok: true, reason: "", viaArchetype: db.archetypes[aid]?.name || aid };
    }
  }
  return { ok: false, reason: alignNeedText(db, toks) };
}

/** 某个阵营下，已选内容里所有「阵营不符」的原因 */
function alignReasons(db: Db, build: Build, alignment: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lv of build.levels) {
    const cid = lv.classId;
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    const archIds = build.classArchetypes[cid] || [];
    const over = alignOverrideOf(db, cid, archIds);
    const bare = over ? over.tokens : alignTokensOf(db.classes[cid]?.prereq);
    if (!alignAllows(alignment, bare)) {
      out.push(
        over
          ? `${label(db.classes[cid])} · ${over.archName} 需要 ${alignNeedText(db, bare)}`
          : `${label(db.classes[cid])} 需要 ${alignNeedText(db, bare)}`,
      );
    }
    for (const aid of archIds) {
      if (over && aid === over.archId) continue; // 已被上面那条取代，别报两遍
      const at = alignTokensOf(db.archetypes[aid]?.prereq);
      if (!alignAllows(alignment, at)) {
        out.push(`${db.archetypes[aid]?.name || aid} 需要 ${alignNeedText(db, at)}`);
      }
    }
  }
  const dt = deityAlignTokens(db, build.deity);
  if (build.deity && !alignAllows(alignment, dt)) {
    out.push(`神祇 ${label(db.features[build.deity])} 只接受 ${alignNeedText(db, dt)}`);
  }
  return out;
}

/** 当前构筑在所选阵营下的冲突清单（给界面显示、也进 derive().unfinished） */
export function alignConflicts(db: Db, build: Build): string[] {
  if (!build.alignment) return [];
  return alignReasons(db, build, build.alignment);
}

/** 9 个阵营各自「为什么不能用」（给阵营下拉做禁用与提示） */
export function alignmentLocks(db: Db, build: Build): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of db.rules.alignments) {
    const r = alignReasons(db, build, a.id);
    if (r.length) out[a.id] = r;
  }
  return out;
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
      // 前置里也会引用怪物 / NPC / 神话内部职业（不在 classes.json 里）：玩家永远拿不到，按「无法判定」算，不拦人也不显示
      if (!db.classes[String(p.class)]) return "unknown";
      const n = num(ctx.classLevels[String(p.class)] || 0);
      return n >= (num2(p.v) ?? 1) ? "ok" : "no";
    }
    case "nocl":
      if (!db.classes[String(p.class)]) return "unknown";
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
    case "mrank": {
      const need = num2(p.v) ?? 1;
      if (ctx.rank === undefined) return "unknown";
      return ctx.rank >= need ? "ok" : "no";
    }
    case "mainchar":
    case "etude":
      // 主角/同伴身份、剧情进度（etude）——规划器不判定，也不拦人
      return "unknown";
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
    case "oneof": {
      const need = typeof p.amount === "number" ? p.amount : 1;
      const names = ((p.ids as string[]) || []).map(nm).join(" / ");
      return need > 1 ? `需要以下 ${need} 项：${names}` : `需要以下之一：${names}`;
    }
    case "stat": {
      const s = String(p.stat || "");
      const attr = (ATTRS as string[]).includes(s) ? label(db.rules.attributes.find((a) => a.id === s)) : null;
      const sk = db.rules.skills.find((x) => x.id === (CHECK_ALIAS[s] || s));
      return `${attr || sk?.name || s} ≥ ${p.v}`;
    }
    case "statfull": return `${p.stat} ≥ ${p.v}`;
    case "clvl": return `${db.classes[String(p.class)] ? label(db.classes[String(p.class)]) : "内部职业"} 职业等级 ≥ ${p.v}`;
    case "nocl": return `非 ${db.classes[String(p.class)] ? label(db.classes[String(p.class)]) : "内部职业"}`;
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
    case "mrank": return `神话阶层 ≥ ${p.v}`;
    case "mainchar": return p.companion ? "仅同伴角色" : "仅主角";
    case "etude": return "剧情进度限定（游戏内按剧情解锁）";
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
