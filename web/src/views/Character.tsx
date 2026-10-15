import React, { useMemo } from "react";
import type { Db } from "../types";
import type { Build } from "../store";
import { act, useBuild } from "../store";
import {
  attrMod, attrsAtLevel, classLevels, label, pointBuySpent, traitList, universalFeatures,
} from "../rules";
import { Chip, Collapse, Desc, Field, Meter, NumBox, Panel, SearchSelect } from "../ui";
import { AutoList, PickSlot } from "../pick";

export function Character(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;

  const race = build.race ? db.races[build.race] : null;

  // 背景：大类 → 具体（数据里只有 group 的 children，没有 parent）
  const bgOpts = useMemo(() => {
    const groups: Record<string, string> = {};
    for (const g of Object.values(db.backgrounds)) {
      if (g.kind !== "group") continue;
      for (const c of g.children || []) groups[c] = g.name;
    }
    return Object.values(db.backgrounds)
      .filter((b) => b.kind !== "group" && !b.companionOnly)
      .map((b) => ({ id: b.id, label: b.name, hint: b.nameEn, group: groups[b.id] || "背景" }));
  }, [db]);

  const raceOpts = useMemo(
    () => Object.values(db.races).map((r) => ({ id: r.id, label: r.name, hint: r.nameEn })),
    [db],
  );

  const deitySlot = rules.deitySelection ? db.features[rules.deitySelection] : null;
  const deityOpts = useMemo(() => {
    return (deitySlot?.choices || []).map((id) => {
      const f = db.features[id];
      return { id, label: label(f), hint: f?.nameEn };
    });
  }, [db, deitySlot]);

  const spent = pointBuySpent(db, build);
  const total = rules.pointBuyTotal || 25;
  const racial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of race?.statBonuses || []) m[b.stat] = (m[b.stat] || 0) + b.value;
    return m;
  }, [race]);

  const cls = Object.keys(classLevels(build))[0];
  // 通用升级表里有几个纯内部机制特性没有显示名（读出来是一串 guid），不给玩家看
  const universal1 = universalFeatures(db, 1).filter((id) => !!db.features[id]?.name);
  const traits = traitList(db, race);

  return (
    <div className="grid2">
      <Panel title="基本资料">
        <Field label="角色名">
          <input
            className="text"
            value={build.name}
            placeholder="给这个构筑起个名字"
            onChange={(e) => act.setName(e.target.value)}
          />
        </Field>
        <Field label="阵营">
          <SearchSelect
            value={build.alignment}
            options={rules.alignments.map((a) => ({ id: a.id, label: a.name }))}
            onChange={(v) => act.patch((b) => { b.alignment = v; })}
            width={220}
          />
        </Field>
        <Field
          label="神祇"
          hint={`牧师/战斗祭司等需要神祇；共 ${(deitySlot?.choices || []).length} 个可选`}
        >
          <SearchSelect
            value={build.deity}
            options={deityOpts}
            onChange={(v) => act.setDeity(v)}
            placeholder="选择信仰"
            width={220}
          />
        </Field>
      </Panel>

      <Panel
        title="种族"
        sub={race ? (race.nameEn || "") : "先选一个种族"}
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
            {(race.heritageSelections || []).length > 0 && (
              <div className="slots mt8">
                {(race.heritageSelections || []).map((sid) => {
                  const slot = db.features[sid];
                  if (!slot) return null;
                  return (
                    <PickSlot
                      key={sid}
                      db={db}
                      slot={slot}
                      value={build.racePicks[sid] || null}
                      verdict={() => "ok"}
                      onChange={(v) => act.patch((b) => {
                        if (v) b.racePicks[sid] = v; else delete b.racePicks[sid];
                        const chosen = v ? db.features[v] : null;
                        if (chosen?.param) {
                          const pv = (chosen.paramVariants || [])[0] || "";
                          if (pv) b.raceParams[chosen.id] = pv;
                        }
                      })}
                    />
                  );
                })}
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

      <Panel title="背景">
        <SearchSelect
          value={build.background}
          options={bgOpts}
          onChange={(v) => act.setBackground(v)}
          placeholder="选择背景（可选）"
          width={300}
        />
        {build.background && (
          <div className="mt8">
            <Desc text={db.backgrounds[build.background]?.desc} limit={700} />
          </div>
        )}
      </Panel>

      <Panel
        title="属性"
        sub={`点买 ${spent} / ${total}`}
        right={<span className="muted small">升级提升：4/8/12/16/20 级各 +1</span>}
      >
        <Meter used={spent} total={total} label="点买" />
        <table className="tbl attrs">
          <thead>
            <tr>
              <th>属性</th><th>基础</th><th>种族</th><th>手工</th><th>总</th><th>调整</th><th>点数</th>
            </tr>
          </thead>
          <tbody>
            {rules.attributes.map((a) => {
              const base = build.attributes[a.id] || 10;
              const rr = racial[a.id] || 0;
              const man = build.attrManual[a.id] || 0;
              const tot = base + rr + man;
              const cost = rules.pointBuy[String(base)] ?? 0;
              return (
                <tr key={a.id}>
                  <td className="nowrap">{a.name}<span className="muted small"> {a.short}</span></td>
                  <td>
                    <NumBox
                      value={base}
                      min={7}
                      max={18}
                      onChange={(v) => act.patch((b) => { b.attributes[a.id] = v; })}
                    />
                  </td>
                  <td className={rr ? (rr > 0 ? "pos" : "neg") : "muted"}>{rr > 0 ? "+" : ""}{rr || 0}</td>
                  <td>
                    <NumBox
                      value={man}
                      min={-20}
                      max={40}
                      onChange={(v) => act.setAttrManual(a.id, v)}
                    />
                  </td>
                  <td className="bold">{tot}</td>
                  <td>{attrMod(tot) >= 0 ? "+" : ""}{attrMod(tot)}</td>
                  <td className="muted">{cost}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="muted small mt8">
          「手工」一列用来记装备/药水之类的外部加值，不计入点买花费。
        </div>
        <div className="muted small mt8">
          当前 1 级属性（含种族与升级提升）：
          {rules.attributes.map((a) => `${a.short} ${attrsAtLevel(db, build, 1)[a.id]}`).join(" · ")}
        </div>
      </Panel>

      <Panel title="角色创建时自动获得的选项" className="span2">
        <div className="muted small">来自通用升级表（1 级）：这些是每个角色都有的槽位。</div>
        <AutoList db={db} ids={universal1} />
      </Panel>
    </div>
  );
}
