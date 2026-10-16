import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { alignConflicts, alignmentLocks } from "../rules";
import { Chip } from "../ui";
import { AlignWheel, ListPane, ListRow, Sect, StatRows, ThreePane } from "../pane";

const ABBR: Record<string, string> = {
  LawfulGood: "LG",
  LawfulNeutral: "LN",
  LawfulEvil: "LE",
  NeutralGood: "NG",
  TrueNeutral: "N",
  NeutralEvil: "NE",
  ChaoticGood: "CG",
  ChaoticNeutral: "CN",
  ChaoticEvil: "CE",
};

/** 第 ⑨ 步：阵营（与职业 / 变体 / 神祇的相容性都在这里看结果） */
export function Align(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;
  const [hover, setHover] = useState<string | null>(null);

  const locks = useMemo(() => alignmentLocks(db, build), [db, build]);
  const conflicts = useMemo(() => alignConflicts(db, build), [db, build]);

  const focusId = hover || build.alignment || rules.alignments[4]?.id || null;
  const focus = rules.alignments.find((a) => a.id === focusId);
  const focusLock = focusId ? locks[focusId] : undefined;

  return (
    <ThreePane
      left={
        <ListPane title="选择阵营" foot={<span>共 {rules.alignments.length} 个阵营</span>}>
          {rules.alignments.map((a) => {
            const lock = locks[a.id];
            return (
              <ListRow
                key={a.id}
                glyph={ABBR[a.id] || a.name.slice(0, 1)}
                name={a.name}
                sub={lock ? lock.join("；") : a.id}
                badge={lock ? <span className="badge no">不符</span> : undefined}
                dis={!!lock}
                sel={build.alignment === a.id}
                onHover={() => setHover(a.id)}
                onClick={() => !lock && act.patch((b) => { b.alignment = a.id; })}
              />
            );
          })}
        </ListPane>
      }
      center={
        <>
          <AlignWheel
            value={build.alignment}
            abbr={(id) => ABBR[id] || id}
            locks={locks}
            labels={Object.fromEntries(rules.alignments.map((a) => [a.id, a.name]))}
            onPick={(id) => !locks[id] && act.patch((b) => { b.alignment = id; })}
          />
          <div className="muted small" style={{ textAlign: "center", marginTop: 4 }}>
            点击轮盘上的阵营即可选择；灰掉的表示当前职业 / 变体 / 神祇不允许
          </div>

          {focus && (
            <Sect title={focus.name}>
              <div className="row wrap">
                {focusLock ? (
                  <Chip tone="no">不可选：{focusLock.join("；")}</Chip>
                ) : (
                  <Chip tone="ok">可以选</Chip>
                )}
                {build.alignment === focus.id && <Chip tone="ok">当前阵营</Chip>}
              </div>
            </Sect>
          )}

          {conflicts.length > 0 && (
            <Sect title="当前构筑的阵营冲突">
              <div className="row wrap">
                {conflicts.map((c) => (
                  <Chip key={c} tone="no">
                    {c}
                  </Chip>
                ))}
              </div>
            </Sect>
          )}
        </>
      }
      right={
        <>
          <Sect title="全部阵营">
            <StatRows
              items={rules.alignments.map((a) => [
                <span key={a.id}>
                  {a.name} <span className="muted small">{ABBR[a.id]}</span>
                </span>,
                locks[a.id] ? <span key="v" className="neg">不行</span> : <span key="v" className="pos">可以</span>,
              ])}
              dense
            />
          </Sect>
          <Sect title="说明">
            <div className="muted small">
              阵营不是纯 RP：职业、变体和神祇都会限制它。被锁住的阵营会写明原因（先改职业/变体/神祇通常就能解开）。
              游戏里部分流程会改变阵营，这里随时可改。
            </div>
          </Sect>
        </>
      }
    />
  );
}
