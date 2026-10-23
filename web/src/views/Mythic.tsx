import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { LEGEND_PATH_ID, act, useBuild } from "../store";
import {
  MYTHIC_LATE_START, choiceVerdict, derive, evalPrereqs, label, mythicHeroPath, mythicSource, ownedFeatures,
  MYTHIC_RANK_LEVELS, babAt, levelForRank, pathStartRank, prereqText, rankRootSlots, sneakAt,
} from "../rules";
import { Chip, Collapse } from "../ui";
import { AutoList, ParamField, SlotChain, pickedParams } from "../pick";
import { openDetail } from "../detail";
import { DetailHead, ListPane, MythicGrowth, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { ART, featureIcon, mythicCard, ui } from "../skin";

export function Mythic(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const path = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;
  const hero = mythicHeroPath(db);
  const [sel, setSel] = useState<number | null>(null);

  const ctxBase = useMemo(() => {
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

  const pathReqs = useMemo(() => {
    const out: Record<string, { verdict: string; fail: string[]; text: string }> = {};
    for (const p of Object.values(db.mythic.paths)) {
      const list = p.prereq || [];
      const res = evalPrereqs(db, ctxBase, list, 0, p.id);
      out[p.id] = {
        verdict: res.verdict,
        fail: res.details.filter((d) => d.v === "no").map((d) => prereqText(db, d.p)),
        text: list.filter((x) => !x.hide).map((x) => prereqText(db, x)).join("、"),
      };
    }
    return out;
  }, [db, ctxBase]);

  const paths = useMemo(
    () =>
      Object.values(db.mythic.paths)
        .filter((p) => p.selectable !== false)
        .sort((a, b) => pathStartRank(db, a) - pathStartRank(db, b) || a.name.localeCompare(b.name, "zh")),
    [db],
  );

  const mainPaths = useMemo(() => paths.filter((p) => pathStartRank(db, p) === 3), [paths, db]);
  const latePaths = useMemo(() => paths.filter((p) => pathStartRank(db, p) >= MYTHIC_LATE_START), [paths, db]);
  const mainPath = build.mythicPath ? db.mythic.paths[build.mythicPath] : null;

  const rankInfo = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
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

  const missingOf = (r: number) => build.ranks[r - 1].picks;
  const fallbackRank = rankInfo.find((ri) => ri.slots.some((s) => !missingOf(ri.rank)[s.id]))?.rank || derived.rank || 1;
  const cur = rankInfo[(sel ?? fallbackRank) - 1] || rankInfo[0];
  const curLv = build.ranks[cur.rank - 1];
  const curMissing = cur.slots.filter((s) => !curLv.picks[s.id]).length;
  const lateBand = cur.rank >= MYTHIC_LATE_START;
  const beforePath = !!path && cur.rank < pathStartRank(db, path);

  return (
    <ThreePane
      left={
        <ListPane
          title={lateBand ? `第 ${MYTHIC_LATE_START} 阶起：可选晚期道途` : "选择神话道途"}
          foot={
            <span>
              第 1–2 阶固定是「神话英雄」，第 3 阶选道途，第 {MYTHIC_LATE_START} 阶可换晚期道途
            </span>
          }
        >
          {lateBand ? (
            <>
              <div className="muted small" style={{ padding: "2px 6px 8px" }}>
                换晚期道途不会丢掉第 3–7 阶已经选的东西：那几阶仍由主道途
                {mainPath ? `（${mainPath.name}）` : ""}提供，晚期道途只接管第 {MYTHIC_LATE_START} 阶以后。
              </div>
              <button
                type="button"
                className={"mpcard" + (build.mythicLate ? "" : " sel")}
                title="继续走第 3 阶选的那条主道途"
                onClick={() => act.setMythicLate(null)}
              >
                <span className="mpcard-glyph">沿</span>
                <span className="mpcard-name">沿用主道途{mainPath ? `（${mainPath.name}）` : ""}</span>
                <span className="mpcard-sub">第 {MYTHIC_LATE_START} 阶起继续主道途</span>
              </button>
              {latePaths.map((p) => {
                const r = pathReqs[p.id];
                const bad = r?.verdict === "no";
                const sel2 = build.mythicLate === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={"mpcard" + (sel2 ? " sel" : "") + (bad ? " dis" : "")}
                    title={r?.text || p.nameEn || p.name}
                    onClick={() => act.setMythicLate(p.id)}
                  >
                    {ART && <img className="mpcard-art" src={mythicCard(p.key)} alt="" />}
                    {ART && sel2 && <img className="mpcard-arrow" src={ui("UI_Mythic_SelectFrameArrow")} alt="" />}
                    <span className="mpcard-glyph">{p.name.slice(0, 1)}</span>
                    <span className="mpcard-name">{p.name}</span>
                    <span className="mpcard-sub">
                      {p.id === LEGEND_PATH_ID
                        ? "第 8 阶起 · 等级上限 40（每职业仍 20）"
                        : `第 ${pathStartRank(db, p)} 阶起${bad && r?.fail.length ? " · 需要 " + r.fail.join("、") : ""}`}
                    </span>
                    {bad ? (
                      <span className="mpcard-badge badge no">门槛未达</span>
                    ) : p.id === LEGEND_PATH_ID ? (
                      <span className="mpcard-badge badge">特殊</span>
                    ) : null}
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <div className="muted small" style={{ padding: "2px 6px 8px" }}>
                {cur.rank < 3
                  ? "第 1–2 阶固定是「神话英雄」（第 1 阶超凡飞升 + 神话能力，第 2 阶神话专长）；道途从第 3 阶生效，这里可以先把它选好。"
                  : "第 3 阶（第 2 章结尾）才选道途；这里选的是主道途。"}
              </div>
              <button
                type="button"
                className={"mpcard" + (build.mythicPath ? "" : " sel")}
                title="前两阶走「神话英雄」：第 1 阶选超凡飞升 + 神话能力，第 2 阶选神话专长"
                onClick={() => act.setMythicPath(null)}
              >
                {ART && <img className="mpcard-art" src={mythicCard("MythicStartingClass")} alt="" />}
                <span className="mpcard-glyph">英</span>
                <span className="mpcard-name">神话英雄（通用）</span>
                <span className="mpcard-sub">第 1–2 阶 · 神话能力 / 神话专长</span>
              </button>
              {mainPaths.map((p) => {
                const r = pathReqs[p.id];
                const bad = r?.verdict === "no";
                const sel2 = build.mythicPath === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={"mpcard" + (sel2 ? " sel" : "") + (bad ? " dis" : "")}
                    title={r?.text || p.nameEn || p.name}
                    onClick={() => act.setMythicPath(p.id)}
                  >
                    {ART && <img className="mpcard-art" src={mythicCard(p.key)} alt="" />}
                    {ART && sel2 && <img className="mpcard-arrow" src={ui("UI_Mythic_SelectFrameArrow")} alt="" />}
                    <span className="mpcard-glyph">{p.name.slice(0, 1)}</span>
                    <span className="mpcard-name">{p.name}</span>
                    <span className="mpcard-sub">
                      第 {pathStartRank(db, p)} 阶起
                      {bad && r?.fail.length ? " · 需要 " + r.fail.join("、") : p.nameEn ? " · " + p.nameEn : ""}
                    </span>
                    {bad ? <span className="mpcard-badge badge no">门槛未达</span> : null}
                  </button>
                );
              })}
            </>
          )}
        </ListPane>
      }
      center={
        <>
          {/* 进度表上方的横条（游戏里是道途专属的装饰条） */}
          <div className="mpcap">
            <span>{cur.isHero ? "神话英雄" : path?.name || "神话"}</span>
          </div>
          <MythicGrowth db={db} build={build} sel={cur.rank} onSel={(r) => setSel(r)} />

          <DetailHead
            ico={cur.isHero ? null : path ? featureIcon(db, path.id) : null}
            glyph={cur.isHero ? "英" : path ? path.name.slice(0, 1) : "?"}
            title={`神话等级 ${cur.rank}`}
            en={`约 ${levelForRank(cur.rank)} 级 · ${cur.isHero ? "神话英雄" : `${cur.ownerName} · 第 ${cur.level} 级`}`}
            big
          />

          {beforePath && (
            <div className="muted small">
              这一阶还是「神话英雄」，{cur.ownerName} 要到第 {pathStartRank(db, path!)} 阶才开始。
            </div>
          )}

          {cur.slots.length > 0 ? (
            <Sect title={`第 ${cur.rank} 阶要选（${cur.slots.length}）`}>
              <div className="slots">
                {cur.slots.map((s) => (
                  <SlotChain
                    key={s.id}
                    db={db}
                    root={s}
                    picks={curLv.picks}
                    verdict={(fid) => choiceVerdict(db, ctxBase, fid)}
                    onChange={(slotId, v) => act.setRankPick(cur.rank - 1, slotId, v)}
                  />
                ))}
              </div>
              {/* 神话阶里的参数化选择：诡术师学识（宗教）2/3 阶要挑领域 */}
              {cur.slots.map((s) =>
                pickedParams(db, s, curLv.picks).map(({ f, key }, i) => (
                  <div key={`${s.id}:${key}`} style={{ marginTop: 6 }}>
                    <ParamField
                      f={f}
                      index={i + 1}
                      value={curLv.params[key] || null}
                      onChange={(v) => act.setRankParam(cur.rank - 1, key, v)}
                    />
                  </div>
                )),
              )}
            </Sect>
          ) : (
            <div className="muted small mt8">这一阶没有要选的东西。</div>
          )}

          {cur.features.length > 0 && (
            <Collapse title={`${cur.isHero ? "神话英雄" : "道途"}特性（${cur.features.length}）`}>
              <AutoList db={db} ids={cur.features} onDetail={openDetail} />
            </Collapse>
          )}

          {path?.desc && (
            <Sect title={`${path.name} 说明`}>
              <div className="desc-body">{path.desc}</div>
            </Sect>
          )}

          <div className="muted small mt8">
            <b>阶层与等级：</b>游戏里神话阶层按剧情节点给，不是按经验值；玩家通常在
            {MYTHIC_RANK_LEVELS.join(" / ")} 级左右拿到第 1–10 阶（这张表也用在「逐级」的前置推算里）。<br />
            <b>前两阶没有道途。</b>第 1 阶你成为「神话英雄」：选一项<b>超凡飞升</b>能力 + 一项神话能力；
            第 2 阶一项神话专长。道途要到<b>第 3 阶</b>（第 2 章结尾）才生效 —— 金龙 / 虫群行者 / 魔鬼 / 传奇
            这几条晚期道途更是第 8 阶才换。
          </div>
        </>
      }
      right={
        <>
          <Sect title="神话">
            <StatBox
              cols={2}
              items={[
                { k: "神话等级", v: derived.rank },
                { k: "道途", v: path ? path.name : "—（通用神话英雄）" },
                { k: "道途起始", v: path ? `第 ${pathStartRank(db, path)} 阶` : "—" },
                {
                  k: "门槛",
                  v: path ? (pathReqs[path.id]?.verdict === "no" ? "未达" : "已满足") : "—",
                },
              ]}
            />
            {path && pathReqs[path.id]?.verdict === "no" && (
              <div className="row wrap" style={{ marginTop: 6 }}>
                <Chip tone="no">门槛未达：{pathReqs[path.id].fail.join("、") || "神话阶层不足"}</Chip>
              </div>
            )}
            {path?.spellbookId && <Chip>有神话法术书</Chip>}
          </Sect>

          <Sect title="各阶填写情况">
            <StatRows
              items={rankInfo.map((ri) => {
                const lv = build.ranks[ri.rank - 1];
                const miss = ri.slots.filter((s) => !lv.picks[s.id]).length;
                return [
                  `${ri.rank} 阶`,
                  <span key="v">
                    {ri.slots.length === 0 ? "—" : miss === 0 ? "已填" : `${miss} 项未选`}
                    <span className="muted small">　{ri.isHero ? "英雄" : ri.ownerName}</span>
                  </span>,
                ];
              })}
              dense
            />
          </Sect>

          <Sect title="说明">
            <div className="muted small">
              神话阶层本身不提升属性值（每阶给的是「奇数阶神话能力 / 偶数阶神话专长」）。
              加属性的是道途自己的特性，例如传奇的全属性 +4、恶魔的高等恶魔之相（数值 = 阶层的一半 + 1）、
              碎片之力的「诅咒之力」全属性 +4 —— 这些都已自动算进「属性」与「汇总」页。
            </div>
          </Sect>
        </>
      }
    />
  );
}
