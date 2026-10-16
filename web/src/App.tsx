import React, { useEffect, useMemo, useState } from "react";
import type { Db } from "./types";
import { loadDb } from "./load";
import { act, deserialize, shareUrl, useBuild } from "./store";
import { attrMod, derive } from "./rules";
import {
  STEPS, allSteps, normalizeStep, stepFilled, stepGlyph, stepNote, stepValue, stepWarn,
} from "./steps";
import type { Step } from "./steps";
import { featureIcon, stepUiIcon, useSkin, toggleSkin } from "./skin";
import { Align } from "./views/Align";
import { Attrs } from "./views/Attrs";
import { Background } from "./views/Background";
import { ClassFeature } from "./views/ClassFeature";
import { ClassPlan } from "./views/ClassPlan";
import { Deity } from "./views/Deity";
import { Feats } from "./views/Feats";
import { Mythic } from "./views/Mythic";
import { Race } from "./views/Race";
import { Skills } from "./views/Skills";
import { Spells } from "./views/Spells";
import { Summary } from "./views/Summary";
import { PresetPicker } from "./views/Presets";

export function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [err, setErr] = useState("");
  const [pct, setPct] = useState(0);
  const [presetsOpen, setPresetsOpen] = useState(() => /[#&]presets=1/.test(location.hash));
  const [doneMsg, setDoneMsg] = useState("");
  const [step, setStep] = useState(() => {
    const m = /[#&]tab=([A-Za-z0-9:_-]+)/.exec(location.hash);
    return normalizeStep(m ? m[1] : null);
  });
  const build = useBuild();
  const skin = useSkin();

  useEffect(() => {
    loadDb((p) => setPct(Math.round((p.done / p.total) * 100))).then(setDb).catch((e) => setErr(String(e)));
  }, []);

  // 打开时如果链接里带了构筑代码，就读进来
  useEffect(() => {
    const m = /[#&]b=([A-Za-z0-9\-_]+)/.exec(location.hash);
    if (!m) return;
    const b = deserialize(m[1]);
    if (b) act.load(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const u = new URL(location.href);
    const h = u.hash.replace(/^#/, "").split("&").filter((x) => x && !x.startsWith("tab="));
    h.unshift("tab=" + step);
    u.hash = h.join("&");
    history.replaceState(null, "", u.toString());
  }, [step]);

  const derived = useMemo(() => (db ? derive(db, build) : null), [db, build]);
  const steps = useMemo(() => (db ? allSteps(db, build) : STEPS), [db, build]);

  if (err) {
    return (
      <div className="boot err">
        <h1>数据没加载起来</h1>
        <p>{err}</p>
        <p className="muted">
          先把游戏数据导出来：在项目根目录跑 <code>python pipeline\build_data.py</code>，
          它会生成 <code>web/public/data/*.json</code>。
        </p>
      </div>
    );
  }

  if (!db || !derived) {
    return (
      <div className="boot">
        <h1>《开拓者：正义之怒》构筑规划器</h1>
        <p className="muted">正在读取游戏数据… {pct}%</p>
      </div>
    );
  }

  const meta = db.meta;
  const idx = Math.max(0, steps.findIndex((s) => s.id === step));
  const cur = steps[idx] || steps[0];
  const notes = steps.map((s) => ({ id: s.id, note: stepNote(db, build, derived, s.id) }));
  const curNote = notes[idx]?.note || "";
  const go = (i: number) => setStep(steps[Math.min(steps.length - 1, Math.max(0, i))].id);
  /** 最后一步的「完成」：把分享链接放进剪贴板（游戏里这一步是收尾页） */
  const last = idx >= steps.length - 1;
  const finish = () => {
    const url = shareUrl(build);
    navigator.clipboard?.writeText(url).then(
      () => setDoneMsg("构筑完成：分享链接已复制到剪贴板"),
      () => setDoneMsg("构筑完成（分享链接：" + url + "）"),
    );
  };
  const attr = db.rules.attributes;
  /** 牌匾上的小图标：动态步骤用该槽位自己的内容图标，固定步骤用游戏自带的界面图标 */
  const pngOf = (s: Step): string | null =>
    s.dynamic && s.slotId ? featureIcon(db, s.slotId) : stepUiIcon(s.id);

  return (
    <div className="app" data-skin={skin}>
      {/* 最外层的深色木框：书以外的东西都放在这条细带上 */}
      <div className="topstrip">
        <span className="strip-logo">⚔</span>
        <span className="strip-title">《开拓者：正义之怒》构筑规划器</span>
        <span className="muted small">
          {meta.counts.classes} 职业 / {meta.counts.archetypes} 变体 / {meta.counts.features} 特性 /{" "}
          {meta.counts.spells} 法术
        </span>
        <span className="spacer" />
        <span className="muted small">
          {build.name || "未命名"} · {derived.level}/20 · 神话 {derived.rank}/10
        </span>
        <button className="btn sm ghost" type="button" onClick={toggleSkin} title="切换皮肤：游戏素材 / 纯 CSS">
          {skin === "game" ? "素材皮" : "素色皮"}
        </button>
        <button className="btn sm" type="button" onClick={() => setPresetsOpen(true)}>
          预置构筑
        </button>
      </div>

      <div className="book-frame">
        <div className="book-page">
          {/* 顶部牌匾步骤条（游戏里就是这一条，选定职业后会插入该职业自己的牌匾） */}
          <nav className="plaquebar">
            <button className="pq-nav" type="button" title="第一步" onClick={() => go(0)}>
              «
            </button>
            <button className="pq-nav" type="button" title="上一步" onClick={() => go(idx - 1)}>
              ‹
            </button>
            <div className="pq-scroll">
              {/* 游戏里牌匾条最前面那块是进度计数（升级时是「N 等级」，神话时是「神话 等级 N」） */}
              <div className="pq-counter" title={`角色等级 ${derived.level} / ${db.rules.levelRange?.[1] || 20}`}>
                <b>{derived.level}</b>
                <span>等级</span>
              </div>
              {steps.map((s) => {
                const val = stepValue(db, build, derived, s.id);
                const filled = stepFilled(db, build, derived, s.id);
                const n = notes.find((x) => x.id === s.id);
                return (
                  <div className={"pq-wrap" + (step === s.id ? " on" : "") + (s.dynamic ? " dyn" : "")} key={s.id}>
                    <button className="pq" type="button" title={s.hint} onClick={() => setStep(s.id)}>
                      {pngOf(s) ? (
                        <img className="pq-img" src={pngOf(s)!} alt="" />
                      ) : (
                        <i className="pq-ico">{stepGlyph(s.id, s.name)}</i>
                      )}
                      <span className="pq-name">{s.name}</span>
                    </button>
                    {val ? (
                      <button className="pq-val" type="button" title={val} onClick={() => setStep(s.id)}>
                        {val}
                      </button>
                    ) : (
                      <span className={"pq-plus" + (filled ? " done" : "")}>{filled ? "✓" : "＋"}</span>
                    )}
                    {n && n.note && (
                      <i className={"dot" + (stepWarn(s.id, n.note) ? " warn" : "")} title={n.note} />
                    )}
                  </div>
                );
              })}
            </div>
            <button className="pq-nav" type="button" title="下一步" onClick={() => go(idx + 1)}>
              ›
            </button>
            <button className="pq-nav" type="button" title="最后一步" onClick={() => go(steps.length - 1)}>
              »
            </button>

            {/* 条尾那组数值（游戏里也在这一条上） */}
            <div className="pq-stats">
              <div className="pq-attrs">
                {attr.map((a) => {
                  const v = derived.attrs[a.id as keyof typeof derived.attrs] || 0;
                  return (
                    <span className="pq-attr" key={a.id}>
                      <i>{a.short || a.name}</i>
                      <b>{v}</b>
                      <em>{attrMod(v) >= 0 ? `+${attrMod(v)}` : attrMod(v)}</em>
                    </span>
                  );
                })}
              </div>
              <span className="pq-badge" title="购点总数">
                {db.rules.pointBuyTotal || 25}
              </span>
              <span className="pq-badge" title="已排等级">
                {derived.level}
              </span>
            </div>
          </nav>

          <div className="book-body">
            <main className="detail-pane">
              <div className="stephead">
                <h2>
                  {cur.num} {cur.name}
                </h2>
                <div className="muted small">{cur.hint}</div>
                {curNote && (
                  <span className={"chip " + (stepWarn(cur.id, curNote) ? "chip-no" : "chip-warn")}>{curNote}</span>
                )}
              </div>

              {cur.dynamic && cur.slotId && cur.classId ? (
                <ClassFeature db={db} slotId={cur.slotId} classId={cur.classId} />
              ) : (
                <>
                  {step === "class" && <ClassPlan db={db} />}
                  {step === "race" && <Race db={db} />}
                  {step === "background" && <Background db={db} />}
                  {step === "attrs" && <Attrs db={db} />}
                  {step === "skills" && <Skills db={db} />}
                  {step === "feats" && <Feats db={db} />}
                  {step === "spells" && <Spells db={db} />}
                  {step === "deity" && <Deity db={db} />}
                  {step === "align" && <Align db={db} />}
                  {step === "mythic" && <Mythic db={db} />}
                  {step === "summary" && <Summary db={db} />}
                </>
              )}
            </main>
          </div>

          {/* 底部导航（游戏里是 返回 / 下一项 + 右侧一个上下文按钮） */}
          <div className="book-foot">
            <div className="foot-nav">
              <button className="fbtn" type="button" disabled={idx === 0} onClick={() => go(0)}>
                «
              </button>
              <button className="fbtn" type="button" disabled={idx === 0} onClick={() => go(idx - 1)}>
                ‹
              </button>
              <button className="fbtn wide" type="button" disabled={idx === 0} onClick={() => go(idx - 1)}>
                返回
              </button>
              <button
                className="fbtn wide"
                type="button"
                disabled={!last && idx >= steps.length - 1}
                onClick={last ? finish : () => go(idx + 1)}
              >
                {last ? "完成" : "下一项"}
              </button>
              <button className="fbtn" type="button" disabled={idx >= steps.length - 1} onClick={() => go(idx + 1)}>
                ›
              </button>
              <button className="fbtn" type="button" disabled={idx >= steps.length - 1} onClick={() => go(steps.length - 1)}>
                »
              </button>
              <span className="foot-note muted small">
                {doneMsg
                  ? doneMsg
                  : derived.unfinished.length > 0
                    ? `还有 ${derived.unfinished.length} 项待处理`
                    : "没有待处理项"}
              </span>
            </div>
            {!last && (
              <button
                className="fbtn right"
                type="button"
                onClick={() => setStep(cur.id === "class" ? "summary" : cur.id === "spells" ? "spells" : "class")}
              >
                {cur.id === "class" ? "总结" : cur.id === "spells" ? "法术书" : "职业成长"}
              </button>
            )}
          </div>
        </div>
      </div>

      {presetsOpen && <PresetPicker db={db} onClose={() => setPresetsOpen(false)} />}
    </div>
  );
}
