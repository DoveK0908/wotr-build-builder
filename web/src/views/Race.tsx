import React, { useMemo } from "react";
import type { Db } from "../types";
import { ATTRS, act, useBuild } from "../store";
import { label, raceRootSlots, traitList } from "../rules";
import { Chip, Collapse, Desc, Panel, SearchSelect } from "../ui";
import { SlotChain, reachable } from "../pick";

/** 第 ② 步：种族、种族加值、任选 +2、种族传承 */
export function Race(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;

  const race = build.race ? db.races[build.race] : null;
  const raceOpts = useMemo(
    () => Object.values(db.races).map((r) => ({ id: r.id, label: r.name, hint: r.nameEn })),
    [db],
  );
  const raceSlots = useMemo(() => raceRootSlots(db, build), [db, build]);
  const traits = traitList(db, race);

  return (
    <Panel
      title="② 种族"
      sub={race ? race.nameEn || "" : "先选一个种族；种族会给固定加值，有些种族还能任选一项 +2"}
    >
      <SearchSelect
        value={build.race}
        options={raceOpts}
        onChange={(v) => act.patch((b) => {
          b.race = v;
          b.racePicks = {};
          b.raceParams = {};
        })}
        placeholder="选择种族"
        width={260}
      />
      {race && (
        <>
          <div className="row wrap mt8">
            {(race.statBonuses || []).map((b, i) => (
              <Chip key={i} tone={b.value >= 0 ? "ok" : "no"}>
                {label(rules.attributes.find((a) => a.id === b.stat))} {b.value > 0 ? "+" : ""}{b.value}
                {b.cond ? "（有条件）" : ""}
              </Chip>
            ))}
            {race.size && <Chip>{race.size === "Large" ? "大型" : race.size === "Small" ? "小型" : "中型"}</Chip>}
          </div>

          {race.selectableStat && (
            <div className="row wrap mt8">
              <span className="muted small">任选一项 +2：</span>
              {ATTRS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={build.raceStatPick === a ? "btn sm" : "btn sm ghost"}
                  onClick={() => act.setRaceStatPick(build.raceStatPick === a ? null : a)}
                >
                  {label(rules.attributes.find((x) => x.id === a))}
                </button>
              ))}
              {!build.raceStatPick && <span className="muted small">（还没选）</span>}
            </div>
          )}

          {raceSlots.length > 0 && (
            <div className="slots mt8">
              {raceSlots.map((slot) => (
                <SlotChain
                  key={slot.id}
                  db={db}
                  root={slot}
                  picks={build.racePicks}
                  verdict={() => "ok"}
                  onChange={(slotId, v) => act.patch((b) => {
                    if (v) b.racePicks[slotId] = v; else delete b.racePicks[slotId];
                    // 换掉上层选择后，下层已经不可达的旧选择也一并丢掉
                    for (const key of Object.keys(b.racePicks)) {
                      if (!reachable(db, raceSlots, b.racePicks, key)) delete b.racePicks[key];
                    }
                    const chosen = v ? db.features[v] : null;
                    if (chosen?.param) {
                      const pv = (chosen.paramVariants || [])[0] || "";
                      if (pv) b.raceParams[chosen.id] = pv;
                    }
                  })}
                />
              ))}
            </div>
          )}

          {traits.length > 0 && (
            <Collapse title={`种族特性（${traits.length}）`}>
              {traits.map((t) => (
                <div key={t.id} className="trait">
                  <div className="trait-name">{label(t)}</div>
                  <Desc text={t.desc} limit={300} />
                </div>
              ))}
            </Collapse>
          )}
        </>
      )}
    </Panel>
  );
}
