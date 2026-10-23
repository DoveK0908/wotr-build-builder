import { buildTable, tableFilename, toCsv, toTsv } from "../src/exportTable";


/**
 * 规则引擎无头自检：直接拿 public/data 里的真实数据跑一遍
 * derive / 购点 / 属性 / 前置校验 / 存档往返，
 * 由 scripts/smoke.mjs 用 esbuild 打包后执行。
 */
import fs from "node:fs";
import path from "node:path";
import type { Db, FeatureEntry, MythicPathEntry, Preset, Prereq } from "../src/types";
import {
  BASE_LEVEL, LEGEND_PATH_ID, MAX_LEVEL, act, buildStore, emptyBuild, emptyLevel, emptyRank, levelCap, migrate, serialize, deserialize,
} from "../src/store";
import { applyPreset } from "../src/presets";
import type { Build } from "../src/store";
import {
  DYN_MYTHIC_PREFIX, DYN_MYTHIC_SPELL_PREFIX, DYN_PREFIX, STEP_IDS, allSteps, classSubSteps,
  mythicSubSteps, normalizeStep, stepFilled, stepGlyph, stepNote, stepValue,
} from "../src/steps";
import {
  MYTHIC_LATE_START,
  MYTHIC_RANK_LEVELS,
  levelForRank,
  ranksAtLevel,
  alignAllows,
  alignConflicts,
  alignTokensOf,
  alignmentLocks,
  classAlignTokens,
  classSelectableAt,
  deityAlignTokens,
  attrMod,
  attrsAtLevel,
  charLevel,
  classLevels,
  derive,
  evalPrereq,
  evalPrereqs,
  attrBreakdown,
  attrRecommend,
  backgroundRoot,
  levelCtxList,
  levelRootSlots,
  label,
  livePicks,
  mythicHeroPath,
  mythicSource,
  mythicSpellbook,
  num,
  ownedFeatures,
  pathStartRank,
  pointBuySpent,
  prereqText,
  prereqForIndex,
  raceRootSlots,
  rankRootSlots,
  traitList,
} from "../src/rules";

const FILES = [
  "rules", "classes", "archetypes", "features", "spells", "spellLists",
  "spellbooks", "races", "backgrounds", "mythic", "presets", "icons", "meta",
];

const FIGHTER = "48ac8db94d5de7645906c7d0ad3bcfbd";
const WIZARD = "ba34257984f4c41408ce1dc2004e342e";
const HUMAN = "0a5d473ead98b0646b94495af250fdc4";
const ELF = "25a5878d125338244896ebd3238226c8";

let pass = 0;
const fails: string[] = [];

