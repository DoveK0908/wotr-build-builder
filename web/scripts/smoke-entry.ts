/**
 * 规则引擎无头自检：直接拿 public/data 里的真实数据跑一遍
 * derive / 点买 / 属性 / 前置校验 / 存档往返，
 * 由 scripts/smoke.mjs 用 esbuild 打包后执行。
 */
import fs from "node:fs";
import path from "node:path";
import type { Db, FeatureEntry, Prereq } from "../src/types";
import { emptyBuild, serialize, deserialize } from "../src/store";
import { applyPreset } from "../src/presets";
import type { Build } from "../src/store";
import {
  attrMod,
  attrsAtLevel,
  charLevel,
  classLevels,
  derive,
  evalPrereqs,
  backgroundRoot,
  levelCtxList,
  levelRootSlots,
  livePicks,
  num,
  ownedFeatures,
  pointBuySpent,
  raceRootSlots,
  rankRootSlots,
  traitList,
} from "../src/rules";

const FILES = [
  "rules", "classes", "archetypes", "features", "spells", "spellLists",
  "spellbooks", "races", "backgrounds", "mythic", "presets", "meta",
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

  // ---- 属性点买 ----
  const b: Build = emptyBuild();
  b.name = "自检角色";
  b.race = HUMAN;
  for (let i = 0; i < 20; i += 1) b.levels[i].classId = FIGHTER;
  eq(pointBuySpent(db, b), 0, "全 10 点买花费 0");
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
  b.name = "往返测试";
  b.background = bgItems[0]?.id || null;
  b.mythicPath = Object.keys(db.mythic)[0];
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
  const angel = Object.values(db.mythic.paths).find((p) => p.nameEn === "AngelMythicClass") ||
    Object.values(db.mythic.paths).find((p) => p.name === "天使");
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

  const fighterCls = Object.values(db.classes).find((c) => c.nameEn === "FighterClass");
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

  const total = pass + fails.length;
  if (fails.length === 0) {
    console.log(`### ALL CHECKS PASSED ###  (${pass}/${total})`);
  } else {
    console.log(`### FAILED ###  ${pass}/${total} 通过`);
    for (const f of fails) console.log("  ✗ " + f);
    process.exitCode = 1;
  }
}
