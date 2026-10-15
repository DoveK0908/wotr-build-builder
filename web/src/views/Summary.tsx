import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import type { Build } from "../store";
import { act, deserialize, serialize, shareUrl, useBuild } from "../store";
import { attrMod, derive, label } from "../rules";
import { Panel } from "../ui";

export function Summary(props: { db: Db; build: Build; derived: ReturnType<typeof derive> }) {
  const { db, build, derived: d } = props;
  const [msg, setMsg] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const race = build.race ? db.races[build.race] : null;
  const bg = build.background ? db.backgrounds[build.background] : null;

  const racial = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of race?.statBonuses || []) m[b.stat] = (m[b.stat] || 0) + b.value;
    return m;
  }, [race]);

  const fromLevels = useMemo(() => {
    const m: Record<string, number> = {};
    for (const lv of build.levels) if (lv.ability) m[lv.ability] = (m[lv.ability] || 0) + 1;
    for (const lv of build.ranks) if (lv.ability) m[lv.ability] = (m[lv.ability] || 0) + 2;
    return m;
  }, [build]);

  // 每一级选了什么（用于「升级记录」）
  const perLevel = useMemo(() => {
    const running: Record<string, number> = {};
    return build.levels.map((lv, i) => {
      const lvl = i + 1;
      if (lv.classId) running[lv.classId] = (running[lv.classId] || 0) + 1;
      const picks = Object.entries(lv.picks || {}).map(([sid, cid]) => {
        const slot = db.features[sid];
        return { slot: label(slot), val: label(db.features[cid]), id: cid, param: lv.params[cid] };
      });
      return {
        level: lvl,
        classId: lv.classId,
        classLevel: lv.classId ? running[lv.classId] : 0,
        ability: lv.ability,
        picks,
      };
    });
  }, [db, build]);

  const copy = (t: string, label2: string) => {
    navigator.clipboard?.writeText(t).then(
      () => setMsg(`${label2} 已复制到剪贴板`),
      () => setMsg("复制失败，请手动选中"),
    );
  };

  return (
    <div className="grid2">
      <Panel title="角色卡" className="span2">
        <div className="sheet">
          <div className="sheet-row"><span>名字</span><b>{build.name || "（未命名）"}</b></div>
          <div className="sheet-row"><span>种族</span><b>{race?.name || "—"}</b></div>
          <div className="sheet-row"><span>背景</span><b>{bg?.name || "—"}</b></div>
          <div className="sheet-row"><span>阵营</span><b>{db.rules.alignments.find((a) => a.id === build.alignment)?.name || "—"}</b></div>
          <div className="sheet-row"><span>神祇</span><b>{build.deity ? label(db.features[build.deity]) : "—"}</b></div>
          <div className="sheet-row">
            <span>职业</span>
            <b>
              {Object.entries(d.classLevels).map(([cid, n]) => `${label(db.classes[cid])} ${n}`).join(" / ") || "—"}
            </b>
          </div>
          <div className="sheet-row"><span>神话</span><b>{build.mythicPath ? label(db.mythic.paths[build.mythicPath]) : "—"}</b></div>
          <div className="sheet-row"><span>总等级</span><b>{d.level} / 20　神话 {d.rank} / 10</b></div>
        </div>
      </Panel>

      <Panel title="属性">
        <table className="tbl">
          <thead><tr><th>属性</th><th>基础</th><th>种族</th><th>升级</th><th>合计</th><th>调整</th></tr></thead>
          <tbody>
            {db.rules.attributes.map((a) => {
              const base = build.attributes[a.id] || 10;
              const r = racial[a.id] || 0;
              const u = fromLevels[a.id] || 0;
              const tot = base + r + u;
              return (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{base}</td>
                  <td className={r ? (r > 0 ? "pos" : "neg") : "muted"}>{r > 0 ? "+" : ""}{r || 0}</td>
                  <td className={u ? "pos" : "muted"}>{u > 0 ? "+" : ""}{u || 0}</td>
                  <td className="bold">{tot}</td>
                  <td>{attrMod(tot) >= 0 ? "+" : ""}{attrMod(tot)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="战斗数值" sub="不含武器/护甲等装备">
        <div className="stats">
          <div><span>BAB</span><b>{d.bab}</b></div>
          <div><span>AC</span><b>{d.ac}</b></div>
          <div><span>生命值</span><b>{d.hp}</b></div>
          <div><span>强韧</span><b>{d.fort}</b><span className="muted small">（职业 {d.fort - d.savesMisc.fort - attrMod(d.attrs.Constitution)} + 属性 {attrMod(d.attrs.Constitution)} + 杂项 {d.savesMisc.fort}）</span></div>
          <div><span>反射</span><b>{d.ref}</b></div>
          <div><span>意志</span><b>{d.will}</b></div>
        </div>
        <div className="muted small mt8">
          护甲擅长：{(d.proficiencies.armor || []).length ? d.proficiencies.armor.join("、") : "无"}
          <br />
          武器擅长：{(d.proficiencies.weapon || []).length ? d.proficiencies.weapon.join("、") : "无"}
        </div>
      </Panel>

      <Panel title="升级记录" className="span2">
        <table className="tbl lvtable">
          <thead><tr><th>等级</th><th>职业</th><th>选择</th></tr></thead>
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
      </Panel>

      <Panel title="技能">
        <table className="tbl">
          <thead><tr><th>技能</th><th>投入</th><th>总</th></tr></thead>
          <tbody>
            {d.skills.filter((s) => s.ranks > 0).map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.ranks}</td>
                <td className="bold">{s.total >= 0 ? "+" : ""}{s.total}</td>
              </tr>
            ))}
            {d.skills.every((s) => !s.ranks) && <tr><td colSpan={3} className="muted">还没投技能点</td></tr>}
          </tbody>
        </table>
      </Panel>

      <Panel title="法术">
        {d.spells.length === 0 && <div className="muted">没有施法职业</div>}
        {d.spells.map((sp) => (
          <div key={sp.classId} className="mt8">
            <div className="bold">{sp.className}</div>
            {Object.entries(groupByLevel(db, sp.chosen)).map(([l, arr]) => (
              <div key={l} className="muted small">
                {l === "0" ? "戏法" : `${l} 环`}：{arr.join("、")}
              </div>
            ))}
            {sp.chosen.length === 0 && <div className="muted small">（未选法术）</div>}
          </div>
        ))}
      </Panel>

      <Panel title="没选完的地方">
        {d.unfinished.length === 0
          ? <div className="ok">看起来都选完了 ✓</div>
          : <ul className="issues">{d.unfinished.map((u, i) => <li key={i}>{u}</li>)}</ul>}
      </Panel>

      <Panel title="分享与存档" className="span2">
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
          <button
            type="button"
            className="btn ghost danger"
            onClick={() => { act.reset(); setMsg("已清空"); }}
          >重新开始</button>
        </div>
        {pasteOpen && (
          <div className="mt8">
            <textarea
              className="text wide"
              rows={4}
              placeholder="把构筑代码粘到这里"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
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
        <div className="mt8">
          <div className="muted small">备注：</div>
          <textarea
            className="text wide"
            rows={3}
            value={build.notes}
            onChange={(e) => act.setNotes(e.target.value)}
            placeholder="写点攻略心得…"
          />
        </div>
      </Panel>
    </div>
  );
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
