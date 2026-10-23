/**
 * 构筑推导与规则校验。
 *
 * 原则：能用游戏数据的都用数据 —— 升级表、变体增删、BAB/豁免、生命骰、技能点、
 * 法术位、法术表、前置条件全部来自 web/public/data/。
 * 只有游戏数据里确实没有的（技能关键属性、购点花费表）才写死，并在注释里说明。
 */
import type {
  AttrId, BackgroundEntry, ClassEntry, Db, FeatureEntry, MythicPathEntry, Prereq,
  RaceEntry, SpellEntry, SpellbookEntry,
} from "./types";
import { ATTRS, BASE_LEVEL, LEGEND_PATH_ID, MAX_LEVEL, MAX_RANK, levelCap, type Build } from "./store";

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

/**
 * 选出来的特性本身还可能是个「进程表」，要把里面的特性展开成一层的 id 列表。
 *
 * 还有一种是「中转表」：`IgnorePrerequisites:true` 且只有一个选项的隐藏选择表。
 * 游戏里它的唯一作用就是把那个唯一选项塞给玩家（诡术师的学识（宗教）2/3阶就是这样：
 * 进程表 → Selection（隐藏、忽略前置、只有一个选项）→ Parametrized），
 * 所以这里也要跟着走一层，否则 Parametrized 永远不在 idSet 里。
 * 判据不能只看「隐藏」——默认的专长/神祇选择表也是隐藏的，但选项有几百个。
 */
export function expandFeature(db: Db, id: string, depth = 0): string[] {
  if (depth > 4) return [];
  const f = db.features[id];
  if (!f) return [id];
  const out = [id];
  if (f.progression) {
    for (const e of f.progression) for (const sub of e.features) out.push(...expandFeature(db, sub, depth + 1));
    return out;
  }
  if (f.ignorePrereq && f.choices?.length === 1) {
    out.push(...expandFeature(db, f.choices[0], depth + 1));
  }
  return out;
}

/**
 * AddFacts 只在**擅长**上收：职业的擅长是 `FighterProficiencies → AddFacts → 擅长(轻/中/重甲…)`，
 * 这一层必须跟着走，否则「擅长盔甲（重型）」这类专长在逐级选择时判不出前置。
 * 但不能像 expandFeature 那样把 addFacts 全展开 —— 有些 addFacts 指向的特性自己也带属性加值
 * （例如恶魔之相），叠起来会重复计算。
 */
