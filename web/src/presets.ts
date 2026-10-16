/**
 * 预置构筑：把 pipeline/import_presets.py 从中文 BD 合集解析出来的攻略，
 * 套用成一个可以直接继续编辑的 Build。
 *
 * 攻略里的「第 N 级：专长 A、专长 B」是文字，不是槽位，所以要在这里做一次归属：
 *   1) 该级的某个选择槽的候选里正好有它 → 选中；
 *   2) 该级本来就白给（升级表/种族/背景直接给）→ 视为已满足；
 *   3) 都不行 → 收进 leftover，界面按原文展示，不丢信息。
 */

import type { AttrId, Db, Preset } from "./types";
import { ATTRS, MAX_LEVEL, MAX_RANK, emptyBuild, type Build } from "./store";
import { expandFeature, featuresAtClassLevel, universalSlots } from "./rules";

/** 升级属性加点的等级（1 级之后的 5 次） */
const ABILITY_LEVELS = [4, 8, 12, 16, 20];

export interface ApplyResult {
  build: Build;
  /** 自动落到槽位的专长数 */
  placed: number;
  /** 放不进去的（原文，按等级排好） */
  leftover: string[];
}

function slotIdsOf(db: Db, b: Build, i: number, classLevel: number): string[] {
  const lv = b.levels[i];
  const out: string[] = [];
  if (lv.classId && classLevel > 0) {
    out.push(...featuresAtClassLevel(db, lv.classId, classLevel, b.classArchetypes[lv.classId] || []));
  }
  out.push(...universalSlots(db, i + 1).map((f) => f.id));
  return out;
}

/**
 * 在某个槽位下面找一条能走到 `fid` 的路径（选择里还有选择）。
 * 返回交替的「槽位 → 选项 → 槽位 → … → fid」序列；找不到返回 null。
 */
function findPath(db: Db, slotId: string, fid: string, depth = 0): string[] | null {
  if (depth > 4) return null;
  const f = db.features[slotId];
  if (!f || !f.choices || !f.choices.length) return null;
  if (f.choices.includes(fid)) return [slotId, fid];
  for (const c of f.choices) {
    const inner = db.features[c];
    if (!inner || !inner.choices || !inner.choices.length) continue;
    const sub = findPath(db, c, fid, depth + 1);
    if (sub) return [slotId, c, ...sub.slice(1)];
  }
  return null;
}

/** 把这一级的专长塞进能容纳它的槽位（必要时连中间层一起选上） */
function placeInto(
  db: Db, b: Build, i: number, want: string[], classLevel: number,
): { placed: number; unplaced: string[] } {
  const lv = b.levels[i];
  const slots = slotIdsOf(db, b, i, classLevel);
  const unplaced: string[] = [];
  let n = 0;
  for (const fid of want) {
    if (!fid) continue;
    if (Object.values(lv.picks).includes(fid)) {
      n += 1;
      continue;
    }
    // 1) 找一个槽位，顺着它的选择树能走到这个专长
    let path: string[] | null = null;
    for (const sid of slots) {
      const p = findPath(db, sid, fid);
      if (!p) continue;
      // 路径上已经选了别的东西就换个根槽位，别覆盖玩家的选择
      let clash = false;
      for (let k = 0; k + 1 < p.length; k += 1) {
        const cur = lv.picks[p[k]];
        if (cur && cur !== p[k + 1]) { clash = true; break; }
      }
      if (!clash) { path = p; break; }
    }
    if (path) {
      // path 是「槽位 → 选项 → 槽位 → 选项」交替的，相邻两项就是一次落位
      for (let k = 0; k + 1 < path.length; k += 1) lv.picks[path[k]] = path[k + 1];
      n += 1;
      continue;
    }
    // 2) 这一级本来就白给（升级表/通用表白给），不用选
    if (slots.some((sid) => sid === fid || expandFeature(db, sid).includes(fid))) {
      n += 1;
      continue;
    }
    unplaced.push(fid);
  }
  return { placed: n, unplaced };
}

export function applyPreset(db: Db, p: Preset): ApplyResult {
  const b = emptyBuild();
  b.name = `${p.who}·预置`;
  // 一个职业只能有一个变体（原作规则）——攻略里若写了两个，只取第一个
  for (const [cid, ids] of Object.entries(p.archetypes || {})) {
    const keep = (ids || []).filter(Boolean);
    if (keep.length) b.classArchetypes[cid] = [keep[0]];
  }

  for (const pl of p.levels || []) {
    const i = pl.level - 1;
    if (i < 0 || i >= MAX_LEVEL) continue;
    if (pl.classId) b.levels[i].classId = pl.classId;
    for (const [sel, ch] of Object.entries(pl.picks || {})) if (ch) b.levels[i].picks[sel] = ch;
    for (const [f, v] of Object.entries(pl.params || {})) if (v) b.levels[i].params[f] = v;
  }

  (p.attrs || []).slice(0, ABILITY_LEVELS.length).forEach((a, k) => {
    const i = ABILITY_LEVELS[k] - 1;
    if ((ATTRS as readonly string[]).includes(a)) b.levels[i].ability = a as AttrId;
  });

  let placed = 0;
  const leftover: string[] = [];
  // 攻略里直接标好槽位的（选择槽 → 选项）算作已落位
  for (const pl of p.levels || []) {
    for (const [sel, ch] of Object.entries(pl.picks || {})) if (ch) placed += 1;
    for (const [f, v] of Object.entries(pl.params || {})) if (v && !pl.picks?.[f]) placed += 1;
  }
  const classCount: Record<string, number> = {};
  for (let i = 0; i < MAX_LEVEL; i += 1) {
    const pl = (p.levels || [])[i];
    if (!pl) continue;
    const lv = b.levels[i];
    let cl = 0;
    if (lv.classId) {
      classCount[lv.classId] = (classCount[lv.classId] || 0) + 1;
      cl = classCount[lv.classId];
    }
    const want = (pl.feats || []).map((f) => f.id);
    const res = placeInto(db, b, i, want, cl);
    placed += res.placed;
    // 放不进去的，按原文收着（界面上会列出来让你手选）
    for (const fid of res.unplaced) leftover.push(`第 ${i + 1} 级：${db.features[fid]?.name || fid}`);
    for (const u of pl.unmatched || []) leftover.push(`第 ${i + 1} 级：${u}`);
  }

  const selIds = Object.keys(db.mythic?.selections || {});
  for (const [rank, kind, val] of p.mythic || []) {
    const i = rank - 1;
    if (i < 0 || i >= MAX_RANK) continue;
    if (kind === "feat" || kind === "mythic") {
      const sel = selIds.find((s) => (db.mythic.selections[s].choices || []).includes(val));
      if (sel) {
        b.ranks[i].picks[sel] = val;
        placed += 1;
        continue;
      }
      leftover.push(`神话 ${rank}：${db.features[val]?.name || val}`);
    } else if (val) {
      leftover.push(`神话 ${rank}：${val}`);
    }
  }

  return { build: b, placed, leftover };
}
