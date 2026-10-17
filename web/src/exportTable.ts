import type { Db } from "./types";
import { ATTRS, levelCap } from "./store";
import type { Build } from "./store";
import {
  attrMod,
  backgroundRoot,
  derive,
  label,
  levelForRank,
  levelRootSlots,
  pointBuySpent,
  rankRootSlots,
  ranksAtLevel,
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

/** 某一级里所有「要选的东西」，按列分类 */
function levelCells(db: Db, build: Build, idx: number) {
  const lv = build.levels[idx];
  const feat: string[] = [];
  const other: string[] = [];
  const notes: string[] = [];
  if (!lv) return { cls: "", feat, other, notes };

  const slots = levelRootSlots(db, build, idx + 1);
  for (const s of slots) {
    const v = lv.picks?.[s.id];
    if (!v) continue;
    // 参数化的专长把参数一起写出来
    const p = db.features[v]?.paramVariants?.[lv.params?.[v] ?? ""];
    const text = p ?? slotName(db, v);
    const slotLabel = slotName(db, s.id);
    if (/专长/.test(slotLabel) || /专长/.test(text)) feat.push(text);
    else other.push(text);
  }
  const ab = lv.ability ? ATTR_CN[lv.ability] ?? lv.ability : "";
  if (ab) notes.push(`属性 +1：${ab}`);
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
    const v = r.picks?.[s.id];
    if (!v) continue;
    const p = db.features[v]?.paramVariants?.[r.params?.[v] ?? ""];
    out.push(p ?? slotName(db, v));
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
    const rank = ranksAtLevel(n);
    const isNewRank = rank > 0 && levelForRank(rank) === n;
    rows.push([
      String(n),
      cls,
      feat.join("、"),
      other.join("、"),
      isNewRank ? `第 ${rank} 阶` : "",
      isNewRank ? rankCells(db, build, rank).join("、") : "",
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
