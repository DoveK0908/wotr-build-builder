import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import type { Build } from "../store";
import { act, deserialize, levelCap, serialize, shareUrl, useBuild } from "../store";
import { attrBreakdown, attrMod, alignmentLocks, derive, label, ownedFeatures } from "../rules";
import { Chip, Collapse, Confirm } from "../ui";
import { AlignWheel, GrowthTable, IconGrid, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { alignAbbr as abbrOf } from "../steps";
import { featureIcon } from "../skin";

/** 第 ⑪ 步：按游戏「角色卡」排的三栏总结 */
export function Summary(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const cap = levelCap(build);
  const d = useMemo(() => derive(db, build), [db, build]);
  const [msg, setMsg] = useState("");
  const [askReset, setAskReset] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const race = build.race ? db.races[build.race] : null;
  const bg = build.background ? db.backgrounds[build.background] : null;
  const attrBr = useMemo(() => attrBreakdown(db, build), [db, build]);
  const owned = useMemo(() => ownedFeatures(db, build).ids, [db, build]);
  const god = build.deity ? db.features[build.deity] : null;
  const alignName = db.rules.alignments.find((a) => a.id === build.alignment)?.name || "—";
  /** 角色卡左栏的阵营轮盘：只读展示，锁住的阵营变淡 */
  const alignLocks = useMemo(() => alignmentLocks(db, build), [db, build]);
  const alignLabels = useMemo(
    () => Object.fromEntries(db.rules.alignments.map((a) => [a.id, a.name])),
    [db],
  );

  // 拥有的东西按类型拆成「特殊能力 / 专长 / 其它特性」三组图标
  const groups = useMemo(() => {
    const feats: string[] = [];
    const abilities: string[] = [];
    const traits: string[] = [];
    for (const id of owned) {
      const f = db.features[id];
      if (!f || !f.name) continue;
      const g = f.groups || [];
      if (f.type === "feat" || g.includes("Feat") || g.includes("CombatFeat") || g.includes("MythicFeat")) feats.push(id);
      else if (f.type === "ability" || f.type === "activatableability" || g.includes("MythicAbility") || f.activatable || f.ability) abilities.push(id);
      else traits.push(id);
    }
    return { feats, abilities, traits };
  }, [db, owned]);

  const perLevel = useMemo(() => {
    const running: Record<string, number> = {};
    return build.levels.map((lv, i) => {
      if (lv.classId) running[lv.classId] = (running[lv.classId] || 0) + 1;
      const picks = Object.entries(lv.picks || {}).map(([sid, cid]) => ({
        slot: label(db.features[sid]),
        val: label(db.features[cid]),
        param: lv.params[cid],
      }));
      return { level: i + 1, classId: lv.classId, classLevel: lv.classId ? running[lv.classId] : 0, ability: lv.ability, picks };
    });
  }, [db, build]);

  const strMod = attrMod(d.attrs.Strength || 10);
  const dexMod = attrMod(d.attrs.Dexterity || 10);
  const touch = 10 + dexMod;

  const copy = (t: string, what: string) => {
    navigator.clipboard?.writeText(t).then(
      () => setMsg(`${what} 已复制到剪贴板`),
      () => setMsg("复制失败，请手动选中"),
    );
  };

  const grid = (ids: string[]) =>
    ids.map((id) => ({ id, name: label(db.features[id]), ico: featureIcon(db, id), title: db.features[id]?.desc || "" }));

  return (
    <>
    <ThreePane
      left={
        <>
          <Sect title="角色">
            <div className="sheet-plate">
              <div className="sp-name">{build.name || "（未命名）"}</div>
              <div className="sp-line">
                {alignName}　·　{race?.name || "—"}
              </div>
              <div className="sp-line">
                生命值 {d.hp}　·　等级 {d.level}
              </div>
              <div className="sp-badge"> ① {Object.entries(d.classLevels).map(([cid, n]) => `${label(db.classes[cid])} ${n}`).join(" / ") || "—"}</div>
              {/* 游戏的角色卡左栏也放着一个阵营轮盘（只读） */}
              <div className="sp-wheel">
                <AlignWheel
                  value={build.alignment}
                  abbr={abbrOf}
                  locks={alignLocks}
                  labels={alignLabels}
                  onPick={() => {}}
                />
              </div>
            </div>
          </Sect>

          <Sect title="属性">
            <StatRows
              dense
              items={db.rules.attributes.map((a) => {
                const v = d.attrs[a.id] ?? 10;
                const m = attrMod(v);
                const br = attrBr[a.id];
                return [
                  <span key="k">
                    <b>{a.short || a.name.slice(0, 3)}</b> <span className="muted small">{a.name}</span>
                  </span>,
                  <span key="v">
                    <b>{v}</b> <span className={m > 0 ? "pos" : m < 0 ? "neg" : "muted"}>{m >= 0 ? "+" : ""}{m}</span>
                    {br && (br.race || br.level || br.feat || br.manual) ? (
                      <span className="muted small">　（基础 {br.base}）</span>
                    ) : null}
                  </span>,
                ] as [React.ReactNode, React.ReactNode];
              })}
            />
          </Sect>

          <Sect title="攻击" right={<span className="muted small">不含装备</span>}>
            <StatBox
              cols={2}
              items={[
                { k: "基础攻击加值", v: d.bab },
                { k: "近战攻击", v: `${d.bab + strMod >= 0 ? "+" : ""}${d.bab + strMod}` },
                { k: "远程攻击", v: `${d.bab + dexMod >= 0 ? "+" : ""}${d.bab + dexMod}` },
                { k: "战技", v: `${d.bab + strMod >= 0 ? "+" : ""}${d.bab + strMod}` },
                { k: "先攻", v: `${dexMod >= 0 ? "+" : ""}${dexMod}` },
                { k: "法术抗力", v: "—" },
              ]}
            />
          </Sect>

          <Sect title="防御等级和豁免检定">
            <StatBox
              cols={3}
              items={[
                { k: "防御等级", v: d.ac },
                { k: "措手不及", v: touch - dexMod },
                { k: "接触", v: touch },
                { k: "强韧", v: `${d.fort >= 0 ? "+" : ""}${d.fort}` },
                { k: "反射", v: `${d.ref >= 0 ? "+" : ""}${d.ref}` },
                { k: "意志", v: `${d.will >= 0 ? "+" : ""}${d.will}` },
              ]}
            />
            <div className="muted small" style={{ marginTop: 6 }}>
              速度 30 尺　·　生命值 {d.hp}（每级取半骰 + 体质调整）
            </div>
          </Sect>
        </>
      }
      center={
        <>
          <Sect title="角色卡">
            <StatRows
              items={[
                ["名字", build.name || "（未命名）"],
                ["种族", race ? race.name + (build.raceStatPick ? `（任选 +2：${label(db.rules.attributes.find((a) => a.id === build.raceStatPick))}）` : "") : "—"],
                ["背景", bg?.name || "—"],
                ["神祇", god ? label(god) : "—"],
                ["阵营", alignName],
                ["职业", Object.entries(d.classLevels).map(([cid, n]) => `${label(db.classes[cid])} ${n}`).join(" / ") || "—"],
                ["神话", build.mythicPath ? `${label(db.mythic.paths[build.mythicPath])} ${d.rank} 阶` : `神话英雄 ${d.rank} 阶`],
                ["总等级", `${d.level} / 20`],
              ]}
            />
          </Sect>

          {groups.traits.length > 0 && (
            <Sect title={`种族与背景特性（${groups.traits.length}）`}>
              <IconGrid items={grid(groups.traits)} cols={3} />
            </Sect>
          )}

          {groups.abilities.length > 0 && (
            <Sect title={`特殊能力（${groups.abilities.length}）`}>
              <IconGrid items={grid(groups.abilities)} cols={3} />
            </Sect>
          )}

          {groups.feats.length > 0 && (
            <Sect title={`专长（${groups.feats.length}）`}>
              <IconGrid items={grid(groups.feats)} cols={3} />
            </Sect>
          )}

          <Sect title="法术">
            {d.spells.length === 0 && <div className="muted">没有施法职业</div>}
            {d.spells.map((sp) => {
              const byLevel = groupByLevel(db, sp.chosen);
              return (
                <div key={sp.classId} style={{ marginBottom: 10 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <b>{sp.className}</b>
                    <div className="rings">
                      {Array.from({ length: 10 }, (_, r) => (
                        <span key={r} className={"ring" + (byLevel[String(r)] ? " on" : "")} title={`${r} 环`}>
                          <i>{r}</i>
                          <b>{byLevel[String(r)]?.length || 0}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  {Object.entries(byLevel).map(([l, arr]) => (
                    <div key={l} className="muted small">
                      {l === "0" ? "戏法" : `${l} 环`}：{arr.join("、")}
                    </div>
                  ))}
                  {sp.chosen.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <IconGrid
                        cols={4}
                        items={sp.chosen.map((id) => ({
                          id,
                          name: db.spells[id]?.name || id,
                          ico: featureIcon(db, id),
                        }))}
                      />
                    </div>
                  )}
                  {sp.chosen.length === 0 && <div className="muted small">（未选法术）</div>}
                </div>
              );
            })}
          </Sect>

          <Sect title={`成长表（1–${cap} 级）`} right={<span className="muted small">每级给了什么特性</span>}>
            <GrowthTable db={db} build={build} max={cap} />
          </Sect>

          <Collapse title="升级记录（逐级选了什么）">
            <table className="tbl lvtable">
              <thead>
                <tr><th>等级</th><th>职业</th><th>选择</th></tr>
              </thead>
              <tbody>
                {perLevel.map((p) => (
                  <tr key={p.level}>
                    <td>{p.level}</td>
                    <td>
                      {p.classId ? `${label(db.classes[p.classId])}${p.classLevel > 1 ? `（第 ${p.classLevel} 级）` : ""}` : <span className="muted">—</span>}
                      {p.ability && <span className="muted small"> · 属性+1 {label(db.rules.attributes.find((a) => a.id === p.ability))}</span>}
                    </td>
                    <td>
                      {p.picks.length === 0 && <span className="muted">—</span>}
                      {p.picks.map((x, i) => (
                        <span className="picknote" key={i}>
                          <i>{x.slot}</i> {x.val}
                          {x.param ? <span className="muted">（{x.param}）</span> : null}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Collapse>

          <Sect title="没选完的地方">
            {d.unfinished.length === 0 ? (
              <div className="ok">看起来都选完了 ✓</div>
            ) : (
              <ul className="issues">
                {d.unfinished.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
          </Sect>
        </>
      }
      right={
        <>
          <Sect title="技能" right={d.skillPointsTotal ? <Chip>还剩 {d.skillPointsTotal - d.skillSpent}</Chip> : undefined}>
            <StatRows
              dense
              items={d.skills.map((s) => [
                s.name,
                <span key="v" className={s.ranks ? "" : "muted"}>
                  {s.total >= 0 ? "+" : ""}
                  {s.total}
                  {s.ranks > 0 ? <span className="muted small">　{s.ranks} 级</span> : null}
                </span>,
              ])}
            />
          </Sect>

          <Sect title="武艺特性">
            <StatRows
              dense
              items={[
                ["护甲擅长", (d.proficiencies.armor || []).join("、") || "无"],
                ["武器擅长", (d.proficiencies.weapon || []).join("、") || "无"],
              ]}
            />
          </Sect>

          <Sect title="分享与存档">
            <div className="row wrap">
              <button type="button" className="btn" onClick={() => copy(shareUrl(build), "分享链接")}>复制分享链接</button>
              <button type="button" className="btn" onClick={() => copy(serialize(build), "构筑代码")}>复制构筑代码</button>
              <button type="button" className="btn ghost" onClick={() => setPasteOpen((x) => !x)}>粘贴代码导入</button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(build, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = (build.name || "wotr-build") + ".json";
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >下载 JSON</button>
              <label className="btn ghost as-btn">
                导入 JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const text = await f.text();
                      const b = deserialize(text) || (JSON.parse(text) as Build);
                      act.load(b);
                      setMsg("已导入");
                    } catch {
                      setMsg("文件解析失败");
                    }
                  }}
                />
              </label>
              <button type="button" className="btn ghost danger" onClick={() => setAskReset(true)} title="清空当前构筑">重置</button>
            </div>
            {pasteOpen && (
              <div className="mt8">
                <textarea className="text wide" rows={4} placeholder="把构筑代码粘到这里" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const b = deserialize(pasteText.trim());
                    if (b) { act.load(b); setMsg("已导入"); } else setMsg("这段代码看不懂");
                  }}
                >导入</button>
              </div>
            )}
            {msg && <div className="muted small mt8">{msg}</div>}
          </Sect>

          <Sect title="备注">
            <textarea className="text wide" rows={4} value={build.notes} onChange={(e) => act.setNotes(e.target.value)} placeholder="写点攻略心得…" />
          </Sect>
        </>
      }
    />
    {askReset && (
      <Confirm
        title="清空构筑"
        danger
        confirmText="清空"
        text={<>
          确定要清空当前构筑吗？<b>职业、种族、背景、属性、技能、专长、法术、神话</b>都会一起清掉，
          分享链接里原有的内容也会失效。此操作不可撤销。
        </>}
        onCancel={() => setAskReset(false)}
        onConfirm={() => { act.reset(); setAskReset(false); setMsg("已清空"); }}
      />
    )}
  </>);
}

function groupByLevel(db: Db, ids: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    const s = db.spells[id];
    if (!s) continue;
    const lv = String(Object.values(s.levels || {})[0] ?? s.listLevel ?? 0);
    (out[lv] = out[lv] || []).push(s.name);
  }
  return out;
}
