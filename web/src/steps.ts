/**
 * 建置顺序（用户指定的流程）：职业 → 种族 → 背景 → 购点 → 技能 → 专长 → 法术 → 神祇 → 阵营 → 神话 → 总结。
 *
 * 只放数据与状态判断，不放 JSX —— 这样无头自检（scripts/smoke-entry.ts）也能直接验证顺序。
 * 神话不在用户列的顺序里，但它本来就是独立的一条进度线（10 个阶层），所以排在阵营之后、总结之前。
 */
import type { Db } from "./types";
import type { Build } from "./store";
import type { Derived } from "./rules";
import {
  alignConflicts, archSel, featuresAtClassLevel, label, levelRootSlots, mythicRank, mythicSpellbook,
  pointBuySpent, rankRootSlots, universalSlots,
} from "./rules";

export interface Step {
  id: string;
  name: string;
  num: string;
  hint: string;
  /** 动态步骤：由已选职业带出来的子步骤（游戏里也是选定职业后才出现的） */
  dynamic?: boolean;
  /** 动态步骤对应的槽位（选择表特性 id） */
  slotId?: string;
  /** 动态步骤属于哪个职业 */
  classId?: string;
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
  if (id.startsWith(DYN_PREFIX) || id.startsWith(DYN_MYTHIC_PREFIX) || id.startsWith(DYN_MYTHIC_SPELL_PREFIX)) {
    return id; // 动态步骤
  }
  const v = ALIASES[id] || id;
  return STEP_IDS.includes(v) ? v : STEPS[0].id;
}

// ── 动态子步骤 ──────────────────────────────────────────────────────────
/** 职业子步骤的 id 前缀（后面跟槽位 guid） */
export const DYN_PREFIX = "cls:";

/** 神话子步骤的 id 前缀（后面跟槽位 guid）—— 游戏升神话阶层时也会多出这类牌匾 */
export const DYN_MYTHIC_PREFIX = "my:";

/** 神话法术书的子步骤前缀（后面跟环位）—— 游戏里是「法术:等级 N」 */
export const DYN_MYTHIC_SPELL_PREFIX = "mysp:";

/** 这些「额外专长」类槽位留在 ⑥ 专长 一步里，不单独出步骤 */
const GENERIC_SLOT = /额外专长|额外战斗专长|Bonus ?Feat/i;

/**
 * 已选职业自带的子步骤。游戏里选定职业后顶部会多出该职业自己的牌匾
 * （先知 → 先知诅咒 / 秘示域 / 启示 / 额外法术；法师 → 专精学派 / 奥法契约…）。
 *
 * 判别办法：职业升级表里「带 choices 的根槽位」减去角色通用升级表给的那些。
 * 这些特性在数据里 `groups` 都是空数组，所以只能靠「谁发的」来区分。
 */
export function classSubSteps(db: Db, build: Build): Step[] {
  const sel = archSel(db, build);
  const universal = new Set<string>();
  for (let l = 1; l <= 20; l += 1) for (const f of universalSlots(db, l)) universal.add(f.id);

  const out: Step[] = [];
  const seen = new Set<string>();
  const names = new Set<string>();
  const classesDone = new Set<string>();

  for (const lv of build.levels) {
    const cid = lv.classId;
    if (!cid || classesDone.has(cid)) continue;
    classesDone.add(cid);
    const c = db.classes[cid];
    if (!c) continue;
    const max = Math.min(c.maxLevel || 20, 20);
    for (let cl = 1; cl <= max; cl += 1) {
      for (const id of featuresAtClassLevel(db, cid, cl, sel[cid] || [])) {
        const f = db.features[id];
        if (!f || !f.choices || !f.choices.length) continue;
        if (universal.has(f.id) || seen.has(f.id)) continue;
        const nm = label(f);
        if (GENERIC_SLOT.test(nm) || GENERIC_SLOT.test(f.nameEn || "")) continue;
        seen.add(f.id);
        let name = nm;
        if (names.has(name)) {
          let n = 2;
          while (names.has(`${name} ${n}`)) n += 1;
          name = `${name} ${n}`;
        }
        names.add(name);
        out.push({
          id: DYN_PREFIX + f.id,
          name,
          num: "",
          hint: `${label(c)} 的「${nm}」：${(f.choices || []).length} 个可选`,
          dynamic: true,
          slotId: f.id,
          classId: cid,
        });
      }
    }
  }
  return out;
}

