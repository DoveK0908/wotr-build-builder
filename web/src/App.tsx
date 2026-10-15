import React, { useEffect, useMemo, useState } from "react";
import type { Db } from "./types";
import { loadDb } from "./load";
import { act, deserialize, useBuild } from "./store";
import { derive } from "./rules";
import { Character } from "./views/Character";
import { Levels } from "./views/Levels";
import { Mythic } from "./views/Mythic";
import { Skills } from "./views/Skills";
import { Spells } from "./views/Spells";
import { Summary } from "./views/Summary";

const TABS: [string, string][] = [
  ["char", "角色"],
  ["levels", "升级"],
  ["mythic", "神话"],
  ["skills", "技能"],
  ["spells", "法术"],
  ["summary", "汇总"],
];

export function App() {
  const [db, setDb] = useState<Db | null>(null);
  const [err, setErr] = useState("");
  const [pct, setPct] = useState(0);
  const [tab, setTab] = useState(() => {
    const m = /[#&]tab=([a-z]+)/.exec(location.hash);
    return m ? m[1] : "char";
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
    h.unshift("tab=" + tab);
    u.hash = h.join("&");
    history.replaceState(null, "", u.toString());
  }, [tab]);

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

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">⚔</span>
          <div>
            <h1>《开拓者：正义之怒》构筑规划器</h1>
            <div className="muted small">
              数据来自本机游戏本体 · {meta.counts.classes} 职业 / {meta.counts.archetypes} 变体 /{" "}
              {meta.counts.features} 特性 / {meta.counts.spells} 法术 · 生成于 {meta.generated?.slice(0, 16).replace("T", " ")}
            </div>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map(([id, name]) => (
            <button
              key={id}
              type="button"
              className={"tab" + (tab === id ? " on" : "")}
              onClick={() => setTab(id)}
            >
              {name}
              {id === "summary" && derived.unfinished.length > 0 && (
                <i className="dot" title={`还有 ${derived.unfinished.length} 项没选`} />
              )}
            </button>
          ))}
        </nav>
        <div className="top-right">
          <span className="muted small">
            {build.name || "未命名"} · {derived.level}/20 · 神话 {derived.rank}/10
          </span>
        </div>
      </header>

      <main className="main">
        {tab === "char" && <Character db={db} />}
        {tab === "levels" && <Levels db={db} />}
        {tab === "mythic" && <Mythic db={db} />}
        {tab === "skills" && <Skills db={db} />}
        {tab === "spells" && <Spells db={db} />}
        {tab === "summary" && <Summary db={db} build={build} derived={derived} />}
      </main>

      <footer className="foot">
        <span className="muted small">
          非官方工具 · 数据与译名来自游戏本体的官方简体中文包 · 详见 README
        </span>
      </footer>
    </div>
  );
}
