import type { Db, FeatureEntry } from "./types";
import { ATTRS, levelCap } from "./store";
import type { Build } from "./store";
import {
  attrMod,
  backgroundRoot,
  babAt,
  derive,
  expandFeature,
  label,
  levelRootSlots,
  paramName,
  pointBuySpent,
  rankRootSlots,
  ranksForLevel,
} from "./rules";
import { alignAbbr } from "./steps";

/** 背景是从「选择背景」一路 bgPicks 往下选的，这里还原成人能看的路径 */
function bgPath(db: Db, build: Build): string[] {
  const out: string[] = [];
  const picks = build.bgPicks || {};
  let cur = backgroundRoot(db);
  let guard = 0;
  while (cur && guard < 6) {
    const v = picks[cur.id];
    if (!v) break;
    out.push(label(db.features[v]));
    cur = db.features[v];
    guard += 1;
  }
  if (!out.length && build.background) out.push(label(db.features[build.background]));
  return out;
}

/** 导出用的表格：上面是「角色」信息块，下面是逐级表。纯数据，不依赖 DOM。 */
export interface Table {
  /** 标题（第一行）*/
  title: string;
  /** 角色信息（label, value）*/
  meta: [string, string][];
  /** 逐级表的表头 */
  head: string[];
  /** 逐级表的行 */
  rows: string[][];
}

const ATTR_CN: Record<string, string> = {
  Strength: "力量",
  Dexterity: "敏捷",
  Constitution: "体质",
  Intelligence: "智力",
  Wisdom: "感知",
  Charisma: "魅力",
};

function slotName(db: Db, id: string): string {
  return label(db.features[id]);
}

/**
 * 把一个根槽位下面「活着的」选择链翻成人能读的一段文字。
 * 战斗特技 › 战斗流派专长 › 弓术 这种嵌套全部写出来，不能只报根槽位。
 * 参数化专长（武器专攻、诡术师学识（宗教）给的领域之类）把参数一并写进去。
 */
function chainWalk(db: Db, root: FeatureEntry, picks?: Record<string, string>, params?: Record<string, string>) {
  const parts: string[] = [];
  const labels: string[] = [];
  let leaf: FeatureEntry | undefined;
  let slot: FeatureEntry | undefined = root;
  for (let guard = 0; slot && guard < 8; guard += 1) {
    const choice = picks?.[slot.id];
    if (!choice) break;
    const f = db.features[choice];
    labels.push(slotName(db, choice));
    leaf = f;
    // 参数化专长：参数可能是 `id` 也可能是 `id#2`（学识宗教给两个领域）
    const withParam = paramLabels(db, choice, params);
    parts.push(withParam.length ? withParam.join("、") : slotName(db, choice));
    if (!f || !f.choices || !f.choices.length) {
      // 选中的是进程表（如学识（宗教）2阶）：真正的参数化特性藏在展开里
      if (!withParam.length) {
        const deep = paramLabelsOfExpansion(db, choice, params);
        if (deep.length) parts[parts.length - 1] += `（${deep.join("、")}）`;
      }
      break;
    }
    slot = f;
  }
  return {
    text: parts.length ? parts.join(" › ") : null,
    leaf,
    labels,
  };
}

/** 特性自身挂着的参数名（`id`、`id#2`… 都算） */
function paramLabels(db: Db, id: string, params?: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (k !== id && !k.startsWith(`${id}#`)) continue;
    const nm = paramName(db.features[id], v);
    if (nm) out.push(nm);
  }
  return out;
}

/** 进程表/中转表展开出来的参数化特性所选的参数 */
function paramLabelsOfExpansion(db: Db, id: string, params?: Record<string, string>): string[] {
  const out: string[] = [];
  for (const x of expandFeature(db, id)) {
    if (x === id) continue;
    for (const nm of paramLabels(db, x, params)) if (!out.includes(nm)) out.push(nm);
  }
  return out;
}

/** 这个选择算「专长」吗：链上任何一层是专长槽，或者选出来的东西带 Feat 标签 */
const FEAT_LABEL = /专长|专精|流派|特技|秘闻|天赋|绝技|发现|启示|戒律|原力|联结|契约|诅咒|血承|祝福|圣恩/;
function isFeatPick(labels: string[], leaf?: FeatureEntry): boolean {
  if (labels.some((l) => FEAT_LABEL.test(l))) return true;
  const g = leaf?.groups || [];
  return g.includes("Feat") || g.includes("CombatFeat") || g.includes("MythicFeat");
}

/** 某一级里所有「要选的东西」，按列分类 */
function levelCells(db: Db, build: Build, idx: number) {
  const lv = build.levels[idx];
  const feat: string[] = [];
  const other: string[] = [];
  const notes: string[] = [];
  if (!lv) return { cls: "", feat, other, notes };

  const slots = levelRootSlots(db, build, idx + 1);
  for (const s of slots) {
    const w = chainWalk(db, s, lv.picks, lv.params);
    if (!w.text) continue;
    if (isFeatPick(w.labels, w.leaf)) feat.push(w.text);
    else other.push(w.text);
  }
  const ab = lv.ability ? ATTR_CN[lv.ability] ?? lv.ability : "";
  if (ab) notes.push(`属性 +1：${ab}`);
  // 这一级结束时的基础攻击加值（专长的 BAB 前置就是拿它对）
  notes.push(`BAB +${babAt(db, build, idx + 1)}`);
  const cls = lv.classId ? label(db.classes[lv.classId]) : "";
  const arch = lv.classId ? (build.classArchetypes[lv.classId] || []).map((a) => label(db.archetypes[a])).join("/") : "";
  return { cls: arch ? `${cls}（${arch}）` : cls, feat, other, notes };
}

