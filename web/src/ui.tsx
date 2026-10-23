import React, {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";

export interface Opt {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  disabled?: boolean;
  badge?: string;
}

/** 能搜的大下拉框：8800 个特性也能秒找 */
export function SearchSelect(props: {
  value: string | null;
  options: Opt[];
  onChange: (id: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  width?: number | string;
  className?: string;
  /** 给定选项的说明文本：下拉里光标停在哪一项，就在列表下方显示它的说明 */
  descOf?: (id: string) => string | undefined;
}) {
  const {
    value, options, onChange, placeholder = "选择…", clearable = true, disabled, width = 280, className, descOf,
  } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, minW: 240, up: false, maxH: 520 });

  const cur = useMemo(() => options.find((o) => o.id === value), [options, value]);
  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = options;
    if (terms.length) {
      list = options.filter((o) => {
        const hay = (o.label + " " + (o.hint || "") + " " + (o.group || "") + " " + o.id).toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    return list.slice(0, 300);
  }, [options, q]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const up = below < 360 && r.top > below;
    const maxH = Math.max(220, Math.min(560, up ? r.top - 12 : below));
    setPos({
      top: up ? Math.max(8, r.bottom - 4 - maxH) : r.bottom + 4,
      left: Math.min(r.left, Math.max(8, window.innerWidth - 440)),
      minW: Math.max(r.width, 240),
      up,
      maxH,
    });
    setHi(0);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className={"ss " + (className || "")} style={{ width }}>
      <button
        ref={btnRef}
        type="button"
        className={"ss-btn" + (open ? " open" : "") + (!cur ? " empty" : "")}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ss-label" title={cur?.label || ""}>{cur ? cur.label : placeholder}</span>
        {clearable && cur && (
          <span
            className="ss-x"
            title="清除"
            onClick={(e) => { e.stopPropagation(); commit(null); }}
          >×</span>
        )}
        <span className="ss-caret">▾</span>
      </button>
      {open && (
        <div
          ref={popRef}
          className="ss-pop"
          style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.minW, maxHeight: pos.maxH }}
        >
          <input
            ref={inputRef}
            className="ss-input"
            value={q}
            placeholder="搜索（可拼音首字母以外的汉字/英文）…"
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (shown[hi]) commit(shown[hi].id); }
              else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
            }}
          />
          <div className="ss-list">
            {shown.length === 0 && <div className="ss-empty">没有匹配项</div>}
            {shown.map((o, i) => (
              <div
                key={o.id}
                className={"ss-row" + (i === hi ? " hi" : "") + (o.id === value ? " sel" : "") + (o.disabled ? " dis" : "")}
                onMouseEnter={() => setHi(i)}
                onClick={() => { if (!o.disabled) commit(o.id); }}
                title={o.hint || o.label}
              >
                <span className="ss-row-label">{o.label}</span>
                {o.badge && <span className="badge">{o.badge}</span>}
                {o.hint && <span className="ss-row-hint">{o.hint}</span>}
              </div>
            ))}
          </div>
          {descOf && (() => {
            const opt = shown[hi] || cur || null;
            const text = opt ? descOf(opt.id) : undefined;
            return (
              <div className="ss-desc">
                {opt && <div className="ss-desc-title">{opt.label}</div>}
                {text
                  ? text.split("\n").filter((x) => x.trim()).map((p, i) => <p key={i}>{p}</p>)
                  : <p className="muted">（这一项没有说明文本）</p>}
              </div>
            );
          })()}
          <div className="ss-foot">
            <span>{shown.length} / {options.length} 项</span>
            {clearable && <span className="link" onClick={() => commit(null)}>清除选择</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Panel(props: {
  title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
  className?: string; sub?: React.ReactNode;
}) {
  return (
    <section className={"panel " + (props.className || "")}>
      {(props.title || props.right) && (
        <header className="panel-head">
          <div>
            <h3>{props.title}</h3>
            {props.sub && <div className="panel-sub">{props.sub}</div>}
          </div>
          <div className="panel-right">{props.right}</div>
        </header>
      )}
      <div className="panel-body">{props.children}</div>
    </section>
  );
}

export function Field(props: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <span className="field-ctl">{props.children}</span>
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Chip(props: { children: React.ReactNode; tone?: string; title?: string; onClick?: () => void }) {
  return (
    <span className={"chip" + (props.tone ? " chip-" + props.tone : "")} title={props.title} onClick={props.onClick}>
      {props.children}
    </span>
  );
}

export function VerdictTag(props: { v: "ok" | "no" | "unknown" }) {
  const map = { ok: ["满足", "ok"], no: ["不满足", "no"], unknown: ["需确认", "unk"] } as const;
  const [t, c] = map[props.v];
  return <Chip tone={c}>{t}</Chip>;
}

/** 一组选项的单选列表（专长池、法术池都用它） */
export function ChoiceList(props: {
  options: Opt[];
  value: string | null;
  onChange: (id: string | null) => void;
  empty?: string;
  filterable?: boolean;
  max?: number;
  verdict?: (id: string) => "ok" | "no" | "unknown";
  onlyOk?: boolean;
}) {
  const { options, value, onChange, empty = "这里没有可选项" } = props;
  const [q, setQ] = useState("");
  const [onlyOk, setOnlyOk] = useState(false);
  const list = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let l = options;
    if (terms.length) l = l.filter((o) => terms.every((t) => (o.label + " " + (o.hint || "")).toLowerCase().includes(t)));
    if (onlyOk && props.verdict) l = l.filter((o) => props.verdict!(o.id) !== "no");
    return l.slice(0, props.max ?? 400);
  }, [options, q, onlyOk, props]);

  if (!options.length) return <div className="muted">{empty}</div>;
  return (
    <div className="choicelist">
      <div className="cl-bar">
        <input className="cl-search" value={q} placeholder="在候选里搜索…" onChange={(e) => setQ(e.target.value)} />
        {props.verdict && (
          <label className="cl-only">
            <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} />
            只看可用
          </label>
        )}
        {value && <span className="link" onClick={() => onChange(null)}>清除</span>}
        <span className="muted small">{list.length} 项</span>
      </div>
      <div className="cl-list">
        {list.map((o) => (
          <div
            key={o.id}
            className={"cl-row" + (o.id === value ? " sel" : "") + (o.disabled ? " dis" : "")}
            onClick={() => !o.disabled && onChange(o.id === value ? null : o.id)}
          >
            <span className="cl-name">{o.label}</span>
            {o.hint && <span className="cl-hint">{o.hint}</span>}
            {props.verdict && <VerdictTag v={props.verdict(o.id)} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 带 −/+ 的数值输入 */
export function NumBox(props: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; wide?: boolean;
}) {
  const { value, onChange, min = -99, max = 999, step = 1 } = props;
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span className="numbox">
      <button type="button" onClick={() => set(value - step)} disabled={value <= min}>−</button>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        className={props.wide ? "wide" : ""}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/[^0-9-]/g, ""), 10);
          if (!isNaN(n)) set(n);
        }}
      />
      <button type="button" onClick={() => set(value + step)} disabled={value >= max}>+</button>
    </span>
  );
}

