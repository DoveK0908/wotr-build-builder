import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { derive, label } from "../rules";
import { Chip, Meter, Panel } from "../ui";
import { PickModal } from "../pick";

export function Spells(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const [open, setOpen] = useState<{ classId: string; level: number } | null>(null);

  if (!derived.spells.length) {
    return (
      <Panel title="法术">
        <div className="muted">
          当前构筑里还没有会施法的职业。先在「升级」里给某个等级选上法师/牧师之类的施法职业。
        </div>
      </Panel>
    );
  }

  const bonus = bonusSpells(db, derived);

  return (
    <div>
      {derived.spells.map((sp) => {
        const chosen = sp.chosen;
        return (
          <Panel
            key={sp.classId}
            title={`${sp.className} 的法术`}
            sub={[
              sp.castingAttr ? `施法属性 ${label(db.rules.attributes.find((a) => a.id === sp.castingAttr))}` : null,
              sp.spontaneous ? "自发施法（有已知法术上限）" : "准备施法",
              sp.allSpellsKnown ? "已知全部法术" : null,
              `最高 ${sp.maxSpellLevel} 环`,
            ].filter(Boolean).join(" · ")}
            right={
              chosen.length > 0
                ? <button type="button" className="btn sm ghost" onClick={() => act.clearSpells(sp.classId)}>清空已选</button>
                : null
            }
          >
            <div className="spellgrid">
              {Array.from({ length: sp.maxSpellLevel + 1 }, (_, l) => l).map((l) => {
                const pool = sp.byLevel[l] || [];
                const got = chosen.filter((id) => (db.spells[id]?.levels?.[sp.classId] ?? -1) === l);
                const cap = sp.knownCount != null ? sp.knownCount : null;
                const perDay = sp.spellsPerDay[l];
                return (
                  <div className="spellbox" key={l}>
                    <div className="spellbox-head">
                      <b>{l === 0 ? "戏法" : `${l} 环`}</b>
                      <span className="muted small">
                        {perDay != null ? `每日 ${perDay}` : ""}
                        {cap != null && perDay != null ? " · " : ""}
                        {cap != null ? `已知上限 ${cap}` : ""}
                      </span>
                    </div>
                    <div className="spellbox-body">
                      {got.length === 0 && <span className="muted small">（未选）</span>}
                      {got.map((id) => (
                        <span className="spell-chip" key={id} title={db.spells[id]?.desc || ""}>
                          {label(db.spells[id])}
                          <i className="x" onClick={() => act.toggleSpell(sp.classId, id)}>×</i>
                        </span>
                      ))}
                    </div>
                    {cap != null && <Meter used={got.length} total={cap} />}
                    <button
                      type="button"
                      className="btn sm"
                      disabled={pool.length === 0}
                      onClick={() => setOpen({ classId: sp.classId, level: l })}
                    >
                      {pool.length === 0 ? "该环没有法术" : `挑法术（${pool.length}）`}
                    </button>
                  </div>
                );
              })}
            </div>

            {bonus.length > 0 && (
              <div className="mt8">
                <div className="muted small">领域/血统/庇护主额外送的法术：</div>
                <div className="row wrap">
                  {bonus.map((b, i) => <Chip key={i} tone="ok">{b}</Chip>)}
                </div>
              </div>
            )}
          </Panel>
        );
      })}

      {open && (
        <PickModal
          db={db}
          title={`${derived.spells.find((s) => s.classId === open.classId)?.className} ${open.level} 环`}
          ids={(derived.spells.find((s) => s.classId === open.classId)?.byLevel[open.level] || []).map((s) => s.id)}
          value={null}
          verdict={() => "ok"}
          multi
          selected={new Set(build.spells[open.classId] || [])}
          onToggle={(id) => act.toggleSpell(open!.classId, id)}
          onPick={() => undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** 从已拥有的特性里收集「额外送的法术」 */
function bonusSpells(db: Db, d: ReturnType<typeof derive>): string[] {
  const out: string[] = [];
  for (const id of d.owned.ids) {
    const f = db.features[id];
    if (!f) continue;
    for (const ks of f.knownSpells || []) {
      const s = db.spells[ks.id];
      if (s) out.push(`${s.name}${ks.level != null ? `（${ks.level} 环）` : ""}`);
    }
    for (const lid of f.spellLists || []) {
      const sl = db.spellLists[lid];
      if (!sl) continue;
      for (const [lv, arr] of Object.entries(sl.levels || {})) {
        for (const sid of arr) {
          const s = db.spells[sid];
          if (s) out.push(`${s.name}（${lv} 环）`);
        }
      }
    }
  }
  return Array.from(new Set(out));
}
