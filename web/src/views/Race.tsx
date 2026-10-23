import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { ATTRS, act, useBuild } from "../store";
import { attrMod, derive, label, raceRootSlots, traitList } from "../rules";
import { Chip, Collapse, Desc } from "../ui";
import { SlotChain, reachable } from "../pick";
import { DetailHead, IconGrid, ListPane, ListRow, Sect, StatRows, ThreePane } from "../pane";
import { openDetail } from "../detail";
import { featureIcon } from "../skin";

/** 第 ② 步：种族、种族加值、任选 +2、种族传承 */
export function Race(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;
  const [q, setQ] = useState("");

  const race = build.race ? db.races[build.race] : null;
  const raceSlots = useMemo(() => raceRootSlots(db, build), [db, build]);
  const traits = traitList(db, race);
  const d = useMemo(() => derive(db, build), [db, build]);
  const attrs = rules.attributes;

  const list = useMemo(() => {
    /* 顺序按游戏角色创建名单（人类→精灵→…→狐妖），不是拼音序 */
  const rOrder = db.rules.raceOrder || [];
  const rank = (id: string) => {
    const i = rOrder.indexOf(id);
    return i < 0 ? 999 : i;
  };
  const all = Object.values(db.races).sort((a, b) => rank(a.id) - rank(b.id) || (a.name || "").localeCompare(b.name || "", "zh"));
    const kw = q.trim().toLowerCase();
    return kw ? all.filter((r) => (r.name + " " + (r.nameEn || "")).toLowerCase().includes(kw)) : all;
  }, [db, q]);

  return (
    <ThreePane
      left={
        <ListPane
          title="选择种族"
          search={q}
          onSearch={setQ}
          foot={`共 ${Object.keys(db.races).length} 个种族`}
        >
          {list.map((r) => (
            <ListRow
              key={r.id}
              glyph={r.name.slice(0, 1)}
              name={r.name}
              sub={r.nameEn}
                  sel={build.race === r.id}
              onClick={() =>
                act.patch((b) => {
                  b.race = r.id;
                  b.racePicks = {};
                  b.raceParams = {};
                })
              }
            />
          ))}
        </ListPane>
      }
      center={
        !race ? (
          <div className="muted">先在左边选一个种族。</div>
        ) : (
          <>
            <DetailHead glyph={race.name.slice(0, 1)} title={race.name} en={race.nameEn} big />

            <Sect title="种族加值">
              <div className="row wrap">
                {(race.statBonuses || []).map((b, i) => (
                  <Chip key={i} tone={b.value >= 0 ? "ok" : "no"}>
                    {label(attrs.find((a) => a.id === b.stat))} {b.value > 0 ? "+" : ""}
                    {b.value}
                    {b.cond ? "（有条件）" : ""}
                  </Chip>
                ))}
                {race.size && <Chip>{race.size === "Large" ? "大型" : race.size === "Small" ? "小型" : "中型"}</Chip>}
                {(!race.statBonuses || race.statBonuses.length === 0) && (
                  <span className="muted small">没有固定属性加值</span>
                )}
              </div>
            </Sect>

            {race.selectableStat && (
              <Sect
                title="任选一项 +2"
                right={build.raceStatPick ? label(attrs.find((a) => a.id === build.raceStatPick)) : "还没选"}
              >
                <div className="row wrap">
                  {ATTRS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={build.raceStatPick === a ? "btn sm" : "btn sm ghost"}
                      onClick={() => act.setRaceStatPick(build.raceStatPick === a ? null : a)}
                    >
                      {label(attrs.find((x) => x.id === a))}
                    </button>
                  ))}
                </div>
              </Sect>
            )}

            {raceSlots.length > 0 && (
              <Sect title="种族传承">
                <div className="slots">
                  {raceSlots.map((slot) => (
                    <SlotChain
                      key={slot.id}
                      db={db}
                      root={slot}
                      picks={build.racePicks}
                      verdict={() => "ok"}
                      onChange={(slotId, v) =>
                        act.patch((b) => {
                          if (v) b.racePicks[slotId] = v;
                          else delete b.racePicks[slotId];
                          for (const key of Object.keys(b.racePicks)) {
                            if (!reachable(db, raceSlots, b.racePicks, key)) delete b.racePicks[key];
                          }
                          const chosen = v ? db.features[v] : null;
                          if (chosen?.param) {
                            // paramVariants 是「名字|guid」，真正要存的是 guid
                            const pv = (chosen.paramVariants || [])[0]?.split("|")[1] || "";
                            if (pv) b.raceParams[chosen.id] = pv;
                          }
                        })
                      }
                    />
                  ))}
                </div>
              </Sect>
            )}

            {traits.length > 0 && (
              <Sect title={`种族特性（${traits.length}）`}>
                <IconGrid
                  cols={3}
                  onDetail={openDetail}
                  items={traits.map((t) => ({
                    id: t.id,
                    name: label(t),
                    ico: featureIcon(db, t.id),
                    title: t.desc,
                  }))}
                />
                <Collapse title="展开特性说明">
                  {traits.map((t) => (
                    <div key={t.id} className="trait">
                      <div className="trait-name">{label(t)}</div>
                      <Desc text={t.desc} limit={300} />
                    </div>
                  ))}
                </Collapse>
              </Sect>
            )}
          </>
        )
      }
      right={
        <>
          <Sect title="属性值">
            <StatRows
              items={ATTRS.map((a) => [
                label(attrs.find((x) => x.id === a)),
                <span key={a}>
                  {d.attrs[a]}{" "}
                  <span className="muted">
                    {attrMod(d.attrs[a] ?? 10) >= 0 ? "+" : ""}
                    {attrMod(d.attrs[a] ?? 10)}
                  </span>
                </span>,
              ])}
              dense
            />
          </Sect>
          <Sect title="当前数值">
            <StatRows
              items={[
                ["等级", d.level],
                ["生命值", d.hp],
                ["防御等级", d.ac],
                ["强韧 / 反射 / 意志", `${d.fort} / ${d.ref} / ${d.will}`],
                ["技能点总数", d.skillPointsTotal],
              ]}
            />
          </Sect>
        </>
      }
    />
  );
}
