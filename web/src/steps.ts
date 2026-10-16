/**
 * 建置顺序（用户指定的流程）：职业 → 种族 → 背景 → 购点 → 技能 → 专长 → 法术 → 神祇 → 阵营 → 神话 → 总结。
 *
 * 只放数据与状态判断，不放 JSX —— 这样无头自检（scripts/smoke-entry.ts）也能直接验证顺序。
 * 神话不在用户列的顺序里，但它本来就是独立的一条进度线（10 个阶层），所以排在阵营之后、总结之前。
 */
import type { Db } from "./types";
import type { Build } from "./store";
import type { Derived } from "./rules";
import { alignConflicts, levelRootSlots, pointBuySpent } from "./rules";

export interface Step {
  id: string;
  name: string;
  num: string;
  hint: string;
}

export const STEPS: Step[] = [
  { id: "class", name: "职业", num: "①", hint: "先排 20 级要练哪些职业，以及要不要变体" },
  { id: "race", name: "种族", num: "②", hint: "种族加值、任选属性、种族传承" },
  { id: "background", name: "背景", num: "③", hint: "按层级选：大类 → 具体背景 → 有些还要再选一项" },
  { id: "attrs", name: "购点", num: "④", hint: "点买、升级提升、装备等外部加值" },
  { id: "skills", name: "技能", num: "⑤", hint: "把每级的技能点投出去" },
  { id: "feats", name: "专长", num: "⑥", hint: "逐级填专长 / 职业选择，含参数（武器、法术学派…）" },
  { id: "spells", name: "法术", num: "⑦", hint: "每个施法职业的已知法术与额外领域法术" },
  { id: "deity", name: "神祇", num: "⑧", hint: "信仰（牧师/战斗祭司等必需），并会限制阵营与领域" },
  { id: "align", name: "阵营", num: "⑨", hint: "阵营与已选职业 / 变体 / 神祇是否相容" },
  { id: "mythic", name: "神话", num: "⑩", hint: "神话道途：前两阶是神话英雄，第 3 阶才出道途" },
  { id: "summary", name: "总结", num: "⑪", hint: "全构筑一览、未完成清单与分享" },
];

export const STEP_IDS: string[] = STEPS.map((s) => s.id);

/** 老链接（#tab=char / #tab=levels）映射到新步骤 */
const ALIASES: Record<string, string> = {
  char: "race",
  levels: "class",
};

export function normalizeStep(id: string | null | undefined): string {
  if (!id) return STEPS[0].id;
  const v = ALIASES[id] || id;
  return STEP_IDS.includes(v) ? v : STEPS[0].id;
}

/** 还有几项没选完（专长一步的进度） */
export function missingPicks(db: Db, build: Build, levels = 20): number {
  let n = 0;
  for (let i = 0; i < levels && i < build.levels.length; i += 1) {
    if (!build.levels[i].classId) continue;
    for (const s of levelRootSlots(db, build, i + 1)) {
      if (!build.levels[i].picks[s.id]) n += 1;
    }
  }
  return n;
}

/** 这一步的提示：空字符串 = 已经做完 / 没什么要提醒的 */
export function stepNote(db: Db, build: Build, d: Derived, id: string): string {
  switch (id) {
    case "class": {
      if (d.level === 0) return "还没排任何职业";
      return d.level < 20 ? `已排 ${d.level}/20 级` : "";
    }
    case "race":
      return build.race ? "" : "还没选种族";
    case "background":
      return build.background ? "" : "可以不选，但多数构筑会选一个";
    case "attrs": {
      const total = db.rules.pointBuyTotal || 25;
      const spent = pointBuySpent(db, build);
      if (spent > total) return `点买超支 ${spent - total} 点`;
      return spent < total ? `点买还剩 ${total - spent} 点` : "";
    }
    case "skills": {
      const left = d.skillPointsTotal - d.skillSpent;
      if (left > 0) return `还有 ${left} 点没投`;
      if (left < 0) return `投多了 ${-left} 点`;
      return "";
    }
    case "feats": {
      const miss = missingPicks(db, build);
      return miss ? `还有 ${miss} 项没选` : "";
    }
    case "spells":
      return d.spells.length ? "" : "没有施法职业（可跳过）";
    case "deity":
      return build.deity ? "" : "没有信仰也可以（除牧师类）";
    case "align": {
      const bad = alignConflicts(db, build);
      return bad.length ? `${bad.length} 处阵营冲突` : "";
    }
    case "mythic":
      return d.rank ? "" : "还没到神话阶层（可跳过）";
    default:
      return "";
  }
}

/** 「警告色」提示 vs 中性提示 */
export function stepWarn(stepId: string, note: string): boolean {
  if (!note) return false;
  if (stepId === "align") return true;
  return /冲突|超支|投多了|还没/.test(note);
}
