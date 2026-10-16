import React, { useMemo } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { choiceVerdict, derive, expandFeature, featuresAtClassLevel, label, levelCtxList } from "../rules";
import { Chip, Panel } from "../ui";
import { SlotChain } from "../pick";

/**
 * 动态子步骤（游戏里选定职业后顶部多出来的那些牌匾）：
 * 一个职业自己那条选择线，例如先知的「先知诅咒 / 秘示域 / 启示 / 额外法术」、
 * 法师的「专精学派 / 奥法契约」、操念使的「元素专攻 / 注能 / 原力」。
 */
export function ClassFeature(props: { db: Db; slotId: string; classId: string }) {
  const { db, slotId, classId } = props;
  const build = useBuild();
  const derived = useMemo(() => derive(db, build), [db, build]);
  const ctxs = useMemo(() => levelCtxList(db, build, derived), [db, build, derived]);
  const slot = db.features[slotId];
  const cls = db.classes[classId];

  // 这个职业在哪些等级会发放这个槽位
  const rows = useMemo(() => {
    const out: { idx: number; level: number; classLevel: number }[] = [];
    let cl = 0;
    build.levels.forEach((lv, idx) => {
      if (lv.classId !== classId) return;
      cl += 1;
      const archs = build.classArchetypes[classId] || [];
      const ids = featuresAtClassLevel(db, classId, cl, archs);
      if (ids.some((id) => expandFeature(db, id).includes(slotId))) {
        out.push({ idx, level: idx + 1, classLevel: cl });
      }
    });
    return out;
  }, [db, build, classId, slotId]);

  if (!slot || !cls) return <div className="muted">找不到这个槽位。</div>;

  const chosen = rows.map((r) => build.levels[r.idx].picks[slotId]).filter(Boolean);

  return (
    <div>
      <Panel
        title={label(slot)}
        sub={slot.desc || `${label(cls)} 的职业选择`}
        right={<Chip tone={chosen.length === rows.length && rows.length ? "ok" : undefined}>
          {chosen.length} / {rows.length}
        </Chip>}
      >
        <div className="muted small">
          属于「{label(cls)}」· 可选 {slot.choices?.length || 0} 项
          {slot.ignorePrereq ? " · 这个槽位游戏里不检查前置条件" : ""}
        </div>
      </Panel>

      <div className="lvlist">
        {rows.map((r) => (
          <section className="lvcard" key={r.idx}>
            <header className="lvhead">
              <span className="lvnum">{r.level}</span>
              <span className="lvcls">
                {label(cls)} 第 {r.classLevel} 级
              </span>
              <span className="spacer" />
              {!build.levels[r.idx].picks[slotId] && <Chip tone="no">未选</Chip>}
            </header>
            <div className="slots">
              <SlotChain
                db={db}
                root={slot}
                picks={build.levels[r.idx].picks}
                verdict={(fid) => choiceVerdict(db, ctxs[r.idx], fid)}
                onChange={(sid, v) => act.setPick(r.idx, sid, v)}
              />
            </div>
          </section>
        ))}
        {!rows.length && (
          <div className="muted small">
            这个职业还没排到发放「{label(slot)}」的等级。
          </div>
        )}
      </div>
    </div>
  );
}