export function Meter(props: { used: number; total: number; label?: string }) {
  const over = props.used > props.total;
  const pct = props.total > 0 ? Math.min(100, (props.used / props.total) * 100) : 0;
  return (
    <div className="meter">
      {props.label && <span className="meter-label">{props.label}</span>}
      <span className={"meter-num" + (over ? " over" : "")}>{props.used} / {props.total}</span>
      <span className="meter-bar"><i style={{ width: pct + "%" }} className={over ? "over" : ""} /></span>
    </div>
  );
}

export function Collapse(props: { title: React.ReactNode; children: React.ReactNode; open?: boolean; right?: React.ReactNode }) {
  const [o, setO] = useState(!!props.open);
  return (
    <div className={"collapse" + (o ? " open" : "")}>
      <div className="collapse-head" onClick={() => setO((x) => !x)}>
        <span className="collapse-caret">{o ? "▾" : "▸"}</span>
        <span className="collapse-title">{props.title}</span>
        <span className="collapse-right" onClick={(e) => e.stopPropagation()}>{props.right}</span>
      </div>
      {o && <div className="collapse-body">{props.children}</div>}
    </div>
  );
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** 固定高度（矮屏仍受 88vh 限制）。用于「左列表 + 右详情」这类弹窗：
   *  鼠标扫过列表时右栏内容长短变化，窗口不会跟着上下伸缩抖动。 */
  fixed?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={"modal" + (props.wide ? " wide" : "") + (props.fixed ? " fixed" : "")}>
        <header className="modal-head">
          <h3>{props.title}</h3>
          <button type="button" className="x" onClick={props.onClose}>×</button>
        </header>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}

/** 二次确认弹窗：用于清空构筑这类不可撤销的操作。 */
export function Confirm(props: {
  title: string;
  text: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); }, []);
  return (
    <Modal title={props.title} onClose={props.onCancel}>
      <div className="confirm-body">{props.text}</div>
      <div className="confirm-foot">
        <button type="button" className="btn ghost" onClick={props.onCancel}>取消</button>
        <button
          ref={btn}
          type="button"
          className={"btn" + (props.danger ? " ghost danger" : "")}
          onClick={props.onConfirm}
        >
          {props.confirmText || "确定"}
        </button>
      </div>
    </Modal>
  );
}

/** 富文本描述：把游戏里的 \n 变成段落，去掉残留标记 */
export function Desc(props: { text?: string; limit?: number }) {
  const [full, setFull] = useState(false);
  const raw = props.text || "";
  if (!raw) return <div className="muted small">（没有说明文本）</div>;
  const limit = props.limit ?? 600;
  const cut = !full && raw.length > limit;
  const body = cut ? raw.slice(0, limit) + "…" : raw;
  return (
    <div className="desc">
      {body.split("\n").filter((x) => x.trim()).map((p, i) => <p key={i}>{p}</p>)}
      {cut && <span className="link" onClick={() => setFull(true)}>展开全文</span>}
      {!cut && raw.length > limit && <span className="link" onClick={() => setFull(false)}>收起</span>}
    </div>
  );
}
