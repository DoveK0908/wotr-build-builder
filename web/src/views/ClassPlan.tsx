import React, { useMemo, useState } from "react";
import type { ClassEntry, Db } from "../types";
import { act, useBuild } from "../store";
import {
  alignAllows, alignNeedText, alignOverrideOf, alignTokensOf, classLevels, classSelectableAt, derive,
  evalPrereqs, label, prereqText,
} from "../rules";
import { GrowthTable, ListPane, ListRow, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { Modal } from "../ui";

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

/**
 * 第 ① 步：排 20 级要练哪些职业、要不要变体。
 *
 * 版面按用户 2026-10-17 的要求：不再有「职业预览」那一块，也不在选职业后自动跳级 ——
 * 点职业只是把这一级定下来，中间栏那块可展开/收起的成长表里就是该职业完整的 20 级信息
 * （排到的等级会高亮），变体则在左栏职业本体下面展开。
 */
export function ClassPlan(props: { db: Db; onPresets?: () => void }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const [q, setQ] = useState("");
  /* 可以用 #tab=class&lv=7 直接跳到某一级（分享链接时有用） */
  const [levelState, setLevel] = useState<number | null>(() => {
    const m = /[#&]lv=(\d{1,2})/.exec(location.hash);
    const n = m ? Number(m[1]) : 0;
    return n >= 1 && n <= 20 ? n : null;
  });

  /* 「职业详情」小弹窗（BAB / 豁免 / 法术位）与「第一次选进阶职业」的前置弹窗 */
  const [preInfo, setPreInfo] = useState<string | null>(null);

  const firstEmpty = build.levels.findIndex((l) => !l.classId);
  const level = levelState ?? (firstEmpty < 0 ? 20 : firstEmpty + 1); // 1 基
  const lv = build.levels[level - 1];

  const classOpts = useMemo(() => {
    /* 顺序＝游戏角色创建界面的顺序：基础职业在前、进阶在后，两段内部都按中文名的字符编码序
       （不是拼音：实测游戏就是 先知→化形师→吟游诗人→…→骑将→魔战士；进阶段是 冬巫→决斗家→…→龙脉术士） */
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const all = Object.values(db.classes)
      .filter((c) => !c.mythic)
      .sort((a, b) => (a.prestige === b.prestige ? cmp(a.name, b.name) : a.prestige ? 1 : -1))
      .map((c) => {
        const sel = classSelectableAt(db, c.id, build.alignment);
        const bad = !sel.ok;
        return {
          id: c.id,
          c,
          bad,
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
  const picked = lv?.classId || null; // 当前这一级排的职业
  const shown = picked ? db.classes[picked] : null;
  const archList = (picked && build.classArchetypes[picked]) || [];
  const archChoices = (shown?.archetypes || []).map((id) => db.archetypes[id]).filter(Boolean);
  const override = picked ? alignOverrideOf(db, picked, archList) : null;
  const firstLvlOf = (cid: string) => build.levels.findIndex((l) => l.classId === cid) + 1;
  /** 这个职业的变体只能在该职业的第 1 级选（游戏如此） */
  const archSlotLevel = picked ? firstLvlOf(picked) : 0;
  const canPickArch = !!picked && archChoices.length > 0 && archSlotLevel === level;

  /** 点职业 = 把这一级定成它（不再自动跳下一级）；
      进阶职业只在「给它排第一级」时弹一次前置条件窗口，之后加它的第 2、3 级不再弹 */
  const pickClass = (cid: string) => {
    const before = classLevels(build)[cid] || 0;
    act.setClass(level - 1, cid);
    const c = db.classes[cid];
    if (c?.prestige && before === 0) setPreInfo(cid);
  };

  /** 某个职业的「第几级」（当前正在编辑的那一级对应它的第几级，没排到就是 1） */
  const classLevelOf = (cid: string) => {
    let k = 0;
    for (let i = 0; i < level; i++) if (build.levels[i]?.classId === cid) k++;
    return k || 1;
  };

  /** 进阶职业的前置判定（和神祇页同一套三态：ok / no / unknown） */
  const preCtx = useMemo(
    () => ({
      atLevel: level,
      classLevels: derived.classLevels,
      attrs: derived.attrs,
      idSet: new Set<string>(),
      alignment: build.alignment,
      race: build.race,
      background: build.background,
      mythicPath: build.mythicPath,
      archLevels: derived.archLevels,
      currentArchetypes: Object.values(derived.archSel).flat(),
      maxSpellLevel: derived.maxSpellLevel,
      rank: derived.rank,
    }),
    [level, derived, build.alignment, build.race, build.background, build.mythicPath],
  );
  const reqsOf = (c?: ClassEntry) => {
    if (!c?.prereq) return [] as { v: string; text: string; k: string }[];
    return evalPrereqs(db, preCtx, c.prereq)
      .details.filter((d) => !d.p.hide)
      .map((d) => ({ v: d.v as string, text: prereqText(db, d.p), k: d.p.k }));
  };
  const preReqs = useMemo(() => reqsOf(shown), [db, preCtx, shown]);
  const preFail = preReqs.filter((r) => r.v === "no").length;

  const skillNames = (ids?: string[]) =>
    (ids || []).map((k) => db.rules.skills.find((s) => s.id === k)?.name || k);

  /** 左栏里某个职业下面展开的变体行 */
  const archRows = (cid: string) => {
    const c = db.classes[cid];
    const list = (c?.archetypes || []).map((id) => db.archetypes[id]).filter(Boolean);
    if (!list.length) return null;
    if (!canPickArch) {
      const at = firstLvlOf(cid);
      return (
        <div className="lrow-sub" key={cid + "-arch-hint"}>
          <ListRow
            plain
            name={<span className="muted">变体要在它的第 {at} 级选（点这里跳过去）</span>}
            onClick={() => setLevel(at)}
            title={`「${label(c)}」的变体只能在该职业的第 1 级（第 ${at} 级）选择`}
          />
        </div>
      );
    }
    return (
      <div className="lrow-sub" key={cid + "-arch"}>
        {archList.length > 0 && (
          <ListRow
            plain
            name={<span className="muted">不用变体</span>}
            onClick={() => act.clearArchetype(cid)}
            title="去掉已选的变体"
          />
        )}
        {list.map((a) => {
          const on = archList.includes(a.id);
          const toks = alignTokensOf(a.prereq);
          const bad = !alignAllows(build.alignment, toks);
          return (
            <ListRow
              key={a.id}
              plain
              name={
                <>
                  <span className="dia">♦</span>
                  {a.name}
                </>
              }
              sub={bad ? `需要 ${alignNeedText(db, toks)}` : a.nameEn || undefined}
              badge={bad ? <span className="badge no">阵营不符</span> : undefined}
              dis={bad}
              sel={on}
              title={bad ? `需要 ${alignNeedText(db, toks)}` : a.desc ? a.desc.slice(0, 200) : a.nameEn}
              onClick={() => {
                if (bad && !on) return;
                act.toggleArchetype(cid, a.id);
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <>
      <ThreePane
      left={
        <ListPane
          title={`第 ${level} 级选择职业`}
          search={q}
          onSearch={setQ}
          foot={<span>已排 {derived.level} / 20 级　·　点职业只定这一级，不自动跳级</span>}
        >
          {classOpts.map((o) => (
            <React.Fragment key={o.id}>
              <ListRow
                plain
                name={o.c.name}
                sub={
                  o.bad
                    ? o.hint
                    : `${o.c.prestige ? "进阶" : "基础"} · HD ${o.c.hitDie}`
                }
                badge={o.bad ? <span className="badge no">阵营不符</span> : undefined}
                dis={o.bad}
                sel={picked === o.id}
                arrow={picked !== o.id}
                title={o.hint}
                onClick={() => !o.bad && pickClass(o.id)}
              />
              {picked === o.id && archRows(o.id)}
            </React.Fragment>
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
              <button type="button" className="btn sm ghost" onClick={() => act.setClass(level - 1, null)}>
                清空第 {level} 级
              </button>
            )}
            {lv?.classId && level < 20 && (
              <button
                type="button"
                className="btn sm"
                title="确认这一级，然后手动去下一级"
                onClick={() => setLevel(level + 1)}
              >
                确认，去第 {level + 1} 级 →
              </button>
            )}
          </div>

          {props.onPresets && (
            <div className="row">
              <button type="button" className="btn wide" onClick={props.onPresets}>
                使用推荐模板
              </button>
              <span className="muted small">从中文 BD 合集导入的 24 套现成构筑，选了会替换当前编排</span>
            </div>
          )}

          <GrowthTable
            db={db}
            build={build}
            sel={level}
            onSel={(l) => setLevel(l)}
          />

          <div className="muted small" style={{ marginTop: 8 }}>
            {picked
              ? `第 ${level} 级已排「${label(shown)}」${archList.length ? " · 变体「" + (db.archetypes[archList[0]]?.name || "") + "」" : ""}（这个职业共 ${used[picked] || 0} 级，块内高亮前 ${used[picked] || 0} 列）。`
              : `第 ${level} 级还没排职业 —— 在左边点一个职业即可（点表头的等级号可以跳到那一级）。`}
          </div>
          {archList.length > 0 && override && (
            <div className="muted small" style={{ marginTop: 4 }}>
              「{override.archName}」自带阵营要求（{alignNeedText(db, override.tokens)}），选中后取代本职业的「
              {alignNeedText(db, override.classTokens)}」——两条互斥，游戏里也只取变体那条。
            </div>
          )}
        </>
      }
      right={
        <>
          {shown && (
            <>
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

              {shown.prestige && (
                <Sect title={`进阶前提（${preReqs.filter((r) => r.v === "ok").length}/${preReqs.length}）`}>
                  {preReqs.length === 0 ? (
                    <div className="muted small">这个进阶职业没有导出前置条件。</div>
                  ) : (
                    <div className="reqlist">
                      {preReqs.map((r, i) => (
                        <div className="reqrow" key={i}>
                          <span
                            className="pcheck"
                            data-v={r.v}
                            title={r.v === "ok" ? "满足" : r.v === "unknown" ? "游戏内判定" : "不满足"}
                          >
                            {r.v === "ok" ? "✓" : r.v === "unknown" ? "?" : "✗"}
                          </span>
                          <span className="reqtext">{r.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {preFail > 0 && (
                    <div className="muted small" style={{ marginTop: 6 }}>
                      还有 {preFail} 条没满足 —— 先把这些前置补齐（或改了职业/等级）再选它。
                    </div>
                  )}
                </Sect>
              )}

              <Sect title="职业说明">
                <div className="desc-body">{shown.short || shown.desc}</div>
              </Sect>
            </>
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
              items={Object.entries(used).map(([cid, n]) => [label(db.classes[cid]), `${n} 级`])}
              dense
            />
          </Sect>
        </>
      }
      />

      {preInfo && db.classes[preInfo] && (
        <Modal title={`${label(db.classes[preInfo])}：进阶职业`} onClose={() => setPreInfo(null)}>
          <div className="muted small">
            进阶职业只有 {db.classes[preInfo].maxLevel} 级，选中前必须满足下面这些前置条件：
          </div>
          <div className="reqlist">
            {reqsOf(db.classes[preInfo]).map((r, i) => (
              <div className="reqrow" key={i}>
                <span className="pcheck" data-v={r.v} title={r.v === "ok" ? "满足" : r.v === "unknown" ? "游戏内判定" : "不满足"}>
                  {r.v === "ok" ? "✓" : r.v === "unknown" ? "?" : "✗"}
                </span>
                <span className="reqtext">{r.text}</span>
              </div>
            ))}
          </div>
          <div className="confirm-foot">
            <button type="button" className="btn" onClick={() => setPreInfo(null)}>
              知道了
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
