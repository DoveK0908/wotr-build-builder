import { useSyncExternalStore } from "react";
import type { AttrId } from "./types";

export interface LevelPlan {
  classId: string | null;
  /** 选择表特性 id -> 选中的特性 id */
  picks: Record<string, string>;
  /** 参数化专长 id -> 参数 */
  params: Record<string, string>;
  /** 4/8/12/16/20 级的属性提升 */
  ability: AttrId | null;
}

export interface RankPlan {
  picks: Record<string, string>;
  params: Record<string, string>;
  /** 神话属性提升（偶数神话等级） */
  ability: AttrId | null;
}

export interface Build {
  v: number;
  name: string;
  race: string | null;
  /** 种族自带的选择表（传承/血脉/氏族/额外专长）→ 选项 id */
  racePicks: Record<string, string>;
  raceParams: Record<string, string>;
  /** 人类/半精灵/半兽人的「任选一项属性 +2」（种族蓝图里只有 SelectableRaceStat=true，值固定 +2） */
  raceStatPick: AttrId | null;
  background: string | null;
  /** 背景整条链的挑选：选择背景→大类，大类→具体，具体→子选择（如自然学者→戏法） */
  bgPicks: Record<string, string>;
  /** 神祇（牧师/审判官等需要；来自通用升级表的「神祇选择」） */
  deity: string | null;
  alignment: string | null;
  attributes: Record<AttrId, number>;
  /** 手工修正（数据里拿不到的调整，例如某些变体的属性变化） */
  attrManual: Record<string, number>;
  levels: LevelPlan[];
  /** 职业 id -> 该职业选的变体（在选职业时就定） */
  classArchetypes: Record<string, string[]>;
  mythicPath: string | null;
  ranks: RankPlan[];
  skills: Record<string, number>;
  /** 职业 id -> 已选法术 id */
  spells: Record<string, string[]>;
  notes: string;
}

export const ATTRS: AttrId[] = [
  "Strength", "Dexterity", "Constitution",
  "Intelligence", "Wisdom", "Charisma",
];

export const MAX_LEVEL = 20;
export const MAX_RANK = 10;

export function emptyLevel(): LevelPlan {
  return { classId: null, picks: {}, params: {}, ability: null };
}
export function emptyRank(): RankPlan {
  return { picks: {}, params: {}, ability: null };
}

export function emptyBuild(): Build {
  return {
    v: 1,
    name: "",
    race: null,
    racePicks: {},
    raceParams: {},
    raceStatPick: null,
    background: null,
    bgPicks: {},
    deity: null,
    alignment: null,
    attributes: {
      Strength: 10, Dexterity: 10, Constitution: 10,
      Intelligence: 10, Wisdom: 10, Charisma: 10,
    },
    attrManual: {},
    levels: Array.from({ length: MAX_LEVEL }, emptyLevel),
    classArchetypes: {},
    mythicPath: null,
    ranks: Array.from({ length: MAX_RANK }, emptyRank),
    skills: {},
    spells: {},
    notes: "",
  };
}

/** 把旧文档补齐成当前结构，避免老分享链接炸掉 */
export function migrate(raw: unknown): Build {
  const base = emptyBuild();
  if (!raw || typeof raw !== "object") return base;
  const b = raw as Partial<Build>;
  const out: Build = {
    ...base,
    ...b,
    attributes: { ...base.attributes, ...(b.attributes || {}) },
    attrManual: { ...(b.attrManual || {}) },
    racePicks: { ...(b.racePicks || {}) },
    raceParams: { ...(b.raceParams || {}) },
    raceStatPick: b.raceStatPick || null,
    bgPicks: { ...(b.bgPicks || {}) },
    skills: { ...(b.skills || {}) },
    spells: { ...(b.spells || {}) },
    notes: typeof b.notes === "string" ? b.notes : "",
  };
  out.levels = Array.from({ length: MAX_LEVEL }, (_, i) => {
    const l = (b.levels || [])[i];
    return l
      ? { classId: l.classId ?? null, picks: { ...(l.picks || {}) }, params: { ...(l.params || {}) }, ability: l.ability ?? null }
      : emptyLevel();
  });
  out.ranks = Array.from({ length: MAX_RANK }, (_, i) => {
    const r = (b.ranks || [])[i];
    return r
      ? { picks: { ...(r.picks || {}) }, params: { ...(r.params || {}) }, ability: r.ability ?? null }
      : emptyRank();
  });
  out.v = 1;
  return out;
}

