import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { choiceVerdict, derive, expandFeature, featuresAtClassLevel, label, levelCtxList } from "../rules";
import { Chip } from "../ui";
import { SlotChain } from "../pick";
import { DetailHead, ListPane, ListRow, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { featureIcon } from "../skin";

/**
 * 动态子步骤（游戏里选定职业后顶部多出来的那些牌匾）：
 * 一个职业自己那条选择线，例如先知的「先知诅咒 / 秘示域 / 启示 / 额外法术」、
 * 法师的「专精学派 / 奥法契约」、操念使的「元素专攻 / 注能 / 原力」。
 */
export function ClassFeature(props: { db: Db; slotId: string; classId: string }) {
  const { db, slotId, classId } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const ctxs = useMemo(() => levelCtxList(db, build, derived), [db, build, derived]);
  const slot = db.features[slotId];
  const cls = db.classes[classId];
  const [sel, setSel] = useState<number | null>(null);

  // 这个职业在哪些等级会发放这个槽位
  const rows = useMemo(() => {
    const out: { idx: number; level: number; classLevel: number }[] = [];
    let cl = 0;
    build.levels.forEach((lv, idx) => {
      if (lv.classId !== classId) return;
      cl += 1;
      const archs = build.classArchetypes[classId] || [];
      const ids = featuresAtClassLevel(db, classId, cl, archs);
      if (ids.some((id) => expandFeature(db, id).includes(slotId))) {
        out.push({ idx, level: idx + 1, classLevel: cl });
      }
    });
    return out;
  }, [db, build, classId, slotId]);

  if (!slot || !cls) return <div className="muted">找不到这个槽位。</div>;

  const chosenOf = (idx: number) => build.levels[idx].picks[slotId];
  const chosen = rows.map((r) => chosenOf(r.idx)).filter(Boolean);
  const firstEmpty = rows.find((r) => !chosenOf(r.idx));
  const cur = rows.find((r) => r.level === (sel ?? firstEmpty?.level)) || rows[0];
  const options = slot.choices || [];

  return (
    <ThreePane
      left={
        <ListPane
          title={label(slot)}
          foot={<span>「{label(cls)}」· 共 {rows.length} 次选择</span>}
        >
          {rows.map((r) => {
            const v = chosenOf(r.idx);
            return (
              <ListRow
                key={r.idx}
                ico={v ? featureIcon(db, v) : null}
                glyph={label(slot).slice(0, 1)}
                name={`第 ${r.level} 级`}
                sub={v ? label(db.features[v]) : `${label(cls)} 第 ${r.classLevel} 级`}
                badge={!v ? <span className="badge no">未选</span> : undefined}
                mark={!!v}
                sel={cur && cur.idx === r.idx}
                onClick={() => setSel(r.level)}
              />
            );
          })}
          {!rows.length && <div className="muted small" style={{ padding: 10 }}>还没排到发放这个选择的等级。</div>}
        </ListPane>
      }
      center={
        <>
          <DetailHead
            ico={cur && chosenOf(cur.idx) ? featureIcon(db, chosenOf(cur.idx)!) : null}
            glyph={label(slot).slice(0, 1)}
            title={label(slot)}
            en={slot.nameEn}
            sub={cur ? `${label(cls)} 第 ${cur.classLevel} 级 · 总第 ${cur.level} 级` : undefined}
            big
          />

          {slot.desc && <div className="desc-body">{slot.desc}</div>}

          {cur ? (
            <Sect title={`第 ${cur.level} 级要选（${options.length} 选 1${slot.ignorePrereq ? "，不检查前置" : ""}）`}>
              <div className="slots">
                <SlotChain
                  db={db}
                  root={slot}
                  picks={build.levels[cur.idx].picks}
                  verdict={(fid) => choiceVerdict(db, ctxs[cur.idx], fid)}
                  onChange={(sid, v) => act.setPick(cur.idx, sid, v)}
                />
              </div>
            </Sect>
          ) : (
            <div className="muted small mt8">
              这个职业还没排到发放「{label(slot)}」的等级 —— 先在「职业」步骤里给这个职业多排几级。
            </div>
          )}

          <div className="muted small mt8">
            这类选择是<b>职业自己的选择线</b>（游戏里选完职业后顶部会多出对应的牌匾）。选择里面还可以再套选择，
            点开槽位就能一层层选下去。
          </div>
        </>
      }
      right={
        <>
          <Sect title="这个选择">
            <StatBox
              cols={2}
              items={[
                { k: "属于职业", v: label(cls) },
                { k: "可选", v: `${options.length} 项` },
                { k: "要选次数", v: rows.length },
                { k: "已选", v: chosen.length },
              ]}
            />
            {slot.ignorePrereq && <div style={{ marginTop: 6 }}><Chip>游戏里不检查前置条件</Chip></div>}
          </Sect>

          <Sect title="逐次填写情况">
            <StatRows
              dense
              items={rows.map((r) => {
                const v = chosenOf(r.idx);
                return [
                  `${label(cls)} ${r.classLevel} 级（总 ${r.level}）`,
                  v ? label(db.features[v]) : <span key="v" className="muted">未选</span>,
                ];
              })}
            />
          </Sect>

          {slot.groups?.length ? (
            <Sect title="分组">
              <div className="muted small">{slot.groups.join("、")}</div>
            </Sect>
          ) : null}
        </>
      }
    />
  );
}
