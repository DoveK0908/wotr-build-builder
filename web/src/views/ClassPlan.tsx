import React, { useMemo, useState } from "react";
import type { ClassEntry, Db } from "../types";
import { act, useBuild } from "../store";
import {
  alignAllows, alignNeedText, alignOverrideOf, alignTokensOf, classLevels, classSelectableAt, derive,
  featuresAtClassLevel, isNamed, label,
} from "../rules";
import { Chip } from "../ui";
import { DetailHead, GrowthTable, IconGrid, ListPane, ListRow, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { featureIcon } from "../skin";

/** bab / 豁免表的第 0 项是占位，第 N 项才是第 N 级；10 级进阶职业的表只有 11 项，所以一律按职业自己的满级取。 */
function saveGrade(arr?: number[], maxLevel = 20) {
  const v = arr?.[maxLevel];
  if (typeof v !== "number") return "—";
  return v >= maxLevel * 0.6 ? "高" : "低";
}

function babGrade(arr?: number[], maxLevel = 20) {
  const v = arr?.[maxLevel] ?? 0;
  const r = maxLevel ? v / maxLevel : 0;
  return r >= 0.95 ? "高" : r >= 0.7 ? "中" : "低";
}

/** 游戏职业页右栏「施法属性 / 施法类型」两格 */
function castAttr(db: Db, c?: ClassEntry) {
  const sb = c?.spellbookId ? db.spellbooks[c.spellbookId] : undefined;
  if (!sb) return "—";
  const a = db.rules.attributes.find((x) => x.id === sb.castingAttribute);
  return a ? a.name : sb.castingAttribute || "—";
}

function castKind(db: Db, c?: ClassEntry) {
  const sb = c?.spellbookId ? db.spellbooks[c.spellbookId] : undefined;
  if (!sb) return "—";
  if (sb.spontaneous) return "自发施法";
  return sb.allSpellsKnown ? "准备施法（全表）" : "准备施法（法术书）";
}

/** 第 ① 步：排 20 级要练哪些职业、要不要变体 */
export function ClassPlan(props: { db: Db; onPresets?: () => void }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const [q, setQ] = useState("");
  const [levelState, setLevel] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const firstEmpty = build.levels.findIndex((l) => !l.classId);
  const level = levelState ?? (firstEmpty < 0 ? 20 : firstEmpty + 1); // 1 基
  const lv = build.levels[level - 1];

  const classOpts = useMemo(() => {
    const all = Object.values(db.classes)
      .filter((c) => !c.mythic)
      .sort((a, b) => (a.prestige === b.prestige ? a.name.localeCompare(b.name, "zh") : a.prestige ? 1 : -1))
      .map((c) => {
        const sel = classSelectableAt(db, c.id, build.alignment);
        const bad = !sel.ok;
        return {
          id: c.id,
          c,
          bad,
          badge: (c.prestige ? "进阶" : "基础") + (bad ? " · 阵营不符" : ""),
          hint: bad
            ? `需要 ${sel.reason}`
            : sel.viaArchetype
              ? `需要 ${alignNeedText(db, alignTokensOf(c.prereq))}，或选「${sel.viaArchetype}」则改为它的阵营要求`
              : `HD ${c.hitDie} · 技能点 ${c.skillPoints}${c.spellbookId ? " · 施法" : ""}`,
        };
      });
    const kw = q.trim().toLowerCase();
    return kw ? all.filter((o) => (o.c.name + " " + (o.c.nameEn || "")).toLowerCase().includes(kw)) : all;
  }, [db, build.alignment, q]);

  const used = classLevels(build);
  const running: Record<string, number> = {};
  for (let i = 0; i < level - 1; i += 1) {
    const cid = build.levels[i].classId;
    if (cid) running[cid] = (running[cid] || 0) + 1;
  }

  // 中间/右栏展示哪个职业：已排的这一级优先，其次是鼠标悬停的那一行（游戏里左列表是即时预览），
  // 都没有时用列表里的第一个职业当预览，避免中间栏一片空白。
  const shownId = lv?.classId ?? hover ?? classOpts[0]?.id ?? null;
  const preview = !lv?.classId && !!shownId;
  const shown = shownId ? db.classes[shownId] : null;
  const archList = (lv?.classId && build.classArchetypes[lv.classId]) || [];
  const classLvl = lv?.classId ? (running[lv.classId] || 0) + 1 : 1;
  const archChoices = (shown?.archetypes || []).map((id) => db.archetypes[id]).filter(Boolean);
  const override = lv?.classId ? alignOverrideOf(db, lv.classId, archList) : null;
  const got = (shownId ? featuresAtClassLevel(db, shownId, classLvl, archList) : []).filter((id) => isNamed(db.features[id]));

  const pickClass = (cid: string) => {
    act.setClass(level - 1, cid);
    setHover(null);
    if (level < 20) setLevel(level + 1);
  };

  const skillNames = (ids?: string[]) =>
    (ids || []).map((k) => db.rules.skills.find((s) => s.id === k)?.name || k);

  return (
    <ThreePane
      left={
        <ListPane
          title={`第 ${level} 级选择职业`}
          search={q}
          onSearch={setQ}
          foot={<span>已排 {derived.level} / 20 级　·　点职业会排到第 {level} 级并自动跳下一级</span>}
        >
          {classOpts.map((o) => (
            <ListRow
              key={o.id}
              ico={featureIcon(db, o.id)}
              glyph={o.c.name.slice(0, 1)}
              name={o.c.name}
              sub={o.bad ? o.hint : `${o.c.prestige ? "进阶" : "基础"} · HD ${o.c.hitDie}`}
              badge={o.bad ? <span className="badge no">阵营不符</span> : undefined}
              dis={o.bad}
              sel={shownId === o.id}
              title={o.hint}
              onHover={() => setHover(o.id)}
              onClick={() => !o.bad && pickClass(o.id)}
            />
          ))}
        </ListPane>
      }
      center={
        <>
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
            {lv?.classId && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  act.setClass(level - 1, null);
                  setLevel(level);
                }}
              >
                清空第 {level} 级
              </button>
            )}
          </div>

          <GrowthTable db={db} build={build} sel={level} onSel={(l) => setLevel(l)} />

          {!shown ? (
            <div className="muted" style={{ marginTop: 10 }}>
              第 {level} 级还没排职业 —— 在左边点一个职业即可（点成长表上的等级号可以跳到那一级）。
            </div>
          ) : (
            <>
              <DetailHead
                ico={featureIcon(db, shownId!)}
                glyph={shown.name.slice(0, 1)}
                title={preview ? `${shown.name}（预览）` : `${shown.name}　第 ${classLvl} 级`}
                en={shown.nameEn}
                big
              />
              {preview && (
                <div className="row wrap">
                  <Chip tone="any" title={classOpts.find((o) => o.id === shownId)?.hint}>
                    预览 —— 点左边这个职业就会排到第 {level} 级
                  </Chip>
                </div>
              )}
              {props.onPresets && (
                <div className="row">
                  <button type="button" className="btn wide" onClick={props.onPresets}>
                    使用推荐模板
                  </button>
                  <span className="muted small">从中文 BD 合集导入的 24 套现成构筑，选了会替换当前编排</span>
                </div>
              )}
              {archList.length > 0 && (
                <div className="row wrap">
                  {archList.map((a) => (
                    <Chip key={a} tone="ok">
                      {db.archetypes[a]?.name || a}
                    </Chip>
                  ))}
                </div>
              )}

              <Sect title={`第 ${classLvl} 级获得（${got.length}）`}>
                {got.length === 0 ? (
                  <div className="muted small">这一级没有新特性（法术/专长在其它步骤里选）。</div>
                ) : (
                  <IconGrid
                    cols={3}
                    items={got.map((id) => ({
                      id,
                      name: label(db.features[id]),
                      ico: featureIcon(db, id),
                      title: db.features[id]?.desc,
                    }))}
                  />
                )}
              </Sect>

              {lv?.classId && classLvl === 1 && archChoices.length > 0 && (
                <Sect title="变体（一个职业只能选一个，会替换职业特性）">
                  <div className="row wrap">
                    {archChoices.map((a) => {
                      const on = archList.includes(a.id);
                      const toks = alignTokensOf(a.prereq);
                      const bad = !alignAllows(build.alignment, toks);
                      return (
                        <Chip
                          key={a.id}
                          tone={on ? "ok" : bad ? "no" : undefined}
                          title={
                            bad
                              ? `需要 ${alignNeedText(db, toks)}`
                              : a.desc
                                ? a.desc.slice(0, 200)
                                : a.nameEn
                          }
                          onClick={() => {
                            if (bad && !on) return;
                            act.toggleArchetype(lv!.classId as string, a.id);
                          }}
                        >
                          {on ? "● " : ""}
                          {a.name}
                          {bad ? "（阵营不符）" : ""}
                        </Chip>
                      );
                    })}
                    {archList.length > 0 && (
                      <Chip tone="any" onClick={() => act.clearArchetype(lv!.classId as string)}>
                        不用变体
                      </Chip>
                    )}
                  </div>
                  <div className="muted small" style={{ marginTop: 4 }}>
                    原作里一个职业同时只能有一个变体（游戏本体如此，同时叠两个要靠 MOD）。
                  </div>
                  {override && (
                    <div className="muted small" style={{ marginTop: 4 }}>
                      「{override.archName}」自带阵营要求（{alignNeedText(db, override.tokens)}），选中后取代本职业的「
                      {alignNeedText(db, override.classTokens)}」——两条互斥，游戏里也只取变体那条。
                    </div>
                  )}
                </Sect>
              )}

              <Sect title="职业说明">
                <div className="desc-body">{shown.short || shown.desc}</div>
              </Sect>
            </>
          )}
        </>
      }
      right={
        <>
          {shown && (
            <Sect title={`${shown.name} 数值`}>
              <StatBox
                cols={3}
                items={[
                  { k: "强韧", v: saveGrade(shown.fort, shown.maxLevel) },
                  { k: "反射", v: saveGrade(shown.ref, shown.maxLevel) },
                  { k: "意志", v: saveGrade(shown.will, shown.maxLevel) },
                  { k: "基础攻击加值", v: babGrade(shown.bab, shown.maxLevel) },
                  { k: "每级生命值", v: shown.hitDie },
                  { k: "技能点", v: shown.skillPoints },
                  { k: "起始金币", v: shown.startingGold },
                  { k: "类型", v: shown.prestige ? "进阶" : "基础" },
                  { k: "最高等级", v: shown.maxLevel },
                  // 游戏职业页右栏这三格：施法属性 / 施法类型 / 施法（法术书）
                  { k: "施法属性", v: castAttr(db, shown) },
                  { k: "施法类型", v: castKind(db, shown) },
                  { k: "施法", v: shown.spellbookId ? db.spellbooks[shown.spellbookId]?.name || "有" : "—" },
                ]}
              />
              {shown.classSkills && shown.classSkills.length > 0 && (
                <div className="kskills">
                  {skillNames(shown.classSkills).map((n) => (
                    <span key={n} className="kskill">
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </Sect>
          )}

          <Sect title="累计">
            <StatRows
              items={[
                ["等级", `${derived.level} / 20`],
                ["BAB", derived.bab],
                ["强韧 / 反射 / 意志", `${derived.fort} / ${derived.ref} / ${derived.will}`],
                ["生命值", derived.hp],
                ["技能点", derived.skillPointsTotal],
              ]}
              dense
            />
          </Sect>

          <Sect title="已排职业">
            <StatRows
              items={Object.entries(used).map(([cid, n]) => [
                label(db.classes[cid]),
                `${n} 级`,
              ])}
              dense
            />
          </Sect>
        </>
      }
    />
  );
}
