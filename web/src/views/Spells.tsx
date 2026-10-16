import React, { useMemo, useState } from "react";
import type { Db, SpellEntry } from "../types";
import { act, useBuild } from "../store";
import { derive, label } from "../rules";
import { Chip, Meter } from "../ui";
import { DetailHead, ListPane, ListRow, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { featureIcon } from "../skin";

const RANGE_CN: Record<string, string> = {
  Personal: "自身",
  Touch: "接触",
  Close: "近距",
  Medium: "中距",
  Long: "远距",
  Unlimited: "无限",
  None: "—",
};

const ACTION_CN: Record<string, string> = {
  Standard: "标准动作",
  FullRound: "整轮动作",
  Move: "移动动作",
  Swift: "迅捷动作",
  Immediate: "直觉动作",
  Free: "自由动作",
  FreeStep: "五尺快步",
};

const SAVE_CN: Record<string, string> = {
  Fortitude: "强韧",
  Reflex: "反射",
  Will: "意志",
  Unknown: "无",
};

const TYPE_CN: Record<string, string> = {
  Spell: "法术",
  Supernatural: "超自然能力",
  Extraordinary: "特异能力",
};

const SCHOOL_CN: Record<string, string> = {
  Abjuration: "防护",
  Conjuration: "咒法",
  Divination: "预言",
  Enchantment: "附魔",
  Evocation: "塑能",
  Illusion: "幻术",
  Necromancy: "死灵",
  Transmutation: "变化",
  Universal: "通用",
};

/** 游戏里那一行「1个敌方生物 近距」 */
function targetText(sp?: SpellEntry | null): string {
  if (!sp) return "—";
  const t = sp.targets || {};
  let what = "一个点";
  if (t.self && !t.enemies && !t.friends && !t.point) what = "自身";
  else if (t.self && t.point) what = "自身或一个点";
  else if (t.enemies && !t.friends) what = "1个敌方生物";
  else if (t.friends && !t.enemies) what = "1个友方生物";
  else if (t.enemies && t.friends) what = "1个生物";
  else if (t.point) what = "一个点";
  if (sp.radius) {
    const area = sp.areaTarget === "Ally" ? "盟友" : sp.areaTarget === "Enemy" ? "敌人" : "生物";
    what = `半径 ${sp.radius} 英尺内的所有${area}`;
  }
  const rng = RANGE_CN[sp.range || ""] || sp.range || "";
  return rng ? `${what}　${rng}` : what;
}

export function Spells(props: { db: Db; focusBook?: string; focusLevel?: number }) {
  const { db, focusBook, focusLevel } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  // 神话法术书的子步骤（`mysp:<环位>`）会带着要看的法术书进来，第一次渲染就定位到它。
  const [clsIdx, setClsIdx] = useState(() => {
    if (!focusBook) return 0;
    const i = derived.spells.findIndex((s) => s.spellbookId === focusBook || s.classId === focusBook);
    return i >= 0 ? i : 0;
  });
  const [lvl, setLvl] = useState(focusLevel && focusLevel > 0 ? focusLevel : 1);
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(true);

  if (!derived.spells.length) {
    return (
      <ThreePane
        left={<ListPane title="法术书"><div className="muted small" style={{ padding: 10 }}>没有施法职业</div></ListPane>}
        center={
          <div className="muted">
            当前构筑里还没有会施法的职业。先在「职业」步骤给某个等级选上法师/牧师/先知之类的施法职业。
          </div>
        }
        right={null}
      />
    );
  }

  const sp = derived.spells[Math.min(clsIdx, derived.spells.length - 1)];
  const chosen = new Set(sp.chosen);
  const maxLevel = Math.max(0, sp.maxSpellLevel);
  const activeLevel = Math.min(lvl, maxLevel);
  const pool = sp.byLevel[activeLevel] || [];
  const bonus = bonusSpells(db, derived);

  // 法术 → 环位：优先用**这本**法术书自己的分环表（神话道途法术书不是按职业分环的，
  // `spell.levels[classId]` 对它们永远是 undefined）。
  const levelMap = new Map<string, number>();
  for (const [L, arr] of Object.entries(sp.byLevel || {})) {
    for (const e of arr) levelMap.set(e.id, Number(L));
  }
  const levelOf = (id: string): number | null => {
    const hit = levelMap.get(id);
    if (hit !== undefined) return hit;
    const fb = db.spells[id]?.levels?.[sp.classId];
    return fb === undefined || fb === null ? null : fb;
  };
  const levelText = (id: string): string => {
    const l = levelOf(id);
    if (l === null) return "";
    return l === 0 ? "戏法" : `${l}环`;
  };

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const base = showAll ? pool : pool;
    return kw ? base.filter((s) => (s.name + " " + (s.nameEn || "")).toLowerCase().includes(kw)) : base;
  }, [pool, q, showAll]);

  const focusId = hover && pool.some((s) => s.id === hover) ? hover : list[0]?.id || null;
  const focus = focusId ? db.spells[focusId] : null;
  const isChosen = !!focus && chosen.has(focus.id);

  return (
    <ThreePane
      left={
        <ListPane
          title={
            <span>
              {sp.className}　
              <span className="muted small">{activeLevel === 0 ? "戏法" : `${activeLevel} 环`}</span>
            </span>
          }
          search={q}
          onSearch={setQ}
          foot={
            <span>
              已选 {chosen.size} 个
              {sp.knownCount != null && sp.knownCount >= 0 ? ` / 上限 ${sp.knownCount}` : ""}
            </span>
          }
        >
          {list.map((s) => (
            <ListRow
              key={s.id}
              ico={featureIcon(db, s.id)}
              glyph={s.name.slice(0, 1)}
              name={s.name}
              sub={SCHOOL_CN[s.school || ""] || s.school || s.nameEn}
              num={chosen.has(s.id) ? "●" : undefined}
              sel={focusId === s.id}
              onHover={() => setHover(s.id)}
              onClick={() => setHover(s.id)}
            />
          ))}
          {list.length === 0 && <div className="muted small" style={{ padding: 10 }}>这一环没有可选法术</div>}
        </ListPane>
      }
      center={
        !focus ? (
          <div className="muted">左边选一个法术看法术详情。</div>
        ) : (
          <>
            <DetailHead
              ico={featureIcon(db, focus.id)}
              glyph={focus.name.slice(0, 1)}
              title={focus.name}
              en={`${SCHOOL_CN[focus.school || ""] || focus.school || ""}　·　${
                TYPE_CN[focus.type || ""] || focus.type || "法术"
              }`}
              big
            />

            <Sect title="法术详情">
              <StatRows
                items={[
                  ["目标", targetText(focus)],
                  ["施法时间", ACTION_CN[focus.action || ""] || focus.action || "—"],
                  ["持续时间", focus.duration || "立即"],
                  ["法术抗力", focus.sr ? "受法术抗力影响" : "不受法术抗力影响"],
                  ["豁免检定", focus.saveText || (focus.save && focus.save !== "Unknown" ? `${SAVE_CN[focus.save] || focus.save}，免除效果` : "无")],
                  ["组件", `${focus.material ? "言语、姿势、材料" : "言语、姿势"}`],
                ]}
              />
            </Sect>

            {focus.desc && (
              <Sect title="说明">
                <div className="desc-body">{focus.desc}</div>
              </Sect>
            )}

            <div className="row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={isChosen ? "btn sm ghost" : "btn sm"}
                onClick={() => act.toggleSpell(sp.classId, focus.id)}
              >
                {isChosen ? "移出法术书" : "加入法术书"}
              </button>
              {isChosen && <Chip tone="ok">已在法术书里</Chip>}
              {sp.knownCount != null && sp.knownCount >= 0 && chosen.size >= sp.knownCount && !isChosen && (
                <Chip tone="no">已达已知上限 {sp.knownCount}</Chip>
              )}
            </div>
          </>
        )
      }
      right={
        <>
          <Sect title={sp.className}>
            <StatBox
              cols={2}
              items={[
                {
                  k: "施法属性",
                  v: sp.castingAttr ? label(db.rules.attributes.find((a) => a.id === sp.castingAttr)) : "—",
                },
                { k: "施法类型", v: sp.spontaneous ? "自发施法" : "准备施法" },
                { k: "最高环位", v: maxLevel },
                { k: "已知", v: sp.allSpellsKnown ? "全部" : String(sp.knownCount ?? "—") },
              ]}
            />
          </Sect>

          <Sect title="各环已选">
            <div className="row wrap">
              {Array.from({ length: maxLevel + 1 }, (_, l) => l).map((l) => {
                const got = sp.chosen.filter((id) => levelOf(id) === l);
                const per = sp.spellsPerDay[l];
                return (
                  <button
                    key={l}
                    type="button"
                    className={"btn sm" + (l === activeLevel ? "" : " ghost")}
                    title={per != null ? `每日 ${per} 个` : undefined}
                    onClick={() => setLvl(l)}
                  >
                    {l === 0 ? "戏法" : `${l}环`} {got.length}
                    {sp.knownCount != null ? `/${sp.knownCount}` : ""}
                  </button>
                );
              })}
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              点环位切换左栏的法术列表；数字是「已选 / 上限」。
            </div>
          </Sect>

          <Sect title="已选法术">
            {chosen.size === 0 ? (
              <div className="muted small">还没选法术。</div>
            ) : (
              <StatRows
                items={sp.chosen.map((id) => [db.spells[id]?.name || id, levelText(id)])}
                dense
              />
            )}
            {chosen.size > 0 && (
              <button
                type="button"
                className="btn sm ghost"
                style={{ marginTop: 6 }}
                onClick={() => act.clearSpells(sp.classId)}
              >
                清空已选
              </button>
            )}
          </Sect>

          {bonus.length > 0 && (
            <Sect title="领域/血统额外赠送">
              <div className="row wrap">
                {bonus.map((b, i) => (
                  <Chip key={i} tone="ok">
                    {b}
                  </Chip>
                ))}
              </div>
            </Sect>
          )}

          {derived.spells.length > 1 && (
            <Sect title="施法职业">
              <div className="row wrap">
                {derived.spells.map((s, i) => (
                  <button
                    key={s.classId}
                    type="button"
                    className={"btn sm" + (i === clsIdx ? "" : " ghost")}
                    onClick={() => {
                      setClsIdx(i);
                      setLvl(1);
                    }}
                  >
                    {s.className}
                  </button>
                ))}
              </div>
            </Sect>
          )}
        </>
      }
    />
  );
}

/** 从已拥有的特性里收集「额外送的法术」 */
function bonusSpells(db: Db, d: ReturnType<typeof derive>): string[] {
  const out: string[] = [];
  for (const id of d.owned.ids) {
    const f = db.features[id];
    if (!f) continue;
    for (const ks of f.knownSpells || []) {
      const s = db.spells[ks.id];
      if (s) out.push(`${s.name}${ks.level != null ? `（${ks.level} 环）` : ""}`);
    }
    for (const lid of f.spellLists || []) {
      const sl = db.spellLists[lid];
      if (!sl) continue;
      for (const [lv, arr] of Object.entries(sl.levels || {})) {
        for (const sid of arr) {
          const s = db.spells[sid];
          if (s) out.push(`${s.name}（${lv} 环）`);
        }
      }
    }
  }
  return Array.from(new Set(out));
}
