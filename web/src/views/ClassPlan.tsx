import React, { useMemo } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import {
  alignAllows, alignNeedText, alignOverrideOf, alignTokensOf, classLevels, classSelectableAt, derive, label,
} from "../rules";
import { Chip, Panel, SearchSelect } from "../ui";

/** 第 ① 步：排 20 级要练哪些职业、要不要变体 */
export function ClassPlan(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);

  const classOpts = useMemo(() => {
    return Object.values(db.classes)
      .filter((c) => !c.mythic)
      .sort((a, b) => (a.prestige === b.prestige ? a.name.localeCompare(b.name, "zh") : a.prestige ? 1 : -1))
      .map((c) => {
        const sel = classSelectableAt(db, c.id, build.alignment);
        const bad = !sel.ok;
        return {
          id: c.id,
          label: c.name,
          badge: (c.prestige ? "进阶" : "基础") + (bad ? " · 阵营不符" : ""),
          hint: bad
            ? `需要 ${sel.reason}`
            : sel.viaArchetype
              ? `需要 ${alignNeedText(db, alignTokensOf(c.prereq))}，或选「${sel.viaArchetype}」则改为它的阵营要求`
              : `HD ${c.hitDie} · 技能点 ${c.skillPoints}${c.spellbookId ? " · 施法" : ""}`,
          disabled: bad,
        };
      });
  }, [db, build.alignment]);

  const used = classLevels(build);
  const running: Record<string, number> = {};

  return (
    <div>
      <Panel
        title="① 职业与变体"
        sub={`先排 20 级要练哪些职业；变体在某个职业的第一级上选，会替换该职业的部分特性。已排 ${derived.level} / 20 级`}
      >
        <div className="row wrap">
          <label className="cl-only">
            构筑名
            <input
              className="text"
              value={build.name}
              placeholder="例如：主坦席拉"
              onChange={(e) => act.setName(e.target.value)}
            />
          </label>
        </div>
        <div className="row wrap mt8">
          {Object.entries(used).map(([cid, n]) => (
            <Chip key={cid}>{label(db.classes[cid])} {n} 级</Chip>
          ))}
          {derived.level === 0 && <span className="muted small">还没排职业</span>}
        </div>
        <div className="row wrap mt8">
          <span className="kv">BAB <b>{derived.bab}</b></span>
          <span className="kv">强韧 <b>{derived.fort}</b></span>
          <span className="kv">反射 <b>{derived.ref}</b></span>
          <span className="kv">意志 <b>{derived.will}</b></span>
          <span className="kv">生命 <b>{derived.hp}</b></span>
          <span className="kv">技能点 <b>{derived.skillPointsTotal}</b></span>
        </div>
      </Panel>

      <div className="lvlist">
        {build.levels.map((lv, idx) => {
          const level = idx + 1;
          if (lv.classId) running[lv.classId] = (running[lv.classId] || 0) + 1;
          const classLvl = lv.classId ? running[lv.classId] : 0;
          const cls = lv.classId ? db.classes[lv.classId] : null;
          const overMax = !!cls && classLvl > cls.maxLevel;
          const archList = build.classArchetypes[lv.classId || ""] || [];
          const firstOfClass = classLvl === 1 && lv.classId;
          const archChoices = (cls?.archetypes || []).map((id) => db.archetypes[id]).filter(Boolean);
          const archOverride = lv.classId ? alignOverrideOf(db, lv.classId, archList) : null;

          return (
            <section className={"lvcard" + (lv.classId ? "" : " empty")} key={idx}>
              <header className="lvhead">
                <span className="lvnum">{level}</span>
                <SearchSelect
                  value={lv.classId}
                  options={classOpts}
                  onChange={(v) => act.setClass(idx, v)}
                  placeholder="选择职业"
                  width={260}
                />
                {lv.classId && (
                  <span className="muted small">该职业第 {classLvl} 级{cls ? ` · ${cls.hitDie}` : ""}</span>
                )}
                {overMax && <Chip tone="no">超过该职业最高等级 {cls?.maxLevel}</Chip>}
                <span className="spacer" />
              </header>

              {firstOfClass && archChoices.length > 0 && (
                <div className="arch">
                  <span className="muted small">变体（可多选，会替换职业特性）：</span>
                  <div className="row wrap">
                    {archChoices.map((a) => {
                      const on = archList.includes(a.id);
                      const toks = alignTokensOf(a.prereq);
                      const bad = !alignAllows(build.alignment, toks);
                      return (
                        <Chip
                          key={a.id}
                          tone={on ? "ok" : bad ? "no" : undefined}
                          title={bad
                            ? `需要 ${alignNeedText(db, toks)}`
                            : a.desc ? a.desc.slice(0, 200) : a.nameEn}
                          onClick={() => {
                            if (bad && !on) return;
                            act.toggleArchetype(lv.classId as string, a.id);
                          }}
                        >
                          {on ? "✓ " : ""}{a.name}{bad ? "（阵营不符）" : ""}
                        </Chip>
                      );
                    })}
                  </div>
                  {archOverride && (
                    <div className="muted small" style={{ marginTop: 4 }}>
                      「{archOverride.archName}」自带阵营要求（{alignNeedText(db, archOverride.tokens)}），
                      选中后取代本职业的「{alignNeedText(db, archOverride.classTokens)}」——两条互斥，游戏里也只取变体那条。
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
