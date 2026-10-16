import React, { useEffect, useMemo, useState } from "react";
import type { Db } from "./types";
import { loadDb } from "./load";
import { act, deserialize, useBuild } from "./store";
import { derive } from "./rules";
import { STEPS, normalizeStep, stepNote, stepWarn } from "./steps";
import { Align } from "./views/Align";
import { Attrs } from "./views/Attrs";
import { Background } from "./views/Background";
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
  const [step, setStep] = useState(() => {
    const m = /[#&]tab=([a-z]+)/.exec(location.hash);
    return normalizeStep(m ? m[1] : null);
  });
  const build = useBuild();

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
  const idx = STEPS.findIndex((s) => s.id === step);
  const cur = STEPS[idx] || STEPS[0];
  const notes = STEPS.map((s) => ({ id: s.id, note: stepNote(db, build, derived, s.id) }));

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">⚔</span>
          <div>
            <h1>《开拓者：正义之怒》构筑规划器</h1>
            <div className="muted small">
              数据来自本机游戏本体 · {meta.counts.classes} 职业 / {meta.counts.archetypes} 变体 /{" "}
              {meta.counts.features} 特性 / {meta.counts.spells} 法术
            </div>
          </div>
        </div>
        <div className="top-right">
          <button className="btn sm" type="button" onClick={() => setPresetsOpen(true)}>
            预置构筑
          </button>
          <span className="muted small">
            {build.name || "未命名"} · {derived.level}/20 · 神话 {derived.rank}/10
          </span>
        </div>
      </header>

      <nav className="tabs steps">
        {STEPS.map((s) => {
          const n = notes.find((x) => x.id === s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={"tab" + (step === s.id ? " on" : "")}
              onClick={() => setStep(s.id)}
              title={s.hint}
            >
              <i className="num">{s.num}</i>
              {s.name}
              {n && n.note && <i className={"dot" + (stepWarn(s.id, n.note) ? " warn" : "")} title={n.note} />}
            </button>
          );
        })}
      </nav>

      {presetsOpen && <PresetPicker db={db} onClose={() => setPresetsOpen(false)} />}

      <main className="main">
        <div className="stephead">
          <div>
            <h2>{cur.num} {cur.name}</h2>
            <div className="muted small">{cur.hint}</div>
          </div>
          {(() => {
            const n = notes[idx];
            return n && n.note ? (
              <span className={"chip " + (stepWarn(cur.id, n.note) ? "chip-no" : "chip-warn")}>{n.note}</span>
            ) : null;
          })()}
        </div>

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
        {step === "summary" && <Summary db={db} build={build} derived={derived} />}

        <div className="row mt8 steppers">
          <button
            className="btn sm ghost"
            type="button"
            disabled={idx === 0}
            onClick={() => setStep(STEPS[Math.max(0, idx - 1)].id)}
          >
            ← 上一步
          </button>
          <button
            className="btn sm"
            type="button"
            disabled={idx === STEPS.length - 1}
            onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)].id)}
          >
            下一步 →
          </button>
          <span className="spacer" />
          <span className="muted small">
            {derived.unfinished.length > 0 ? `还有 ${derived.unfinished.length} 项待处理` : "没有待处理项"}
          </span>
        </div>
      </main>

      <footer className="foot">
        <span className="muted small">
          非官方工具 · 数据与译名来自游戏本体的官方简体中文包 · 详见 README
        </span>
      </footer>
    </div>
  );
}
