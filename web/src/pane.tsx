import React, { useMemo } from "react";
import type { Db } from "./types";
import type { Build } from "./store";
import {
  classLevels, featuresAtClassLevel, isNamed, label, mythicHeroPath, pathStartRank,
  universalSlots,
} from "./rules";
import { featureIcon, ui } from "./skin";

/* ────────────────────────────────────────────────────────────────────────────
   游戏里那套「左列表 + 中详情 + 右预览」三栏骨架，以及配套小件。
   参考 docs/game-ui-spec.md / docs/game-ui-screens.md。
   ──────────────────────────────────────────────────────────────────────────── */

/** 紫色 V 小节：标题 + 横向分隔线（游戏里 `∨ 特殊能力` 那种） */
export function Sect(props: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="sect">
      <div className="sect-head">
        <span className="sect-v" aria-hidden="true" />
        <span className="sect-title">{props.title}</span>
        {props.right && <span className="sect-right">{props.right}</span>}
      </div>
      {props.children !== undefined && <div className="sect-body">{props.children}</div>}
      <div className="sect-rule" />
    </section>
  );
}

/** 三栏：左列表 / 中详情 / 右预览 */
export function ThreePane(props: {
  left?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      className={
        "tp" + (props.left === undefined ? " noleft" : "") + (props.right === undefined ? " noright" : "")
      }
    >
      {props.left !== undefined && <div className="tp-left">{props.left}</div>}
      <div className="tp-mid">{props.center}</div>
      {props.right !== undefined && <div className="tp-right">{props.right}</div>}
    </div>
  );
}

/** 左列表栏（带搜索框、标题、底部说明） */
export function ListPane(props: {
  title?: React.ReactNode;
  /** 标题右侧的圆形计数徽章（游戏里法术选择那栏左上角就有一个） */
  badge?: React.ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className="lp">
      {(props.title !== undefined || props.badge !== undefined) && (
        <div className="lp-title">
          {props.title}
          {props.badge !== undefined && <span className="lp-badge">{props.badge}</span>}
        </div>
      )}
      {props.onSearch && (
        <div className="lp-search">
          <input
            className="lp-input"
            value={props.search || ""}
            placeholder="搜索……"
            onChange={(e) => props.onSearch && props.onSearch(e.target.value)}
          />
          <img className="lp-lens" src={ui("UI_Search_Icon")} alt="" />
        </div>
      )}
      <div className="lp-list">{props.children}</div>
      {props.foot && <div className="lp-foot">{props.foot}</div>}
    </div>
  );
}

/** 列表行：图标（或首字徽记）+ 名字 + 副标题 + 右侧数字 + `»` 下级 + 绿勾 */
export function ListRow(props: {
  ico?: string | null;
  glyph?: string;
  name: React.ReactNode;
  sub?: React.ReactNode;
  num?: React.ReactNode;
  arrow?: boolean;
  mark?: boolean;
  sel?: boolean;
  dis?: boolean;
  badge?: React.ReactNode;
  title?: string;
  onClick?: () => void;
  onHover?: () => void;
}) {
  return (
    <div
      className={"lrow" + (props.sel ? " sel" : "") + (props.dis ? " dis" : "") + (props.onClick ? "" : " static")}
      title={props.title}
      onClick={props.onClick}
      onMouseEnter={props.onHover}
    >
      <span className="lrow-ico">
        {props.ico ? (
          <img className="row-ico" src={props.ico} alt="" />
        ) : (
          <span className="row-glyph">
            {props.glyph || (typeof props.name === "string" ? props.name.slice(0, 1) : "?")}
          </span>
        )}
      </span>
      <span className="lrow-main">
        <span className="lrow-name">{props.name}</span>
        {props.sub && <span className="lrow-sub">{props.sub}</span>}
      </span>
      {props.badge && <span className="lrow-badge">{props.badge}</span>}
      {props.num !== undefined && <span className="lrow-num">{props.num}</span>}
      {props.mark && <span className="lrow-mark" title="推荐 / 可用">✔</span>}
      {props.arrow && <span className="lrow-arrow">»</span>}
    </div>
  );
}

/** 中间详情的大标题（图标 + 大号标题 + 英文/副标题） */
export function DetailHead(props: {
  ico?: string | null;
  glyph?: string;
  title: React.ReactNode;
  en?: React.ReactNode;
  sub?: React.ReactNode;
  big?: boolean;
}) {
  return (
    <header className={"dhead" + (props.big ? " big" : "")}>
      {props.ico ? (
        <img className="dhead-ico detail-ico" src={props.ico} alt="" />
      ) : props.glyph ? (
        <span className="dhead-glyph">{props.glyph}</span>
      ) : null}
      <div className="dhead-txt">
        <h3 className="dhead-title">{props.title}</h3>
        {props.en && <div className="dhead-en">{props.en}</div>}
      </div>
      {props.sub && <div className="dhead-sub">{props.sub}</div>}
    </header>
  );
}

