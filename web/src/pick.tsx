import React, { useMemo, useState } from "react";
import type { Db, FeatureEntry, SpellEntry } from "./types";
import { label, prereqText } from "./rules";
import type { Verdict } from "./rules";
import { Chip, Desc, Modal, VerdictTag } from "./ui";

const V_ORDER: Record<Verdict, number> = { ok: 0, unknown: 1, no: 2 };

/** 法术和特性共用一套展示逻辑，缺的字段当空处理 */
function cast(x: FeatureEntry | SpellEntry | undefined): (FeatureEntry & SpellEntry) | null {
  return (x || null) as (FeatureEntry & SpellEntry) | null;
}

function candidates(db: Db, slot: FeatureEntry, cands: string[]): { id: string; f: FeatureEntry }[] {
  const out: { id: string; f: FeatureEntry }[] = [];
  for (const id of cands) {
    const f = db.features[id] || db.spells[id];
    if (!f) continue;
    out.push({ id, f: f as FeatureEntry });
  }
  return out;
}

/** 某个槽位（选择表）的当前选择 + 打开挑选取的面板 */
export function PickSlot(props: {
  db: Db;
  slot: FeatureEntry;
  value: string | null;
  verdict: (fid: string) => Verdict;
  onChange: (id: string | null) => void;
  /** 是否允许自由输入（参数化专长之类的兜底） */
  title?: string;
  hint?: React.ReactNode;
}) {
  const { db, slot, value, verdict, onChange } = props;
  const [open, setOpen] = useState(false);
  const cur = cast(value ? db.features[value] || db.spells[value] : undefined);
  const v = value ? verdict(value) : "unknown";
  const n = (slot.choices || []).length;
  return (
    <div className="slot">
      <div className="slot-head">
        <span className="slot-name">{props.title || label(slot)}</span>
        <span className="slot-opt">{n} 选 1</span>
      </div>
      <div className="slot-body">
        {value ? (
          <>
            <span className="slot-val" title={label(cur)}>{label(cur)}</span>
            {v !== "ok" && <VerdictTag v={v} />}
          </>
        ) : (
          <span className="muted">未选择</span>
        )}
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>
          {value ? "更换" : "选择"}
        </button>
        {value && (
          <button type="button" className="btn sm ghost" onClick={() => onChange(null)}>清除</button>
        )}
      </div>
      {props.hint && <div className="slot-hint">{props.hint}</div>}
      {open && (
        <PickModal
          db={db}
          title={props.title || label(slot)}
          ids={slot.choices || []}
          value={value}
          verdict={verdict}
          onPick={(id) => { onChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** 通用选取弹窗：左边搜列表，右边看说明 */
export function PickModal(props: {
  db: Db;
  title: string;
  ids: string[];
  value: string | null;
  verdict: (fid: string) => Verdict;
  onPick: (id: string | null) => void;
  onClose: () => void;
  multi?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const { db, ids, verdict } = props;
  const [q, setQ] = useState("");
  const [onlyOk, setOnlyOk] = useState(false);
  const [sortByV, setSortByV] = useState(true);
  const [focus, setFocus] = useState<string | null>(props.value || ids[0] || null);

  const list = useMemo(() => {
    let items = candidates(db, {} as FeatureEntry, ids);
    if (q.trim()) {
      const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      items = items.filter(({ id, f }) => {
        const hay = (label(f) + " " + (f.nameEn || "") + " " + id).toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    if (onlyOk) items = items.filter(({ id }) => verdict(id) !== "no");
    if (sortByV) items = items.slice().sort((a, b) => V_ORDER[verdict(a.id)] - V_ORDER[verdict(b.id)]);
    return items;
  }, [db, ids, q, onlyOk, sortByV, verdict]);

  const cur = focus ? cast(db.features[focus] || db.spells[focus]) : null;
  const pr = cur?.prereq || [];
  const held = props.multi ? (props.selected || new Set<string>()) : null;

  return (
    <Modal wide title={`${props.title} — 候选 ${ids.length} 项`} onClose={props.onClose}>
      <div className="pick">
        <div className="pick-left">
          <div className="pick-bar">
            <input
              className="cl-search"
              autoFocus
              value={q}
              placeholder="搜索名称 / 英文名…"
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="cl-only">
              <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} />
              只看可用
            </label>
            <label className="cl-only">
              <input type="checkbox" checked={sortByV} onChange={(e) => setSortByV(e.target.checked)} />
              按可用排序
            </label>
          </div>
          <div className="pick-list">
            {list.length === 0 && <div className="muted">没有匹配项</div>}
            {list.map(({ id, f }) => {
              const v = verdict(id);
              const on = props.multi ? held?.has(id) : id === props.value;
              return (
                <div
                  key={id}
                  className={"pick-row" + (on ? " sel" : "") + (id === focus ? " focus" : "")}
                  onMouseEnter={() => setFocus(id)}
                  onClick={() => (props.multi ? props.onToggle?.(id) : props.onPick(id))}
                >
                  {props.multi && <input type="checkbox" checked={!!on} readOnly />}
                  <span className="pick-name">{label(f)}</span>
                  {f.nameEn && <span className="pick-en">{f.nameEn}</span>}
                  <span className="spacer" />
                  <VerdictTag v={v} />
                </div>
              );
            })}
          </div>
        </div>
        <div className="pick-right">
          {cur ? (
            <>
              <h4>{label(cur)}</h4>
              {cur.nameEn && <div className="muted small">{cur.nameEn}</div>}
              {cur.groups?.length ? (
                <div className="row wrap">{cur.groups.map((g) => <Chip key={g}>{g}</Chip>)}</div>
              ) : null}
              {pr.length > 0 && (
                <div className="prereq">
                  <div className="prereq-title">前置条件</div>
                  <ul>
                    {pr.map((p, i) => (
                      <li key={i}>
                        <span className={(p.group || "All") === "Any" ? "tag-any" : "tag-all"}>
                          {(p.group || "All") === "Any" ? "或" : "且"}
                        </span>
                        {prereqText(db, p)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Desc text={cur.desc} limit={900} />
            </>
          ) : (
            <div className="muted">把鼠标移到左边某一项上看说明</div>
          )}
        </div>
      </div>
      <div className="pick-foot">
        {props.multi
          ? <button type="button" className="btn" onClick={props.onClose}>完成</button>
          : (
            <>
              <button type="button" className="btn ghost" onClick={() => props.onPick(null)}>清空</button>
              <span className="muted small">点左边任意一项即选定</span>
            </>
          )}
      </div>
    </Modal>
  );
}

/** 只管展示的「自动获得」列表 */
export function AutoList(props: { db: Db; ids: string[]; empty?: string }) {
  const { db, ids } = props;
  if (!ids.length) return <div className="muted small">{props.empty || "（本级没有自动获得的特性）"}</div>;
  return (
    <div className="autolist">
      {ids.map((id) => {
        const f = db.features[id];
        if (!f) return <div key={id} className="auto-row"><span className="muted">{id}</span></div>;
        return (
          <div key={id} className="auto-row" title={f.desc || ""}>
            <span className="auto-name">{label(f)}</span>
            {f.nameEn && <span className="pick-en">{f.nameEn}</span>}
          </div>
        );
      })}
    </div>
  );
}
