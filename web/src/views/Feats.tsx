import React, { useMemo, useState } from "react";
import type { AttrId, Db } from "../types";
import { act, useBuild } from "../store";
import {
  choiceVerdict, derive, featuresAtClassLevel, label, levelCtxList, levelRootSlots,
} from "../rules";
import { Chip, Collapse, SearchSelect } from "../ui";
import { SlotChain } from "../pick";
import { DetailHead, ListPane, ListRow, Sect, StatBox, StatRows, ThreePane } from "../pane";
import { featureIcon } from "../skin";
import { stepGlyph } from "../steps";

const ATTR_LEVELS = [4, 8, 12, 16, 20];

/** 第 ⑥ 步：逐级把专长 / 职业选择填满（选择里面还可能有选择；参数化专长要选参数） */
export function Feats(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const ctxs = useMemo(() => levelCtxList(db, build, derived), [db, build, derived]);
  const [onlyUnfinished, setOnlyUnfinished] = useState(false);
  const firstEmpty = build.levels.findIndex((l) => !l.classId);
  const [sel, setSel] = useState<number | null>(null);

  const running: Record<string, number> = {};
  const info = build.levels.map((lv, idx) => {
    const level = idx + 1;
    if (lv.classId) running[lv.classId] = (running[lv.classId] || 0) + 1;
    const classLvl = lv.classId ? running[lv.classId] : 0;
    const uniqSlots = levelRootSlots(db, build, level);
    const missing = uniqSlots.filter((s) => !lv.picks[s.id]).length;
    return { idx, level, lv, classLvl, uniqSlots, missing };
  });

  const totalMissing = info.reduce((a, i) => a + i.missing, 0);
  const fallback = info.find((i) => i.missing > 0)?.level || (firstEmpty < 0 ? 20 : firstEmpty + 1);
  const cur = info[(sel ?? fallback) - 1] || info[info.length - 1];
  const ctx = ctxs[cur.idx];
  const archList = (cur.lv.classId && build.classArchetypes[cur.lv.classId]) || [];
  const autoIds = cur.lv.classId ? featuresAtClassLevel(db, cur.lv.classId, cur.classLvl, archList) : [];
  const cls = cur.lv.classId ? db.classes[cur.lv.classId] : null;

  const rows = onlyUnfinished ? info.filter((i) => i.missing > 0) : info;

  return (
    <ThreePane
      left={
        <ListPane
          title={
            <span className="row" style={{ gap: 8 }}>
              逐级选择
              <label className="cl-only small" style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={onlyUnfinished}
                  onChange={(e) => setOnlyUnfinished(e.target.checked)}
                />
                只看没选完的
              </label>
            </span>
          }
          foot={
            <span>
              未选 {totalMissing} 项　·　{Object.entries(derived.classLevels).length} 个职业
            </span>
          }
        >
          {rows.map((i) => (
            <ListRow
              key={i.level}
              ico={i.lv.classId ? featureIcon(db, i.lv.classId) : null}
              glyph={stepGlyph("class")}
              name={`第 ${i.level} 级`}
              sub={
                i.lv.classId
                  ? `${label(db.classes[i.lv.classId])}${i.classLvl > 1 ? ` 第 ${i.classLvl} 级` : ""}`
                  : "未选职业"
              }
              num={i.uniqSlots.length > 0 ? `${i.uniqSlots.length - i.missing}/${i.uniqSlots.length}` : undefined}
              badge={i.missing > 0 ? <span className="badge no">{i.missing} 项未选</span> : undefined}
              sel={cur.level === i.level}
              onClick={() => setSel(i.level)}
            />
          ))}
        </ListPane>
      }
      center={
        <>
          <DetailHead
            ico={cur.lv.classId ? featureIcon(db, cur.lv.classId) : null}
            glyph={stepGlyph("class")}
            title={`第 ${cur.level} 级${cls ? `　${label(cls)}` : ""}`}
            en={cls ? `${cls.nameEn}${cur.classLvl > 1 ? `　第 ${cur.classLvl} 级` : ""}` : "还没选职业"}
            big
          />

          {ATTR_LEVELS.includes(cur.level) && (
            <Sect title="属性提升 +1（4 / 8 / 12 / 16 / 20 级）">
              <div className="row">
                <SearchSelect
                  value={cur.lv.ability || null}
                  options={db.rules.attributes.map((a) => ({ id: a.id, label: a.name }))}
                  onChange={(v) => act.setAbility(cur.idx, v as AttrId | null)}
                  placeholder="未选"
                  width={160}
                />
                {!cur.lv.ability && <Chip tone="no">这一级还没选要提升哪项属性</Chip>}
              </div>
            </Sect>
          )}

          {cur.uniqSlots.length > 0 && (
            <Sect title={`这一级要选（${cur.uniqSlots.length}）`}>
              <div className="slots">
                {cur.uniqSlots.map((s) => (
                  <SlotChain
                    key={s.id}
                    db={db}
                    root={s}
                    picks={cur.lv.picks}
                    verdict={(fid) => choiceVerdict(db, ctx, fid)}
                    onChange={(slotId, v) => act.setPick(cur.idx, slotId, v)}
                  />
                ))}
              </div>
            </Sect>
          )}

          {cur.uniqSlots.length === 0 && (
            <div className="muted" style={{ marginTop: 8 }}>
              这一级没有要做的选择{cls ? "" : "（先在「职业」步骤排这一级的职业）"}。
            </div>
          )}

          {Object.entries(cur.lv.picks).map(([sid, cid]) => {
            const f = db.features[cid];
            if (!f?.param) return null;
            const variants = f.paramVariants || [];
            if (!variants.length) return null;
            return (
              <Sect key={sid} title={`${label(f)} 的参数（${f.param}）`}>
                <SearchSelect
                  value={cur.lv.params[f.id] || null}
                  options={mergeParamOptions(variants)}
                  onChange={(v) => act.setParam(cur.idx, f.id, v)}
                  placeholder="选择参数"
                  width={260}
                />
              </Sect>
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

          <div className="muted small mt8">
            没选完的槽位会标红；改掉上层选择后，下层已经不可达的旧选择会自动丢掉（不会偷偷留着生效）。
            职业给的专长/能力、奇数级的通用专长都在这里。
          </div>
        </>
      }
      right={
        <>
          <Sect title="进度">
            <StatBox
              cols={2}
              items={[
                { k: "已排等级", v: `${derived.level} / 20` },
                { k: "未选项", v: totalMissing },
                { k: "本级要选", v: cur.uniqSlots.length },
                { k: "本级未选", v: cur.missing },
              ]}
            />
          </Sect>

          <Sect title="这一级的职业特性">
            {autoIds.length === 0 ? (
              <div className="muted small">—</div>
            ) : (
              <StatRows items={autoIds.map((id) => [label(db.features[id]), ""])} dense />
            )}
          </Sect>

          <Sect title="已排职业">
            <StatRows
              items={Object.entries(derived.classLevels).map(([cid, n]) => [label(db.classes[cid]), `${n} 级`])}
              dense
            />
          </Sect>
        </>
      }
    />
  );
}

/** 从参数标签里把「名字|guid」拆成选项 */
function mergeParamOptions(variants: string[]) {
  const seen = new Set<string>();
  const out: { id: string; label: string; hint?: string }[] = [];
  for (const v of variants) {
    const [nm, gid] = v.split("|");
    const id = gid || nm;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: nm, hint: gid ? undefined : nm });
  }
  return out;
}