/** 图标 + 名称的网格（游戏里「可选项」那种裸网格） */
export function IconGrid(props: {
  items: { id: string; name: string; ico?: string | null; glyph?: string; title?: string }[];
  cols?: number;
  sel?: string;
  onPick?: (id: string) => void;
}) {
  return (
    <div className="igrid" style={{ gridTemplateColumns: `repeat(${props.cols || 3}, minmax(0, 1fr))` }}>
      {props.items.map((it) => (
        <div
          key={it.id}
          className={"ig" + (props.sel === it.id ? " sel" : "") + (props.onPick ? "" : " static")}
          title={it.title || it.name}
          onClick={props.onPick ? () => props.onPick!(it.id) : undefined}
        >
          {it.ico ? (
            <img className="row-ico" src={it.ico} alt="" />
          ) : (
            <span className="row-glyph">{it.glyph || it.name.slice(0, 1)}</span>
          )}
          <span className="ig-name">{it.name}</span>
        </div>
      ))}
    </div>
  );
}

/** 右栏的数值盒子（游戏里「基础攻击加值 中 / 每级生命值 5 / 强韧 低」那种） */
export function StatBox(props: {
  items: { k: React.ReactNode; v: React.ReactNode }[];
  cols?: number;
}) {
  return (
    <div className="sbox" style={{ gridTemplateColumns: `repeat(${props.cols || 3}, minmax(0, 1fr))` }}>
      {props.items.map((it, i) => (
        <div className="sb" key={i}>
          <div className="sb-k">{it.k}</div>
          <div className="sb-v">{it.v}</div>
        </div>
      ))}
    </div>
  );
}

/** 右栏的键值行 */
export function StatRows(props: { items: [React.ReactNode, React.ReactNode][]; dense?: boolean }) {
  return (
    <div className={"srows" + (props.dense ? " dense" : "")}>
      {props.items.map((it, i) => (
        <div className="srow" key={i}>
          <span className="srow-k">{it[0]}</span>
          <span className="srow-v">{it[1]}</span>
        </div>
      ))}
    </div>
  );
}

/* ── 阵营轮盘（照游戏：八瓣扇形 + 正中绝对中立） ────────────────────────────── */

/** 八瓣的位置：角度 0 = 正右，逆时针为正（90 = 正上）。正中那格是绝对中立。 */
const WHEEL_ORDER: Array<{ id: string; deg: number }> = [
  { id: "NeutralGood", deg: 90 },
  { id: "ChaoticGood", deg: 45 },
  { id: "ChaoticNeutral", deg: 0 },
  { id: "ChaoticEvil", deg: -45 },
  { id: "NeutralEvil", deg: -90 },
  { id: "LawfulEvil", deg: -135 },
  { id: "LawfulNeutral", deg: 180 },
  { id: "LawfulGood", deg: 135 },
];

const W_R = 112; // 外半径
const W_R0 = 46; // 内半径
const W_LABEL = 79; // 缩写圆心的半径

function wPolar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [120 + r * Math.cos(a), 120 - r * Math.sin(a)];
}

