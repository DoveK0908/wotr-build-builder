import React, { useMemo, useState } from "react";
import type { AttrId, Db } from "../types";
import { act, levelCap, useBuild } from "../store";
import { attrBreakdown, attrMod, attrsAtLevel, pointBuySpent } from "../rules";
import { Chip, Meter, NumBox, SearchSelect } from "../ui";
import { DetailHead, ListPane, ListRow, Sect, StatBox, StatRows, ThreePane } from "../pane";

function attrLevels(cap: number) {
  const out: number[] = [];
  for (let l = 4; l <= cap; l += 4) out.push(l);
  return out;
}

/** 每项属性影响什么（游戏里点在属性上时中间那栏会写的说明） */
const EFFECTS: Record<string, string[]> = {
  Strength: ["近战攻击掷骰", "使用近战武器与投掷武器时的伤害检定", "运动技能检定", "战技（CMB）"],
  Dexterity: ["远程攻击掷骰", "防御等级（AC）", "反射豁免", "灵巧 / 隐匿 / 巧手检定", "先攻"],
  Constitution: ["每级生命值", "强韧豁免", "体质相关的专注检定"],
  Intelligence: ["每级获得的技能点数", "知识（神秘）/ 知识（世界）检定"],
  Wisdom: ["意志豁免", "察觉 / 学识（自然）/ 学识（宗教）检定"],
  Charisma: ["沟通技能检定", "先知 / 术士 / 圣武士等魅力施法者的法术强度", "动摇与威吓类能力"],
};

/** 第 ④ 步：购点（分配属性点 + 升级提升 + 外部加值），按游戏「分配属性点」画面排 */
export function Attrs(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const cap = levelCap(build);
  const rules = db.rules;
  const [sel, setSel] = useState<string>(rules.attributes[0]?.id || "Strength");

  const spent = pointBuySpent(db, build);
  const total = rules.pointBuyTotal || 25;
  const br = useMemo(() => attrBreakdown(db, build), [db, build]);
  const at1 = useMemo(() => attrsAtLevel(db, build, 1), [db, build]);
  const a = rules.attributes.find((x) => x.id === sel) || rules.attributes[0];
  const cur = br[a.id];
  const base = build.attributes[a.id] || 10;
  const cost = rules.pointBuy[String(base)] ?? 0;
  const maxCost = rules.pointBuy["18"] ?? 17;

  const bump = (d: number) =>
    act.patch((b) => {
      const v = (b.attributes[a.id] || 10) + d;
      if (v < 7 || v > 18) return;
      b.attributes[a.id] = v;
    });

  const rows = rules.attributes.map((x) => {
    const bx = br[x.id];
    const bs = build.attributes[x.id] || 10;
    return { id: x.id, def: x, br: bx, base: bs, cost: rules.pointBuy[String(bs)] ?? 0 };
  });
  // 说明：曾经按本职职业的 RecommendedAttributes / NotRecommendedAttributes 在每项属性旁打
  // 绿拇指 / 红拇指，用户要求去掉（m06671）。数据仍在 classes.json 的 recommended/notRecommended 里。

  return (
    <ThreePane
      left={
        <ListPane
          title="分配属性点"
          foot={<span>原始值 7–18　·　17/18 点很贵（13/17 点）</span>}
        >
          {rows.map((r) => (
            <ListRow
              key={r.id}
              glyph={r.def.short || r.def.name.slice(0, 1)}
              name={
                <span>
                  {r.def.name} <span className="muted small">{r.def.short}</span>
                </span>
              }
              sub={r.br.race ? `种族 ${r.br.race > 0 ? "+" : ""}${r.br.race}` : "种族 —"}
              num={
                <span>
                  <b>{r.base}</b>
                  <span className={attrMod(r.br.total) >= 0 ? "pos" : "neg"}>
                    　{attrMod(r.br.total) >= 0 ? "+" : ""}
                    {attrMod(r.br.total)}
                  </span>
                </span>
              }
              badge={r.base !== 10 ? <span className="badge">{r.cost} 点</span> : undefined}
              sel={r.id === a.id}
              onClick={() => setSel(r.id)}
            />
          ))}
        </ListPane>
      }
      center={
        <>
          <DetailHead glyph={a.short || a.name.slice(0, 1)} title={`${a.name}（${a.short}）`} en={a.id} big />


          <Sect title="属性点">
            <div className="row center attrs-row">
              <button type="button" className="btn round" onClick={() => bump(-1)} disabled={base <= 7}>◀</button>
              <span className="attr-big">{base}</span>
              <button type="button" className="btn round" onClick={() => bump(1)} disabled={base >= 18}>▶</button>
              <span className="muted small">花费 {cost} 点</span>
            </div>
          </Sect>

          <Sect title="合计">
            <StatBox
              cols={4}
              items={[
                { k: "基础值", v: cur.base },
                { k: "总值", v: cur.total },
                { k: "调整值", v: `${attrMod(cur.total) >= 0 ? "+" : ""}${attrMod(cur.total)}` },
                { k: "1 级时", v: at1[a.id] },
              ]}
            />
          </Sect>

          <Sect title="加值来源">
            <StatRows
              items={[
                ["基础（购点）", cur.base],
                ["种族 / 血脉", (cur.race > 0 ? "+" : "") + cur.race],
                [`升级提升（每 4 级一次，上限 ${cap} 级）`, (cur.level > 0 ? "+" : "") + cur.level],
                ["特性（种族传承 / 背景 / 专长 / 职业 / 神话道途）", (cur.feat > 0 ? "+" : "") + cur.feat],
                ["手工（装备等外部加值）", <NumBox key="m" value={cur.manual} min={-20} max={40} onChange={(v) => act.setAttrManual(a.id, v)} />],
              ]}
            />
          </Sect>

          <Sect title={`${a.name}影响什么`}>
            <ul className="issues">
              {(EFFECTS[a.id] || []).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </Sect>
        </>
      }
      right={
        <>
          <Sect title="购点">
            <Meter used={spent} total={total} label="购点" />
            <StatBox
              cols={2}
              items={[
                { k: "已用", v: `${spent} / ${total}` },
                { k: "剩余", v: total - spent },
                { k: "单属性上限", v: `18（${maxCost} 点）` },
                { k: "合计上限", v: `${total} 点` },
              ]}
            />
            {spent > total && <div style={{ marginTop: 6 }}><Chip tone="no">超出 {spent - total} 点</Chip></div>}
          </Sect>

          <Sect title="升级提升（每 4 级 +1）">
            <StatRows
              dense
              items={attrLevels(cap).map((lv) => [
                `${lv} 级`,
                <SearchSelect
                  key="s"
                  value={build.levels[lv - 1]?.ability || null}
                  options={rules.attributes.map((x) => ({ id: x.id, label: x.name }))}
                  onChange={(v) => act.setAbility(lv - 1, v as AttrId | null)}
                  placeholder="未选"
                  width={104}
                />,
              ])}
            />
          </Sect>

          <Sect title="1 级属性（含种族）">
            <StatRows dense items={rules.attributes.map((x) => [x.name, at1[x.id]])} />
          </Sect>

          <Sect title="说明">
            <div className="muted small">
              「手工」一列用来记装备 / 药水 / 队友光环之类的外部加值，不计入购点花费；
              升级提升也可以在这一步一次填完，或者到「专长」步骤逐级填。
            </div>
          </Sect>
        </>
      }
    />
  );
}
