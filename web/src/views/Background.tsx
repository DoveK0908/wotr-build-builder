import React, { useMemo, useState } from "react";
import type { Db, FeatureEntry } from "../types";
import { act, useBuild } from "../store";
import { backgroundRoot, childFeatures, label } from "../rules";
import { Chip, Desc } from "../ui";
import { reachable } from "../pick";
import { DetailHead, IconGrid, ListPane, ListRow, Sect, StatRows, ThreePane } from "../pane";
import { featureIcon } from "../skin";

const DEPTH_TAG = ["大类", "具体背景", "再选一项", "再选一项"];

/** 第 ③ 步：背景（大类 → 具体背景 → 有些背景还要再选一项） */
export function Background(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const bgRootSlot = backgroundRoot(db);
  const bgPicks = build.bgPicks || {};
  const companionOnly = useMemo(() => {
    const s = new Set<string>();
    for (const b of Object.values(db.backgrounds)) if (b.companionOnly) s.add(b.id);
    return s;
  }, [db]);

  /** 从头顺着已选项往下走，得到「已经走过的层级 + 当前待选层」 */
  const levels = useMemo(() => {
    const out: { slot: string; options: string[] }[] = [];
    let slot: FeatureEntry | undefined = bgRootSlot;
    for (let depth = 0; slot && depth < 4; depth += 1) {
      out.push({
        slot: slot.id,
        options: (slot.choices || []).filter((id) => !companionOnly.has(id) && !!db.features[id]),
      });
      const chosen = bgPicks[slot.id];
      if (!chosen) break;
      const f = db.features[chosen];
      slot = f && f.choices && f.choices.length ? f : undefined;
    }
    return out;
  }, [db, bgRootSlot, bgPicks, companionOnly]);

  const active = levels[levels.length - 1];
  const activeDepth = levels.length - 1;
  const forced = active ? bgPicks[active.slot] : null;

  const onBgPick = (slot: string, v: string | null) => {
    const next: Record<string, string> = { ...bgPicks };
    if (v) next[slot] = v;
    else delete next[slot];
    const roots: FeatureEntry[] = bgRootSlot ? [bgRootSlot] : [];
    for (const key of Object.keys(next)) if (!reachable(db, roots, next, key)) delete next[key];
    let deepest: string | null = null;
    let node: FeatureEntry | undefined = bgRootSlot;
    while (node) {
      const c = next[node.id];
      if (!c) break;
      deepest = c;
      const f = db.features[c];
      node = f && f.choices && f.choices.length ? f : undefined;
    }
    act.setBgPicks(next, deepest);
  };

  const list = useMemo(() => {
    if (!active) return [];
    const kw = q.trim().toLowerCase();
    return active.options.filter((id) => {
      if (!kw) return true;
      const f = db.features[id];
      return (label(f) + " " + (f?.nameEn || "")).toLowerCase().includes(kw);
    });
  }, [active, db, q]);

  const focusId = hover || forced || list[0] || null;
  const focus = focusId ? db.features[focusId] : null;
  const focusChildren = focus ? childFeatures(db, focus) : [];

  return (
    <ThreePane
      left={
        <ListPane
          title={
            <span>
              <span className="muted small">{DEPTH_TAG[activeDepth]}　</span>
              选择背景
            </span>
          }
          search={q}
          onSearch={setQ}
          foot={
            levels.length > 1 ? (
              <span>
                已选：
                {levels
                  .slice(0, activeDepth)
                  .map((l, i) => bgPicks[l.slot])
                  .filter(Boolean)
                  .map((id) => label(db.features[id]))
                  .join(" › ")}
              </span>
            ) : undefined
          }
        >
          {list.map((id) => {
            const f = db.features[id];
            return (
              <ListRow
                key={id}
                ico={featureIcon(db, id)}
                glyph={label(f).slice(0, 1)}
                name={label(f)}
                sub={f?.nameEn}
                arrow={!!(f?.choices && f.choices.length)}
                sel={forced === id}
                onHover={() => setHover(id)}
                onClick={() => onBgPick(active!.slot, forced === id ? null : id)}
              />
            );
          })}
          {list.length === 0 && <div className="muted small" style={{ padding: "8px 10px" }}>没有匹配项</div>}
        </ListPane>
      }
      center={
        !focus ? (
          <div className="muted">在左边选一个背景。</div>
        ) : (
          <>
            <DetailHead
              ico={featureIcon(db, focus.id)}
              glyph={label(focus).slice(0, 1)}
              title={label(focus)}
              en={focus.nameEn}
              big
            />
            {focus.desc ? <Desc text={focus.desc} limit={900} /> : <div className="muted small">没有说明文本。</div>}

            {focusChildren.length > 0 && (
              <Sect title={`再选一项（${focusChildren.length}）`}>
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

            {focus.proficiencies && (focus.proficiencies.armor?.length || focus.proficiencies.weapon?.length) ? (
              <Sect title="获得擅长">
                <div className="row wrap">
                  {(focus.proficiencies.armor || []).map((p) => (
                    <Chip key={"a" + p}>护甲：{p}</Chip>
                  ))}
                  {(focus.proficiencies.weapon || []).map((p) => (
                    <Chip key={"w" + p}>武器：{p}</Chip>
                  ))}
                </div>
              </Sect>
            ) : null}

            {focus.knownSpells && focus.knownSpells.length > 0 && (
              <Sect title="赠送法术">
                <IconGrid
                  cols={3}
                  items={focus.knownSpells.map((ks) => ({
                    id: ks.id,
                    name: db.spells[ks.id]?.name || ks.id,
                    ico: featureIcon(db, ks.id),
                    glyph: (db.spells[ks.id]?.name || "?").slice(0, 1),
                  }))}
                />
              </Sect>
            )}
          </>
        )
      }
      right={
        <>
          <Sect title="已选背景">
            {forced && activeDepth < 0 ? null : null}
            <StatRows
              items={
                levels
                  .slice(0, activeDepth)
                  .filter((l) => bgPicks[l.slot])
                  .map((l, i) => [DEPTH_TAG[i], label(db.features[bgPicks[l.slot]])])
              }
              dense
            />
            {activeDepth === 0 && !forced && <div className="muted small">还没选。背景会给本职技能、技能加值或一项额外专长。</div>}
          </Sect>

          {forced && db.backgrounds[forced] && (
            <Sect title="最终背景">
              <StatRows
                items={[
                  ["名称", db.backgrounds[forced].name],
                  ["英文", db.backgrounds[forced].nameEn || "—"],
                ]}
              />
            </Sect>
          )}
        </>
      }
    />
  );
}
