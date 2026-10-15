/**
 * 预置构筑选择器：列出 pipeline/import_presets.py 从中文 BD 合集
 * （ZJUZBW/-Wotr-BD-）解析出来的队友构筑，一键载入成可继续编辑的构筑。
 */

import React, { useMemo, useState } from "react";
import type { Db, Preset } from "../types";
import { act } from "../store";
import { applyPreset } from "../presets";
import { Modal, Panel } from "../ui";

export function PresetPicker({ db, onClose }: { db: Db; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");

  const groups = useMemo(() => {
    const m = new Map<string, Preset[]>();
    for (const p of db.presets?.presets || []) {
      const text = `${p.who}${p.plan}`;
      if (q && !text.includes(q)) continue;
      const k = p.who || "其他";
      if (!m.has(k)) m.set(k, []);
      (m.get(k) as Preset[]).push(p);
    }
    return [...m.entries()];
  }, [db, q]);

  const load = (p: Preset) => {
    const r = applyPreset(db, p);
    act.load(r.build);
    if (r.leftover.length) act.setNotes(r.leftover.join("\n"));
    setMsg(
      `已载入「${p.who} · ${p.plan}」：自动落位 ${r.placed} 项` +
        (r.leftover.length ? `，另有 ${r.leftover.length} 项需手动确认（已写入备注）` : ""),
    );
  };

  const st = db.presets?.stats;
  const attrName = useMemo(
    () => Object.fromEntries((db.rules.attributes || []).map((a) => [a.id, a.name])),
    [db],
  );

  return (
    <Modal title="预置构筑（来自中文 BD 合集）" onClose={onClose} wide>
      <div className="row wrap">
        <input
          className="cl-search"
          placeholder="搜索队友名 / 职业配比…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted small">
          共 {st?.presets ?? 0} 套 · 专长识别 {st?.matched ?? 0}/{st?.feats ?? 0} · 来源{" "}
          {db.presets?.source}
        </span>
      </div>
      {msg && <div className="row mt8"><span className="chip chip-ok">{msg}</span></div>}
      <div className="mt8">
        {groups.map(([who, list]) => (
          <Panel key={who} title={who} sub={`${list.length} 套构筑`}>
            {list.map((p) => (
              <div className="row wrap" key={p.id} style={{ padding: "3px 0" }}>
                <span className="pick-name">{p.plan}</span>
                {p.match && (
                  <span className="muted small">
                    专长 {p.match.feats}/{p.match.total}
                  </span>
                )}
                {p.attrs?.length > 0 && (
                  <span className="muted small">
                    加点 {p.attrs.map((a) => attrName[a] || a).join(" / ")}
                  </span>
                )}
                <span className="spacer" />
                <button className="btn sm" type="button" onClick={() => load(p)}>
                  载入
                </button>
              </div>
            ))}
          </Panel>
        ))}
        {groups.length === 0 && <p className="muted">没有匹配的预置构筑。</p>}
      </div>
    </Modal>
  );
}
