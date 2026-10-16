import React, { useMemo, useState } from "react";
import type { AttrId, Db, FeatureEntry, LevelEntry } from "../types";
import type { Build } from "../store";
import { act, useBuild } from "../store";
import {
  choiceVerdict, classLevels, derive, featuresAtClassLevel, label, levelCtxList,
  levelRootSlots,
} from "../rules";
import { Chip, Collapse, Panel, SearchSelect } from "../ui";
import { SlotChain } from "../pick";

const ATTR_LEVELS = [4, 8, 12, 16, 20];

export function Levels(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const ctxs = useMemo(() => levelCtxList(db, build, derived), [db, build, derived]);
  const [onlyUnfinished, setOnlyUnfinished] = useState(false);

  const classOpts = useMemo(() => {
    return Object.values(db.classes)
      .filter((c) => !c.mythic)
      .sort((a, b) => (a.prestige === b.prestige ? a.name.localeCompare(b.name, "zh") : a.prestige ? 1 : -1))
      .map((c) => ({
        id: c.id,
        label: c.name,
        badge: c.prestige ? "进阶" : "基础",
        hint: `HD ${c.hitDie} · 技能点 ${c.skillPoints}${c.spellbookId ? " · 施法" : ""}`,
      }));
  }, [db]);

  const used = classLevels(build);
  const rest = 20 - derived.level;

  // 逐级渲染时用到的「该职业已经练到第几级」
  const running: Record<string, number> = {};

  return (
    <div>
      <Panel
        title="升级路线"
        sub={`已排 ${derived.level} / 20 级${rest > 0 ? `，还剩 ${rest} 级` : ""}`}
        right={
          <label className="cl-only">
            <input type="checkbox" checked={onlyUnfinished} onChange={(e) => setOnlyUnfinished(e.target.checked)} />
            只看没选完的
          </label>
        }
      >
        <div className="row wrap">
          {Object.entries(used).map(([cid, n]) => (
            <Chip key={cid}>{label(db.classes[cid])} {n} 级</Chip>
          ))}
          {derived.unfinished.length > 0 && (
            <Chip tone="no">还有 {derived.unfinished.length} 个槽位没选</Chip>
          )}
        </div>
        <div className="row wrap mt8">
          <span className="kv">BAB <b>{derived.bab}</b></span>
          <span className="kv">强韧 <b>{derived.fort}</b></span>
          <span className="kv">反射 <b>{derived.ref}</b></span>
          <span className="kv">意志 <b>{derived.will}</b></span>
          <span className="kv">生命 <b>{derived.hp}</b></span>
          <span className="kv">技能点 <b>{derived.skillSpent}/{derived.skillPointsTotal}</b></span>
        </div>
      </Panel>

      {build.levels.map((lv, idx) => {
        const level = idx + 1;
        const ctx = ctxs[idx];
        if (lv.classId) running[lv.classId] = (running[lv.classId] || 0) + 1;
        const classLvl = lv.classId ? running[lv.classId] : 0;
        const cls = lv.classId ? db.classes[lv.classId] : null;
        const overMax = !!cls && classLvl > cls.maxLevel;

        const archList = build.classArchetypes[lv.classId || ""] || [];
        const autoIds = lv.classId
          ? featuresAtClassLevel(db, lv.classId, classLvl, archList)
          : [];
        // 该级要做的选择：职业升级表给的 + 通用升级表给的（rules 里的单一真源）
        const uniqSlots = levelRootSlots(db, build, level);
        const missing = uniqSlots.filter((s) => !lv.picks[s.id]).length;

        if (onlyUnfinished && missing === 0 && lv.classId) return null;

        const firstOfClass = classLvl === 1 && lv.classId;
        const archChoices = (cls?.archetypes || []).map((id) => db.archetypes[id]).filter(Boolean);

        return (
          <section className={"lvcard" + (lv.classId ? "" : " empty")} key={idx}>
            <header className="lvhead">
              <span className="lvnum">{level}</span>
              <SearchSelect
                value={lv.classId}
                options={classOpts}
                onChange={(v) => act.setClass(level, v)}
                placeholder="选择职业"
                width={260}
              />
              {lv.classId && (
                <span className="muted small">该职业第 {classLvl} 级{cls ? ` · ${cls.hitDie}` : ""}</span>
              )}
              {overMax && <Chip tone="no">超过该职业最高等级 {cls?.maxLevel}</Chip>}
              {ATTR_LEVELS.includes(level) && (
                <span className="lvattr">
                  属性 +1：
                  <SearchSelect
                    value={lv.ability || null}
                    options={db.rules.attributes.map((a) => ({ id: a.id, label: a.name }))}
                    onChange={(v) => act.setAbility(level, v as AttrId | null)}
                    placeholder="未选"
                    width={120}
                  />
                </span>
              )}
              <span className="spacer" />
              {missing > 0 && <Chip tone="no">{missing} 项未选</Chip>}
            </header>

            {firstOfClass && archChoices.length > 0 && (
              <div className="arch">
                <span className="muted small">变体（可多选，会替换职业特性）：</span>
                <div className="row wrap">
                  {archChoices.map((a) => {
                    const on = archList.includes(a.id);
                    return (
                      <Chip
                        key={a.id}
                        tone={on ? "ok" : undefined}
                        title={a.desc ? a.desc.slice(0, 200) : a.nameEn}
                        onClick={() => act.toggleArchetype(lv.classId as string, a.id)}
                      >
                        {on ? "✓ " : ""}{a.name}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            {uniqSlots.length > 0 && (
              <div className="slots">
                {uniqSlots.map((s) => (
                  <SlotChain
                    key={s.id}
                    db={db}
                    root={s}
                    picks={lv.picks}
                    verdict={(fid) => choiceVerdict(db, ctx, fid)}
                    onChange={(slotId, v) => act.setPick(level, slotId, v)}
                  />
                ))}
              </div>
            )}

            {/* 参数化专长的参数 */}
            {Object.entries(lv.picks).map(([sid, cid]) => {
              const f = db.features[cid];
              if (!f?.param) return null;
              const variants = f.paramVariants || [];
              if (!variants.length) return null;
              return (
                <div className="param" key={sid}>
                  <span className="muted small">{label(f)} 的参数（{f.param}）：</span>
                  <SearchSelect
                    value={lv.params[f.id] || null}
                    options={mergeParamOptions(f.id, variants)}
                    onChange={(v) => act.setParam(level, f.id, v)}
                    placeholder="选择参数"
                    width={220}
                  />
                </div>
              );
            })}

            {autoIds.length > 0 && (
              <Collapse title={`本级自动获得（${autoIds.length}）`}>
                <div className="autolist">
                  {autoIds.map((id) => {
                    const f = db.features[id];
                    return (
                      <div className="auto-row" key={id} title={f?.desc || ""}>
                        <span className="auto-name">{label(f)}</span>
                        {f?.nameEn && <span className="pick-en">{f.nameEn}</span>}
                      </div>
                    );
                  })}
                </div>
              </Collapse>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 从参数标签里把「名字|guid」拆成选项 */
function mergeParamOptions(_fid: string, variants: string[]) {
  const seen = new Set<string>();
  const out: { id: string; label: string; hint?: string }[] = [];
  for (const v of variants) {
    const [nm, gid] = v.split("|");
    const id = gid || nm;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: gid ? nm : nm, hint: gid ? undefined : nm });
  }
  return out;
}

export function abilitySummary(db: Db, b: Build) {
  return derive(db, b);
}