/** 基础 11 步 + 职业动态子步骤（插在 ⑥ 专长 之后）+ 神话动态子步骤（插在 ⑩ 神话 之后） */
export function allSteps(db: Db, build: Build): Step[] {
  const cls = classSubSteps(db, build);
  const my = mythicSubSteps(db, build);
  let out = STEPS;
  if (cls.length) {
    const i = out.findIndex((s) => s.id === "feats");
    out = [...out.slice(0, i + 1), ...cls, ...out.slice(i + 1)];
  }
  if (my.length) {
    const i = out.findIndex((s) => s.id === "mythic");
    out = [...out.slice(0, i + 1), ...my, ...out.slice(i + 1)];
  }
  return out;
}

/**
 * 神话道途自己的子步骤。游戏里升神话阶层时，顶部除了「神话」还会多出道途自己的牌匾
 * （天使 → 神话能力 / 强化天堂宝剑 / 强化天使光环 / 高等天堂宝剑；巫妖 → 骷髅战将；
 * 御衡者 → 逼迫凝视；金龙 → 精通金龙吐息…）。
 *
 * 判别办法与职业一致：神话升级表里「带 choices 的槽位」（`rankRootSlots` 已把
 * 「奇数阶神话能力 / 偶数阶神话专长」的兜底也算进来了），按阶层顺序去重。
 * 只列到**已经排到的阶层**为止 —— 与游戏一样，阶层推进后牌匾才出现。
 */
export function mythicSubSteps(db: Db, build: Build): Step[] {
  const rank = mythicRank(build);
  if (!rank) return [];
  const out: Step[] = [];
  const seen = new Set<string>();
  const names = new Set<string>();
  for (let r = 1; r <= rank; r += 1) {
    for (const f of rankRootSlots(db, build, r)) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const nm = label(f);
      let name = nm;
      if (names.has(name)) {
        let n = 2;
        while (names.has(`${name} ${n}`)) n += 1;
        name = `${name} ${n}`;
      }
      names.add(name);
      out.push({
        id: DYN_MYTHIC_PREFIX + f.id,
        name,
        num: "",
        hint: `第 ${r} 神话阶的「${nm}」：${(f.choices || []).length} 个可选`,
        dynamic: true,
        slotId: f.id,
      });
    }
  }
  // 道途法术书（游戏里也会为每一环单独出一块「法术:等级 N」牌匾）。
  // 只有**要自己挑法术**的法术书才出（`allSpellsKnown` 的道途，比如天使/巫妖，整张表都会，
  // 游戏里就不给挑选步骤 —— 数据里也确实是 True）。
  const mb = mythicSpellbook(db, build);
  if (mb && !mb.book.allSpellsKnown) {
    for (let l = 1; l <= mb.maxLevel; l += 1) {
      const pool = mb.byLevel[l] || [];
      if (!pool.length) continue;
      out.push({
        id: DYN_MYTHIC_SPELL_PREFIX + l,
        name: `法术:等级 ${l}`,
        num: "",
        hint: `${mb.pathName}法术书：第 ${l} 环 ${pool.length} 个可选`,
        dynamic: true,
      });
    }
  }
  return out;
}

// ── 牌匾上的「已选值」 ───────────────────────────────────────────────────
const ALIGN_ABBR: Record<string, string> = {
  LawfulGood: "LG", LawfulNeutral: "LN", LawfulEvil: "LE",
  NeutralGood: "NG", TrueNeutral: "N", NeutralEvil: "NE",
  ChaoticGood: "CG", ChaoticNeutral: "CN", ChaoticEvil: "CE",
};

/** 阵营短码（游戏里牌匾上就是 LG/LN/…） */
export function alignAbbr(id: string | null | undefined): string {
  return id ? ALIGN_ABBR[id] || id : "";
}

