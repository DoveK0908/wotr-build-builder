import React, { useMemo } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { alignAllows, alignConflicts, alignNeedText, alignTokensOf, label } from "../rules";
import { Chip, Desc, Field, Panel, SearchSelect } from "../ui";

/** 第 ⑧ 步：神祇（会限制阵营，牧师/战斗祭司等还需要它才能开领域） */
export function Deity(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const rules = db.rules;

  const deitySlot = rules.deitySelection ? db.features[rules.deitySelection] : null;

  const deityOpts = useMemo(() => {
    return (deitySlot?.choices || []).map((id) => {
      const f = db.features[id];
      const toks = alignTokensOf(f?.prereq);
      const bad = !alignAllows(build.alignment, toks);
      return {
        id,
        label: label(f),
        hint: bad ? `需要 ${alignNeedText(db, toks)}` : f?.nameEn,
        disabled: bad,
        badge: bad ? "阵营不符" : undefined,
      };
    });
  }, [db, deitySlot, build.alignment]);

  const chosen = build.deity ? db.features[build.deity] : null;
  const conflicts = useMemo(() => alignConflicts(db, build), [db, build]);

  return (
    <Panel
      title="⑧ 神祇"
      sub={`共 ${(deitySlot?.choices || []).length} 个可选信仰；每个神祇都限定阵营，神祇还会决定你开得出哪些领域`}
    >
      <Field label="信仰">
        <SearchSelect
          value={build.deity}
          options={deityOpts}
          onChange={(v) => act.setDeity(v)}
          placeholder="选择信仰"
          width={260}
        />
      </Field>

      {chosen && (
        <div className="mt8">
          <div className="row wrap">
            <Chip>{label(chosen)}</Chip>
            {alignTokensOf(chosen.prereq).length > 0 && (
              <Chip>只接受 {alignNeedText(db, alignTokensOf(chosen.prereq))}</Chip>
            )}
          </div>
          <Desc text={chosen.desc} limit={700} />
        </div>
      )}

      {build.deity && conflicts.some((c) => c.includes("神祇")) && (
        <div className="row wrap mt8">
          {conflicts.filter((c) => c.includes("神祇")).map((c) => (
            <Chip key={c} tone="no">{c}</Chip>
          ))}
        </div>
      )}

      <div className="muted small mt8">
        游戏里神祇选定后不能更改，这里刻意允许随时改，方便对比不同信仰的构筑；
        改动后职业、变体、阵营与领域的限制会立刻按新信仰重判。
      </div>
    </Panel>
  );
}
