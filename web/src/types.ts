/**
 * 数据契约 —— 与 pipeline/build_data.py 的输出一一对应。
 * 所有中文字段都来自游戏本体 Wrath_Data/StreamingAssets/Localization/zhCN.json。
 */

export type AttrId =
  | "Strength" | "Dexterity" | "Constitution"
  | "Intelligence" | "Wisdom" | "Charisma";

export interface AttributeDef { id: AttrId; name: string; short: string }
export interface SkillDef { id: string; name: string; nameEn: string }
export interface AlignmentDef { id: string; name: string }

export interface Rules {
  attributes: AttributeDef[];
  skills: SkillDef[];
  alignments: AlignmentDef[];
  spellSchools: string[];
  pointBuy: Record<string, number>;
  pointBuyTotal: number;
  levelRange: [number, number];
  mythicRankRange: [number, number];
  /** 角色通用升级表（每个角色都走）：奇数级给通用专长，1 级还带背景/神祇选择 */
  characterProgressionId?: string;
  characterProgression?: LevelEntry[];
  basicFeatSelection?: string;
  deitySelection?: string;
  backgroundSelection?: string;
}

export interface LevelEntry { level: number; features: string[] }

export interface ClassEntry {
  id: string;
  name: string;
  nameEn: string;
  key?: string;
  path: string;
  prestige: boolean;
  mythic: boolean;
  hitDie: string;
  skillPoints: number;
  classSkills: string[];
  startingGold?: number;
  desc?: string;
  short?: string;
  bab: number[];
  fort: number[];
  ref: number[];
  will: number[];
  progression: LevelEntry[];
  maxLevel: number;
  uiGroups?: string[][];
  archetypes?: string[];
  spellbookId?: string;
}

export interface ArchetypeEntry {
  id: string;
  name: string;
  nameEn: string;
  path: string;
  classes: string[];
  addFeatures: LevelEntry[];
  removeFeatures: LevelEntry[];
  buildChanging?: boolean;
  newSpellbook?: string;
  replace?: boolean;
  replaceClassSkills?: boolean;
  desc?: string;
}

export interface StatBonus { stat: string; value: number; cond?: boolean }

export interface Prereq {
  k: string;
  group?: string;
  hide?: boolean;
  id?: string;
  ids?: string[];
  amount?: number;
  stat?: string;
  v?: number | string[];
  full?: boolean;
  class?: string;
  arch?: string;
  armor?: string[];
  weapon?: string[];
  [key: string]: unknown;
}

export interface KnownSpell { id: string; level?: number }

export interface FeatureEntry {
  id: string;
  name: string;
  nameEn: string;
  type?: string;
  path?: string;
  desc?: string;
  groups?: string[];
  ranks?: number;
  icon?: string;
  classFeature?: boolean;
  ability?: boolean;
  activatable?: boolean;
  prereq?: Prereq[];
  choices?: string[];
  progression?: LevelEntry[];
  knownSpells?: KnownSpell[];
  spellLists?: string[];
  spellbookFeature?: boolean;
  newSpellbook?: string;
  allowedSpellbooks?: string[];
  mythicSpellList?: string;
  param?: string;
  paramSub?: string;
  paramVariants?: string[];
  missing?: boolean;
  statBonuses?: StatBonus[];
  skillPointsPerLevel?: number;
  proficiencies?: { armor?: string[]; weapon?: string[] };
  replace?: boolean;
}

export interface SpellEntry {
  id: string;
  name: string;
  nameEn: string;
  path?: string;
  desc?: string;
  range?: string;
  components?: number;
  levels?: Record<string, number>;
  mythicLevels?: Record<string, number>;
  listLevel?: number;
}

export interface SpellListEntry {
  id: string;
  name?: string;
  nameEn?: string;
  levels: Record<string, string[]>;
}

export interface SpellbookEntry {
  id: string;
  name?: string;
  castingAttribute?: string;
  spontaneous?: boolean;
  allSpellsKnown?: boolean;
  spellsPerLevel?: number;
  cantripsType?: string;
  isArcane?: boolean;
  spellsPerDay: number[][];
  spellsKnown?: number[];
}

export interface RaceEntry {
  id: string;
  name: string;
  nameEn?: string;
  path?: string;
  size?: string;
  traits?: string[];
  heritageSelections?: string[];
  statBonuses?: StatBonus[];
  desc?: string;
  selectableStat?: boolean;
}

export interface BackgroundEntry {
  id: string;
  name: string;
  nameEn?: string;
  kind?: string;
  path?: string;
  desc?: string;
  children?: string[];
  /** 上一层（大类 → 具体背景） */
  parent?: string;
  companionOnly?: boolean;
  groups?: string[];
}

export interface MythicPathEntry {
  id: string;
  name: string;
  nameEn?: string;
  key?: string;
  path?: string;
  higher?: boolean;
  selectable?: boolean;
  desc?: string;
  maxLevel?: number;
  progression?: LevelEntry[];
  uiGroups?: string[][];
  spellbookId?: string;
}

export interface MythicSelection {
  id: string;
  name: string;
  nameEn?: string;
  choices: string[];
}

export interface MythicData {
  paths: Record<string, MythicPathEntry>;
  selections: Record<string, MythicSelection>;
}

export interface Meta {
  gameDir: string;
  generated: string;
  blueprints: number;
  localization: Record<string, number>;
  counts: Record<string, number>;
  sizes: Record<string, number>;
  seconds?: number;
}

// ── 预置构筑（由 pipeline/import_presets.py 从中文 BD 合集解析） ─────────────

export interface PresetFeat { id: string; param?: string }

export interface PresetLevel {
  level: number;
  classId: string | null;
  /** 选择槽 → 选项 */
  picks: Record<string, string>;
  /** 专长 id → 参数（武器/技能/法术名） */
  params: Record<string, string>;
  feats: PresetFeat[];
  spells: string[];
  /** 没认出来的短名（原样展示给用户参考） */
  unmatched?: string[];
  /** 攻略正文（长句） */
  notes?: string[];
}

/** [神话阶, 类型, 特性 id 或原文] */
export type PresetMythic = [number, string, string];

export interface Preset {
  id: string;
  /** 队友中文名，如「席拉」 */
  who: string;
  /** 职业配比原文，如「14圣武士1传统武僧1受诅巫师3突变斗士1原怒者」 */
  plan: string;
  /** 职业 id → 变体 id 列表 */
  archetypes: Record<string, string[]>;
  /** 升级属性加点，按 4/8/12/16/20 级的顺序 */
  attrs: string[];
  mythic: PresetMythic[];
  notes?: string[];
  levels: PresetLevel[];
  match?: { feats: number; total: number };
}

export interface PresetData {
  source: string;
  generated: string;
  stats: { presets: number; feats: number; matched: number; slotted: number };
  presets: Preset[];
}

export interface Db {
  rules: Rules;
  meta: Meta;
  classes: Record<string, ClassEntry>;
  archetypes: Record<string, ArchetypeEntry>;
  features: Record<string, FeatureEntry>;
  spells: Record<string, SpellEntry>;
  spellLists: Record<string, SpellListEntry>;
  spellbooks: Record<string, SpellbookEntry>;
  races: Record<string, RaceEntry>;
  backgrounds: Record<string, BackgroundEntry>;
  mythic: MythicData;
  presets: PresetData;
}
