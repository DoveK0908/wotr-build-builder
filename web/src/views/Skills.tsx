import React, { useMemo } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { derive, num } from "../rules";
import { Chip, Meter, NumBox, Panel } from "../ui";

export function Skills(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const d = useMemo(() => derive(db, build), [db, build]);
  const cls = Object.keys(d.classLevels);
  const classSkillIds = useMemo(() => {
    const s = new Set<string>();
    for (const cid of cls) {
      const c = db.classes[cid];
      for (const k of c?.classSkills || []) s.add(k);
    }
    return s;
  }, [db, cls.join(",")]);

  return (
    <Panel
      title="技能"
      sub={`已投 ${d.skillSpent} / ${d.skillPointsTotal} 点（每级上限 = 角色等级；本职技能额外 +3）`}
      right={
        <span className="row">
          <button type="button" className="btn sm ghost" onClick={() => act.patch((b) => { b.skills = {}; })}>
            清空
          </button>
        </span>
      }
    >
      <Meter used={d.skillSpent} total={d.skillPointsTotal} label="技能点" />
      <table className="tbl skills">
        <thead>
          <tr>
            <th>技能</th><th>属性</th><th>本职</th><th>投入</th><th>属性调整</th><th>总加值</th>
          </tr>
        </thead>
        <tbody>
          {d.skills.map((s) => {
            const isClass = classSkillIds.has(s.id) || s.classSkill;
            const attr = db.rules.attributes.find((a) => a.id === s.attr);
            return (
              <tr key={s.id}>
                <td>
                  {s.name}
                  <span className="muted small"> {s.nameEn}</span>
                </td>
                <td className="muted">{attr?.short || s.attr}</td>
                <td>{isClass ? <Chip tone="ok">本职</Chip> : ""}</td>
                <td>
                  <NumBox
                    value={s.ranks}
                    min={0}
                    max={d.level}
                    onChange={(v) => act.setSkill(s.id, v)}
                  />
                </td>
                <td>{s.bonus >= 0 ? "+" : ""}{s.bonus}</td>
                <td className="bold">{s.total >= 0 ? "+" : ""}{s.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted small mt8">
        技能点 = 每级（职业基础 {cls.map((c) => num(db.classes[c]?.skillPoints, 2)).join(" / ") || "—"} + 智力调整）
        累计，升级表与专长带来的额外技能点也会算进去。
      </div>
    </Panel>
  );
}
