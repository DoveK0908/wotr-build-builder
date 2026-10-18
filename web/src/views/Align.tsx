import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { alignConflicts, alignmentLocks } from "../rules";
import { Chip } from "../ui";
import { AlignWheel, DetailHead, PinBar, Sect, StatRows, ThreePane } from "../pane";

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
  /** 点一下锁定这个阵营的详情（再点一次取消） */
  const [pinned, setPinned] = useState<string | null>(null);

  const locks = useMemo(() => alignmentLocks(db, build), [db, build]);
  const conflicts = useMemo(() => alignConflicts(db, build), [db, build]);

  const abbr = (id: string) => ABBR[id] || id;
  const labels = useMemo(
    () => Object.fromEntries(rules.alignments.map((a) => [a.id, a.name])),
    [rules.alignments]
  );

  // 游戏里左栏轮盘上方写着「当前阵营」，中栏标题跟着鼠标走。
  const current = rules.alignments.find((a) => a.id === build.alignment);
  const focusId = pinned || hover || build.alignment || "TrueNeutral";
  const focus = rules.alignments.find((a) => a.id === focusId);
  const focusLock = focusId ? locks[focusId] : undefined;

  const pick = (id: string) => {
    if (!locks[id]) act.patch((b) => { b.alignment = id; });
  };

  return (
    <ThreePane
      left={
        <div className="lp alwheel-pane">
          <div className="lp-title">选择阵营</div>
          <div className="alwheel-box">
            <AlignWheel
              value={build.alignment}
              abbr={abbr}
              locks={locks}
              labels={labels}
              onPick={pick}
              onHover={setHover}
              onFocus={(id) => setPinned((cur) => (cur === id ? null : id))}
            />
          </div>
          <div className="alwheel-name">{current ? current.name : "尚未选择"}</div>
          <div className="muted small" style={{ padding: "0 8px" }}>
            点扇形或正中那格即可选择；灰掉的表示当前职业 / 变体 / 神祇不允许。
            点一下会把该阵营的详情固定在中栏（再点一次取消）。
          </div>
          <div className="lp-foot">
            <span>共 {rules.alignments.length} 个阵营</span>
          </div>
        </div>
      }
      center={
        <>
          <DetailHead
            glyph={abbr(focusId)}
            title={focus ? focus.name : "阵营"}
            en={abbr(focusId)}
            sub={build.alignment === focusId ? "当前阵营" : pinned === focusId ? "固定查看" : "鼠标悬停预览"}
            big
          />
          <PinBar
            pinned={pinned === focusId}
            onUnpin={() => {
              setHover(focusId);
              setPinned(null);
            }}
          />
          <div className="row wrap">
            {focusLock ? (
              <Chip tone="no">不可选：{focusLock.join("；")}</Chip>
            ) : (
              <Chip tone="ok">可以选</Chip>
            )}
            {build.alignment === focusId && <Chip tone="ok">当前阵营</Chip>}
          </div>

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

          <Sect title="说明">
            <div>
              一个生物的阵营代表着它总体的道德观和个人态度。阵营包括：守序善良（LG）、中立善良（NG）、混乱善良（CG）、
              守序中立（LN）、绝对中立（N）、混乱中立（CN）、守序邪恶（LE）、中立邪恶（NE）和混乱邪恶（CE）。
              善良的角色保护无辜的生命，邪恶的角色则会为了取乐或牟利而虐待或摧毁事物；守序的角色会诚实守信、
              遵守规则、尊重权威和传统、并惩罚那些玩忽职守的人，混乱的角色则更加我行我素、特立独行、求新求变。
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              阵营不是纯 RP：职业、变体和神祇都会限制它。被锁住的阵营会写明原因（先改职业/变体/神祇通常就能解开）。
              游戏里部分流程会改变阵营，这里随时可改。
            </div>
          </Sect>
        </>
      }
      right={
        <>
          <Sect title="全部阵营">
            <StatRows
              items={rules.alignments.map((a) => [
                <span key={a.id}>
                  {a.name} <span className="muted small">{abbr(a.id)}</span>
                </span>,
                locks[a.id] ? (
                  <span key="v" className="neg" title={locks[a.id].join("；")}>
                    不行
                  </span>
                ) : (
                  <span key="v" className="pos">可以</span>
                ),
              ])}
              dense
            />
          </Sect>
          <Sect title="当前阵营">
            <StatRows
              items={[
                ["阵营", build.alignment ? (current?.name ?? build.alignment) : "—"],
                ["缩写", build.alignment ? abbr(build.alignment) : "—"],
                ["冲突", conflicts.length ? `${conflicts.length} 处` : "无"],
              ]}
            />
          </Sect>
        </>
      }
    />
  );
}