export function factProficiencies(db: Db, id: string, depth = 0): string[] {
  if (depth > 3) return [];
  const f = db.features[id];
  if (!f || !f.addFacts) return [];
  const out: string[] = [];
  for (const sub of f.addFacts) {
    const g = db.features[sub];
    if (!g) continue;
    if (g.proficiencies) out.push(sub);
    out.push(...factProficiencies(db, sub, depth + 1));
  }
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

/** 第 8 阶起可以换成晚期道途（金龙 / 虫群行者 / 魔鬼 / 传奇 / 碎片之力） */
export const MYTHIC_LATE_START = 8;

/** 第 rank 阶由谁提供内容：神话英雄（还没到道途起点）/ 主道途 / 第 8 阶换上的晚期道途 */
export function mythicSource(
  db: Db,
  build: Build,
  rank: number,
): { owner: MythicPathEntry | null; level: number; features: string[] } {
  const hero = mythicHeroPath(db);
  const main = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  const late = build.mythicLate ? db.mythic.paths[build.mythicLate] : null;
  // 晚期道途只在它自己的起始阶之后接管；之前的阶层仍然由主道途（或神话英雄）提供
  const lateActive = !!late && rank >= pathStartRank(db, late);
  const path = lateActive ? late : main;
  const start = pathStartRank(db, path);
  const useHero = !path || rank < start;
  const owner = useHero ? hero || null : path;
  const level = useHero ? rank : rank - start + 1;
  const features = (owner?.progression || []).find((x) => x.level === level)?.features || [];
  return { owner, level, features };
}

/** 某个神话等级要玩家做选择的槽位（英雄/道途自家的内容优先，没有就走通用神话能力/专长） */
export function rankRootSlots(db: Db, build: Build, rank: number): FeatureEntry[] {
  // 换传奇既没有第 9–10 阶；传奇自己那一阶（第 8 阶）也不给选择 ——
  // 数据里传奇 L1 是 10 个固定特性、0 个选择表（见 docs/data-format.md「传奇」）
  if (build.mythicLate === LEGEND_PATH_ID && rank > 8) return [];
  const src = mythicSource(db, build, rank);
  if (src.level > 0 && src.owner && src.owner.id === LEGEND_PATH_ID) return [];
  const ids = src.features;
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

  // 「重复获得就升级」的职业能力（upgrades.json：游戏里靠阶层条件 AddFact 实现）
  const upgraded = new Set<string>();
  const addAuto = (id: string) => {
    const up = db.upgrades?.[id];
    if (up) {
      if (upgraded.has(up)) {
        auto.add(up);
        ids.add(up);
        for (const x of expandFeature(db, up)) ids.add(x);
        for (const x of factProficiencies(db, up)) ids.add(x);
      }
      upgraded.add(up);
    }
    auto.add(id);
    for (const x of expandFeature(db, id)) ids.add(x);
    for (const x of factProficiencies(db, id)) ids.add(x);
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
/**
 * 神话阶层与角色等级的对应关系（游戏里其实是按剧情节点给的，等级只是「玩家当时大约几级」）。
 * 数值取自社区整理的解锁表（GameFAQs 攻略的 Rank/Event/Lvl 表、fextralife 页面下的同一份整理）：
 * MR1≈6 级、MR2≈8、MR3≈10、MR4≈13、MR5≈15、MR6≈17、MR7≈18、MR8≈18、MR9≈19、MR10≈20。
 * 规划器用它决定「第 N 级时最多能有几个神话阶层」，不参与剧情模拟。
 */
export const MYTHIC_RANK_LEVELS = [6, 8, 10, 13, 15, 17, 18, 18, 19, 20];

/** 角色到达 level 级时，游戏里大约已经拿到几个神话阶层（0..10） */
export function ranksAtLevel(level: number): number {
  let n = 0;
  for (const need of MYTHIC_RANK_LEVELS) if (level >= need) n += 1;
  return Math.min(n, MAX_RANK);
}

/** 第 rank 阶大约需要角色到几级 */
export function levelForRank(rank: number): number {
  return MYTHIC_RANK_LEVELS[Math.max(0, Math.min(MYTHIC_RANK_LEVELS.length - 1, rank - 1))];
}

/**
 * 反查：角色到 level 级时**新拿到**的所有神话阶层。
 * 一般只有一阶，但解锁表里 18 级同时对应第 7、第 8 阶（剧情上是连续两个节点），
 * 只取最大的那个会让第 7 阶的选择在导出的表里整行消失。
 */
export function ranksForLevel(level: number): number[] {
  const out: number[] = [];
  for (let r = 1; r <= MYTHIC_RANK_LEVELS.length; r += 1) {
    if (MYTHIC_RANK_LEVELS[r - 1] === level) out.push(r);
  }
  return out;
}

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

/** 用构建时选的购点数（不含种族/升级）算购点花费 */
export function pointBuySpent(db: Db, build: Build): number {
  const table = db.rules.pointBuy || {};
  let sum = 0;
  for (const a of ATTRS) sum += num(table[String(build.attributes[a])]);
  return sum;
}

/** 到第 level 级为止应有的基础攻击加值：各职业按自己的职业等级查表相加 */
export function babAt(db: Db, build: Build, level: number): number {
  const cl: Record<string, number> = {};
  for (let i = 0; i < level && i < build.levels.length; i += 1) {
    const cid = build.levels[i]?.classId;
    if (cid) cl[cid] = (cl[cid] || 0) + 1;
  }
  let bab = 0;
  for (const [cid, n] of Object.entries(cl)) bab += num(db.classes[cid]?.bab?.[n]);
  return bab;
}

/** 偷袭骰数：把已拥有特性里所有 SneakAttack 加值加起来（游荡者/杀手/刺客按职业等级给） */
export function sneakAt(db: Db, ids: Set<string>): number {
  let n = 0;
  for (const id of ids) {
    for (const b of db.features[id]?.statBonuses || []) {
      if (b.stat === "SneakAttack") n += num(b.value);
    }
  }
  return n;
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
  for (let L = 1; L <= levelCap(build); L += 1) {
    const trunc: Build = {
      ...build,
      levels: build.levels.slice(0, L),
      ranks: build.ranks.slice(0, ranksAtLevel(L)),
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
    // 特性「层数」：数一数这个构筑里拿了几遍（重复可选的专长会出现在多个等级）
    const factCount: Record<string, number> = {};
    const bump = (id?: string | null) => {
      if (id) factCount[id] = (factCount[id] || 0) + 1;
    };
    for (const lv of trunc.levels) for (const v of Object.values(lv.picks || {})) bump(v);
    for (const rk of trunc.ranks) for (const v of Object.values(rk.picks || {})) bump(v);
    for (const v of Object.values(trunc.racePicks || {})) bump(v);
    for (const v of Object.values(trunc.bgPicks || {})) bump(v);
    out.push({
      atLevel: L,
      classLevels: clv,
      factCount,
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
      bab: babAt(db, build, L),
      sneak: sneakAt(db, o.ids),
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
  if (remainingPointBuy < 0) unfinished.push(`购点超支 ${-remainingPointBuy} 点`);
  if (skillSpent > total) unfinished.push(`技能点超支 ${skillSpent - total} 点`);
  for (const w of alignConflicts(db, build)) unfinished.push(`阵营不符：${w}`);
  const perClass: Record<string, number> = {};
  for (let i = 0; i < levelCap(build); i += 1) {
    const lv = build.levels[i];
    if (!lv.classId) unfinished.push(`第 ${i + 1} 级未选职业`);
    else perClass[lv.classId] = (perClass[lv.classId] || 0) + 1;
  }
  for (const [cid, n] of Object.entries(perClass)) {
    if (n > BASE_LEVEL) {
      unfinished.push(`${db.classes[cid] ? label(db.classes[cid]) : cid} 排了 ${n} 级（单职业最多 ${BASE_LEVEL} 级）`);
    }
  }

  /* 已经选了的专长/特性：按它所在的那一级重新判前置（改任何一步都会立刻影响这里） */
  for (let i = 0; i < levelCap(build); i += 1) {
    const lv = build.levels[i];
    const ctx = levelCtxList(db, build, {
      level, rank, classLevels: cl, archLevels: archLevels(db, build), archSel: sel,
      attrs, owned, bab, fort, ref, will, hp, skillPointsTotal: total, skills,
      skillSpent, ac: 0, savesMisc, maxSpellLevel, spells,
      proficiencies: { armor: [], weapon: [] }, unfinished: [],
    } as any)[i];
    if (!ctx) continue;
    for (const cid of Object.values(lv.picks)) {
      if (!cid) continue;
      const f = db.features[cid];
      const pr = f?.prereq || [];
      if (!pr.length) continue;
      const res = evalPrereqs(db, ctx, pr, 0, cid);
      if (res.verdict !== "no") continue;
      const why = (res.details || []).filter((d) => d.v === "no").map((d) => prereqText(db, d.p)).join("、");
      unfinished.push(`第 ${i + 1} 级「${label(f)}」前置不满足${why ? "：" + why : ""}`);
    }
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
  /** 特性 id -> 拿了几遍（判定「该特性层数 >= N」用） */
  factCount?: Record<string, number>;
  /** 评估点上应有的基础攻击加值（判定 BaseAttackBonus 用） */
  bab?: number;
  /** 评估点上的偷袭骰数（判定 SneakAttack 用） */
  sneak?: number;
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

/** 轴 token 的中文说法（阵营本身用 db 里的名字） */
const ALIGN_AXIS_CN: Record<string, string> = {
  Lawful: "任意守序",
  Chaotic: "任意混乱",
  Good: "任意善良",
  Evil: "任意邪恶",
  Neutral: "绝对中立",
};

export function alignNeedText(db: Db, tokens: string[]): string {
  const known = new Map(db.rules.alignments.map((a) => [a.id, a.name]));
  return tokens.map((t) => known.get(t) || ALIGN_AXIS_CN[t] || t).join(" / ");
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

/** 前置里的「条件」组件树（pipeline 导出的 PrerequisiteCondition 内容） */
export interface CondNode {
  /** 叶子类型：fact 有某特性 / class 某职业等级 / align 阵营 / mrank 神话阶层 / other 未解析 */
  t?: "fact" | "factrank" | "class" | "align" | "mrank" | "other";
  id?: string | null;
  v?: string;
  min?: number;
  type?: string;
  not?: boolean;
  /** OrAndLogic */
  op?: "and" | "or";
  conds?: CondNode[];
}

const flip = (v: Verdict): Verdict => (v === "ok" ? "no" : v === "no" ? "ok" : "unknown");

function evalCondNode(db: Db, ctx: LevelCtx, node: CondNode | null | undefined, depth = 0): Verdict {
  if (!node || depth > 4) return "unknown";
  const base = (): Verdict => {
    if (node.op && node.conds) {
      const vs = node.conds.map((c) => evalCondNode(db, ctx, c, depth + 1));
      if (node.op === "and") {
        if (vs.some((v) => v === "no")) return "no";
        return vs.every((v) => v === "ok") ? "ok" : "unknown";
      }
      if (vs.some((v) => v === "ok")) return "ok";
      return vs.every((v) => v === "no") ? "no" : "unknown";
    }
    switch (node.t) {
      case "fact":
        return node.id ? (ctx.idSet.has(node.id) ? "ok" : "no") : "unknown";
      case "class": {
        if (!node.id || !db.classes[node.id]) return "unknown";
        const have = (ctx.classLevels || {})[node.id] || 0;
        return have >= (node.min || 1) ? "ok" : "no";
      }
      case "mrank":
        return typeof ctx.rank === "number" ? (ctx.rank >= (node.min || 1) ? "ok" : "no") : "unknown";
      case "factrank": {
        if (!node.id) return "unknown";
        const have = (ctx.factCount || {})[node.id] || 0;
        return have >= (node.min || 1) ? "ok" : "no";
      }
      case "align": {
        const toks = String(node.v || "").split(",").map((x) => x.trim()).filter(Boolean);
        if (!toks.length || !ctx.alignment) return "unknown";
        return alignAllows(ctx.alignment, toks) ? "ok" : "no";
      }
      default:
        return "unknown"; // ContextConditionBuffRank 之类，规划器里判不出来
    }
  };
  const v = base();
  return node.not ? flip(v) : v;
}

/** 某个「检定名」（属性 / BAB / 偷袭 / 技能）在当前上下文里的原始值（不含 replacestat 改写） */
function statValue(db: Db, ctx: LevelCtx, stat: string): number | undefined {
  const key = CHECK_ALIAS[stat] || stat;
  if ((ATTRS as string[]).includes(key)) return ctx.attrs[key as AttrId];
  // 逐级算出来的 BAB（职业表相加），不是最终攻击加值
  if (key === "BaseAttackBonus") return ctx.bab;
  if (key === "SneakAttack") return ctx.sneak;
  if (key.startsWith("Skill")) {
    // 这里比较的是技能点数，由调用方注入
    return ctx.skillRanks ? num(ctx.skillRanks[key], Number.NaN) : undefined;
  }
  return undefined;
}

/** ReplaceStatForPrerequisites.ResultStat：判前置时把一个属性值改写掉（六种策略） */
function applyReplace(db: Db, ctx: LevelCtx, q: Prereq, old: number): number {
  const lvOf = (cid: unknown) => num(ctx.classLevels[String(cid || "")] || 0);
  switch (String(q.policy || "")) {
    case "NewStat": {
      const v = statValue(db, ctx, String(q.new || ""));
      return v === undefined ? old : Math.max(old, v);
    }
    case "ClassLevel":
      return Math.max(old, lvOf(q.class));
    case "ClassLevelStacking":
      return old + lvOf(q.class);
    case "SpecificNumber":
      return Math.max(old, num(q.num as number));
    case "Summand":
      return old + num(q.num as number);
    // 魔战士：BAB 按职业等级折算（源码 float*0.25f+0.75f 取整）
    case "MagusBaseAttack":
      return old + Math.trunc(lvOf(q.class) * 0.25 + 0.75);
    default:
      return old;
  }
}

/** 已拥有特性里那些「改写器」组件的汇总（它们不是门槛，是判别人前置时怎么算数） */
interface PrereqExtras {
  /** 旧属性名 -> 改写器列表 */
  replaceStats: Record<string, Prereq[]>;
  /** 被折算的职业 -> 折算来源（ClassLevelsForPrerequisites） */
  classLevelBonus: Record<string, { class: string; mod: number; sum: number; sel: string }[]>;
}
const EXTRAS_CACHE = new WeakMap<object, PrereqExtras>();

function prereqExtras(db: Db, ctx: LevelCtx): PrereqExtras {
  const hit = EXTRAS_CACHE.get(ctx.idSet);
  if (hit) return hit;
  const out: PrereqExtras = { replaceStats: {}, classLevelBonus: {} };
  for (const id of ctx.idSet) {
    for (const q of db.features[id]?.prereq || []) {
      if (q.k === "replacestat") {
        const old = String(q.old || "");
        if (old) (out.replaceStats[old] ||= []).push(q);
      } else if (q.k === "classlevels") {
        const fake = String(q.fake || "");
        if (!fake) continue;
        // m_ForSelection 在源码里是跟「正在被判定前置的特性」（base.OwnerBlueprint）比，
        // 不是跟持有者比，所以这里只记下来，判定时再用 subject 过滤
        (out.classLevelBonus[fake] ||= []).push({
          class: String(q.class || ""),
          mod: num(q.mod as number),
          sum: num(q.sum as number),
          sel: String(q.sel || ""),
        });
      }
    }
  }
  EXTRAS_CACHE.set(ctx.idSet, out);
  return out;
}

export function evalPrereq(db: Db, ctx: LevelCtx, p: Prereq, depth = 0, subject = ""): Verdict {
  const has = (id?: string | null) => !!id && ctx.idSet.has(id);
  const num2 = (v: unknown) => (typeof v === "number" ? v : undefined);
  switch (p.k) {
    case "feat":
    case "hasfeature": {
      const id = p.id as string;
      // 有些前置直接指向「种族」（例如灵狐猛扑要求狐妖）：种族不进 idSet，要单独比
      if (!has(id) && id && db.races?.[id]) return ctx.race === id ? "ok" : "no";
      return has(id) ? "ok" : "no";
    }
    case "nofeat": {
      // 「已有就不能再拿」由 BlueprintFeature.MeetsPrerequisites 的 GetRank >= Ranks 负责，
      // 指向自己的 PrerequisiteNoFeature 是冗余的（包抄、学识（宗教）2/3阶 的进程表都有），
      // 照字面判会让它一选完就自己否定自己。
      if (p.id && p.id === subject) return "ok";
      return has(p.id as string) ? "no" : "ok";
    }
    case "oneof": {
      const ids = (p.ids as string[]) || [];
      // PrerequisiteFeaturesFromList.CheckInternal：只有「持有某项」时才 num++ 并检查 num >= Amount，
      // 一项都没持有时循环走完直接 return m_RestrictIfNot（false）。所以 Amount<=0 等价于「至少一项」，
      // 不是「无限制」。IsDeity 时则只要有一项就通过（与 Amount 无关），即同「至少一项」。
      const need = Math.max(1, num2(p.amount) ?? 1);
      const n = ids.filter((x) => ctx.idSet.has(x)).length;
      // m_RestrictIfNot：源码 `if (...) return !m_RestrictIfNot;`，末尾 `return m_RestrictIfNot;`
      // 即取反后是「最多 need-1 项」（如「活神」= 最多信一位神）
      if (p.restrict) return n < need ? "ok" : "no";
      return n >= need ? "ok" : "no";
    }
    case "stat":
    case "statfull": {
      const stat = String(p.stat || "");
      const need = num2(p.v) ?? 1;
      let got = statValue(db, ctx, stat);
      if (got !== undefined) {
        // ReplaceStatForPrerequisites：已拥有的改写器会把这个值抬高（如魔战士的完美重击按职业等级算 BAB）
        for (const q of prereqExtras(db, ctx).replaceStats[String(p.stat || "")] || []) {
          got = applyReplace(db, ctx, q, got);
        }
        return got >= need ? "ok" : "no";
      }
      return "unknown";
    }
    case "clvl": {
      // 前置里也会引用怪物 / NPC / 神话内部职业（不在 classes.json 里）：玩家永远拿不到，按「无法判定」算，不拦人也不显示
      if (!db.classes[String(p.class)]) return "unknown";
      const cid = String(p.class);
      let n = num(ctx.classLevels[cid] || 0);
      // ClassLevelsForPrerequisites：别的职业等级折算成本职业等级（如「战士训练」让魔战士等级算作战士等级）
      for (const b of prereqExtras(db, ctx).classLevelBonus[cid] || []) {
        // m_ForSelection 只对「该选择表的子项」生效（源码是拿 base.OwnerBlueprint 比）
        if (b.sel) {
          const sel = db.features[b.sel];
          if (!subject || !sel || !(sel.choices || []).includes(subject)) continue;
        }
        n += Math.trunc(b.mod * num(ctx.classLevels[b.class] || 0) + b.sum);
      }
      // PrerequisiteClassLevel.Not：反过来的「不是这个职业」
      if (p.not) return n < (num2(p.v) ?? 1) ? "ok" : "no";
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
      // PrerequisiteProficiency.CheckInternal：每个数组内部「任意一项擅长即成立」，
      // 最后 return checkWeapon || checkArmor —— 是「或」不是「与」
      const arm = (p.armor as string[]) || [];
      const wep = (p.weapon as string[]) || [];
      if (!arm.length && !wep.length) return "unknown";
      const okA = arm.some((x) => (ctx.profArmor || []).includes(x));
      const okW = wep.some((x) => (ctx.profWeapon || []).includes(x));
      return okA || okW ? "ok" : "no";
    }
    case "notprof": {
      // PrerequisiteNotProficient：任意一项「不擅长」即成立，最后同样取或
      const arm = (p.armor as string[]) || [];
      const wep = (p.weapon as string[]) || [];
      const missA = arm.some((x) => !(ctx.profArmor || []).includes(x));
      const missW = wep.some((x) => !(ctx.profWeapon || []).includes(x));
      return missA || missW ? "ok" : "no";
    }
    case "ispet":
    case "pet":
      return "ok"; // 玩家角色不是宠物；这些条件只用于区分宠物界面
    case "paramfeat":
    case "paramweapon":
      return has(p.id as string) ? "ok" : "no";
    case "classspell": {
      // PrerequisiteClassSpellLevel：该职业的法术书当前能施放到第几环；没这个职业（或没有法术书）就不满足
      const cid = String(p.class);
      const need = num2(p.v) ?? 1;
      const mx = ctx.maxSpellLevel?.[cid];
      if (mx === undefined) return "no";
      return mx >= need ? "ok" : "no";
    }
    case "casterspell": {
      // PrerequisiteCasterTypeSpellLevel：要有「对应类型（奥术/神术）+ 是否自发」的施法职业，
      // 且它当前能施放 v 环；炼金与神话法术书不算
      const need = num2(p.v) ?? 1;
      const wantArcane = !!p.arcane;
      const onlySpont = !!p.spont;
      let matched = false;
      let best = 0;
      for (const [cid, n] of Object.entries(ctx.classLevels || {})) {
        if (!n) continue;
        const c = db.classes[cid];
        const sb = c?.spellbookId ? db.spellbooks[c.spellbookId] : undefined;
        if (!sb) continue;
        if (!!sb.isArcane !== wantArcane) continue;
        if (sb.isAlchemist || sb.isMythic) continue;
        if (onlySpont && !sb.spontaneous) continue;
        matched = true;
        best = Math.max(best, num(ctx.maxSpellLevel?.[cid]));
      }
      if (!matched) return "no";
      return best >= need ? "ok" : "no";
    }
    case "castertype": {
      // PrerequisiteCasterType：只要有对应类型的施法职业即可（奥术 / 神术）
      const want = !!(p as unknown as { arcane?: boolean }).arcane;
      let anyCaster = false;
      for (const [cid, n] of Object.entries(ctx.classLevels || {})) {
        if (!n) continue;
        const c = db.classes[cid];
        if (!c || !c.spellbookId) continue;
        const sb = db.spellbooks[c.spellbookId];
        if (!sb) continue;
        anyCaster = true;
        if (!!sb.isArcane === want) return "ok";
      }
      return anyCaster ? "no" : "unknown";
    }
    case "spellbook": {
      const any = Object.values(ctx.maxSpellLevel || {}).some((v) => v >= 0);
      return any ? "ok" : "unknown";
    }
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
      // PrerequisiteCondition：pipeline 把它拆成了可求值的条件树
      return evalCondNode(db, ctx, (p as unknown as { cond?: CondNode }).cond);
    case "weaponcond":
      // PrerequisiteConditionForWeaponCategory 是「有该武器擅长时才附加一个条件」的展示项，
      // 真正的门槛由同蓝图的 PrerequisiteProficiency 表达（已算）——这里不判、也不拦
      return "ok";
    case "replacestat":
    case "classlevels":
      // 这两个不是门槛，而是「持有者被判定前置时怎么算数」的改写器（已由 prereqExtras 消费），
      // 它们出现在自己蓝图的 Components 里，不该拦人也别显示成条件。
      return "ok";
    case "selpossible": {
      // PrerequisiteSelectionPossible：该选择表里还有「没拿过、且前置满足」的子项。
      // 注意：游戏只在 selectionState 非空（正站在该选择表里挑）时才判它，
      // 我们这儿没有这个上下文，按「该表是否还有空位」理解，判不出来就放行。
      const sid = String(p.id || "");
      const sel = sid ? db.features[sid] : undefined;
      if (!sel || depth > 2) return "unknown";
      const left = (sel.choices || []).filter((c) => !ctx.idSet.has(c));
      if (!left.length) return "no";
      const any = left.some((c) => evalPrereqs(db, ctx, db.features[c]?.prereq, depth + 1, c).verdict === "ok");
      return any ? "ok" : "unknown";
    }
    default:
      return "unknown";
  }
}

export function evalPrereqs(db: Db, ctx: LevelCtx, list: Prereq[] | undefined, depth = 0, subject = ""): {
  verdict: Verdict; details: { p: Prereq; v: Verdict }[];
} {
  if (!list || !list.length) return { verdict: "ok", details: [] };
  const details = list
    .filter((p) => prereqText(db, p) !== "")
    .map((p) => ({ p, v: evalPrereq(db, ctx, p, depth, subject) }));
  const all = details.filter((d) => (d.p.group || "All") === "All");
  const any = details.filter((d) => (d.p.group || "All") === "Any");
  // ForcedTrue：游戏里「任一满足就整条通过」（BlueprintCharacterClass.MeetsPrerequisites 的
  // case ForcedTrue 直接 return true；专长那边的 MeetsPrerequisites 把它并进或分支，
  // 而专长蓝图里目前一条 ForcedTrue 都没有，只在 6 条神话道途上出现）
  if (details.some((d) => d.p.group === "ForcedTrue" && d.v === "ok")) return { verdict: "ok", details };
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
  return evalPrereqs(db, ctx, f.prereq, 0, fid).verdict;
}

// ── 中文描述用的前置条件文本 ────────────────────────────────────────────
/** 把条件树翻成一句中文（判不出来的那一支写「条件复杂」） */
function condText(db: Db, node: CondNode | null | undefined, depth = 0): string {
  if (!node || depth > 3) return "条件复杂";
  if (node.op && node.conds) {
    const parts = node.conds.map((c) => condText(db, c, depth + 1)).filter(Boolean);
    const joined = parts.join(node.op === "and" ? " 且 " : " 或 ");
    return `${node.not ? "非（" : ""}${joined}${node.not ? "）" : ""}`;
  }
  const one = (() => {
    switch (node.t) {
      case "fact": {
        const f = node.id ? db.features[node.id] : undefined;
        return `已有：${f && f.name ? f.name : "某个特性"}`;
      }
      case "class": {
        const c = node.id ? db.classes[node.id] : undefined;
        return `${c ? label(c) : "某个职业"} 等级 ≥ ${node.min || 1}`;
      }
      case "mrank":
        return `神话阶层 ≥ ${node.min || 1}`;
      case "factrank": {
        const f = node.id ? db.features[node.id] : undefined;
        return `已有 ${node.min || 1} 层：${f && f.name ? f.name : "某个特性"}`;
      }
      case "align":
        return `阵营：${node.v || "?"}`;
      default:
        return node.type ? `条件复杂（${node.type}）` : "条件复杂";
    }
  })();
  return node.not ? `非（${one}）` : one;
}

/** 前置文案里引用到没有中文名的内部特性时，别显示「（未命名）」 */
function featName(db: Db, id: string): string {
  // 有些前置指向的是种族（例如灵狐猛扑要求狐妖），这类 id 不在 features 里
  const race = db.races?.[id];
  if (race) return `${label(race)}（种族）`;
  const t = label(db.features[id]);
  return t === "（未命名）" ? "内部特性" : t;
}

/** stat / statfull 里不出现在属性表与技能表里的那几个（游戏内部的「检定名」） */
const STAT_CN: Record<string, string> = {
  BaseAttackBonus: "基础攻击加值",
  SneakAttack: "偷袭骰",
};

export function prereqText(db: Db, p: Prereq): string {
  const nm = (id?: unknown) => (typeof id === "string" ? featName(db, id) : "?");
  switch (p.k) {
    case "feat": return `需要：${nm(p.id)}`;
    case "hasfeature": return `需要：${nm(p.id)}`;
    case "nofeat": return `无以下特性：${nm(p.id)}`;
    case "oneof": {
      const need = Math.max(1, num(p.amount as number));
      const names = ((p.ids as string[]) || []).map(nm).join(" / ");
      // m_RestrictIfNot：语义翻成「最多 N-1 项」
      if (p.restrict) return `最多只能有其中 ${need - 1} 项：${names}`;
      return need > 1 ? `需要以下 ${need} 项：${names}` : `需要以下之一：${names}`;
    }
    case "stat": {
      const s = String(p.stat || "");
      const attr = (ATTRS as string[]).includes(s) ? label(db.rules.attributes.find((a) => a.id === s)) : null;
      const sk = db.rules.skills.find((x) => x.id === (CHECK_ALIAS[s] || s));
      return `${attr || sk?.name || STAT_CN[s] || s} ≥ ${p.v}`;
    }
    case "statfull": {
      const s = String(p.stat || "");
      const attr = (ATTRS as string[]).includes(s) ? label(db.rules.attributes.find((a) => a.id === s)) : null;
      const sk = db.rules.skills.find((x) => x.id === (CHECK_ALIAS[s] || s));
      return `${attr || sk?.name || STAT_CN[s] || s} ≥ ${p.v}`;
    }
    case "clvl": return `${db.classes[String(p.class)] ? label(db.classes[String(p.class)]) : "内部职业"} 职业等级 ≥ ${p.v}`;
    case "nocl": return `非 ${db.classes[String(p.class)] ? label(db.classes[String(p.class)]) : "内部职业"}`;
    case "chlvl": return `角色等级 ≥ ${p.v}`;
    case "align":
      return `阵营：${alignNeedText(db, (p.v as string[]) || [])}`;
    case "prof": return `擅长：${[...((p.armor as string[]) || []), ...((p.weapon as string[]) || [])].join(" / ")}`;
    case "notprof": return `不擅长：${[...((p.armor as string[]) || []), ...((p.weapon as string[]) || [])].join(" / ")}`;
    case "alvl": return `需要 ${label(db.classes[String(p.class)])} 的变体等级 ≥ ${p.v}`;
    case "noarch": {
      const a = db.archetypes[String(p.arch)];
      const c = db.classes[String(p.class)];
      if (a) return `无变体：${label(a)}${c ? `（${label(c)}）` : ""}`;
      return c ? `不能是「${label(c)}」的变体` : "不能是任意变体";
    }
    case "classspell": return `${label(db.classes[String(p.class)])} 能施放 ${p.v} 环法术`;
    case "casterspell": {
      const kind = p.arcane ? "奥术" : "神术";
      const extra = p.spont ? "（自发施法）" : "";
      return `能施放 ${p.v} 环${kind}法术${extra}`;
    }
    case "classlevels": return ""; // 改写器，不是门槛
    case "replacestat": return ""; // 改写器，不是门槛
    case "selpossible": {
      const sel = p.id ? db.features[String(p.id)] : undefined;
      return sel ? `「${featName(db, String(p.id))}」里还有可选项` : "";
    }
    case "ispet":
    case "pet": return "（宠物专用条件）";
    case "paramfeat": return `需要：${nm(p.id)}（某一种选择）`;
    case "paramweapon": return `需要：${nm(p.id)}`;
    case "mrank": return `神话阶层 ≥ ${p.v}`;
    case "mainchar": return p.companion ? "仅同伴角色" : "仅主角";
    case "etude": return "剧情进度限定（游戏内按剧情解锁）";
    case "condition": return condText(db, (p as unknown as { cond?: CondNode }).cond);
    case "weaponcond": return ""; // 展示项（武器专长触发附加条件），不构成门槛
    default: return "条件复杂，需在游戏内确认";
  }
}

// ── 属性推荐（游戏属性页的绿拇指 / 红拇指）───────────────────────────────
// 口径取自本职职业蓝图的 RecommendedAttributes / NotRecommendedAttributes；
// 变体带 OverrideAttributeRecommendations 时（管线上只在带该标记时导出）以变体为准。
export function attrRecommend(db: Db, build: Build): { good: Set<string>; bad: Set<string> } {
  const good = new Set<string>();
  const bad = new Set<string>();
  const seen = new Set<string>();
  for (const lv of build.levels) {
    if (!lv.classId || seen.has(lv.classId)) continue;
    seen.add(lv.classId);
    const cls = db.classes[lv.classId];
    if (!cls) continue;
    let rec = cls.recommended || [];
    let norec = cls.notRecommended || [];
    for (const aid of build.classArchetypes[lv.classId] || []) {
      const arch = db.archetypes[aid];
      if (arch && (arch.recommended || arch.notRecommended)) {
        rec = arch.recommended || [];
        norec = arch.notRecommended || [];
      }
    }
    for (const x of rec) good.add(x);
    for (const x of norec) if (!good.has(x)) bad.add(x);
  }
  return { good, bad };
}

// ── 「前置于」反向索引 ─────────────────────────────────────────────────
// 游戏里挑选取的详情栏会写一行「前置于: 额外游荡者天赋」，列的是**先决条件里引用了这个槽位**
// 的那些特性（蓝图里的 IsPrerequisiteFor 就是给这个界面用的反向索引，这里直接现算）。
const PREREQ_FOR_CACHE = new WeakMap<Db, Map<string, string[]>>();

export function prereqForIndex(db: Db): Map<string, string[]> {
  const hit = PREREQ_FOR_CACHE.get(db);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  const add = (target: unknown, who: string) => {
    if (typeof target !== "string" || !target) return;
    const arr = out.get(target);
    if (!arr) out.set(target, [who]);
    else if (!arr.includes(who)) arr.push(who);
  };
  for (const [id, f] of Object.entries(db.features)) {
    for (const p of f.prereq || []) {
      if (p.k === "feat" || p.k === "hasfeature" || p.k === "paramfeat" || p.k === "paramweapon") add(p.id, id);
      else if (p.k === "oneof") for (const x of (p.ids as string[]) || []) add(x, id);
    }
  }
  PREREQ_FOR_CACHE.set(db, out);
  return out;
}

// ── 其它小工具 ─────────────────────────────────────────────────────────
export function childFeatures(db: Db, f: FeatureEntry): FeatureEntry[] {
  return (f.choices || []).map((c) => db.features[c]).filter(Boolean) as FeatureEntry[];
}

export function traitList(db: Db, race: RaceEntry | null): FeatureEntry[] {
  if (!race) return [];
  return (race.traits || []).map((t) => db.features[t]).filter(Boolean) as FeatureEntry[];
}