function wWedge(deg: number): string {
  const d0 = deg - 22.5;
  const d1 = deg + 22.5;
  const [x0, y0] = wPolar(W_R, d0);
  const [x1, y1] = wPolar(W_R, d1);
  const [x2, y2] = wPolar(W_R0, d1);
  const [x3, y3] = wPolar(W_R0, d0);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${W_R},${W_R} 0 0 0 ${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} A${W_R0},${W_R0} 0 0 1 ${x3.toFixed(1)},${y3.toFixed(1)} Z`;
}

export function AlignWheel(props: {
  value: string | null;
  abbr: (id: string) => string;
  locks?: Record<string, string[]>;
  labels?: Record<string, string>;
  onPick?: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const centerId = "TrueNeutral";
  const centerLock = props.locks?.[centerId];
  return (
    <svg className="alwheel" viewBox="0 0 240 240" role="img" aria-label="阵营轮盘">
      <circle className="aw-back" cx={120} cy={120} r={W_R + 5} />
      {WHEEL_ORDER.map(({ id, deg }) => {
        const lock = props.locks?.[id];
        const sel = props.value === id;
        const [lx, ly] = wPolar(W_LABEL, deg);
        const name = props.labels?.[id] || props.abbr(id);
        return (
          <g
            key={id}
            className={"aw-w" + (sel ? " sel" : "") + (lock ? " lock" : "")}
            onMouseEnter={props.onHover ? () => props.onHover!(id) : undefined}
            onClick={props.onPick && !lock ? () => props.onPick!(id) : undefined}
          >
            <title>{name + (lock ? `　不可选：${lock.join("；")}` : "")}</title>
            <path className="aw-fill" d={wWedge(deg)} />
            <circle className="aw-chip" cx={lx} cy={ly} r={15} />
            <text className="aw-abbr" x={lx} y={ly + 4.5}>
              {props.abbr(id)}
            </text>
          </g>
        );
      })}
      <g
        className={"aw-c" + (props.value === centerId ? " sel" : "") + (centerLock ? " lock" : "")}
        onMouseEnter={props.onHover ? () => props.onHover!(centerId) : undefined}
        onClick={props.onPick && !centerLock ? () => props.onPick!(centerId) : undefined}
      >
        <title>{(props.labels?.[centerId] || props.abbr(centerId)) + (centerLock ? `　不可避免：${centerLock.join("；")}` : "")}</title>
        <circle className="aw-cback" cx={120} cy={120} r={W_R0 - 4} />
        <text className="aw-abbr center" x={120} y={125}>
          {props.abbr(centerId)}
        </text>
      </g>
    </svg>
  );
}

/* ── 职业 / 神话成长表 ────────────────────────────────────────────────────── */

function icoCell(db: Db, id: string) {
  const ico = featureIcon(db, id);
  const nm = label(db.features[id]);
  return ico ? (
    <img key={id} className="grow-ico" src={ico} alt="" title={nm} />
  ) : (
    <span key={id} className="grow-glyph" title={nm}>
      {nm.slice(0, 1)}
    </span>
  );
}

/** 职业成长表：列 = 等级 1..20，行 = 通用专长 + 每个职业各等级拿到的特性 */
export function GrowthTable(props: {
  db: Db;
  build: Build;
  max?: number;
  showFeats?: boolean;
  sel?: number;
  onSel?: (level: number) => void;
}) {
  const { db, build } = props;
  const max = props.max || 20;
  const cols = useMemo(() => Array.from({ length: max }, (_, i) => i + 1), [max]);
  const cls = classLevels(build);

  const featCells = cols.map((lvl) => {
    const lv = build.levels[lvl - 1];
    const out: string[] = [];
    for (const s of universalSlots(db, lvl)) {
      const v = lv?.picks?.[s.id];
      if (v) out.push(v);
    }
    return out;
  });

  const rows = Object.entries(cls).filter(([, n]) => n > 0);

  return (
    <div className="growth">
      <div className="grow-head">
        <span className="grow-label" />
        {cols.map((l) => (
          <span
            key={l}
            className={"grow-num" + (l === (props.sel || 1) ? " on" : "") + (props.onSel ? " click" : "")}
            onClick={props.onSel ? () => props.onSel!(l) : undefined}
          >
            {l}
          </span>
        ))}
      </div>

      {props.showFeats !== false && (
        <div className="grow-row">
          <span className="grow-label">专长</span>
          {cols.map((l) => (
            <span className="grow-cell" key={l}>
              {featCells[l - 1].map((id) => icoCell(db, id))}
            </span>
          ))}
        </div>
      )}

      {rows.map(([cid, n]) => {
        const c = db.classes[cid];
        const arches = build.classArchetypes[cid] || [];
        return (
          <div className="grow-block" key={cid}>
            <div className="grow-row name">
              <span className="grow-label">
                <span className="sect-v" /> {label(c)}
                {arches.length ? " " + arches.map((a) => db.archetypes[a]?.name || "").join(" ") : ""} ({n} 级)
              </span>
              <span className="grow-hearts">{n === 20 ? "♥ " + (c.hitDie || "") : ""}</span>
            </div>
            <div className="grow-row">
              <span className="grow-label" />
              {cols.map((l) => {
                const ids = (l <= n ? featuresAtClassLevel(db, cid, l, arches) : []).filter((id) => isNamed(db.features[id]));
                const shown = ids.slice(0, 4);
                return (
                  <span className="grow-cell" key={l}>
                    {shown.map((id) => icoCell(db, id))}
                    {ids.length > shown.length && <span className="grow-more">+{ids.length - shown.length}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}

      {rows.length === 0 && <div className="muted small">还没有排职业</div>}
    </div>
  );
}

/** 神话成长表：1..10 阶 */
export function MythicGrowth(props: { db: Db; build: Build; max?: number; sel?: number; onSel?: (r: number) => void }) {
  const { db, build } = props;
  const max = props.max || 10;
  const hero = mythicHeroPath(db);
  const path = build.mythicPath ? db.mythic?.paths?.[build.mythicPath] : null;
  const start = path ? pathStartRank(db, path) : 0;
  const rank = start || 99;
  return (
    <div className="growth">
      <div className="grow-head">
        <span className="grow-label" />
        {Array.from({ length: max }, (_, i) => i + 1).map((r) => (
          <span
            key={r}
            className={"grow-num" + (r === (props.sel || start || 1) ? " on" : "") + (props.onSel ? " click" : "")}
            onClick={props.onSel ? () => props.onSel!(r) : undefined}
          >
            {r}
          </span>
        ))}
      </div>
      <div className="grow-row">
        <span className="grow-label">{hero ? label(hero) : "神话英雄"}</span>
        {Array.from({ length: max }, (_, i) => i + 1).map((r) => (
          <span className="grow-cell" key={r}>
            {r < rank ? <span className="grow-dot">◆</span> : <span className="grow-off">·</span>}
          </span>
        ))}
      </div>
      {path && (
        <div className="grow-row">
          <span className="grow-label">{label(path)}</span>
          {Array.from({ length: max }, (_, i) => i + 1).map((r) => (
            <span className="grow-cell" key={r}>
              {r >= start ? <span className="grow-dot on">◆</span> : <span className="grow-off">·</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
