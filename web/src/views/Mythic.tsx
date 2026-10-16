import React, { useMemo } from "react";
import type { Db, FeatureEntry } from "../types";
import { act, useBuild } from "../store";
import {
  choiceVerdict, derive, label, ownedFeatures, rankRootSlots,
} from "../rules";
import { Chip, Collapse, Desc, Panel, SearchSelect } from "../ui";
import { SlotChain } from "../pick";

export function Mythic(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;

  const pathOpts = useMemo(
    () => Object.values(db.mythic.paths)
      .filter((p) => p.selectable !== false)
      .map((p) => ({
        id: p.id,
        label: p.name,
        hint: p.nameEn,
        badge: p.higher ? "高阶" : undefined,
      })),
    [db],
  );

  // 每一个神话等级可选的槽位：道途自家内容优先，空着的等级走通用神话能力/专长
  const rankSlots = useMemo(
    () => Array.from({ length: 10 }, (_, i) => rankRootSlots(db, build, i + 1)),
    [db, build],
  );

  const ctxBase = useMemo(() => {
    const o = ownedFeatures(db, build);
    return {
      atLevel: 20,
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
    };
  }, [db, build, derived]);

  return (
    <div>
      <Panel
        title="神话道途"
        sub={path ? `${path.name}${path.nameEn ? " · " + path.nameEn : ""}` : "先选择一条道途（一般在 2 级时解锁）"}
      >
        <SearchSelect
          value={build.mythicPath}
          options={pathOpts}
          onChange={(v) => act.setMythicPath(v)}
          placeholder="选择神话道途"
          width={260}
        />
        {path?.desc && <div className="mt8"><Desc text={path.desc} /></div>}
        <div className="muted small mt8">
          神话阶层本身不提升属性值（游戏里每阶给的是「奇数阶神话能力 / 偶数阶神话专长」）。
          加属性的是道途自己的特性，例如传奇的全属性 +4、恶魔的高等恶魔之相（数值 = 阶层的一半 + 1）、
          碎片之力的「诅咒之力」全属性 +4 —— 这些都已自动算进「角色 / 汇总」页的属性面板。
        </div>
        <div className="row wrap mt8">
          <span className="kv">神话等级 <b>{derived.rank}</b></span>
          {path?.spellbookId && <Chip>有神话法术书</Chip>}
          {derived.unfinished.filter((u) => u.startsWith("rank:")).length > 0 && (
            <Chip tone="no">神话槽位没选完</Chip>
          )}
        </div>
      </Panel>

      {path && (
        <div className="ranks">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => {
            const lv = build.ranks[r - 1];
            const slots = rankSlots[r - 1];
            const auto = (path.progression || []).find((x) => x.level === r)?.features || [];
            const missing = slots.filter((s) => !lv.picks[s.id]).length;
            return (
              <section className="lvcard" key={r}>
                <header className="lvhead">
                  <span className="lvnum mythic">{r}</span>
                  <span className="lvname">神话等级 {r}</span>
                  <span className="spacer" />
                  {missing > 0 && <Chip tone="no">{missing} 项未选</Chip>}
                </header>

                {slots.length > 0 && (
                  <div className="slots">
                    {slots.map((s) => (
                      <SlotChain
                        key={s.id}
                        db={db}
                        root={s}
                        picks={lv.picks}
                        verdict={(fid) => choiceVerdict(db, ctxBase, fid)}
                        onChange={(slotId, v) => act.setRankPick(r - 1, slotId, v)}
                      />
                    ))}
                  </div>
                )}

                {auto.length > 0 && (
                  <Collapse title={`道途特性（${auto.length}）`}>
                    <div className="autolist">
                      {auto.map((id) => (
                        <div className="auto-row" key={id} title={db.features[id]?.desc || ""}>
                          <span className="auto-name">{label(db.features[id])}</span>
                        </div>
                      ))}
                    </div>
                  </Collapse>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
