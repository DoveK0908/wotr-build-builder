import React, { useMemo } from "react";
import type { AttrId, Db } from "../types";
import { act, useBuild } from "../store";
import { attrBreakdown, attrMod, attrsAtLevel, pointBuySpent } from "../rules";
import { Meter, NumBox, Panel, SearchSelect } from "../ui";

const ATTR_LEVELS = [4, 8, 12, 16, 20];

/** 第 ④ 步：购点（基础属性、升级提升、装备等外部加值） */
export function Attrs(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;

  const spent = pointBuySpent(db, build);
  const total = rules.pointBuyTotal || 25;
  const attrs = useMemo(() => attrBreakdown(db, build), [db, build]);
  const at1 = useMemo(() => attrsAtLevel(db, build, 1), [db, build]);

  return (
    <Panel
      title="④ 购点与属性"
      sub={`点买 ${spent} / ${total}；原始值范围 7–18，17/18 很贵（13/17 点）`}
      right={<span className="muted small">升级提升：4/8/12/16/20 级各 +1</span>}
    >
      <Meter used={spent} total={total} label="点买" />
      <table className="tbl attrs">
        <thead>
          <tr>
            <th>属性</th><th>基础</th><th>种族</th><th>升级</th><th>特性</th><th>手工</th><th>总</th><th>调整</th><th>点数</th>
          </tr>
        </thead>
        <tbody>
          {rules.attributes.map((a) => {
            const base = build.attributes[a.id] || 10;
            const br = attrs[a.id];
            const cost = rules.pointBuy[String(base)] ?? 0;
            const sign = (v: number) => (v > 0 ? "+" : "") + (v || 0);
            const cls2 = (v: number) => (v ? (v > 0 ? "pos" : "neg") : "muted");
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
                <td className={cls2(br.race)}>{sign(br.race)}</td>
                <td className={cls2(br.level)}>{sign(br.level)}</td>
                <td className={cls2(br.feat)} title="种族传承 / 背景 / 专长 / 职业特性 / 神话道途带来的加值">
                  {sign(br.feat)}
                </td>
                <td>
                  <NumBox
                    value={br.manual}
                    min={-20}
                    max={40}
                    onChange={(v) => act.setAttrManual(a.id, v)}
                  />
                </td>
                <td className="bold">{br.total}</td>
                <td>{attrMod(br.total) >= 0 ? "+" : ""}{attrMod(br.total)}</td>
                <td className="muted">{cost}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted small mt8">
        「特性」一列是种族传承 / 背景 / 专长 / 职业特性 / 神话道途特性给的加值（例如传奇 +4 全属性）；
        「手工」一列用来记装备/药水之类的外部加值，不计入点买花费。
      </div>
      <div className="row wrap mt8">
        <span className="muted small">1 级属性（含种族与升级提升）：</span>
        {rules.attributes.map((a) => (
          <span className="kv" key={a.id}>{a.short} <b>{at1[a.id]}</b></span>
        ))}
      </div>

      <div className="row wrap mt8">
        <span className="muted small">升级提升（4/8/12/16/20 级各 +1）：</span>
        {ATTR_LEVELS.map((lv) => (
          <span className="kv" key={lv}>
            {lv} 级
            <SearchSelect
              value={build.levels[lv - 1]?.ability || null}
              options={rules.attributes.map((a) => ({ id: a.id, label: a.name }))}
              onChange={(v) => act.setAbility(lv - 1, v as AttrId | null)}
              placeholder="未选"
              width={110}
            />
          </span>
        ))}
      </div>
    </Panel>
  );
}
