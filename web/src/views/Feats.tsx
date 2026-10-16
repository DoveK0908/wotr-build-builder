import React, { useMemo, useState } from "react";
import type { AttrId, Db } from "../types";
import { act, useBuild } from "../store";
import {
  choiceVerdict, derive, featuresAtClassLevel, label, levelCtxList, levelRootSlots,
} from "../rules";
import { Chip, Collapse, Panel, SearchSelect } from "../ui";
import { SlotChain } from "../pick";

const ATTR_LEVELS = [4, 8, 12, 16, 20];

/** 第 ⑥ 步：逐级把专长 / 职业选择填满（选择里面还可能有选择；参数化专长要选参数） */
export function Feats(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const ctxs = useMemo(() => levelCtxList(db, build, derived), [db, build, derived]);
  const [onlyUnfinished, setOnlyUnfinished] = useState(false);

  const running: Record<string, number> = {};
  let totalMissing = 0;

  return (
    <div>
      <Panel
        title="⑥ 专长与逐级选择"
        sub="每一级要选的东西都在这里：职业给的专长/能力、奇数级的通用专长，还有选择项本身又是选择表的（会继续往下展开）"
        right={
          <label className="cl-only">
            <input type="checkbox" checked={onlyUnfinished} onChange={(e) => setOnlyUnfinished(e.target.checked)} />
            只看没选完的
          </label>
        }
      >
        <div className="row wrap">
          {Object.entries(derived.classLevels).map(([cid, n]) => (
            <Chip key={cid}>{label(db.classes[cid])} {n} 级</Chip>
          ))}
        </div>
        <div className="muted small mt8">
          没选完的槽位会标红；改掉上层选择后，下层已经不可达的旧选择会自动丢掉（不会偷偷留着生效）。
        </div>
      </Panel>

      <div className="lvlist">
        {build.levels.map((lv, idx) => {
          const level = idx + 1;
          const ctx = ctxs[idx];
          if (lv.classId) running[lv.classId] = (running[lv.classId] || 0) + 1;
          const classLvl = lv.classId ? running[lv.classId] : 0;
          const archList = build.classArchetypes[lv.classId || ""] || [];
          const autoIds = lv.classId ? featuresAtClassLevel(db, lv.classId, classLvl, archList) : [];
          const uniqSlots = levelRootSlots(db, build, level);
          const missing = uniqSlots.filter((s) => !lv.picks[s.id]).length;
          totalMissing += missing;

          if (onlyUnfinished && missing === 0) return null;

          return (
            <section className={"lvcard" + (lv.classId ? "" : " empty")} key={idx}>
              <header className="lvhead">
                <span className="lvnum">{level}</span>
                <span className="lvcls">
                  {lv.classId ? label(db.classes[lv.classId]) : "未选职业"}
                  {lv.classId && classLvl > 0 ? ` 第 ${classLvl} 级` : ""}
                </span>
                {ATTR_LEVELS.includes(level) && (
                  <span className="lvattr">
                    属性 +1：
                    <SearchSelect
                      value={lv.ability || null}
                      options={db.rules.attributes.map((a) => ({ id: a.id, label: a.name }))}
                      onChange={(v) => act.setAbility(level, v as AttrId | null)}
                      placeholder="未选"
                      width={120}
                    />
                  </span>
                )}
                <span className="spacer" />
                {missing > 0 && <Chip tone="no">{missing} 项未选</Chip>}
              </header>

              {uniqSlots.length > 0 && (
                <div className="slots">
                  {uniqSlots.map((s) => (
                    <SlotChain
                      key={s.id}
                      db={db}
                      root={s}
                      picks={lv.picks}
                      verdict={(fid) => choiceVerdict(db, ctx, fid)}
                      onChange={(slotId, v) => act.setPick(level, slotId, v)}
                    />
                  ))}
                </div>
              )}

              {/* 参数化专长的参数（武器、法术学派、法术专攻…） */}
              {Object.entries(lv.picks).map(([sid, cid]) => {
                const f = db.features[cid];
                if (!f?.param) return null;
                const variants = f.paramVariants || [];
                if (!variants.length) return null;
                return (
                  <div className="param" key={sid}>
                    <span className="muted small">{label(f)} 的参数（{f.param}）：</span>
                    <SearchSelect
                      value={lv.params[f.id] || null}
                      options={mergeParamOptions(variants)}
                      onChange={(v) => act.setParam(level, f.id, v)}
                      placeholder="选择参数"
                      width={220}
                    />
                  </div>
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
            </section>
          );
        })}
      </div>

      {totalMissing === 0 && <div className="muted small">全部槽位都填好了。</div>}
    </div>
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
