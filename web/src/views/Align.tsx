import React, { useMemo } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { alignConflicts, alignmentLocks } from "../rules";
import { Chip, Field, Panel, SearchSelect } from "../ui";

/** 第 ⑨ 步：阵营（与职业 / 变体 / 神祇的相容性都在这里看结果） */
export function Align(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;

  const locks = useMemo(() => alignmentLocks(db, build), [db, build]);
  const conflicts = useMemo(() => alignConflicts(db, build), [db, build]);

  return (
    <Panel
      title="⑨ 阵营"
      sub="阵营不是纯 RP：职业、变体和神祇都会限制它。被锁住的阵营会写明原因（先改职业/变体/神祇通常就能解开）"
    >
      <Field label="角色阵营" hint="游戏里部分流程会改变阵营，这里随时可改">
        <SearchSelect
          value={build.alignment}
          options={rules.alignments.map((a) => {
            const lock = locks[a.id];
            return {
              id: a.id,
              label: a.name,
              disabled: !!lock,
              badge: lock ? "不符" : undefined,
              hint: lock ? lock.join("；") : undefined,
            };
          })}
          onChange={(v) => act.patch((b) => { b.alignment = v; })}
          width={240}
        />
      </Field>

      {conflicts.length > 0 && (
        <div className="row wrap mt8">
          {conflicts.map((c) => (
            <Chip key={c} tone="no">{c}</Chip>
          ))}
        </div>
      )}

      <table className="tbl mt8">
        <thead>
          <tr><th>阵营</th><th>能不能选</th><th>原因</th></tr>
        </thead>
        <tbody>
          {rules.alignments.map((a) => {
            const lock = locks[a.id];
            const on = build.alignment === a.id;
            return (
              <tr key={a.id} className={on ? "on" : undefined}>
                <td className="nowrap">{a.name}</td>
                <td>{lock ? <span className="neg">不行</span> : <span className="pos">可以</span>}</td>
                <td className="muted small">{lock ? lock.join("；") : on ? "当前阵营" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
