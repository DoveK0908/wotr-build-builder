import React, { useMemo } from "react";
import type { Db, FeatureEntry } from "../types";
import type { Build } from "../store";
import { ATTRS, act, useBuild } from "../store";
import {
  attrMod, attrBreakdown, attrsAtLevel, backgroundRoot, classLevels, label, pointBuySpent, raceRootSlots,
  traitList, universalFeatures,
} from "../rules";
import { Chip, Collapse, Desc, Field, Meter, NumBox, Panel, SearchSelect } from "../ui";
import { AutoList, SlotChain, reachable } from "../pick";

export function Character(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;

  const race = build.race ? db.races[build.race] : null;

  // 背景：大类 → 具体（数据里只有 group 的 children，没有 parent）
  const bgOpts = useMemo(() => {
    const groups: Record<string, string> = {};
    for (const g of Object.values(db.backgrounds)) {
      if (g.kind !== "group") continue;
      for (const c of g.children || []) groups[c] = g.name;
    }
    return Object.values(db.backgrounds)
      .filter((b) => b.kind !== "group" && !b.companionOnly)
      .map((b) => ({ id: b.id, label: b.name, hint: b.nameEn, group: groups[b.id] || "背景" }));
  }, [db]);

  const raceOpts = useMemo(
    () => Object.values(db.races).map((r) => ({ id: r.id, label: r.name, hint: r.nameEn })),
    [db],
  );

  const deitySlot = rules.deitySelection ? db.features[rules.deitySelection] : null;
  const deityOpts = useMemo(() => {
    return (deitySlot?.choices || []).map((id) => {
      const f = db.features[id];
      return { id, label: label(f), hint: f?.nameEn };
    });
  }, [db, deitySlot]);

  // 种族传承槽位（传承本身还可能有下一层）
  const raceSlots = useMemo(() => raceRootSlots(db, build), [db, build]);

  // 背景：按游戏里的树逐层展开「大类 → 具体背景 → 子选择」
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

  const spent = pointBuySpent(db, build);
  const total = rules.pointBuyTotal || 25;
  // 属性来源拆分（基础 / 种族 / 升级 / 特性 / 手工），表格照这个显示
  const attrs = useMemo(() => attrBreakdown(db, build), [db, build]);

  const cls = Object.keys(classLevels(build))[0];
  // 通用升级表里有几个纯内部机制特性没有显示名（读出来是一串 guid），不给玩家看
  const universal1 = universalFeatures(db, 1).filter((id) => !!db.features[id]?.name);
  const traits = traitList(db, race);

  return (
    <div className="grid2">
      <Panel title="基本资料">
        <Field label="角色名">
          <input
            className="text"
            value={build.name}
            placeholder="给这个构筑起个名字"
            onChange={(e) => act.setName(e.target.value)}
          />
        </Field>
        <Field label="阵营">
          <SearchSelect
            value={build.alignment}
            options={rules.alignments.map((a) => ({ id: a.id, label: a.name }))}
            onChange={(v) => act.patch((b) => { b.alignment = v; })}
            width={220}
          />
        </Field>
        <Field
          label="神祇"
          hint={`牧师/战斗祭司等需要神祇；共 ${(deitySlot?.choices || []).length} 个可选`}
        >
          <SearchSelect
            value={build.deity}
            options={deityOpts}
            onChange={(v) => act.setDeity(v)}
            placeholder="选择信仰"
            width={220}
          />
        </Field>
      </Panel>

      <Panel
        title="种族"
        sub={race ? (race.nameEn || "") : "先选一个种族"}
      >
        <SearchSelect
          value={build.race}
          options={raceOpts}
          onChange={(v) => act.patch((b) => {
            b.race = v;
            b.racePicks = {};
            b.raceParams = {};
          })}
          placeholder="选择种族"
          width={260}
        />
        {race && (
          <>
            <div className="row wrap mt8">
              {(race.statBonuses || []).map((b, i) => (
                <Chip key={i} tone={b.value >= 0 ? "ok" : "no"}>
                  {label(rules.attributes.find((a) => a.id === b.stat))} {b.value > 0 ? "+" : ""}{b.value}
                  {b.cond ? "（有条件）" : ""}
                </Chip>
              ))}
              {race.size && <Chip>{race.size === "Large" ? "大型" : race.size === "Small" ? "小型" : "中型"}</Chip>}
            </div>
            {race.selectableStat && (
              <div className="row wrap mt8">
                <span className="muted small">任选一项 +2：</span>
                {ATTRS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={build.raceStatPick === a ? "btn sm" : "btn sm ghost"}
                    onClick={() => act.setRaceStatPick(build.raceStatPick === a ? null : a)}
                  >
                    {label(rules.attributes.find((x) => x.id === a))}
                  </button>
                ))}
                {!build.raceStatPick && <span className="muted small">（还没选）</span>}
              </div>
            )}
            {raceSlots.length > 0 && (
              <div className="slots mt8">
                {raceSlots.map((slot) => (
                  <SlotChain
                    key={slot.id}
                    db={db}
                    root={slot}
                    picks={build.racePicks}
                    verdict={() => "ok"}
                    onChange={(slotId, v) => act.patch((b) => {
                      if (v) b.racePicks[slotId] = v; else delete b.racePicks[slotId];
                      // 换掉上层选择后，下层已经不可达的旧选择也一并丢掉
                      for (const key of Object.keys(b.racePicks)) {
                        if (!reachable(db, raceSlots, b.racePicks, key)) delete b.racePicks[key];
                      }
                      const chosen = v ? db.features[v] : null;
                      if (chosen?.param) {
                        const pv = (chosen.paramVariants || [])[0] || "";
                        if (pv) b.raceParams[chosen.id] = pv;
                      }
                    })}
                  />
                ))}
              </div>
            )}
            {traits.length > 0 && (
              <Collapse title={`种族特性（${traits.length}）`}>
                {traits.map((t) => (
                  <div key={t.id} className="trait">
                    <div className="trait-name">{label(t)}</div>
                    <Desc text={t.desc} limit={300} />
                  </div>
                ))}
              </Collapse>
            )}
          </>
        )}
      </Panel>

      <Panel
        title="背景"
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

      <Panel
        title="属性"
        sub={`点买 ${spent} / ${total}`}
        right={<span className="muted small">升级提升：4/8/12/16/20 级各 +1</span>}
      >
        <Meter used={spent} total={total} label="点买" />
        <table className="tbl attrs">
          <thead>
            <tr>
              <th>属性</th><th>基础</th><th>种族</th><th>升级</th><th>特性</th><th>手工</th><th>总</th><th>调整</th><th>点数</th>
            </tr>
          </thead>
          <tbody>
            {rules.attributes.map((a) => {
              const base = build.attributes[a.id] || 10;
              const br = attrs[a.id];
              const cost = rules.pointBuy[String(base)] ?? 0;
              const sign = (v: number) => (v > 0 ? "+" : "") + (v || 0);
              const cls2 = (v: number) => (v ? (v > 0 ? "pos" : "neg") : "muted");
              return (
                <tr key={a.id}>
                  <td className="nowrap">{a.name}<span className="muted small"> {a.short}</span></td>
                  <td>
                    <NumBox
                      value={base}
                      min={7}
                      max={18}
                      onChange={(v) => act.patch((b) => { b.attributes[a.id] = v; })}
                    />
                  </td>
                  <td className={cls2(br.race)}>{sign(br.race)}</td>
                  <td className={cls2(br.level)}>{sign(br.level)}</td>
                  <td className={cls2(br.feat)} title="种族传承 / 背景 / 专长 / 职业特性 / 神话道途带来的加值">
                    {sign(br.feat)}
                  </td>
                  <td>
                    <NumBox
                      value={br.manual}
                      min={-20}
                      max={40}
                      onChange={(v) => act.setAttrManual(a.id, v)}
                    />
                  </td>
                  <td className="bold">{br.total}</td>
                  <td>{attrMod(br.total) >= 0 ? "+" : ""}{attrMod(br.total)}</td>
                  <td className="muted">{cost}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="muted small mt8">
          「特性」一列是种族传承 / 背景 / 专长 / 职业特性 / 神话道途特性给的加值（例如传奇 +4 全属性）；
          「手工」一列用来记装备/药水之类的外部加值，不计入点买花费。
        </div>
        <div className="muted small mt8">
          当前 1 级属性（含种族与升级提升）：
          {rules.attributes.map((a) => `${a.short} ${attrsAtLevel(db, build, 1)[a.id]}`).join(" · ")}
        </div>
      </Panel>

      <Panel title="角色创建时自动获得的选项" className="span2">
        <div className="muted small">来自通用升级表（1 级）：这些是每个角色都有的槽位。</div>
        <AutoList db={db} ids={universal1} />
      </Panel>
    </div>
  );
}
