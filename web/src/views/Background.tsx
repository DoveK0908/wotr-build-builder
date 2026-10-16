import React, { useMemo } from "react";
import type { Db, FeatureEntry } from "../types";
import { act, useBuild } from "../store";
import { backgroundRoot, label } from "../rules";
import { Desc, Panel, SearchSelect } from "../ui";
import { reachable } from "../pick";

/** 第 ③ 步：背景（大类 → 具体背景 → 有些背景还要再选一项） */
export function Background(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();

  const bgRootSlot = backgroundRoot(db);
  const bgPicks = build.bgPicks || {};
  const companionOnly = useMemo(() => {
    const s = new Set<string>();
    for (const b of Object.values(db.backgrounds)) if (b.companionOnly) s.add(b.id);
    return s;
  }, [db]);

  const bgLevels = useMemo(() => {
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

  const onBgPick = (slot: string, v: string | null) => {
    const next: Record<string, string> = { ...bgPicks };
    if (v) next[slot] = v; else delete next[slot];
    const roots: FeatureEntry[] = bgRootSlot ? [bgRootSlot] : [];
    for (const key of Object.keys(next)) if (!reachable(db, roots, next, key)) delete next[key];
    // 最深的那一项用于显示与前置条件上下文
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

  return (
    <Panel
      title="③ 背景"
      sub="按游戏里的层级选：大类 → 具体背景 → 有些背景还会再让你挑一项（例如自然学者要选一个德鲁伊戏法）"
    >
      <div className="bgtree">
        {bgLevels.map((lvl, depth) => (
          <div className="row" key={lvl.slot}>
            <span className="muted small bgtree-tag">
              {depth === 0 ? "大类" : depth === 1 ? "具体背景" : "再选一项"}
            </span>
            <SearchSelect
              value={bgPicks[lvl.slot] || null}
              options={lvl.options.map((id) => {
                const f = db.features[id];
                return { id, label: label(f), hint: f?.nameEn };
              })}
              onChange={(v) => onBgPick(lvl.slot, v)}
              placeholder={depth === 0 ? "选择背景（可选）" : "选择…"}
              width={300}
            />
          </div>
        ))}
      </div>
      {build.background && (
        <div className="mt8">
          <Desc
            text={db.backgrounds[build.background]?.desc || db.features[build.background]?.desc}
            limit={700}
          />
        </div>
      )}
    </Panel>
  );
}
