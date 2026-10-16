import React, { useMemo } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import {
  choiceVerdict, derive, evalPrereqs, label, mythicHeroPath, mythicSource, ownedFeatures, pathStartRank,
  prereqText, rankRootSlots,
} from "../rules";
import { Chip, Collapse, Desc, Panel, SearchSelect } from "../ui";
import { SlotChain } from "../pick";

export function Mythic(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  const hero = mythicHeroPath(db);
  const start = pathStartRank(db, path);

  // 判定上下文（含神话阶层）：用于道途门槛（例如金龙/魔鬼/虫群行者要神话阶层 ≥ 7）
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
      rank: derived.rank,
    };
  }, [db, build, derived]);

  // 道途自己的门槛：神话阶层（可判定）＋主角身份 / 剧情 etude（不可判定，不拦人）
  const pathReqs = useMemo(() => {
    const out: Record<string, { verdict: string; fail: string[]; text: string }> = {};
    for (const p of Object.values(db.mythic.paths)) {
      const list = p.prereq || [];
      const res = evalPrereqs(db, ctxBase, list);
      out[p.id] = {
        verdict: res.verdict,
        // 只列真正不满足的那几条（剧情/身份类是 unknown，不算不满足）
        fail: res.details.filter((d) => d.v === "no").map((d) => prereqText(db, d.p)),
        text: list.filter((x) => !x.hide).map((x) => prereqText(db, x)).join("、"),
      };
    }
    return out;
  }, [db, ctxBase]);

  const pathOpts = useMemo(
    () => Object.values(db.mythic.paths)
      .filter((p) => p.selectable !== false)
      .map((p) => {
        const r = pathReqs[p.id];
        const short = r?.verdict === "no";
        return {
          id: p.id,
          label: p.name,
          hint: `${p.nameEn || ""} · 第 ${pathStartRank(db, p)} 阶起${short && r.fail.length ? " · 需要 " + r.fail.join("、") : ""}`,
          badge: p.higher ? "高阶" : short ? "门槛未达" : undefined,
        };
      }),
    [db, pathReqs],
  );

  // 每个神话等级的来源与槽位：1–2 阶（晚期道途 1–7 阶）都是「神话英雄」
  const rankInfo = useMemo(
    () => Array.from({ length: 10 }, (_, i) => {
      const r = i + 1;
      const src = mythicSource(db, build, r);
      return {
        rank: r,
        isHero: src.owner === hero || !src.owner,
        ownerName: src.owner ? label(src.owner) : "—",
        level: src.level,
        features: src.features,
        slots: rankRootSlots(db, build, r),
      };
    }),
    [db, build, hero],
  );

  return (
    <div>
      <Panel
        title="神话道途"
        sub={path ? `${path.name}${path.nameEn ? " · " + path.nameEn : ""} · 第 ${start} 阶起` : "还没选道途（前两阶是通用「神话英雄」）"}
      >
        <SearchSelect
          value={build.mythicPath}
          options={pathOpts}
          onChange={(v) => act.setMythicPath(v)}
          placeholder="选择神话道途（第 3 阶才生效）"
          width={260}
        />
        {path?.desc && <div className="mt8"><Desc text={path.desc} /></div>}
        <div className="muted small mt8">
          <b>前两阶没有道途。</b>第 1 阶你成为「神话英雄」：选一项<b>超凡飞升</b>能力 + 一项神话能力；
          第 2 阶一项神话专长。道途要到<b>第 3 阶</b>（第 2 章结尾）才生效 —— 金龙 / 虫群行者 / 魔鬼 / 传奇
          这几条晚期道途更是第 8 阶才换。所以本页 1–2 阶的槽位永远来自「神话英雄」，
          跟上面选不选道途无关。
        </div>
        <div className="muted small mt8">
          神话阶层本身不提升属性值（每阶给的是「奇数阶神话能力 / 偶数阶神话专长」）。
          加属性的是道途自己的特性，例如传奇的全属性 +4、恶魔的高等恶魔之相（数值 = 阶层的一半 + 1）、
          碎片之力的「诅咒之力」全属性 +4 —— 这些都已自动算进「角色 / 汇总」页的属性面板。
        </div>
        <div className="row wrap mt8">
          <span className="kv">神话等级 <b>{derived.rank}</b></span>
          {path && pathReqs[path.id]?.verdict === "no" && (
            <Chip tone="no">门槛未达：{pathReqs[path.id].fail.join("、") || "神话阶层不足"}</Chip>
          )}
          {path?.spellbookId && <Chip>有神话法术书</Chip>}
          {rankInfo.some((ri) => ri.slots.some((s) => !build.ranks[ri.rank - 1].picks[s.id])) && (
            <Chip tone="no">有神话槽位没选完</Chip>
          )}
        </div>
      </Panel>

      <div className="ranks">
        {rankInfo.map((ri) => {
          const lv = build.ranks[ri.rank - 1];
          const missing = ri.slots.filter((s) => !lv.picks[s.id]).length;
          const beforePath = !!path && ri.rank < start;
          return (
            <section className="lvcard" key={ri.rank}>
              <header className="lvhead">
                <span className="lvnum mythic">{ri.rank}</span>
                <span className="lvname">神话等级 {ri.rank}</span>
                <Chip tone={ri.isHero ? "info" : "ok"}>
                  {ri.isHero ? "神话英雄" : `${ri.ownerName} · 第 ${ri.level} 级`}
                </Chip>
                <span className="spacer" />
                {missing > 0 && <Chip tone="no">{missing} 项未选</Chip>}
              </header>

              {beforePath && (
                <div className="muted small">
                  这一阶还是「神话英雄」，{ri.ownerName} 要到第 {start} 阶才开始。
                </div>
              )}

              {ri.slots.length > 0 ? (
                <div className="slots">
                  {ri.slots.map((s) => (
                    <SlotChain
                      key={s.id}
                      db={db}
                      root={s}
                      picks={lv.picks}
                      verdict={(fid) => choiceVerdict(db, ctxBase, fid)}
                      onChange={(slotId, v) => act.setRankPick(ri.rank - 1, slotId, v)}
                    />
                  ))}
                </div>
              ) : (
                <div className="muted small">这一阶没有要选的东西。</div>
              )}

              {ri.features.length > 0 && (
                <Collapse title={`${ri.isHero ? "神话英雄" : "道途"}特性（${ri.features.length}）`}>
                  <div className="autolist">
                    {ri.features.map((id) => (
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
    </div>
  );
}