function ok(cond: boolean, what: string, extra = ""): void {
  if (cond) { pass += 1; return; }
  fails.push(`${what}${extra ? " —— " + extra : ""}`);
}
function eq(got: unknown, want: unknown, what: string): void {
  ok(got === want, what, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`);
}
function findByName(db: Db, name: string): FeatureEntry | undefined {
  return Object.values(db.features).find((f) => f.name === name);
}

export function run(dir: string): void {
  const db = {} as Db;
  for (const k of FILES) {
    (db as unknown as Record<string, unknown>)[k] =
      JSON.parse(fs.readFileSync(path.join(dir, `${k}.json`), "utf8"));
  }

  // ---- 数据完整性 ----
  ok(Object.keys(db.classes).length === 40, "职业数 40", String(Object.keys(db.classes).length));
  ok(Object.keys(db.races).length === 12, "种族数 12", String(Object.keys(db.races).length));
  ok(Object.keys(db.mythic.paths).length === 14, "神话道途 14",
    String(Object.keys(db.mythic.paths).length));
  ok(Object.keys(db.mythic.selections).length === 3, "神话选择表 3",
    String(Object.keys(db.mythic.selections).length));
  ok(Object.values(db.mythic.paths).filter((p) => p.selectable).length === 10,
    "玩家可选神话道途 10");
  ok(db.rules.attributes.length === 6, "属性 6 项");
  ok(db.rules.skills.length === 11, "技能 11 项");
  ok(db.rules.alignments.length === 9, "阵营 9 项");
  ok(!!db.rules.characterProgressionId, "通用升级表 id 存在",
    String(db.rules.characterProgressionId));
  ok(!!db.features[FIGHTER] === false, "职业不是特性（应 false）");

  // ---- 属性购点 ----
  const b: Build = emptyBuild();
  b.name = "自检角色";
  b.race = HUMAN;
  for (let i = 0; i < 20; i += 1) b.levels[i].classId = FIGHTER;
  eq(pointBuySpent(db, b), 0, "全 10 购点花费 0");
  b.attributes.Strength = 18;
  eq(pointBuySpent(db, b), 17, "力量 18 花 17 点");
  b.attributes.Intelligence = 12;
  eq(pointBuySpent(db, b), 19, "力量 18 + 智力 12 = 19 点");

  // ---- 种族加值 ----
  const base = { ...b.attributes };
  const human1 = attrsAtLevel(db, b, 1);
  eq(human1.Dexterity, base.Dexterity, "人类不敏捷加值");
  b.race = ELF;
  const elf1 = attrsAtLevel(db, b, 1);
  eq(elf1.Dexterity, base.Dexterity + 2, "精灵敏捷 +2");
  eq(elf1.Intelligence, base.Intelligence + 2, "精灵智力 +2");
  eq(elf1.Constitution, base.Constitution - 2, "精灵体质 -2");
  eq(attrMod(18), 4, "18 → +4");
  eq(attrMod(7), -2, "7 → -2");
  b.race = HUMAN;

  // ---- 等级 / BAB / 豁免 ----
  eq(charLevel(b), 20, "20 级");
  eq(classLevels(b)[FIGHTER], 20, "战士 20 级");
  const d = derive(db, b);
  eq(d.level, 20, "derive.level = 20");
  eq(d.bab, 20, "战士 BAB 20");
  ok(d.hp > 100, "血量像样", String(d.hp));
  ok(d.fort > d.will, "战士强韧 > 意志", `${d.fort}/${d.will}`);
  ok(d.skillPointsTotal > 20, "技能点总数合理", String(d.skillPointsTotal));

  // 法师 BAB 应远低于战士
  const w: Build = emptyBuild();
  for (let i = 0; i < 20; i += 1) w.levels[i].classId = WIZARD;
  const dw = derive(db, w);
  eq(dw.bab, 10, "法师 BAB 10");
  ok(dw.will > dw.fort, "法师意志 > 强韧", `${dw.fort}/${dw.will}`);

  // ---- 已获得特性 ----
  const owned = ownedFeatures(db, b);
  ok(owned.ids.size > 10, "战士 20 级拿到一堆特性", String(owned.ids.size));
  ok(owned.auto.size > 5, "自动给予的特性表非空", String(owned.auto.size));
  ok(owned.ids.has(FIGHTER) || [...owned.ids].some((id) => db.features[id]?.name === "武器训练"),
    "自动特性里能找到职业特性");

  // ---- 前置校验：猛力攻击（力量 13） ----
  const pa = findByName(db, "猛力攻击");
  ok(!!pa, "找到猛力攻击");
  if (pa) {
    ok((pa.prereq || []).some((p: Prereq) => p.k === "stat" && p.stat === "Strength"),
      "猛力攻击前置里有力量");
    b.attributes.Strength = 13;
    let ctx = levelCtxList(db, b, derive(db, b))[19];
    if (!ctx) ctx = levelCtxList(db, b, derive(db, b))[0];
    ok(evalPrereqs(db, ctx, pa.prereq).verdict === "ok", "力量 13 满足猛力攻击");
    b.attributes.Strength = 12;
    const ctx2 = levelCtxList(db, b, derive(db, b))[19] || levelCtxList(db, b, derive(db, b))[0];
    ok(evalPrereqs(db, ctx2, pa.prereq).verdict === "no", "力量 12 不满足猛力攻击");
    b.attributes.Strength = 18;
  }

  // ---- 通用升级表：1 级该有「专长 / 选择背景 / 神祇选择」 ----
  const cp = db.rules.characterProgression || [];
  ok(cp.length === 20, "通用升级表 20 级", String(cp.length));
  const u1 = cp.find((e) => e.level === 1);
  ok(!!u1, "通用升级表有 1 级条目");
  const u1ids: string[] = (u1 && u1.features) || [];
  ok(u1ids.includes(db.rules.basicFeatSelection as string), "1 级含通用专长槽");
  ok(u1ids.includes(db.rules.backgroundSelection as string), "1 级含选择背景");
  ok(u1ids.includes(db.rules.deitySelection as string), "1 级含神祇选择");
  const deitySel = db.features[db.rules.deitySelection as string];
  ok((deitySel?.choices || []).length > 20, "神祇候选 > 20",
    String((deitySel?.choices || []).length));

  // ---- 背景数据 ----
  const bgGroups = Object.values(db.backgrounds).filter((x) => x.kind === "group");
  const bgItems = Object.values(db.backgrounds).filter((x) => x.kind === "item");
  ok(bgGroups.length === 10, "背景分组 10 个", String(bgGroups.length));
  ok(bgItems.length === 45, "背景条目 45 个", String(bgItems.length));

  // ---- 种族传承 ----
  const elf = db.races[ELF];
  ok(!!elf, "精灵种族存在");
  ok((elf?.heritageSelections || []).length >= 1, "精灵有传承/选择表",
    String((elf?.heritageSelections || []).length));
  const traits = traitList(db, elf || null);
  ok(traits.length >= 4, "精灵种族特性 >= 4", String(traits.length));

  // ---- 存档往返 ----
  const angelPath = Object.values(db.mythic.paths).find((p) => p.name === "天使");
  b.name = "往返测试";
  b.background = bgItems[0]?.id || null;
  b.mythicPath = angelPath?.id || Object.values(db.mythic.paths)[0]?.id || null;
  b.levels[0].picks = {};
  const s = serialize(b);
  const back = deserialize(s);
  ok(!!back, "反序列化成功");
  if (back) {
    eq(back.name, b.name, "名字往返");
    eq(back.race, b.race, "种族往返");
    eq(back.mythicPath, b.mythicPath, "神话道途往返");
    eq(back.levels[0].classId, b.levels[0].classId, "1 级职业往返");
    eq(back.attributes.Strength, b.attributes.Strength, "属性往返");
  }

  // ---- 每个职业都能被选上 ----
  let bad = "";
  for (const id of Object.keys(db.classes)) {
    const t = emptyBuild();
    t.levels[0].classId = id;
    const cl = classLevels(t);
    if (cl[id] !== 1) bad = `${id}:${db.classes[id].name}`;
  }
  eq(bad, "", "40 个职业都能就位");

  // ---- 数值健全：没有 NaN ----
  ok(Number.isFinite(d.bab) && Number.isFinite(d.hp) && Number.isFinite(d.skillPointsTotal),
    "derive 数值无 NaN");
  ok(num(undefined, 3) === 3, "num 默认值");

  // ---- 预置构筑（中文 BD 合集） ----
  const presets = db.presets?.presets || [];
  ok(presets.length === 24, "预置构筑 24 套", String(presets.length));
  ok((db.presets?.stats?.matched || 0) >= 230, "预置专长识别 >= 230",
    String(db.presets?.stats?.matched));
  let pBad = "";
  let pPlaced = 0;
  let pLeft = 0;
  for (const p of presets) {
    const r = applyPreset(db, p);
    const lv = classLevels(r.build);
    const n = Object.values(lv).reduce((a, x) => a + x, 0);
    const dd = derive(db, r.build);
    if (n < 15 || !Number.isFinite(dd.bab) || dd.bab <= 0) {
      pBad = `${p.id}:${n}级/bab${dd.bab}`;
      break;
    }
    pPlaced += r.placed;
    pLeft += r.leftover.length;
  }
  eq(pBad, "", "24 套预置都能套用并推导");
  ok(pPlaced > 100, "预置自动落位总数 > 100", String(pPlaced));
  ok(pLeft > 0, "预置保留了需要人工确认的条目", String(pLeft));
  const first = presets[0];
  if (first) {
    const r = applyPreset(db, first);
    ok(Object.values(r.build.classArchetypes).some((x) => x.length > 0),
      "预置带上了变体", JSON.stringify(r.build.classArchetypes).slice(0, 80));
    ok(r.build.levels.filter((x) => x.classId).length === 20, "预置铺满 20 级职业");
    ok(r.build.levels.filter((x) => x.ability).length > 0, "预置带上了升级加点");
  }

  // ---- 嵌套选择链（选择项本身还可能是选择表） ----
  const featByName = (n: string, withChoices = false): FeatureEntry | undefined =>
    Object.values(db.features).find(
      (f) => f.name === n && (!withChoices || (f.choices || []).length > 0),
    );
  const bgRootSel = backgroundRoot(db);
  ok(!!bgRootSel && (bgRootSel.choices || []).length >= 9, "背景根是选择表",
    String((bgRootSel?.choices || []).length));

  const scholarSel = featByName("学者", true);
  const natureSel = featByName("自然学者", true);
  const lightCantrip = featByName("光亮术");
  ok(!!scholarSel && !!natureSel && !!lightCantrip, "找得到 学者 / 自然学者 / 光亮术");

  if (bgRootSel && scholarSel && natureSel && lightCantrip) {
    const chain: Record<string, string> = {
      [bgRootSel.id]: scholarSel.id,
      [scholarSel.id]: natureSel.id,
      [natureSel.id]: lightCantrip.id,
    };
    const b1: Build = { ...emptyBuild(), background: lightCantrip.id, bgPicks: chain };
    const o1 = ownedFeatures(db, b1);
    eq(String(livePicks(db, [bgRootSel], chain).length), "3", "背景链展开成 3 段");
    ok(o1.ids.has(lightCantrip.id), "背景第三层的「光亮术」进了 owned");

    const arcaneSel = featByName("奥法学者");
    if (arcaneSel) {
      const b2: Build = {
        ...b1,
        bgPicks: { [bgRootSel.id]: scholarSel.id, [scholarSel.id]: arcaneSel.id, [natureSel.id]: lightCantrip.id },
      };
      const o2 = ownedFeatures(db, b2);
      ok(!o2.ids.has(lightCantrip.id), "换掉上层选择后，陈旧的下层选择不再泄漏");
      ok(o2.ids.has(arcaneSel.id), "新选中的「奥法学者」生效");
    }
  }

  const combatSel = featByName("战斗专长", true);
  const styleSel = combatSel
    ? (combatSel.choices || []).map((id) => db.features[id]).find((f) => f && (f.choices || []).length >= 5)
    : undefined;
  ok(!!styleSel, "「战斗专长」下面还有带子选择的分支", styleSel?.name || "");

  const wfFeat = featByName("武器专攻");
  ok(!!wfFeat && (wfFeat.paramVariants || []).length >= 10, "「武器专攻」是参数化专长",
    String((wfFeat?.paramVariants || []).length));

  const elfRace = Object.values(db.races).find((r) => r.name === "精灵");
  ok(!!elfRace && raceRootSlots(db, { ...emptyBuild(), race: elfRace.id }).length > 0,
    "精灵有「种族传承」槽位");
  const humanRace = Object.values(db.races).find((r) => r.name === "人类");
  const humanSlots = humanRace ? raceRootSlots(db, { ...emptyBuild(), race: humanRace.id }) : [];
  ok(humanSlots.some((s) => (s.choices || []).length >= 200), "人类种族槽位是额外专长（≥200 项）",
    humanSlots.map((s) => (s.choices || []).length).join(","));

  const compOnlyBg = Object.values(db.backgrounds).filter((b) => b.companionOnly).map((b) => b.name);
  ok(compOnlyBg.includes("城市猎人") && compOnlyBg.includes("纽玫瑞亚同伴"),
    "同伴专属背景有 companionOnly 标记", compOnlyBg.join("/"));

  if (humanRace) {
    const hb: Build = { ...emptyBuild(), race: humanRace.id, raceStatPick: "Strength" };
    const wa = attrsAtLevel(db, hb, 1);
    eq(String(wa.Strength - emptyBuild().attributes.Strength), "2", "人类的自由属性 +2 生效");
  }

  // 神话：道途自家内容优先，9/10 级走通用神话能力/专长
  const angel = Object.values(db.mythic.paths).find((p) => p.name === "天使");
  if (angel) {
    const mb: Build = { ...emptyBuild(), mythicPath: angel.id };
    ok(rankRootSlots(db, mb, 1).length >= 1, "神话 1 级有道途自己的槽位",
      String(rankRootSlots(db, mb, 1).length));
    ok(rankRootSlots(db, mb, 9).length >= 1, "神话 9 级回退到通用选择表",
      rankRootSlots(db, mb, 9).map((f) => f.name).join("/"));
  }
  const abilitySel = db.mythic.selections?.MythicAbilitySelection;
  const nestedAbility = (abilitySel?.choices || [])
    .map((id) => db.features[id])
    .find((f) => f && (f.choices || []).length > 0);
  ok(!!nestedAbility, "神话能力里有带子选择的能力（如巅峰元素）", nestedAbility?.name || "");

  // 神话阶层本身不加属性；加属性的是道途特性（传奇 +4 全属性、恶魔之相按阶层、碎片之力诅咒之力）
  const ATTR_IDS = db.rules.attributes.map((a) => a.id) as (keyof Build["attributes"])[];
  /** 道途特性实际出现在第几阶（主道途 +2、晚期道途 +7 的映射） */
  const rankOf = (p: MythicPathEntry, featId: string): number => {
    const L = (p.progression || []).find((x) => (x.features || []).includes(featId));
    return L ? pathStartRank(db, p) + L.level - 1 : 0;
  };
  /** 把某个神话阶填上内容（哪怕只是随便挑一项），让 mythicRank 认为走到了这一阶 */
  const fillRank = (b: Build, r: number): void => {
    const s = rankRootSlots(db, b, r)[0];
    b.ranks[r - 1].picks = s ? { [s.id]: (s.choices || [])[0] || "" } : { __marker__: "" };
  };
  // 前两阶是通用的「神话英雄」：没选道途也有 1–2 阶，第 1 阶给超凡飞升 + 神话能力、第 2 阶给神话专长
  {
    const hero = mythicHeroPath(db);
    ok(!!hero, "神话英雄（MythicStartingClass）在数据里", hero?.name || hero?.nameEn || "");
    ok((hero?.progression || []).length === 7, "神话英雄升级表是 7 级",
      String((hero?.progression || []).length));
    const noPath: Build = { ...emptyBuild(), mythicPath: null };
    const r1 = rankRootSlots(db, noPath, 1);
    const r2 = rankRootSlots(db, noPath, 2);
    const r3 = rankRootSlots(db, noPath, 3);
    ok(r1.length >= 2 && r1.some((s) => s.id === db.mythic.selections?.FirstAscensionSelection?.id),
      "没选道途时第 1 阶也是神话英雄：超凡飞升 + 神话能力",
      r1.map((s) => s.name).join("、"));
    ok(r2.some((s) => s.id === db.mythic.selections?.MythicFeatSelection?.id),
      "没选道途时第 2 阶给神话专长", r2.map((s) => s.name).join("、"));
    ok(r3.some((s) => s.id === db.mythic.selections?.MythicAbilitySelection?.id),
      "神话英雄第 3 级只有奇数阶的神话能力（数据里没有别的选择表，走兜底）",
      r3.map((s) => s.name).join("、"));
    const angel = Object.values(db.mythic.paths).find((p) => p.name === "天使");
    if (angel) {
      eq(String(pathStartRank(db, angel)), "3", "天使道途从第 3 阶起");
      const withAngel: Build = { ...emptyBuild(), mythicPath: angel.id };
      ok(rankRootSlots(db, withAngel, 1).some((s) => s.id === db.mythic.selections?.FirstAscensionSelection?.id),
        "选了天使，第 1 阶仍然走神话英雄（不是天使自己的表）");
      const angelNames = mythicSource(db, withAngel, 3).features.map((id) => db.features[id]?.name || "");
      ok(angelNames.includes("天使光环") && angelNames.includes("天堂宝剑"),
        "选了天使，第 3 阶给的是天使第 1 级（天使光环 / 天堂宝剑）", angelNames.filter(Boolean).join("、"));
      const a3 = rankRootSlots(db, withAngel, 3).map((s) => s.name);
      ok(!a3.some((n) => (n || "").includes("超凡飞升")), "第 3 阶不再给神话英雄独有的超凡飞升",
        a3.join("、"));
      const src1 = mythicSource(db, withAngel, 1);
      eq(String(src1.level), "1", "第 1 阶映射到神话英雄第 1 级");
      const src5 = mythicSource(db, withAngel, 5);
      eq(String(src5.level), "3", "第 5 阶映射到天使第 3 级（rank - 2）");
    }
    const dragon = Object.values(db.mythic.paths).find((p) => p.name === "金龙");
    if (dragon) {
      eq(String(pathStartRank(db, dragon)), "8", "金龙（晚期道途）从第 8 阶起");
      const withDragon: Build = { ...emptyBuild(), mythicPath: dragon.id };
      ok(rankRootSlots(db, withDragon, 3).length > 0 && !rankRootSlots(db, withDragon, 3).some((s) => (s.name || "").includes("金龙")),
        "选了金龙，第 3 阶还是神话英雄的内容");
      eq(String(mythicSource(db, withDragon, 8).level), "1", "第 8 阶映射到金龙第 1 级");
    }
  }
  // 属性面板的拆分（基础/种族/升级/特性/手工）必须与 attrsAtLevel 的合计一致
  {
    const probe: Build = { ...emptyBuild(), race: db.races && Object.values(db.races)[0]?.id };
    const br = attrBreakdown(db, probe, 20);
    const tot = attrsAtLevel(db, probe, 20);
    ok(ATTR_IDS.every((a) => br[a].total === tot[a]), "属性拆分合计 = attrsAtLevel（面板不会和引擎打架）",
      ATTR_IDS.map((a) => `${a} ${br[a].total}/${tot[a]}`).join(" "));
  }
  const legend = Object.values(db.mythic.paths).find((p) => p.name === "传奇");
  if (legend) {
    const lb: Build = { ...emptyBuild(), mythicPath: legend.id };
    fillRank(lb, 8); // 传奇是晚期道途，第 8 阶才换
    const la = attrsAtLevel(db, lb, 20);
    const base = emptyBuild().attributes;
    ok(ATTR_IDS.every((a) => la[a] - base[a] === 4), "传奇道途（第 8 阶生效后）：全属性 +4（蓝图只有文字）",
      ATTR_IDS.map((a) => `${a}${la[a] - base[a] >= 0 ? "+" : ""}${la[a] - base[a]}`).join(" "));
    const lbr = attrBreakdown(db, lb, 20);
    ok(ATTR_IDS.every((a) => lbr[a].feat === 4 && lbr[a].level === 0),
      "传奇 +4 落在属性面板的「特性」一栏（不是「升级」一栏）",
      ATTR_IDS.map((a) => `${a} feat${lbr[a].feat}/lv${lbr[a].level}`).join(" "));
  }
  const shards = Object.values(db.mythic.paths).find((p) => p.name === "碎片之力");
  if (shards) {
    const cursed = Object.values(db.features).find((f) => f.name === "诅咒之力" && (f.statBonuses || []).length >= 6);
    const sb2: Build = { ...emptyBuild(), mythicPath: shards.id };
    const before = attrsAtLevel(db, sb2, 20);
    if (cursed) {
      ok(!ownedFeatures(db, sb2).ids.has(cursed.id),
        "选了道途但没走阶层：高层道途特性不算进来（阶层门控）");
    }
    const cr = cursed ? rankOf(shards, cursed.id) : 0; // 碎片之力第 3 级 → 第 10 阶
    const root10 = cr > 0 ? rankRootSlots(db, sb2, cr)[0] : undefined;
    if (root10 && cr > 0) {
      sb2.ranks[cr - 1].picks = { [root10.id]: (root10.choices || [])[0] || "" };
      const after = attrsAtLevel(db, sb2, 20);
      ok(ATTR_IDS.every((a) => after[a] - before[a] === 4),
        `碎片之力第 ${cr} 阶（= 它的第 3 级）的「诅咒之力」全属性 +4 进了属性面板`,
        ATTR_IDS.map((a) => `${a}${after[a] - before[a] >= 0 ? "+" : ""}${after[a] - before[a]}`).join(" "));
    }
  }
  const demonPath = Object.values(db.mythic.paths).find((p) => p.name === "恶魔");
  const aspectSlot = demonPath
    ? (demonPath.progression || [])
      .flatMap((lv) => lv.features || [])
      .map((id) => db.features[id])
      .find((f) => f?.name === "高等恶魔之相")
    : undefined;
  const might = aspectSlot
    ? (aspectSlot.choices || []).map((id) => db.features[id]).find((f) => f?.name === "威加魔相")
    : undefined;
  if (demonPath && aspectSlot && might) {
    // 恶魔是主道途（第 3 阶起），高等恶魔之相在它自己的第 3 级 → 神话第 5 阶；
    // 数值 = floor(阶层/2)+1 = 3
    const ar = rankOf(demonPath, aspectSlot.id);
    const dp: Build = { ...emptyBuild(), mythicPath: demonPath.id };
    dp.ranks[ar - 1].picks = { [aspectSlot.id]: might.id };
    const da = attrsAtLevel(db, dp, 20);
    const db0 = attrsAtLevel(db, { ...emptyBuild(), mythicPath: demonPath.id }, 20);
    eq(String(da.Strength - db0.Strength), String(Math.floor(ar / 2) + 1),
      `恶魔 高等恶魔之相（威加魔相）第 ${ar} 阶给力量 +${Math.floor(ar / 2) + 1}（阶层一半+1）`);
  }

  const fighterCls = Object.values(db.classes).find((c) => c.key === "FighterClass");
  if (fighterCls) {
    const fighterBuild: Build = {
      ...emptyBuild(),
      levels: emptyBuild().levels.map((l) => ({ ...l, classId: (fighterCls as { id: string }).id })),
    };
    ok(levelRootSlots(db, fighterBuild, 1).length >= 2, "1 级合并了职业选择表与通用升级表",
      String(levelRootSlots(db, fighterBuild, 1).length));
    ok(levelRootSlots(db, fighterBuild, 3).length >= 1, "3 级有通用专长槽",
      String(levelRootSlots(db, fighterBuild, 3).length));
    ok(!levelRootSlots(db, fighterBuild, 1).some((f) => f.id === db.rules.deitySelection),
      "神祇选择不在升级页重复出现（角色页有专门控件）");
  }

  // 预置的嵌套落位：攻略只写了最终专长，中间那层要能自己选出来
  const basicSel = db.rules.basicFeatSelection ? db.features[db.rules.basicFeatSelection] : undefined;
  const nestedSlot = basicSel
    ? (basicSel.choices || []).map((id) => db.features[id]).find((f) => f && (f.choices || []).length > 3)
    : undefined;
  if (basicSel && nestedSlot && fighterCls) {
    const target = nestedSlot.choices?.[0] || "";
    const fake: Preset = {
      id: "smoke-nested", who: "冒烟", plan: "1战士",
      archetypes: {}, attrs: [], mythic: [],
      levels: [{
        level: 1, classId: fighterCls.id, picks: {}, params: {},
        feats: [{ id: target }], spells: {},
      }],
    };
    const r = applyPreset(db, fake);
    const picks = r.build.levels[0].picks;
    ok(Object.values(picks).includes(nestedSlot.id), "预置自动选出了中间那层选择",
      `${nestedSlot.name} <-? ${JSON.stringify(picks).slice(0, 90)}`);
    eq(picks[nestedSlot.id] || "", target, "预置落到了嵌套的下一层");
  }

  // ── 阵营限制：职业 / 变体 / 神祇 / 领域 ──────────────────────────────────
  const paladin = Object.values(db.classes).find((c) => c.name === "圣武士");
  const monk = Object.values(db.classes).find((c) => c.name === "武僧");
  const wizard = Object.values(db.classes).find((c) => c.name === "法师");
  ok(!!paladin?.prereq?.length, "职业蓝图的前置条件已经导出",
    `${Object.values(db.classes).filter((c) => c.prereq).length}/${Object.keys(db.classes).length}`);
  eq((alignTokensOf(paladin?.prereq) || []).join(","), "LawfulGood", "圣武士只接受守序善良");
  ok(classAlignTokens(db, monk?.id || "").includes("Lawful"), "武僧要求守序（轴 token）");
  eq(classAlignTokens(db, wizard?.id || "").length, 0, "法师没有阵营要求");
  ok(alignAllows("LawfulNeutral", ["Lawful"]), "「守序」轴涵盖守序中立");
  ok(!alignAllows("LawfulNeutral", ["TrueNeutral"]), "「绝对中立」不含守序中立");
  ok(alignAllows("ChaoticEvil", ["TrueNeutral", "Evil"]), "「邪恶」轴涵盖混乱邪恶");

  const allPally = (b: Build, align: string): Build => ({
    ...b,
    alignment: align,
    levels: emptyBuild().levels.map((l) => ({ ...l, classId: paladin?.id || "" })),
  });
  const pconf = alignConflicts(db, allPally(emptyBuild(), "ChaoticEvil"));
  ok(pconf.some((x) => x.includes("圣武士")), "圣武士 + 混乱邪恶 会被判阵营不符", pconf.join("；"));
  const pgood = allPally(emptyBuild(), "LawfulGood");
  eq(alignConflicts(db, pgood).length, 0, "守序善良的圣武士没有冲突");
  const plocks = alignmentLocks(db, pgood);
  ok(!plocks["LawfulGood"], "守序善良可选");
  ok(["LawfulNeutral", "NeutralGood", "ChaoticEvil"].every((a) => !!plocks[a]),
    "非守序善良的阵营都被锁（阵营下拉要禁用）", Object.keys(plocks).join(","));

  const abadar = (db.features[db.rules.deitySelection]?.choices || [])
    .find((id) => db.features[id]?.name === "阿巴达");
  const abToks = deityAlignTokens(db, abadar);
  ok(!!abadar && alignAllows("LawfulNeutral", abToks) && !alignAllows("ChaoticEvil", abToks),
    "阿巴达接受守序/绝对中立、拒绝混乱邪恶", abToks.join(","));
  const dbuild: Build = { ...emptyBuild(), alignment: "ChaoticEvil", deity: abadar || null };
  ok(alignConflicts(db, dbuild).some((x) => x.includes("阿巴达")), "神祇与阵营冲突会被报出来");

  const blood = Object.values(db.archetypes).find((a) => a.name === "觅血者");
  ok(!!blood && alignTokensOf(blood.prereq).includes("Evil"), "变体自带阵营要求",
    JSON.stringify(alignTokensOf(blood?.prereq)));
  const aparent = blood?.classes?.[0] || "";
  const abuild: Build = {
    ...emptyBuild(),
    alignment: "LawfulGood",
    levels: emptyBuild().levels.map((l) => ({ ...l, classId: aparent })),
    classArchetypes: { [aparent]: [blood?.id || ""] },
  };
  ok(alignConflicts(db, abuild).some((x) => x.includes("觅血者")), "变体阵营冲突会被报出来");

  // 变体取代母职业的阵营要求：武僧（守序）× 醉拳大师（任意非守序）——两个集合交集为空
  const drunk = Object.values(db.archetypes).find((a) => a.name === "醉拳大师");
  const dtoks = alignTokensOf(drunk?.prereq);
  ok(!!drunk && dtoks.length > 0 && !dtoks.includes("Lawful"), "醉拳大师自带「任意非守序」的阵营要求",
    dtoks.join(","));
  const monkToks = classAlignTokens(db, monk?.id || "", [drunk?.id || ""]);
  ok(!monkToks.includes("Lawful"), "选中醉拳大师后武僧的守序要求被取代（不是取并集）", monkToks.join(","));
  const csel = classSelectableAt(db, monk?.id || "", "ChaoticEvil");
  ok(csel.ok && csel.viaArchetype === "醉拳大师", "混乱邪恶也能选武僧，并指向要走醉拳大师",
    csel.viaArchetype || "(无)");
  ok(classSelectableAt(db, monk?.id || "", "LawfulGood").ok, "守序善良当然能选武僧");
  const mk = (align: string, archs: string[]): Build => ({
    ...emptyBuild(),
    alignment: align,
    levels: emptyBuild().levels.map((l) => ({ ...l, classId: monk?.id || "" })),
    classArchetypes: { [monk?.id || ""]: archs },
  });
  ok(alignConflicts(db, mk("LawfulGood", [drunk?.id || ""])).some((x) => x.includes("醉拳大师")),
    "守序善良 + 醉拳大师 会被判冲突（要求以变体为准）");
  eq(alignConflicts(db, mk("ChaoticEvil", [drunk?.id || ""])).length, 0, "混乱邪恶 + 醉拳大师 没有冲突");
  ok(alignConflicts(db, mk("ChaoticEvil", [])).some((x) => x.includes("武僧")),
    "混乱邪恶 + 纯武僧 仍然报冲突");

  const goodDomain = Object.values(db.features)
    .find((f) => f.path && f.path.includes("Domains/Good/") && alignTokensOf(f.prereq).length > 0);
  ok(!!goodDomain, "善良领域带阵营前置（领域靠特性前置拦人）", goodDomain?.path || "");

  // ── 专长前置：新补的三类组件 + 「不检查前置」的槽位 ──────────────────
  const ignSlots = Object.values(db.features).filter((f) => f.ignorePrereq);
  ok(ignSlots.length >= 80, "「不检查前置」的槽位已导出（IgnorePrerequisites）", `实得 ${ignSlots.length}`);
  const crusaderSlot = Object.values(db.features)
    .find((f) => (f.path || "").includes("Crusader/CrusaderBonusFeat1.jbp"));
  ok(!!crusaderSlot?.ignorePrereq, "圣教军的额外专长槽标了 ignorePrereq", crusaderSlot?.path || "");
  const paramIgn = Object.values(db.features).filter((f) => f.ignoreParamPrereq);
  ok(paramIgn.length >= 4, "参数化专长的「不检查参数前置」已导出", `实得 ${paramIgn.length}`);

  const pathByKey = (k: string): MythicPathEntry | undefined =>
    Object.values(db.mythic.paths).find((p) => p.key === k);
  const golden = pathByKey("GoldenDragonClass");
  const gdMrank = (golden?.prereq || []).find((p) => p.k === "mrank");
  ok(!!gdMrank && Number(gdMrank.v) === 7, "金龙道途带「神话阶层 ≥ 7」门槛", JSON.stringify(gdMrank || {}));
  const mkCtx = (rank: number, ids: string[] = []) => ({
    atLevel: 20, classLevels: {}, attrs: {}, idSet: new Set<string>(ids),
    alignment: null, race: null, background: null, mythicPath: null, rank,
  });
  eq(evalPrereq(db, mkCtx(6) as never, gdMrank as Prereq), "no", "神话 6 阶时金龙门槛不满足");
  eq(evalPrereq(db, mkCtx(7) as never, gdMrank as Prereq), "ok", "神话 7 阶时金龙门槛满足");

  const devilEtude = (pathByKey("DevilMythicClass")?.prereq || []).find((p) => p.k === "etude");
  ok(!!devilEtude, "魔鬼道途带剧情 etude 条件");
  eq(evalPrereq(db, mkCtx(7) as never, devilEtude as Prereq), "unknown", "剧情 etude 不拦人（unknown）");
  const heroMain = (pathByKey("MythicStartingClass")?.prereq || []).find((p) => p.k === "mainchar");
  ok(!!heroMain, "神话英雄带「仅主角」条件");
  eq(evalPrereq(db, mkCtx(7) as never, heroMain as Prereq), "unknown", "「仅主角」不拦人（unknown）");

  // ── 神祇页的「先决条件」清单：逐条判定 + 「无变体：X」要写出名字 ──────────
  const kalis = (db.features[db.rules.deitySelection as string]?.choices || [])
    .find((id) => db.features[id]?.name === "卡丽斯翠");
  const kEntry = db.features[kalis || ""];
  const dres = evalPrereqs(db, mkCtx(0) as never, kEntry?.prereq);
  ok(dres.details.length > 0, "神祇的先决条件能逐条算出来",
    `${kEntry?.name || "?"}：${dres.details.length} 条 / 总判定 ${dres.verdict}`);
  ok(dres.details.every((d) => ["ok", "no", "unknown"].includes(d.v as string)),
    "逐条判定只有 ok / no / unknown 三种");
  const noarchP = (kEntry?.prereq || []).find((p) => p.k === "noarch");
  ok(!!noarchP, "神祇带「无变体」类前置",
    `${(kEntry?.prereq || []).filter((p) => p.k === "noarch").length} 条`);
  const noarchTxt = noarchP ? prereqText(db, noarchP) : "";
  ok(noarchTxt.startsWith("无变体：") && !noarchTxt.includes("（未命名）"),
    "「无变体」前置会写出变体名（对齐游戏里的「无变体: 野性神卫」）", noarchTxt);
  // 游戏的神祇页把「不能拥有某特性」写成「无以下特性: X」，文案要对齐
  let nofeatP = null as null | (typeof db.features[string]["prereq"][number]);
  for (const f of Object.values(db.features)) {
    const p = (f.prereq || []).find((x) => x.k === "nofeat" && !x.hide);
    if (p) { nofeatP = p; break; }
  }
  const nofeatTxt = nofeatP ? prereqText(db, nofeatP) : "";
  ok(nofeatTxt.startsWith("无以下特性：") && !nofeatTxt.includes("（未命名）"),
    "「无以下特性」文案与游戏一致（「无以下特性: 活神」）", nofeatTxt);

  // ── 候选列表的「已拥有」绿标：拿过的选项要进 owned，且它仍在候选池里 ────
  const pw = Object.values(db.features).find((f) => f.name === "猛力攻击" && (f.prereq || []).length > 0);
  const basicSlotId = db.rules.basicFeatSelection as string;
  const basicSlot = db.features[basicSlotId];
  ok(!!pw && !!basicSlot && (basicSlot.choices || []).includes(pw.id),
    "猛力攻击在通用专长候选池里（挑选取的列表里会出现它）");
  const ownedBuild: Build = {
    ...emptyBuild(),
    levels: emptyBuild().levels.map((l, i) => (i === 0 ? { ...l, picks: { [basicSlotId]: pw?.id || "" } } : l)),
  };
  ok(ownedFeatures(db, ownedBuild).ids.has(pw?.id || ""),
    "已经拿过的专长会进 ownedFeatures（候选列表据此打「已拥有」标）");

  const oneofFeat = Object.values(db.features)
    .find((f) => (f.prereq || []).some((p) => p.k === "oneof" && Number(p.amount) >= 2));
  const oneofP = (oneofFeat?.prereq || []).find((p) => p.k === "oneof" && Number(p.amount) >= 2);
  ok(!!oneofP, "存在需要「N 项中的 2+ 项」的 oneof 前置", oneofFeat?.name || "");
  eq(evalPrereqs(db, mkCtx(7) as never, [oneofP as Prereq]).verdict, "no", "一项都没拿时不通过");
  eq(
    evalPrereqs(db, mkCtx(7, ((oneofP?.ids as string[]) || []).slice(0, 2)) as never, [oneofP as Prereq]).verdict,
    "ok", "满足 2 项时通过（amount 生效）",
  );

  const paPower = findByName(db, "猛力攻击");
  const paStr = (paPower?.prereq || []).find((p) => p.k === "stat" && p.stat === "Strength");
  ok(!!paStr && Number(paStr.v) === 13, "猛力攻击仍是「力量 ≥ 13」", JSON.stringify(paPower?.prereq || []));

  // ── 属性推荐（游戏属性页的绿拇指 / 红拇指）──────────────────────────
  const oracleCls = Object.values(db.classes).find((c) => c.key === "OracleClass");
  ok(!!oracleCls && (oracleCls.recommended || []).includes("Charisma"),
    "先知推荐魅力（属性页绿拇指）", JSON.stringify(oracleCls?.recommended || []));
  ok((oracleCls?.notRecommended || []).length > 0, "先知另有不推荐属性（红拇指）",
    JSON.stringify(oracleCls?.notRecommended || []));
  const recCls = Object.values(db.classes).filter((c) => (c.recommended || []).length);
  ok(recCls.length >= 20, "多数职业都带推荐属性",
    `${recCls.length}/${Object.keys(db.classes).length}`);
  ok(Object.values(db.archetypes).some((a) => (a.recommended || []).length), "变体也能覆盖推荐属性");
  const recBuild: Build = {
    ...emptyBuild(),
    levels: emptyBuild().levels.map((l) => ({ ...l, classId: oracleCls?.id || "" })),
  };
  const recIdx = attrRecommend(db, recBuild);
  ok(recIdx.good.has("Charisma") && !recIdx.bad.has("Charisma"), "先知构筑里魅力＝绿拇指");
  ok(recIdx.bad.has("Wisdom") || recIdx.bad.has("Intelligence"), "先知构筑里感知/智力＝红拇指",
    JSON.stringify([...recIdx.bad]));

  // ── 职业页右栏「施法属性 / 施法类型」两格的口径（取自职业自己的法术书）──
  const wizCls = Object.values(db.classes).find((c) => c.key === "WizardClass");
  const wizSb = wizCls?.spellbookId ? db.spellbooks[wizCls.spellbookId] : undefined;
  ok(!!wizSb && wizSb.castingAttribute === "Intelligence" && !wizSb.spontaneous,
    "法师的法术书＝智力 + 需要准备（法术书）", JSON.stringify(wizSb && { a: wizSb.castingAttribute, s: wizSb.spontaneous, all: wizSb.allSpellsKnown }));
  const oraSb = oracleCls?.spellbookId ? db.spellbooks[oracleCls.spellbookId] : undefined;
  ok(!!oraSb && oraSb.castingAttribute === "Charisma" && !!oraSb.spontaneous,
    "先知的法术书＝魅力 + 自发施法", JSON.stringify(oraSb && { a: oraSb.castingAttribute, s: oraSb.spontaneous }));
  const cleCls = Object.values(db.classes).find((c) => c.key === "ClericClass");
  const cleSb = cleCls?.spellbookId ? db.spellbooks[cleCls.spellbookId] : undefined;
  ok(!!cleSb && !!cleSb.allSpellsKnown && !cleSb.spontaneous, "牧师整张表都会（准备施法·全表）");

  // ── 「前置于」反向索引（游戏详情栏那行「前置于: 额外游荡者天赋」）────────
  const rev = prereqForIndex(db);
  const withFeatPrereq = Object.values(db.features)
    .filter((f) => (f.prereq || []).some((p) => p.k === "feat" && p.id));
  ok(withFeatPrereq.length > 200, "带「需要某特性」前置的特性很多", `实得 ${withFeatPrereq.length}`);
  const sample = withFeatPrereq.slice(0, 200);
  const revHit = sample.filter((f) => {
    const t = (f.prereq || []).find((p) => p.k === "feat" && p.id)?.id as string;
    return (rev.get(t) || []).includes(f.id);
  }).length;
  eq(revHit, sample.length, "「前置于」反向索引覆盖全部抽样");
  const extraRogue = Object.values(db.features).find((f) => (f.name || "").includes("额外") && (f.name || "").includes("天赋"));
  ok(!!extraRogue, "数据里有「额外……天赋」类特性（游戏里显示为前置于）」", extraRogue?.name || "");
  const poolId = (extraRogue?.prereq || []).find((p) => p.k === "feat" && p.id)?.id as string | undefined;
  ok(!!poolId && (rev.get(poolId) || []).includes(extraRogue?.id || ""),
    "「额外游荡者/杀手天赋」的先决条件槽位能反查到它自己", poolId || "");

  // ── 建置步骤流 ────────────────────────────────────────────────────────
  eq(
    STEP_IDS.join(">"),
    "class>race>background>attrs>skills>progress>deity>align>summary",
    "建置步骤顺序：职业→种族→背景→购点→技能→逐级→神祇→阵营→总结",
  );
  eq(normalizeStep("char"), "race", "老链接 #tab=char 映射到种族");
  eq(normalizeStep("levels"), "class", "老链接 #tab=levels 映射到职业");
  eq(normalizeStep("nonsense"), "class", "未知步骤回落到第一步");
  const stepsBuild = emptyBuild();
  ok(stepNote(db, stepsBuild, derive(db, stepsBuild), "class").includes("还没排"),
    "空构筑下第一步提示还没排职业");
  ok(stepNote(db, stepsBuild, derive(db, stepsBuild), "race").includes("还没选种族"),
    "空构筑下第二步提示还没选种族");
  eq(stepNote(db, stepsBuild, derive(db, stepsBuild), "deity"), "没有信仰也可以（除牧师类）",
    "没有信仰不算错误");

  // ── 等级下标一致性（regression：视图曾把 1 基的等级号当 0 基下标传给 store，
  //    结果在第 1 级选的职业落到了第 2 级）────────────────────────────────
  {
    const fighter = Object.values(db.classes).find((c) => c.key === "FighterClass");
    const slot = levelRootSlots(db, emptyBuild(), 1)[0];
    act.reset();
    if (fighter) act.setClass(0, fighter.id);
    eq(buildStore.get().levels[0].classId, fighter ? fighter.id : null, "setClass(0) 落在第 1 级");
    eq(buildStore.get().levels[1].classId, null, "setClass(0) 不碰第 2 级");
    if (slot) act.setPick(0, slot.id, slot.choices[0]);
    if (slot) eq(buildStore.get().levels[0].picks[slot.id], slot.choices[0], "setPick(0) 落在第 1 级");
    act.setAbility(3, "Strength");
    eq(buildStore.get().levels[3].ability, "Strength", "setAbility(3) 落在第 4 级");
    eq(buildStore.get().levels[4].ability, null, "setAbility(3) 不碰第 5 级");
    act.setClass(20, fighter ? fighter.id : null);
    eq(buildStore.get().levels.length, MAX_LEVEL, `越界的 setClass(${MAX_LEVEL}) 被忽略`);
    act.reset();
  }

  // ── 变体单选（原作规则：一个职业同时只能有一个变体）───────────────────
  {
    const cls = Object.values(db.classes).find((c) => (c.archetypes || []).length >= 2);
    if (cls) {
      const [a1, a2] = cls.archetypes;
      act.reset();
      act.toggleArchetype(cls.id, a1);
      eq((buildStore.get().classArchetypes[cls.id] || []).length, 1, "选第一个变体");
      act.toggleArchetype(cls.id, a2);
      eq((buildStore.get().classArchetypes[cls.id] || []).join(","), a2, "选第二个变体会顶掉第一个");
      act.toggleArchetype(cls.id, a2);
      eq(buildStore.get().classArchetypes[cls.id], undefined, "再点一次取消变体");
      act.toggleArchetype(cls.id, a1);
      act.clearArchetype(cls.id);
      eq(buildStore.get().classArchetypes[cls.id], undefined, "「不用变体」清空");
      const m = migrate({ ...emptyBuild(), classArchetypes: { [cls.id]: [a1, a2] } });
      eq((m.classArchetypes[cls.id] || []).length, 1, "老存档里两个变体只留一个");
    }
    let worst = 0;
    for (const p of presets) {
      const r = applyPreset(db, p);
      for (const v of Object.values(r.build.classArchetypes)) worst = Math.max(worst, v.length);
    }
    ok(worst <= 1, `预置载入后每个职业最多 1 个变体（实测最多 ${worst}）`);
    act.reset();
  }

  // ── 动态子步骤（游戏里选定职业后牌匾条会长出该职业自己的步骤）───────────
  {
    // 没选职业时只有 11 个基础步骤
    act.reset();
    eq(allSteps(db, buildStore.get()).length, STEP_IDS.length, "空构筑时没有动态步骤");

    const oracle = Object.values(db.classes).find((c) => c.key === "OracleClass");
    const fighter = Object.values(db.classes).find((c) => c.key === "FighterClass");
    if (oracle) {
      act.reset();
      for (let i = 0; i < 20; i += 1) act.setClass(i, oracle.id);
      const b = buildStore.get();
      const subs = classSubSteps(db, b);
      const names = subs.map((s) => s.name);
      ok(subs.length >= 3, `先知带出 ${subs.length} 个职业子步骤（期望 ≥3）`);
      ok(names.includes("先知诅咒"), "子步骤含「先知诅咒」", names.join("/"));
      ok(names.includes("秘示域"), "子步骤含「秘示域」", names.join("/"));
      ok(names.includes("启示"), "子步骤含「启示」", names.join("/"));
      for (const s of subs) {
        ok(s.id.startsWith(DYN_PREFIX), `子步骤 id 带 ${DYN_PREFIX} 前缀`);
        ok(!!db.features[s.slotId || ""]?.choices?.length, `子步骤「${s.name}」指向真实选择表`);
        eq(s.classId, oracle.id, `子步骤「${s.name}」归属先知`);
      }
      const all = allSteps(db, b);
      eq(all.length, STEP_IDS.length, "allSteps = 基础 9 步（子步骤已并入「逐级」）");
  ok(subs.length >= 3, `先知带出 ${subs.length} 个职业子步骤（并入逐级页）`, subs.map((x) => x.name).join("/"));
  ok(all.every((x) => !x.dynamic), "顶层步骤里没有动态子步骤");
      eq(normalizeStep(subs[0].id), "progress", "旧链接的 cls: 子步骤归一到「逐级」");
      // 牌匾上的「已选值」
      eq(stepValue(db, b, derive(db, b), "class"), "先知", "职业牌匾显示职业名");
      ok(stepFilled(db, b, derive(db, b), "class"), "选了职业就算已配置");
      for (let i = 0; i < 20; i += 1) act.setClass(i, null);
    }
    if (fighter) {
      act.reset();
      for (let i = 0; i < 20; i += 1) act.setClass(i, fighter.id);
      const subs = classSubSteps(db, buildStore.get());
      ok(!subs.some((s) => /额外专长|Bonus/i.test(s.name)), "「额外专长」类槽位不单独出步骤");
    }
    act.reset();
    eq(stepValue(db, buildStore.get(), derive(db, buildStore.get()), "align"), "", "未选阵营时牌匾为空");
    ok(!stepFilled(db, buildStore.get(), derive(db, buildStore.get()), "attrs"), "空构筑时购点牌匾未配置");
    eq(stepGlyph("mythic"), "神", "神话步骤有字母徽记");
    eq(stepGlyph("cls:abc", "先知诅咒"), "先", "动态步骤用槽位名首字当徽记");

    // 神话子步骤（游戏里升神话阶层时道途自己的牌匾：神话能力 / 强化天堂宝剑 / 骷髅战将…）
    const angel = Object.values(db.mythic.paths).find((p) => p.key === "AngelMythicClass");
    if (angel) {
      act.reset();
      eq(mythicSubSteps(db, buildStore.get()).length, 0, "没到神话阶层时没有神话子步骤");

      act.setMythicPath(angel.id);
      for (let r = 1; r <= 3; r += 1) {
        for (const s of rankRootSlots(db, buildStore.get(), r)) {
          const c = (s.choices || [])[0];
          if (c && !buildStore.get().ranks[r - 1].picks[s.id]) act.setRankPick(r - 1, s.id, c);
        }
      }
      const mb = buildStore.get();
      const my = mythicSubSteps(db, mb);
      const myNames = my.map((s) => s.name);
      ok(my.length >= 2, `天使 3 阶带出 ${my.length} 个神话子步骤（期望 ≥2）`, myNames.join("/"));
      ok(myNames.some((n) => n.includes("神话")), "神话子步骤含神话能力/神话专长", myNames.join("/"));
      for (const s of my) {
        ok(s.id.startsWith(DYN_MYTHIC_PREFIX), `神话子步骤 id 带 ${DYN_MYTHIC_PREFIX} 前缀`);
        ok(!!db.features[s.slotId || ""]?.choices?.length, `神话子步骤「${s.name}」指向真实选择表`);
        ok(!s.classId, `神话子步骤「${s.name}」不带职业归属`);
      }
      const mall = allSteps(db, mb);
      const mi = mall.findIndex((s) => s.id === "mythic");
      ok(mall.every((s) => !s.dynamic), "神话子步骤不再占顶层步骤位置");
      eq(normalizeStep(my[0].id), "progress", "旧链接的 my: 子步骤归一到「逐级」");
      ok(stepValue(db, mb, derive(db, mb), my[0].id) !== "", "神话子步骤牌匾显示已选值");
      eq(stepGlyph(my[0].id, my[0].name), my[0].name.slice(0, 1), "神话子步骤用名字首字当徽记");
      act.reset();
    }

    // 各道途专属子步骤（游戏里升阶时道途自己的牌匾：逼迫凝视 / 骷髅战将 / 精通金龙吐息 / 恶魔之相…）
    {
      const expects: Array<[string, string]> = [
        ["AeonMythicClass", "逼迫凝视"],
        ["LichMythicClass", "骷髅战将"],
        ["GoldenDragonClass", "精通金龙吐息"],
        ["DemonMythicClass", "恶魔之相"],
      ];
      for (const [key, want] of expects) {
        const p = Object.values(db.mythic.paths).find((x) => x.key === key);
        if (!p) {
          ok(false, `道途 ${key} 在数据里`);
          continue;
        }
        act.reset();
        act.setMythicPath(p.id);
        const lastRank = pathStartRank(db, p) + (p.maxLevel || 1) - 1;
        for (let r = 1; r <= lastRank; r += 1) {
          for (const s of rankRootSlots(db, buildStore.get(), r)) {
            const c = (s.choices || [])[0];
            if (c && !buildStore.get().ranks[r - 1].picks[s.id]) act.setRankPick(r - 1, s.id, c);
          }
        }
        const names = mythicSubSteps(db, buildStore.get()).map((s) => s.name);
        ok(names.some((n) => n.includes(want)), `${p.name} 带出「${want}」子步骤`, names.join("/"));
      }
      act.reset();
    }

    // 道途法术书（游戏里的「法术:等级 N」牌匾）—— 只有要自己挑法术的道途才出这些步骤
    {
      const angelP = Object.values(db.mythic.paths).find((p) => p.key === "AngelMythicClass");
      const azataP = Object.values(db.mythic.paths).find((p) => p.key === "AzataMythicClass");
      if (angelP) {
        const ab: Build = { ...emptyBuild(), mythicPath: angelP.id };
        const amb = mythicSpellbook(db, ab);
        ok(!!amb, "天使有道途法术书");
        if (amb) {
          ok(Object.keys(amb.pool).length > 10, `天使法术池非空（实测 ${Object.keys(amb.pool).length} 条）`);
          ok(amb.merged === true, "天使法术书并进职业法术书（按角色等级算环位）");
          ok(!!amb.book.allSpellsKnown, "天使整张法术表都会（allSpellsKnown）");
          ok(
            derive(db, ab).spells.some((s) => s.spellbookId === amb.spellbookId),
            "道途法术书出现在 derive() 的法术书列表里",
          );
          const aSteps = mythicSubSteps(db, ab);
          ok(
            !aSteps.some((s) => s.id.startsWith(DYN_MYTHIC_SPELL_PREFIX)),
            "会整表法术的道途不出「法术:等级 N」子步骤",
          );
        }
      }
      if (azataP) {
        // 道途法术书的法术位按**角色等级**索引（灵使 6 级才有 [1=2]），所以给 12 级法师
        const wz = Object.values(db.classes).find((c) => c.key === "WizardClass");
        const zb: Build = {
          ...emptyBuild(),
          mythicPath: azataP.id,
          levels: Array.from({ length: 20 }, (_, i) => ({
            classId: i < 12 && wz ? wz.id : null, picks: {}, params: {}, ability: null,
          })),
        };
        // 把它推到神话 5 阶（随意填每阶的槽位）
        for (let r = 1; r <= 5; r += 1) {
          for (const s of rankRootSlots(db, zb, r)) {
            const c = (s.choices || [])[0];
            if (c && !zb.ranks[r - 1].picks[s.id]) zb.ranks[r - 1].picks[s.id] = c;
          }
        }
        const zmb = mythicSpellbook(db, zb);
        ok(!!zmb, "灵使有道途法术书");
        if (zmb) {
          ok(!zmb.book.allSpellsKnown, "灵使要自己挑法术（allSpellsKnown=false）");
          ok(zmb.merged === false, "灵使的法术书是独立的（按神话阶层算环位）");
          const zSteps = mythicSubSteps(db, zb).filter((s) => s.id.startsWith(DYN_MYTHIC_SPELL_PREFIX));
          ok(zSteps.length >= 1, `灵使带出 ${zSteps.length} 个「法术:等级 N」子步骤`, zSteps.map((s) => s.name).join("/"));
          if (zSteps.length) {
            const sid = zSteps[0].id;
            eq(normalizeStep(sid), "progress", "旧链接的 mysp: 子步骤归一到「逐级」");
            eq(stepGlyph(sid), "法", "道途法术子步骤用「法」当徽记");
            eq(stepValue(db, zb, derive(db, zb), sid), "", "没选法术时牌匾为空");
            const L = Number(sid.slice(DYN_MYTHIC_SPELL_PREFIX.length));
            const first = (zmb.byLevel[L] || [])[0];
            if (first) {
              zb.spells[zmb.spellbookId] = [first.id];
              ok(
                stepValue(db, zb, derive(db, zb), sid).includes("已选"),
                "选了法术之后牌匾显示「已选 N」",
              );
            }
          }
          const zall = allSteps(db, zb);
          const zi = zall.findIndex((s) => s.id === "mythic");
          const zsubs = mythicSubSteps(db, zb);
          ok(zall.every((s) => !s.dynamic), "神话子步骤（含道途法术）不再占顶层步骤位置");
        }
      }
    }
  }

  // ── 神话：前两阶固定神话英雄、第三阶选道途、第八阶可换晚期道途 ─────────
  {
    eq(MYTHIC_LATE_START, 8, "晚期道途从第 8 阶起");
    const paths = Object.values(db.mythic.paths);
    const mains = paths.filter((p) => pathStartRank(db, p) === 3);
    const lates = paths.filter((p) => pathStartRank(db, p) >= MYTHIC_LATE_START);

    act.reset();
    act.setMythicPath("AngelMythicClass" as any);
    let b = buildStore.get();
    const angel = Object.values(db.mythic.paths).find((p) => /AngelMythicClass/.test(p.key || ""))!.id;
    const dragon = Object.values(db.mythic.paths).find((p) => /GoldenDragonClass/.test(p.key || ""))!.id;
    act.setMythicPath(angel);
    b = buildStore.get();
    eq(mythicSource(db, b, 1).owner?.key || "", "MythicStartingClass", "第 1 阶由神话英雄提供");
    eq(mythicSource(db, b, 2).owner?.key || "", "MythicStartingClass", "第 2 阶仍由神话英雄提供");
    eq(mythicSource(db, b, 3).owner?.id, angel, "第 3 阶起由主道途提供");
    eq(mythicSource(db, b, 7).owner?.id, angel, "第 7 阶仍是主道途");
    eq(mythicSource(db, b, 8).owner?.id, angel, "没换晚期道途时第 8 阶继续主道途");

    act.setMythicLate(dragon);
    b = buildStore.get();
    eq(mythicSource(db, b, 3).owner?.id, angel, "换晚期道途后第 3 阶仍归主道途");
    eq(mythicSource(db, b, 7).owner?.id, angel, "换晚期道途后第 7 阶仍归主道途");
    eq(mythicSource(db, b, 8).owner?.id, dragon, "第 8 阶由晚期道途接管");
    eq(mythicSource(db, b, 10).owner?.id, dragon, "第 10 阶仍由晚期道途提供");
    act.reset();
    act.setMythicLate(null);
    ok(mains.length >= 6, `主道途 ${mains.length} 条（第 3 阶起）`);
    ok(lates.length >= 4, `晚期道途 ${lates.length} 条（第 8 阶起）`);
  }

  // ── 传奇（Legend）：单独处理 —— 等级上限 40，神话只到第 8 阶 ──────────
  {
    act.reset();
    eq(levelCap(buildStore.get()), 20, "普通构筑等级上限 20");
    eq(buildStore.get().levels.length, 40, "存档按 40 格准备（传奇要用到 21–40）");
    act.setMythicLate(LEGEND_PATH_ID);
    eq(levelCap(buildStore.get()), 40, "选了传奇，等级上限变 40");
    const d = derive(db, buildStore.get());
    ok(d.unfinished.includes("第 40 级未选职业"), "传奇的未完成清单排到第 40 级");
    const legend = Object.values(db.mythic.paths).find((p) => p.id === LEGEND_PATH_ID)!;
    eq(legend.maxLevel, 1, "传奇道途只有 1 级（第 8 阶）");
    eq(mythicSource(db, buildStore.get(), 8).owner?.id, LEGEND_PATH_ID, "第 8 阶由传奇接管");
    eq(rankRootSlots(db, buildStore.get(), 8).length, 0, "传奇第 8 阶没有要选的（数据里 10 个特性、0 个选择表）");
    eq(rankRootSlots(db, buildStore.get(), 9).length, 0, "传奇没有第 9 阶的内容");
    eq(rankRootSlots(db, buildStore.get(), 10).length, 0, "传奇没有第 10 阶的内容");
    act.setMythicLate(null);
    eq(levelCap(buildStore.get()), 20, "取消传奇后等级上限回到 20");
    act.reset();
  }

  // ── 传奇：角色等级 40，但单职业仍然最多 20 级 ───────────────────────
  {
    act.reset();
    act.setMythicLate(LEGEND_PATH_ID);
    const paladin = Object.values(db.classes).find((c) => /PaladinClass/.test(c.key || ""))!.id;
    for (let i = 0; i < 25; i += 1) act.setClass(i, paladin);
    const d = derive(db, buildStore.get());
    eq(classLevels(buildStore.get())[paladin], 25, "允许把同一职业排到 25 级（数据层不拦）");
    ok(
      d.unfinished.some((t) => t.includes(`单职业最多 ${BASE_LEVEL} 级`)),
      "未完成清单会指出单职业超 20 级",
      d.unfinished.filter((t) => t.includes("单职业")).join(" / "),
    );
    act.reset();
  }

  // ── 职业擅长随职业实时进 derived（战士 / 法师同一级对比）──────────────
  {
    act.reset();
    const fighter = Object.values(db.classes).find((c) => /FighterClass/.test(c.key || ""))!.id;
    const wizard = Object.values(db.classes).find((c) => /WizardClass/.test(c.key || ""))!.id;
    eq(derive(db, buildStore.get()).proficiencies.weapon.length, 0, "没选职业时没有任何武器擅长");
    act.setClass(0, fighter);
    const fp = derive(db, buildStore.get()).proficiencies;
    ok(fp.weapon.length > 0 || fp.armor.length > 0, "战士第 1 级就带出武器/护甲擅长", JSON.stringify(fp));
    act.setClass(0, wizard);
    const wp = derive(db, buildStore.get()).proficiencies;
    ok(
      JSON.stringify(wp) !== JSON.stringify(fp),
      "换职业后擅长跟着变",
      `战士=${JSON.stringify(fp)} 法师=${JSON.stringify(wp)}`,
    );
    act.reset();
  }

  // ── 图标索引（从本机游戏 blueprint.assets 导出）────────────────────────
  {
    const byId = db.icons?.byId || {};
    ok(Object.keys(byId).length >= 800, `图标索引 ≥800 条（实测 ${Object.keys(byId).length}）`);
    ok(
      Object.keys(db.spells).some((id) => !!byId[id]),
      "至少有一部分法术有真实图标",
    );
    ok(
      Object.keys(db.features).some((id) => !!byId[id]),
      "至少有一部分特性有真实图标",
    );
  }

  // ── 前置里的条件树（PrerequisiteCondition）──────────────────────────
  {
    const conds: { id: string; p: any }[] = [];
    for (const [fid, f] of Object.entries(db.features)) {
      for (const pr of ((f as any).prereq || []) as any[]) {
        if (pr.k === "condition" && !pr.hide) conds.push({ id: fid, p: pr });
      }
    }
    ok(conds.length > 0, `有非隐藏的条件前置（${conds.length} 条）`);
    const texts = conds.map((c) => prereqText(db, c.p));
    ok(!texts.some((t) => t.includes("条件复杂")), "条件前置全部能翻成具体条件（没有「条件复杂」）");
    ok(texts.some((t) => /已有 \d+ 层/.test(t)), "重复可选专长显示成「已有 N 层」");
    // 层数判定：额外奥秘 需要「未拿满 3 层」
    const ea = conds.find((c) => (db.features[c.id] as any).name === "额外奥秘");
    if (ea) {
      const b1 = emptyBuild();
      const d1 = derive(db, b1);
      const c1 = levelCtxList(db, b1, d1)[0];
      ok(evalPrereq(db, c1, ea.p) === "ok", "空构筑下「额外奥秘」的前置通过（还没拿 3 层）");
      const b3 = emptyBuild();
      for (let i = 0; i < 3; i += 1) {
        b3.levels[i] = { ...emptyLevel(), classId: Object.keys(db.classes)[0], picks: { x: ea.id } };
      }
      const d3 = derive(db, b3);
      const c3 = levelCtxList(db, b3, d3)[2];
      ok(evalPrereq(db, c3, ea.p) === "no", "拿了 3 次「额外奥秘」后前置不再通过");
    }
    // 施法类型
    const ct = Object.entries(db.features)
      .flatMap(([fid, f]) => (((f as any).prereq || []) as any[]).filter((p) => p.k === "castertype").map((p) => ({ fid, p })))[0];
    if (ct) {
      const bw = emptyBuild();
      const wiz = Object.values(db.classes).find((c) => c.name === "法师");
      if (wiz) {
        for (let i = 0; i < 5; i += 1) bw.levels[i] = { ...emptyLevel(), classId: wiz.id };
        const dw = derive(db, bw);
        const cw = levelCtxList(db, bw, dw)[4];
        const b0 = emptyBuild();
        const d0 = derive(db, b0);
        const c0 = levelCtxList(db, b0, d0)[0];
        ok(evalPrereq(db, cw, ct.p) === "ok", "有奥术施法职业时「奥术施法者」前置通过");
        ok(evalPrereq(db, c0, ct.p) === "unknown", "没有职业时不误判成失败");
      }
    }
  }

  // 神话阶层与等级的对应（游戏按剧情给，等级是近似值）
  ok(MYTHIC_RANK_LEVELS.length === 10, "神话阶层的等级表 10 阶齐全");
  ok(ranksAtLevel(1) === 0, "1 级还没有神话阶层");
  ok(ranksAtLevel(5) === 0, "5 级还没到第 1 阶（第 1 阶约 6 级）");
  ok(ranksAtLevel(6) === 1, "6 级拿到第 1 阶");
  ok(ranksAtLevel(10) === 3, "10 级拿到第 3 阶");
  ok(ranksAtLevel(20) === 10, "20 级满 10 阶");
  ok(levelForRank(1) === 6 && levelForRank(3) === 10 && levelForRank(10) === 20, "按阶层反查等级");
  {
    const b6 = emptyBuild();
    const fighter = Object.values(db.classes).find((c) => c.name === "战士");
    if (fighter) {
      for (let i = 0; i < 6; i += 1) b6.levels[i] = { ...emptyLevel(), classId: fighter.id };
      const ctx6 = levelCtxList(db, b6, derive(db, b6))[5];
      const ctx5 = levelCtxList(db, b6, derive(db, b6))[4];
      ok(ctx5.rank === 0 && ctx6.rank === 0, "没填任何阶层时 rank=0");
      // 填了第 1 阶之后：第 5 级还看不到（第 1 阶约 6 级），第 6 级才纳入
      const bm = { ...b6, ranks: b6.ranks.map((r, i) => (i === 0 ? { ...r, picks: { any_slot: "x" } } : r)) };
      const cs = levelCtxList(db, bm, derive(db, bm));
      ok(cs[4].rank === 0, "5 级时第 1 阶还不算（第 1 阶约 6 级）");
      ok(cs[5].rank === 1, "6 级时第 1 阶纳入上下文");
    }
  }

  /* ── 导出构筑表（表格数据）── */
  {
    const be = emptyBuild();
    be.name = "导出测试";
    const t = buildTable(db, be);
    ok(t.head.length === 7, "导出表头 7 列");
    ok(t.rows.length === levelCap(be), "导出逐级行数 = 等级上限");
    ok(t.meta.some(([k]) => k === "购点") && t.meta.some(([k]) => k === "种族"), "导出信息块含购点/种族");
    const csv = toCsv(t);
    ok(csv.startsWith("\ufeff") && csv.includes("导出测试"), "CSV 带 BOM 且含标题");
    const tsv = toTsv(t);
    ok(tsv.split("\n").some((l) => l.split("\t").length === 7), "TSV 用制表符分列");
  }

  /* ── 导出表把嵌套选择写全（战斗特技里再选的专长）── */
  {
    const bn = emptyBuild();
    const fighter = Object.values(db.classes).find((c) => c.name === "战士");
    if (fighter) {
      bn.levels[0] = { ...emptyLevel(), classId: fighter.id };
      const slot = levelRootSlots(db, bn, 1).find((s) => label(s) === "专长");
      ok(!!slot, "1 级有「专长」槽位");
      if (slot) {
        // 专长 › 战斗特技 › 猛力攻击
        bn.levels[0].picks[slot.id] = "c5158a6622d0b694a99efb1d0025d2c1";
        bn.levels[0].picks["c5158a6622d0b694a99efb1d0025d2c1"] = "9972f33f977fc724c838e59641b2fca5";
        const nt = buildTable(db, bn);
        ok(nt.rows[0][2].includes("战斗特技 › 猛力攻击"), "导出专长列写出嵌套链：战斗特技 › 猛力攻击");
      }
      const nb = buildTable(db, bn);
      ok(/BAB \+1/.test(nb.rows[0][6]), "导出备注写该级 BAB（战士 1 级 = +1）");
      ok(/BAB \+1/.test(nb.rows[1][6]), "空职业行沿用累计 BAB（战士 1 级后仍 +1）");
    }
  }

  /* ── 逐级 BAB / 偷袭进 LevelCtx，能判 BaseAttackBonus 前置 ── */
  {
    const bb = emptyBuild();
    const fighter = Object.values(db.classes).find((c) => c.name === "战士");
    if (fighter) {
      for (let i = 0; i < 12; i += 1) bb.levels[i] = { ...emptyLevel(), classId: fighter.id };
      const cs = levelCtxList(db, bb, derive(db, bb));
      ok(cs[0].bab === 1 && cs[11].bab === 12, "战士第 1/12 级 BAB 分别为 +1/+12");
      // 重击专攻：只有 BAB ≥ 9 一条前置
      const crit = "8ac59959b1b23c347a0361dc97cc786d";
      const f = db.features[crit];
      ok(!!f && f.name === "重击专攻", "找到「重击专攻」（BAB ≥ 9）");
      if (f) {
        ok(evalPrereqs(db, cs[7], f.prereq).verdict === "no", "战士 8 级（BAB +8）判为不满足");
        ok(evalPrereqs(db, cs[8], f.prereq).verdict === "ok", "战士 9 级（BAB +9）判为满足");
        ok(prereqText(db, f.prereq[0]) === "基础攻击加值 ≥ 9", "BAB 前置文案用中文");
      }
    }
    // 偷袭骰
    const sneakFeat = db.features["9f0187869dc23744292c0e5bb364464e"];
    if (sneakFeat) {
      const no = { ...levelCtxList(db, emptyBuild(), derive(db, emptyBuild()))[0] };
      ok(evalPrereqs(db, no, sneakFeat.prereq).verdict !== "ok", "没有偷袭骰时「熟练偷袭者」不满足");
    }
  }

  /* ── 前置语义对齐游戏源码（prof 取或 / notprof / clvl.Not / oneof 0 项）── */
  {
    const shieldFocus = db.features["ac57069b6bf8c904086171683992a92a"];
    ok(!!shieldFocus && shieldFocus.name === "盾牌专攻", "找到「盾牌专攻」");
    const prof = shieldFocus?.prereq?.find((p) => p.k === "prof");
    ok(!!prof && ((prof.armor as string[]) || []).length >= 2, "盾牌专攻的擅长前置是多值", JSON.stringify(prof?.armor || []));
    if (prof) {
      const onlyLight = { ...levelCtxList(db, emptyBuild(), derive(db, emptyBuild()))[0], profArmor: ["LightShield"] };
      eq(evalPrereq(db, onlyLight as never, prof as Prereq), "ok", "只擅长轻盾也算满足盾牌专攻（游戏是「或」）");
      const none = { ...onlyLight, profArmor: [], profWeapon: [] };
      eq(evalPrereq(db, none as never, prof as Prereq), "no", "什么盾都不擅长时盾牌专攻不满足");
    }
    const np = { k: "notprof", armor: ["Light", "Heavy"] } as unknown as Prereq;
    const hasLight = { ...levelCtxList(db, emptyBuild(), derive(db, emptyBuild()))[0], profArmor: ["Light"] };
    eq(evalPrereq(db, hasLight as never, np), "ok", "notprof：只擅长轻甲也通过（有一项不擅长即可）");
    const hasBoth = { ...hasLight, profArmor: ["Light", "Heavy"] };
    eq(evalPrereq(db, hasBoth as never, np), "no", "notprof：全都会就不通过");

    const notFighter = { k: "clvl", class: Object.values(db.classes).find((c) => c.name === "战士")?.id, v: 1, not: true } as unknown as Prereq;
    const ctx0 = levelCtxList(db, emptyBuild(), derive(db, emptyBuild()))[0];
    eq(evalPrereq(db, ctx0 as never, notFighter), "ok", "clvl.Not：没有该职业等级时通过");
    const fb = emptyBuild();
    const fighter = Object.values(db.classes).find((c) => c.name === "战士");
    if (fighter) {
      fb.levels[0] = { ...emptyLevel(), classId: fighter.id };
      eq(evalPrereq(db, levelCtxList(db, fb, derive(db, fb))[0] as never, notFighter), "no", "clvl.Not：已是该职业则不通过");
    }

    const zero = db.features["ce72662a812b1f242849417b2c784b5e"];
    const zeroP = zero?.prereq?.find((p) => p.k === "oneof" && Number(p.amount) === 0);
    ok(!!zeroP, "找到 Amount=0 的 oneof 前置（迷惑之刃）", zero?.name || "");
    if (zeroP) {
      eq(evalPrereqs(db, ctx0 as never, [zeroP as Prereq]).verdict, "ok", "oneof Amount=0 视为无实际限制");
      ok(prereqText(db, zeroP as Prereq).includes("无实际限制"), "Amount=0 在前置文案里写明无实际限制");
    }
  }

  /* ── 前置语义（二）：replacestat / classlevels / oneof.restrict / selpossible / casterspell ── */
  {
    const magus = Object.values(db.classes).find((c) => c.name === "魔战士");
    const fighter = Object.values(db.classes).find((c) => c.name === "战士");
    ok(!!magus && !!fighter, "找到「魔战士」与「战士」");

    // 完美重击：ReplaceStatForPrerequisites 把 BaseAttackBonus 按 MagusBaseAttack 抬高
    const perf = db.features["36837f00fc2f5d043847e37ba6af187c"];
    ok(!!perf, "找到「完美重击」");
    if (magus && perf) {
      const bm = emptyBuild();
      for (let i = 0; i < 9; i += 1) bm.levels[i] = { ...emptyLevel(), classId: magus.id };
      const cm = levelCtxList(db, bm, derive(db, bm))[8];
      const rawBab = cm.bab ?? 0;
      const p8 = { k: "stat", stat: "BaseAttackBonus", v: rawBab + 2 } as unknown as Prereq;
      eq(evalPrereq(db, cm, p8), "no", "魔战士 9 级：BAB 还不够 BAB+2 的专长");
      const cmPerf = { ...cm, idSet: new Set([...cm.idSet, "36837f00fc2f5d043847e37ba6af187c"]) };
      eq(evalPrereq(db, cmPerf as never, p8), "ok", "完美重击按职业等级改写 BAB 后满足该专长");
    }

    // 战士训练（ClassLevelsForPrerequisites）：魔战士等级的一半折算成战士等级。
    // 它的 m_ForSelection 指向「专长」选择表，所以只对专长表里的子项生效 —— subject 必须传该表里的专长。
    if (magus && fighter) {
      const bm = emptyBuild();
      for (let i = 0; i < 8; i += 1) bm.levels[i] = { ...emptyLevel(), classId: magus.id };
      const cm = levelCtxList(db, bm, derive(db, bm))[7];
      const pF = { k: "clvl", class: fighter.id, v: 4 } as unknown as Prereq;
      eq(evalPrereq(db, cm, pF), "no", "纯魔战士没有战士等级");
      const cmWf = { ...cm, idSet: new Set([...cm.idSet, "2b636b9e8dd7df94cbd372c52237eebf"]) };
      const featSel = db.features["247a4068296e8be42890143f451b4b45"];
      const subject = (featSel?.choices || [])[0] || "";
      ok(!!subject, "专长选择表有子项可作 subject");
      eq(evalPrereq(db, cmWf as never, pF, 0, subject), "ok", "战士训练让魔战士 8 级算作战士 4 级（判专长表子项时）");
      eq(evalPrereq(db, cmWf as never, pF, 0, "not-in-that-selection"), "no", "战士训练不适用于专长表以外的特性");
    }

    // 活神 / 拉兹米尔卧底：m_RestrictIfNot 取反 =「最多 N-1 项」
    const liveGod = db.features["464ffaf88140474a949618bec7955e78"];
    const restrictP = liveGod?.prereq?.find((p) => p.k === "oneof" && p.restrict);
    ok(!!restrictP, "找到带 restrict 的 oneof（活神）");
    if (restrictP) {
      const gods = (restrictP.ids as string[]) || [];
      const c0 = levelCtxList(db, emptyBuild(), derive(db, emptyBuild()))[0];
      eq(evalPrereq(db, c0, restrictP as Prereq), "ok", "一个神都没信时「活神」成立");
      const one = { ...c0, idSet: new Set([...c0.idSet, gods[0]]) };
      eq(evalPrereq(db, one as never, restrictP as Prereq), "no", "已信一位神时「活神」不成立");
      ok(prereqText(db, restrictP as Prereq).includes("最多"), "restrict 的前置文案写成「最多只能有其中 N 项」");
    }

    // 防御扩充：该选择表的子项全拿完之后就不再可选
    const expDef = db.features["d741f298dfae8fc40b4615aaf83b6548"];
    const selP = expDef?.prereq?.find((p) => p.k === "selpossible");
    ok(!!selP && !!selP.id, "防御扩充的 selpossible 拿到了选择表 id");
    if (selP && expDef) {
      const kids = expDef.choices || [];
      const c0 = levelCtxList(db, emptyBuild(), derive(db, emptyBuild()))[0];
      const full = { ...c0, idSet: new Set([...c0.idSet, ...kids]) };
      eq(evalPrereq(db, full as never, selP as Prereq), "no", "防御扩充的子项全拿完后不再通过");
    }

    // 以战筑信：能施放 1 环神术（非自发）
    const warFaith = db.features["b9bee4e4e15573546b76a8d942ce914b"];
    const csP = warFaith?.prereq?.find((p) => p.k === "casterspell");
    ok(!!csP, "找到 casterspell 前置（以战筑信）");
    if (csP) {
      const c0 = levelCtxList(db, emptyBuild(), derive(db, emptyBuild()))[0];
      eq(evalPrereq(db, c0, csP as Prereq), "no", "没有施法职业时 casterspell 不通过");
    }
  }

  const total = pass + fails.length;
  if (fails.length === 0) {
    console.log(`### ALL CHECKS PASSED ###  (${pass}/${total})`);
  } else {
    console.log(`### FAILED ###  ${pass}/${total} 通过`);
    for (const f of fails) console.log("  ✗ " + f);
    process.exitCode = 1;
  }
}
