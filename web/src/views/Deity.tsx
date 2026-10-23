import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { alignAllows, alignConflicts, alignNeedText, alignTokensOf, babAt, childFeatures, derive, evalPrereqs, label, ownedFeatures, prereqText, sneakAt } from "../rules";
import { Chip, Desc } from "../ui";
import { DetailHead, IconGrid, ListPane, ListRow, PinBar, Sect, StatRows, ThreePane } from "../pane";
import { openDetail } from "../detail";
import { featureIcon } from "../skin";

/** 第 ⑧ 步：神祇（会限制阵营，牧师/战斗祭司等还需要它才能开领域） */
export function Deity(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  /** 点一下锁定查看这一位神祇（再点一次取消） */
  const [pinned, setPinned] = useState<string | null>(null);
  const rules = db.rules;

  const deitySlot = rules.deitySelection ? db.features[rules.deitySelection] : null;

  const opts = useMemo(() => {
    const all = (deitySlot?.choices || []).map((id) => {
      const f = db.features[id];
      const toks = alignTokensOf(f?.prereq);
      const need = toks.length > 0 ? alignNeedText(db, toks) : null;
      const bad = toks.length > 0 && !alignAllows(build.alignment, toks);
      return { id, f, need, bad };
    });
    const kw = q.trim().toLowerCase();
    return kw ? all.filter((o) => (label(o.f) + " " + (o.f?.nameEn || "")).toLowerCase().includes(kw)) : all;
  }, [db, deitySlot, build.alignment, q]);

  const conflicts = useMemo(() => alignConflicts(db, build), [db, build]);
  const focusId = pinned || hover || build.deity || opts[0]?.id || null;
  const focus = focusId ? db.features[focusId] : null;
  const focusChildren = focus ? childFeatures(db, focus) : [];
  const focusToks = focus ? alignTokensOf(focus.prereq) : [];

  const derived = useMemo(() => derive(db, build), [db, build]);
  const ctx = useMemo(() => {
    const o = ownedFeatures(db, build);
    return {
      atLevel: 20,
      bab: babAt(db, build, 20),
      sneak: sneakAt(db, o.ids),
      classLevels: derived.classLevels,
      attrs: derived.attrs,
      idSet: o.ids,
      alignment: build.alignment,
      race: build.race,
      background: build.background,
      mythicPath: build.mythicPath,
      archLevels: derived.archLevels,
      currentArchetypes: Object.values(derived.archSel).flat(),
      maxSpellLevel: derived.maxSpellLevel,
      rank: derived.rank,
    };
  }, [db, build, derived]);

  /** 游戏的神祇页中间是一张「先决条件」清单，每条前面一个对勾/灰圈。 */
  const reqs = useMemo(() => {
    if (!focus) return [];
    const res = evalPrereqs(db, ctx, focus.prereq, 0, focus.id);
    return res.details
      .filter((d) => !d.p.hide)
      .map((d) => ({ v: d.v as string, text: prereqText(db, d.p), k: d.p.k }));
  }, [db, ctx, focus]);
  const curAlign = rules.alignments.find((a) => a.id === build.alignment)?.name || "—";

  return (
    <ThreePane
      left={
        <ListPane
          title={`选择信仰（${(deitySlot?.choices || []).length}）`}
          search={q}
          onSearch={setQ}
          foot={<span>共 {(deitySlot?.choices || []).length} 个可选信仰</span>}
        >
          {opts.map((o) => (
            <ListRow
              key={o.id}
              ico={featureIcon(db, o.id)}
              glyph={label(o.f).slice(0, 1)}
              name={label(o.f)}
              sub={o.need ? `需要 ${o.need}` : o.f?.nameEn}
              badge={o.bad ? <span className="badge no">阵营不符</span> : undefined}
              dis={o.bad}
              sel={build.deity === o.id}
              title={o.bad ? `需要 ${o.need}` : o.f?.nameEn}
              onHover={() => setHover(o.id)}
              onClick={() => {
                if (!o.bad) act.setDeity(build.deity === o.id ? null : o.id);
                setPinned((cur) => (cur === o.id ? null : o.id));
              }}
            />
          ))}
          {opts.length === 0 && <div className="muted small" style={{ padding: "8px 10px" }}>没有匹配项</div>}
        </ListPane>
      }
      center={
        !focus ? (
          <div className="muted">在左边选一个信仰。</div>
        ) : (
          <>
            <DetailHead
              ico={featureIcon(db, focus.id)}
              glyph={label(focus).slice(0, 1)}
              title={label(focus)}
              en={focus.nameEn}
              big
            />
            <PinBar
              pinned={pinned === focus.id}
              onUnpin={() => {
                setHover(focus.id);
                setPinned(null);
              }}
            />
            <div className="row wrap">
              {focusToks.length > 0 ? (
                <Chip tone="no">只接受 {alignNeedText(db, focusToks)}</Chip>
              ) : (
                <Chip tone="ok">不限阵营</Chip>
              )}
              {build.deity === focus.id && <Chip tone="ok">当前信仰</Chip>}
            </div>
            <Sect title={`先决条件（${reqs.filter((r) => r.v === "ok").length}/${reqs.length}）`}>
              {reqs.length === 0 ? (
                <div className="muted small">没有额外限制。</div>
              ) : (
                <div className="reqlist">
                  {reqs.map((r, i) => (
                    <div className="reqrow" key={i}>
                      <span className="pcheck" data-v={r.v} title={r.v === "ok" ? "满足" : r.v === "unknown" ? "游戏内判定" : "不满足"}>
                        {r.v === "ok" ? "✓" : r.v === "unknown" ? "?" : "✗"}
                      </span>
                      <span className="reqtext">{r.text}</span>
                      {r.k === "align" && <span className="muted small">当前阵营：{curAlign}</span>}
                    </div>
                  ))}
                </div>
              )}
            </Sect>

            <Desc text={focus.desc} limit={900} />

            {focusChildren.length > 0 && (
              <Sect title={`相关（${focusChildren.length}）`}>
                <IconGrid
                  cols={2}
                  items={focusChildren.map((c) => ({
                    id: c.id,
                    name: label(c),
                    ico: featureIcon(db, c.id),
                    title: c.desc,
                  }))}
                />
              </Sect>
            )}

            <div className="muted small mt8">
              游戏里神祇选定后不能更改，这里刻意允许随时改，方便对比不同信仰的构筑；
              改动后职业、变体、阵营与领域的限制会立刻按新信仰重判。
            </div>
          </>
        )
      }
      right={
        <>
          <Sect title="当前信仰">
            <StatRows
              items={[
                ["神祇", build.deity ? label(db.features[build.deity]) : "—（无信仰）"],
                ["阵营要求", focus && focusToks.length > 0 ? alignNeedText(db, focusToks) : "不限"],
                ["当前阵营", rules.alignments.find((a) => a.id === build.alignment)?.name || "—"],
              ]}
              dense
            />
          </Sect>

          {conflicts.length > 0 && (
            <Sect title="冲突">
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
    />
  );
}
