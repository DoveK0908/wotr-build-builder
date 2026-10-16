/**
 * 界面素材与皮肤。
 *
 * 现在只有一套皮：**暗色主题**（纯 CSS，见 `styles.css`），不再有羊皮纸那套、也没有皮肤开关。
 * 从游戏安装里提取的素材只用在「真实内容图标」和「神话道途立绘卡」上（都是彩色美术，压在暗色底上好看）；
 * 界面外壳贴图（羊皮纸、牌匾条、按钮、图标框、阵营花体字、神话能力花纹框…）已弃用。
 *
 * `ART`：构建里有没有素材。
 *   本机构建（默认）有：`web/public/assets/{ui,icons}`，图标与立绘卡照常显示。
 *   公网发布版（`npm run build:public`，`.env.public` 里 `VITE_ART=0`）没有：游戏素材是 Owlcat 的版权物，
 *   不随站点公开；关掉后界面自动退回「首字徽记 / 字母缩写」，页面依旧完整可用。
 */

export const ART: boolean = (import.meta.env.VITE_ART ?? "1") !== "0";

/** 素材地址：`web/public/assets/ui/…` → `/assets/ui/…`（构建后同样可用）；没有素材时返回空串 */
export const ui = (name: string): string => (ART ? `./assets/ui/${name}.png` : "");
/** 内容图标（专长/法术的 64×64 图标，`web/public/assets/icons/…`）；没有素材时返回空串 */
export const icon = (name: string): string => (ART ? `./assets/icons/${name}.png` : "");

/** 蓝图内容的真实图标（64×64）；这个蓝图没有导出图标、或者构建里没有素材时返回 null */
export function featureIcon(db: { icons?: { byId?: Record<string, string> } } | null | undefined, id?: string | null): string | null {
  if (!ART || !db || !id) return null;
  const n = db.icons?.byId?.[id];
  return n ? icon(n) : null;
}

/**
 * 神话道途的立绘卡。游戏里每条道途都有一张 854×227 的横卡（`UI_Mythic_SelectPortrait_*`），
 * 资源名用的是英文小名；蓝图那边的 key 是 `AngelMythicClass` 这种，所以要过一层对照表。
 * 注意游戏把御衡者写成 `Aion`（Aeon），虫群行者写成 `Locust`。
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

/** 道途横卡立绘 */
export function mythicCard(key?: string | null): string {
  return ui(`UI_Mythic_SelectPortrait_${mythicArt(key)}`);
}