// ── 分享编码（URL 里塞整个构筑）──────────────────────────────────────────
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((x) => (bin += String.fromCharCode(x)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "===".slice((b64.length + 3) % 4);
  const bin = atob(b64 + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const COMPACT_KEYS = ["name", "race", "racePicks", "raceParams", "raceStatPick", "background", "bgPicks",
  "deity", "alignment", "attributes", "attrManual", "levels", "classArchetypes",
  "mythicPath", "ranks", "skills", "spells", "notes"] as const;

export function serialize(b: Build): string {
  const o: Record<string, unknown> = {};
  for (const k of COMPACT_KEYS) {
    const v = (b as unknown as Record<string, unknown>)[k];
    if (v === null || v === "" || v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    o[k] = v;
  }
  return toBase64Url(JSON.stringify(o));
}

export function deserialize(s: string): Build | null {
  try {
    return migrate(JSON.parse(fromBase64Url(s.trim())));
  } catch {
    return null;
  }
}

// ── 极简 store（不引第三方状态库）────────────────────────────────────────
const LS_KEY = "wotr-build-v1";

function initial(): Build {
  const m = /[#&]b=([A-Za-z0-9\-_]+)/.exec(location.hash || "");
  if (m) {
    const fromUrl = deserialize(m[1]);
    if (fromUrl) return fromUrl;
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch { /* 忽略损坏的本地存档 */ }
  return emptyBuild();
}

let state: Build = initial();
const subs = new Set<() => void>();
let saveTimer: number | undefined;

function commit(next: Build) {
  state = next;
  subs.forEach((f) => f());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* 存不下就算了 */ }
  }, 400);
}

export const buildStore = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  /** 局部更新：给出新值或基于旧构筑计算新值 */
  patch(fn: (b: Build) => void) {
    const draft: Build = JSON.parse(JSON.stringify(state));
    fn(draft);
    commit(draft);
  },
  replace(b: Build) { commit(migrate(b)); },
  reset() { commit(emptyBuild()); },
};

export function useBuild(): Build {
  return useSyncExternalStore(buildStore.subscribe, buildStore.get, buildStore.get);
}

// ── 便捷操作 ────────────────────────────────────────────────────────────
export const act = {
  /** 通用改法：直接改一份草稿对象 */
  patch: (fn: (b: Build) => void) => buildStore.patch(fn),
  reset: () => buildStore.reset(),
  setName: (name: string) => buildStore.patch((b) => { b.name = name; }),
  setRace: (id: string | null) => buildStore.patch((b) => {
    b.race = id; b.racePicks = {}; b.raceParams = {}; b.raceStatPick = null;
  }),
  setRaceStatPick: (a: AttrId | null) => buildStore.patch((b) => { b.raceStatPick = a; }),
  setRacePick: (sel: string, choice: string | null) => buildStore.patch((b) => {
    if (choice) b.racePicks[sel] = choice; else delete b.racePicks[sel];
  }),
  setRaceParam: (feat: string, p: string | null) => buildStore.patch((b) => {
    if (p) b.raceParams[feat] = p; else delete b.raceParams[feat];
  }),
  setBackground: (id: string | null) => buildStore.patch((b) => {
    b.background = id;
    if (!id) b.bgPicks = {};
  }),
  /** 背景链改选：bgPicks 是权威来源，background 只记最深那一个（显示/前置条件用） */
  setBgPicks: (picks: Record<string, string>, deepest: string | null) => buildStore.patch((b) => {
    b.bgPicks = picks;
    b.background = deepest;
  }),
  setDeity: (id: string | null) => buildStore.patch((b) => { b.deity = id; }),
  setAlignment: (id: string | null) => buildStore.patch((b) => { b.alignment = id; }),
  setAttr: (a: AttrId, v: number) => buildStore.patch((b) => { b.attributes[a] = v; }),
  setAttrManual: (a: string, v: number) => buildStore.patch((b) => {
    if (v) b.attrManual[a] = v; else delete b.attrManual[a];
  }),
  // ⚠ 这些 setter 收的是 levels/ranks 数组下标（0 = 第 1 级）。视图里务必传 idx（`lv - 1`），
  // 不要传 1 级的等级号 —— 传错就会整体串一级。
  setLevelClass: (i: number, id: string | null) => buildStore.patch((b) => {
    if (!b.levels[i]) return;
    b.levels[i] = { classId: id, picks: {}, params: {}, ability: b.levels[i].ability };
  }),
  setLevelPick: (i: number, sel: string, choice: string | null) => buildStore.patch((b) => {
    if (!b.levels[i]) return;
    if (choice) b.levels[i].picks[sel] = choice; else delete b.levels[i].picks[sel];
  }),
  setLevelParam: (i: number, feat: string, p: string | null) => buildStore.patch((b) => {
    if (!b.levels[i]) return;
    if (p) b.levels[i].params[feat] = p; else delete b.levels[i].params[feat];
  }),
  setLevelAbility: (i: number, a: AttrId | null) => buildStore.patch((b) => {
    if (!b.levels[i]) return;
    b.levels[i].ability = a;
  }),
  toggleArchetype: (classId: string, archId: string) => buildStore.patch((b) => {
    const cur = b.classArchetypes[classId] || [];
    const i = cur.indexOf(archId);
    if (i >= 0) cur.splice(i, 1); else cur.push(archId);
    if (cur.length) b.classArchetypes[classId] = cur;
    else delete b.classArchetypes[classId];
  }),
  setMythicPath: (id: string | null) => buildStore.patch((b) => {
    b.mythicPath = id; b.ranks = Array.from({ length: MAX_RANK }, emptyRank);
  }),
  setRankPick: (i: number, sel: string, choice: string | null) => buildStore.patch((b) => {
    if (!b.ranks[i]) return;
    if (choice) b.ranks[i].picks[sel] = choice; else delete b.ranks[i].picks[sel];
  }),
  setRankParam: (i: number, feat: string, p: string | null) => buildStore.patch((b) => {
    if (!b.ranks[i]) return;
    if (p) b.ranks[i].params[feat] = p; else delete b.ranks[i].params[feat];
  }),
  setRankAbility: (i: number, a: AttrId | null) => buildStore.patch((b) => {
    if (!b.ranks[i]) return;
    b.ranks[i].ability = a;
  }),
  setSkill: (id: string, v: number) => buildStore.patch((b) => {
    if (v > 0) b.skills[id] = v; else delete b.skills[id];
  }),
  toggleSpell: (classId: string, spellId: string) => buildStore.patch((b) => {
    const cur = b.spells[classId] || [];
    const i = cur.indexOf(spellId);
    if (i >= 0) cur.splice(i, 1); else cur.push(spellId);
    if (cur.length) b.spells[classId] = cur; else delete b.spells[classId];
  }),
  clearSpells: (classId: string) => buildStore.patch((b) => { delete b.spells[classId]; }),
  setNotes: (t: string) => buildStore.patch((b) => { b.notes = t; }),
  load: (b: Build) => buildStore.replace(migrate(b)),
  // 视图里用的短名字
  setClass: (i: number, id: string | null) => act.setLevelClass(i, id),
  setPick: (i: number, sel: string, c: string | null) => act.setLevelPick(i, sel, c),
  setParam: (i: number, f: string, p: string | null) => act.setLevelParam(i, f, p),
  setAbility: (i: number, a: AttrId | null) => act.setLevelAbility(i, a),
  importJson: (json: string) => {
    const parsed = JSON.parse(json);            // 解析失败就抛给调用方
    buildStore.replace(migrate(parsed));
  },
};

export function shareUrl(b: Build): string {
  const u = new URL(location.href);
  u.hash = "b=" + serialize(b);
  return u.toString();
}

export { toBase64Url, fromBase64Url };
