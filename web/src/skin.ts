/**
 * 两套皮（用户选的是「两套皮，可切换」）：
 *   game  —— 用从本机游戏里提取的真实贴图（羊皮纸、牌匾条、按钮、图标框…）
 *   plain —— 纯 CSS，不引用任何游戏素材（便于将来发布）
 *
 * 皮肤只影响外观，不改结构：所有布局类名两套皮共用，皮肤只换配色/底图/字体。
 * 也支持用 URL hash 指定（`#skin=plain`），方便无头渲染检查两种皮都跑一遍。
 */
import { useSyncExternalStore } from "react";

export type Skin = "game" | "plain";

const KEY = "wotr-skin-v1";

function initial(): Skin {
  try {
    const m = /[#&]skin=([a-z]+)/.exec(location.hash);
    if (m && (m[1] === "game" || m[1] === "plain")) return m[1];
  } catch {
    /* 无头环境没有 location */
  }
  try {
    const v = localStorage.getItem(KEY);
    if (v === "game" || v === "plain") return v;
  } catch {
    /* ignore */
  }
  return "game";
}

let skin: Skin = initial();
const listeners = new Set<() => void>();

export function getSkin(): Skin {
  return skin;
}

export function setSkin(s: Skin): void {
  skin = s;
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function toggleSkin(): void {
  setSkin(skin === "game" ? "plain" : "game");
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSkin(): Skin {
  return useSyncExternalStore(subscribe, getSkin, getSkin);
}

/** 素材地址：`web/public/assets/ui/…` → `/assets/ui/…`（构建后同样可用） */
export const ui = (name: string): string => `./assets/ui/${name}.png`;
/** 内容图标（专长/法术的 64×64 图标，`web/public/assets/icons/…`） */
export const icon = (name: string): string => `./assets/icons/${name}.png`;

/** 蓝图内容的真实图标（64×64）；这个蓝图没有导出图标就返回 null */
export function featureIcon(db: { icons?: { byId?: Record<string, string> } } | null | undefined, id?: string | null): string | null {
  if (!db || !id) return null;
  const n = db.icons?.byId?.[id];
  return n ? icon(n) : null;
}

/** 固定步骤用游戏自带的界面小图标（只有职业/阵营有对应的那张） */
const STEP_UI_ICON: Record<string, string> = {
  class: "UI_CharGen_ClassIcon_Default",
  align: "UI_CharGen_AlignmentIcon_Default",
};

export function stepUiIcon(stepId: string): string | null {
  const n = STEP_UI_ICON[stepId];
  return n ? ui(n) : null;
}

/**
 * 神话道途的立绘卡。游戏里每条道途都有一张 854×227 的横卡（`UI_Mythic_SelectPortrait_*`）、
 * 一圈描边（`_SelectFrame_*`）和一张大方形边框（`_ProgressionFrame_*`），
 * 资源名用的是英文小名；蓝图那边的 key 是 `AngelMythicClass` 这种，所以要过一层对照表。
 * 注意游戏把御衡者写成 `Aion`（次元守护者 = Aeon），虫群行者写成 `Locust`。
 */
const MYTHIC_ART: Record<string, string> = {
  MythicStartingClass: "MythicHero",
  MythicCompanionClass: "Default",
  AeonMythicClass: "Aion",
  AngelMythicClass: "Angel",
  AzataMythicClass: "Azata",
  DemonMythicClass: "Demon",
  LichMythicClass: "Lich",
  TricksterMythicClass: "Trickster",
  FakeLegendClass: "Legend",
  LegendClass: "Legend",
  DevilMythicClass: "Devil",
  SwarmThatWalksClass: "Locust",
  GoldenDragonClass: "Dragon",
  MythicShardsClass: "Default",
};

export function mythicArt(key?: string | null): string {
  return (key && MYTHIC_ART[key]) || "Default";
}

/** 神话能力槽的图标框（游戏里每条道途一种纹样；神话英雄/传奇/碎片之力没有专属框，退回 Default） */
const SKILL_ARTS = new Set([
  "Aion", "Angel", "Azata", "Demon", "Devil", "Dragon", "Dragon_Corrupted", "Lich", "Locust", "Trickster",
]);

export function mythicSkillFrame(key?: string | null): string {
  const a = mythicArt(key);
  return ui(`UI_Mythic_SkillFrame_${SKILL_ARTS.has(a) ? a : "Default"}`);
}

/** 道途横卡立绘 */
export function mythicCard(key?: string | null): string {
  return ui(`UI_Mythic_SelectPortrait_${mythicArt(key)}`);
}

/** 道途的方形大边框（进度表用） */
export function mythicFrame(key?: string | null): string {
  return ui(`UI_Mythic_ProgressionFrame_${mythicArt(key)}`);
}

/** 道途进度表上方的横条（只有十条道途有专属那条，神话英雄/碎片之力退回通用条） */
const CAP_ARTS = new Set([
  "Aion", "Angel", "Azata", "Demon", "Devil", "Dragon", "Dragon_Corrupted", "Lich", "Locust", "Trickster",
]);

export function mythicCap(key?: string | null): string {
  const a = mythicArt(key);
  return CAP_ARTS.has(a) ? ui(`UI_Mythic_ProgressionCap_${a}`) : ui("UI_Mythic_Progression_Active");
}

/** 阵营缩写贴图（游戏角色卡上那九个花体字母组合，67×70 灰度） */
const ALIGN_ART: Record<string, string> = {
  LawfulGood: "LG",
  LawfulNeutral: "LN",
  LawfulEvil: "LE",
  NeutralGood: "NG",
  TrueNeutral: "TN",
  NeutralEvil: "NE",
  ChaoticGood: "CG",
  ChaoticNeutral: "CN",
  ChaoticEvil: "CE",
};

export function alignArt(id?: string | null): string {
  const a = ALIGN_ART[String(id)];
  return a ? ui(`UI_CharScreen_alignment_${a}`) : ui("UI_CharScreen_alignment_TN");
}