/** 主职业（级数最多的那个；并列取先出现的） */
export function mainClass(db: Db, build: Build): { classId: string; levels: number } | null {
  const n: Record<string, number> = {};
  const first: Record<string, number> = {};
  build.levels.forEach((lv, i) => {
    if (!lv.classId) return;
    n[lv.classId] = (n[lv.classId] || 0) + 1;
    if (first[lv.classId] === undefined) first[lv.classId] = i;
  });
  const ids = Object.keys(n);
  if (!ids.length) return null;
  ids.sort((a, b) => n[b] - n[a] || first[a] - first[b]);
  return { classId: ids[0], levels: n[ids[0]] };
}

/** 牌匾右侧那块「已选值」牌匾上的文字（空串 = 还没选） */
export function stepValue(db: Db, build: Build, d: Derived, id: string): string {
  if (id.startsWith(DYN_MYTHIC_SPELL_PREFIX)) {
    const L = Number(id.slice(DYN_MYTHIC_SPELL_PREFIX.length));
    const mb = mythicSpellbook(db, build);
    if (!mb || !Number.isFinite(L)) return "";
    const picks = build.spells[mb.spellbookId] || [];
    const n = picks.filter((p) => (mb.pool[p] ?? -1) === L).length;
    return n ? `已选 ${n}` : "";
  }
  if (id.startsWith(DYN_PREFIX) || id.startsWith(DYN_MYTHIC_PREFIX)) {
    const slotId = id.slice(id.indexOf(":") + 1);
    for (const lv of build.levels) if (lv.picks[slotId]) return label(db.features[lv.picks[slotId]]);
    for (const r of build.ranks) if (r.picks[slotId]) return label(db.features[r.picks[slotId]]);
    return "";
  }
  switch (id) {
    case "class": {
      const m = mainClass(db, build);
      if (!m) return "";
      const arch = (build.classArchetypes[m.classId] || [])[0];
      const cn = label(db.classes[m.classId]);
      const an = arch ? label(db.archetypes[arch]) : "";
      return an ? `${cn} ${an}` : cn;
    }
    case "race":
      return build.race ? label(db.races[build.race]) : "";
    case "background":
      return build.background ? label(db.backgrounds[build.background]) : "";
    case "attrs": {
      const spent = pointBuySpent(db, build);
      return spent ? `点买 ${spent}` : "";
    }
    case "skills":
      return d.skillSpent ? `已投 ${d.skillSpent}` : "";
    case "feats": {
      let done = 0;
      let total = 0;
      for (let i = 0; i < build.levels.length; i += 1) {
        if (!build.levels[i].classId) continue;
        for (const s of levelRootSlots(db, build, i + 1)) {
          total += 1;
          if (build.levels[i].picks[s.id]) done += 1;
        }
      }
      return total ? `${done} / ${total}` : "";
    }
    case "spells": {
      // `d.maxSpellLevel` 是「每本法术书 → 最高环位」的表，牌匾上要的是最大的那个环位
      const mx = Math.max(0, ...Object.values(d.maxSpellLevel || {}));
      return mx ? `${mx} 环` : "";
    }
    case "deity":
      return build.deity ? label(db.features[build.deity]) : "";
    case "align":
      return alignAbbr(build.alignment);
    case "mythic": {
      const r = mythicRank(build);
      const p = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
      if (p) return `${p.name || p.nameEn} ${r}`;
      return r ? `神话英雄 ${r}` : "";
    }
    default:
      return "";
  }
}

/** 这块牌匾算不算「已配置」（决定画 ＋ 还是画已选值） */
export function stepFilled(db: Db, build: Build, d: Derived, id: string): boolean {
  if (id === "attrs") return pointBuySpent(db, build) > 0;
  if (id === "skills") return d.skillSpent > 0;
  return stepValue(db, build, d, id) !== "";
}

/** 牌匾图标里那个字（没有内容图标时，游戏自己也用字母缩写当图标） */
export function stepGlyph(id: string, name?: string): string {
  if (id.startsWith(DYN_MYTHIC_SPELL_PREFIX)) return "法";
  if (id.startsWith(DYN_PREFIX) || id.startsWith(DYN_MYTHIC_PREFIX)) return (name || "").trim().charAt(0) || "·";
  const fixed: Record<string, string> = {
    class: "职", race: "种", background: "景", attrs: "属", skills: "技", feats: "专",
    spells: "法", deity: "信", align: "阵", mythic: "神", summary: "总",
  };
  return fixed[id] || "·";
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
