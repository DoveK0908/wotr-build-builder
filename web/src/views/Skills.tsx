import React, { useMemo, useState } from "react";
import type { Db } from "../types";
import { act, useBuild } from "../store";
import { derive, attrMod, num } from "../rules";
import { Chip, Meter, NumBox } from "../ui";
import { ListPane, ListRow, PinBar, Sect, StatBox, StatRows, ThreePane } from "../pane";

/** 第 ⑤ 步：技能 */
export function Skills(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const [hover, setHover] = useState<string | null>(null);
  /** 点一下锁定在这一项（再点一次取消）；锁住后不再跟着鼠标跑 */
  const [pinned, setPinned] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const d = useMemo(() => derive(db, build), [db, build]);
  const cls = Object.keys(d.classLevels);

  const classSkillIds = useMemo(() => {
    const s = new Set<string>();
    for (const cid of cls) {
      const c = db.classes[cid];
      for (const k of c?.classSkills || []) s.add(k);
    }
    return s;
  }, [db, cls.join(",")]);

  const focusId = pinned || hover || d.skills[0]?.id || null;
  const focus = d.skills.find((s) => s.id === focusId) || null;

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return d.skills;
    return d.skills.filter((s) => (s.name + " " + (s.nameEn || "")).toLowerCase().includes(kw));
  }, [d.skills, q]);

  const attrOf = (id?: string) => db.rules.attributes.find((a) => a.id === id);

  return (
    <ThreePane
      left={
        <ListPane
          title="技能"
          search={q}
          onSearch={setQ}
          foot={<span>已投 {d.skillSpent} / {d.skillPointsTotal} 点</span>}
        >
          {list.map((s) => {
            const isClass = classSkillIds.has(s.id) || s.classSkill;
            return (
              <ListRow
                key={s.id}
                glyph={s.name.slice(0, 1)}
                name={s.name}
                sub={s.nameEn}
                num={
                  <span className="bold">
                    {s.total >= 0 ? "+" : ""}
                    {s.total}
                  </span>
                }
                badge={isClass ? <span className="badge ok">本职</span> : undefined}
                sel={focusId === s.id}
                title={pinned === s.id ? "点击取消固定" : "点击固定这一项"}
                onHover={() => setHover(s.id)}
                onClick={() => setPinned((cur) => (cur === s.id ? null : s.id))}
              />
            );
          })}
        </ListPane>
      }
      center={
        !focus ? (
          <div className="muted">没有技能。</div>
        ) : (
          <>
            <div className="row wrap" style={{ marginBottom: 6 }}>
              <Meter used={d.skillSpent} total={d.skillPointsTotal} label="技能点" />
            </div>

            <div className="dhead big">
              <span className="dhead-glyph">{focus.name.slice(0, 1)}</span>
              <div className="dhead-txt">
                <h3 className="dhead-title">{focus.name}</h3>
                <div className="dhead-en">
                  {focus.nameEn}　·　{attrOf(focus.attr)?.name || focus.attr}
                </div>
              </div>
              {(classSkillIds.has(focus.id) || focus.classSkill) && (
                <div className="dhead-sub">
                  <Chip tone="ok">本职技能</Chip>
                </div>
              )}
            </div>

            <PinBar
              pinned={pinned === focus.id}
              onUnpin={() => {
                setHover(focus.id);
                setPinned(null);
              }}
            />

            <Sect title="投入点数">
              <div className="row">
                <NumBox value={focus.ranks} min={0} max={d.level} onChange={(v) => act.setSkill(focus.id, v)} />
                <span className="muted small" style={{ marginLeft: 8 }}>
                  上限 = 角色等级 {d.level}（游戏规则：单技能等级不得超过角色等级）
                </span>
              </div>
            </Sect>

            <Sect title="加值构成">
              <StatRows
                items={[
                  [
                    "属性",
                    `${attrOf(focus.attr)?.name || focus.attr}（${
                      attrMod(d.attrs[focus.attr] ?? 10) >= 0 ? "+" : ""
                    }${attrMod(d.attrs[focus.attr] ?? 10)}）`,
                  ],
                  ["投入", `${focus.ranks} 级`],
                  ["本职加值", classSkillIds.has(focus.id) || focus.classSkill ? "+3" : "0"],
                  ["其它", `${focus.bonus >= 0 ? "+" : ""}${focus.bonus}`],
                ]}
              />
              <div className="row" style={{ marginTop: 6 }}>
                <span className="kv">
                  总加值 <b>{focus.total >= 0 ? "+" : ""}{focus.total}</b>
                </span>
              </div>
            </Sect>

            <div className="muted small mt8">
              技能加值 = 投入等级 + 属性调整 + 本职 +3（投入 ≥ 1 时）+ 其它来源。
              游戏里属性调整来自上面「属性值」步骤，改属性会立刻反映到这里。
            </div>
          </>
        )
      }
      right={
        <>
          <Sect title="技能点">
            <StatBox
              cols={2}
              items={[
                { k: "已投", v: d.skillSpent },
                { k: "可用", v: d.skillPointsTotal },
                { k: "剩余", v: d.skillPointsTotal - d.skillSpent },
                { k: "每级基础", v: cls.map((c) => num(db.classes[c]?.skillPoints, 2)).join(" / ") || "—" },
              ]}
            />
            <div className="muted small" style={{ marginTop: 6 }}>
              技能点 = 每级（职业基础 + 智力调整）累计，升级表与专长带来的额外技能点也会算进去。
            </div>
          </Sect>

          <Sect title="全部技能">
            <StatRows
              items={d.skills.map((s) => [
                s.name,
                <span key="v">
                  {s.ranks > 0 ? `${s.ranks} ` : ""}
                  <span className="bold">
                    {s.total >= 0 ? "+" : ""}
                    {s.total}
                  </span>
                </span>,
              ])}
              dense
            />
          </Sect>

          <Sect title="操作">
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => act.patch((b) => { b.skills = {}; })}
            >
              清空全部投入
            </button>
          </Sect>
        </>
      }
    />
  );
}
