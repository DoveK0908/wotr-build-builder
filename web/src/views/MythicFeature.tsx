import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { act, MAX_RANK, useBuild } from "../store";
import { choiceVerdict, derive, label, levelCtxList, mythicRank, mythicSource, rankRootSlots } from "../rules";
import { Chip } from "../ui";
import { SlotChain } from "../pick";
import { DetailHead, ListPane, ListRow, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { featureIcon } from "../skin";

/**
 * 神话子步骤（游戏里升神话阶层时顶部多出来的那些牌匾）：
 * 天使的「神话能力 / 强化天堂宝剑 / 强化天使光环 / 高等天堂宝剑」、巫妖的「骷髅战将」、
 * 御衡者的「逼迫凝视」、金龙的「精通金龙吐息」……都是道途升级表里带选项的槽位。
 *
 * 与职业相同的地方：奇数阶给神话能力、偶数阶给神话专长，所以这两个槽位会各出现 5 次。
 * 不同的地方：这里的「级」是神话阶层（`build.ranks[rank-1]`）。
 */
export function MythicFeature(props: { db: Db; slotId: string }) {
  const { db, slotId } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const ctxs = useMemo(() => levelCtxList(db, build, derived), [db, build, derived]);
  const slot = db.features[slotId];
  const [sel, setSel] = useState<number | null>(null);
  const rank = mythicRank(build);

  // 哪些神话阶层会发这个槽位
  const rows = useMemo(() => {
    const out: { rank: number; idx: number; owner: string; ownerLevel: number }[] = [];
    for (let r = 1; r <= MAX_RANK; r += 1) {
      if (!rankRootSlots(db, build, r).some((f) => f.id === slotId)) continue;
      const src = mythicSource(db, build, r);
      out.push({
        rank: r,
        idx: r - 1,
        owner: src.owner ? label(src.owner) : "神话英雄",
        ownerLevel: src.level,
      });
    }
    return out;
  }, [db, build, slotId]);

  if (!slot) return <div className="muted">找不到这个槽位。</div>;

  const chosenOf = (idx: number) => build.ranks[idx]?.picks[slotId];
  const chosen = rows.map((r) => chosenOf(r.idx)).filter(Boolean);
  const firstEmpty = rows.find((r) => !chosenOf(r.idx));
  const cur = rows.find((r) => r.rank === (sel ?? firstEmpty?.rank)) || rows[0];
  const options = slot.choices || [];
  const ctx = cur ? ctxs[Math.min(ctxs.length - 1, Math.max(0, 2 * cur.rank - 1))] : undefined;

  return (
    <ThreePane
      left={
        <ListPane title={label(slot)} foot={<span>神话 {rank} 阶 · 共 {rows.length} 次选择</span>}>
          {rows.map((r) => {
            const v = chosenOf(r.idx);
            return (
              <ListRow
                key={r.rank}
                ico={v ? featureIcon(db, v) : null}
                glyph={label(slot).slice(0, 1)}
                name={`第 ${r.rank} 神话阶`}
                sub={v ? label(db.features[v]) : `${r.owner} 第 ${r.ownerLevel} 级`}
                badge={!v ? <span className="badge no">未选</span> : undefined}
                mark={!!v}
                sel={!!cur && cur.rank === r.rank}
                onClick={() => setSel(r.rank)}
              />
            );
          })}
          {!rows.length && (
            <div className="muted small" style={{ padding: 10 }}>
              还没排到发放这个选择的阶层 —— 先在「神话」步骤里把阶层推上去。
            </div>
          )}
        </ListPane>
      }
      center={
        <>
          <DetailHead
            ico={cur && chosenOf(cur.idx) ? featureIcon(db, chosenOf(cur.idx)!) : null}
            glyph={label(slot).slice(0, 1)}
            title={label(slot)}
            en={slot.nameEn}
            sub={cur ? `${cur.owner} 第 ${cur.ownerLevel} 级 · 总第 ${cur.rank} 神话阶` : undefined}
            big
          />

          {slot.desc && <div className="desc-body">{slot.desc}</div>}

          {cur ? (
            <Sect title={`第 ${cur.rank} 神话阶要选（${options.length} 选 1${slot.ignorePrereq ? "，不检查前置" : ""}）`}>
              <div className="slots">
                <SlotChain
                  db={db}
                  root={slot}
                  picks={build.ranks[cur.idx].picks}
                  verdict={(fid) => choiceVerdict(db, ctx as never, fid)}
                  onChange={(sid, v) => act.setRankPick(cur.idx, sid, v)}
                />
              </div>
            </Sect>
          ) : (
            <div className="muted small mt8">
              还没有任何神话阶层 —— 先在「神话」步骤里设定排到第几阶。
            </div>
          )}

          <div className="muted small mt8">
            这一类是<b>神话道途自己的选择线</b>（游戏里升阶层时顶部会多出对应牌匾：天使的强化天堂宝剑、
            巫妖的骷髅战将、御衡者的逼迫凝视、金龙的精通金龙吐息…）。
          </div>
        </>
      }
      right={
        <>
          <Sect title="这个选择">
            <StatBox
              cols={2}
              items={[
                { k: "已到阶层", v: rank ? `第 ${rank} 阶` : "—" },
                { k: "可选", v: `${options.length} 项` },
                { k: "要选次数", v: rows.length },
                { k: "已选", v: chosen.length },
              ]}
            />
            {slot.ignorePrereq && (
              <div style={{ marginTop: 6 }}>
                <Chip>游戏里不检查前置条件</Chip>
              </div>
            )}
          </Sect>

          <Sect title="逐阶填写情况">
            <StatRows
              dense
              items={rows.map((r) => {
                const v = chosenOf(r.idx);
                return [
                  `第 ${r.rank} 阶（${r.owner} ${r.ownerLevel} 级）`,
                  v ? label(db.features[v]) : <span key="v" className="muted">未选</span>,
                ];
              })}
            />
          </Sect>
        </>
      }
    />
  );
}