/** 某一神话阶层里选了什么 */
function rankCells(db: Db, build: Build, rank: number) {
  const r = build.ranks[rank - 1];
  const out: string[] = [];
  if (!r) return out;
  for (const s of rankRootSlots(db, build, rank)) {
    const w = chainWalk(db, s, r.picks, r.params);
    if (w.text) out.push(w.text);
  }
  return out;
}

export function buildTable(db: Db, build: Build): Table {
  const cap = levelCap(build);
  const d = derive(db, build);
  const title = build.name || "（未命名构筑）";

  const bgLabels = bgPath(db, build);
  const race = build.race ? label(db.races[build.race]) : "";
  const racePicks = Object.values(build.racePicks || {})
    .filter(Boolean)
    .map((v) => slotName(db, v as string));
  const deity = build.deity ? label(db.features[build.deity]) : "";

  const pb = pointBuySpent(db, build);
  const buy = ATTRS.map((a) => `${ATTR_CN[a]} ${build.attributes[a] ?? 10}`).join("　");
  const fin = ATTRS.map((a) => {
    const v = d.attrs[a] ?? 10;
    const m = attrMod(v);
    return `${ATTR_CN[a]} ${v}${m >= 0 ? "+" : ""}${m}`;
  }).join("　");

  const skills = Object.entries(build.skills || {})
    .filter(([, n]) => Number(n) > 0)
    .map(([id, n]) => `${slotName(db, id)} ${n}`)
    .join("、");

  const classes = Object.entries(d.classLevels)
    .map(([cid, n]) => `${label(db.classes[cid])} ${n}`)
    .join(" / ");

  const path = build.mythicPath ? label(db.mythic.paths[build.mythicPath]) : "";
  const late = build.mythicLate ? label(db.mythic.paths[build.mythicLate]) : "";

  const meta: [string, string][] = [
    ["总等级", `${d.level} / ${cap}`],
    ["种族", [race, ...racePicks].filter(Boolean).join(" · ")],
    ["背景", bgLabels.join(" › ")],
    ["神祇", deity],
    ["阵营", build.alignment ? `${label(db.rules.alignments.find((a) => a.id === build.alignment))}（${alignAbbr(build.alignment)}）` : ""],
    ["购点", `${buy}　（已用 ${pb} 点）`],
    ["属性终值", fin],
    ["技能加点", skills],
    ["职业", classes],
    ["神话道途", [path, late && late !== path ? `第 8 阶起转 ${late}` : ""].filter(Boolean).join("；")],
  ];
  if (build.notes) meta.push(["备注", build.notes]);

  const head = ["等级", "职业", "专长", "职业选择", "神话阶层", "神话能力/专长", "备注"];
  const rows: string[][] = [];
  for (let n = 1; n <= cap; n += 1) {
    const { cls, feat, other, notes } = levelCells(db, build, n - 1);
    // 一个等级可能同时解锁两阶（解锁表里 18 级对应第 7、第 8 阶），都要列出来，
    // 否则第 7 阶选的東西在表里整行消失。
    const ranks = ranksForLevel(n);
    rows.push([
      String(n),
      cls,
      feat.join("、"),
      other.join("、"),
      ranks.length ? ranks.map((r) => `第 ${r} 阶`).join("、") : "",
      ranks.map((r) => rankCells(db, build, r).join("、")).filter(Boolean).join("；"),
      notes.join("、"),
    ]);
  }
  return { title, meta, head, rows };
}

/** 转成 CSV（带 BOM，Excel 直接打开不乱码）*/
export function toCsv(t: Table): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [];
  lines.push(esc(t.title));
  lines.push("");
  for (const [k, v] of t.meta) lines.push(`${esc(k)},${esc(v)}`);
  lines.push("");
  lines.push(t.head.map(esc).join(","));
  for (const r of t.rows) lines.push(r.map(esc).join(","));
  return "\ufeff" + lines.join("\r\n");
}

/** 转成 TSV（粘进 Excel / 飞书表格会直接分行分列）*/
export function toTsv(t: Table): string {
  const clean = (v: string) => v.replace(/\t/g, " ").replace(/\r?\n/g, " ");
  const lines: string[] = [clean(t.title), ""];
  for (const [k, v] of t.meta) lines.push(`${clean(k)}\t${clean(v)}`);
  lines.push("");
  lines.push(t.head.map(clean).join("\t"));
  for (const r of t.rows) lines.push(r.map(clean).join("\t"));
  return lines.join("\n");
}

/** 文件名校安全 */
export function tableFilename(t: Table): string {
  const base = t.title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "构筑";
  return `${base}-构筑表.csv`;
}
