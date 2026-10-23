import React, { useMemo, useState } from "react";
import type { Db, FeatureEntry, SpellEntry } from "./types";
import { label, livePicks, ownedFeatures, prereqForIndex, prereqText, expandFeature } from "./rules";
import type { Verdict } from "./rules";
import { Chip, Desc, Modal, SearchSelect, VerdictTag } from "./ui";
import { ART, featureIcon, ui } from "./skin";
import { useBuild } from "./store";

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
  /** 神话能力槽那种贴图框（素材皮用；传 URL） */
  icoFrame?: string;
}) {
  const { db, slot, value, verdict, onChange } = props;
  const [open, setOpen] = useState(false);
  const cur = cast(value ? db.features[value] || db.spells[value] : undefined);
  // 游戏里这类槽位（IgnorePrerequisites）不检查候选的前置条件，所以不标红也不过滤
  const ignore = !!slot.ignorePrereq;
  const effVerdict = ignore ? () => "ok" as Verdict : verdict;
  const v = value ? effVerdict(value) : "unknown";
  const n = (slot.choices || []).length;
  return (
    <div className="slot">
      <div className="slot-head">
        <span className="slot-name">{props.title || label(slot)}</span>
        {ignore && <span className="chip chip-any" title="游戏里这个槽位不检查前置条件">不检查前置</span>}
        <span className="slot-opt">{n} 选 1</span>
      </div>
      <div className="slot-body">
        {value && (
          <span
            className={"slot-ico" + (props.icoFrame ? " framed" : "")}
            style={props.icoFrame ? { backgroundImage: `url(${props.icoFrame})` } : undefined}
            title={label(cur)}
          >
            {featureIcon(db, value) ? (
              <img src={featureIcon(db, value) || undefined} alt="" />
            ) : (
              <span className="slot-glyph">{label(cur).slice(0, 1)}</span>
            )}
          </span>
        )}
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
          slotId={slot.id}
          ids={slot.choices || []}
          value={value}
          verdict={effVerdict}
          note={ignore ? "游戏里这个槽位不检查前置条件：下面是候选自身的条件，仅供参考。" : undefined}
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
  /** 槽位自己的 id：用来算「前置于」（游戏里详情栏会写「前置于: 额外游荡者天赋」） */
  slotId?: string;
  ids: string[];
  value: string | null;
  verdict: (fid: string) => Verdict;
  onPick: (id: string | null) => void;
  onClose: () => void;
  multi?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  /** 顶部提示（例如「本槽位不检查前置」） */
  note?: string;
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
  /** 游戏里的 64×64 内容图标；这个蓝图没导出图标就返回 null（列表里就不放图） */
  const ico = (id: string) => featureIcon(db, id);
  // 游戏会给自己已经拿过的选项打一个绿色叶子小标（截图里 武器专攻 / 战斗特技 那两行）
  const build = useBuild();
  const owned = useMemo(() => ownedFeatures(db, build).ids, [db, build]);
  const ownedMark = (id: string) =>
    owned.has(id)
      ? ART
        ? <img className="row-mark" src={ui("UI_CharGen_IconLike")} alt="" title="已经拥有了" />
        : <span className="row-mark" title="已经拥有了">✓</span>
      : null;
  /** 游戏里详情栏会写一行「前置于: 额外游荡者天赋」——谁的先决条件里有这个槽位 */
  const reqFor = props.slotId ? prereqForIndex(db).get(props.slotId) || [] : [];

  return (
    <Modal wide fixed title={`${props.title} — 候选 ${ids.length} 项`} onClose={props.onClose}>
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
            {props.note && <div className="muted small pick-note">{props.note}</div>}
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
                  {ico(id) && <img className="row-ico" src={ico(id)!} alt="" />}
                  <span className="pick-name">{label(f)}</span>
                  {ownedMark(id)}
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
              {focus && ico(focus) && <img className="detail-ico" src={ico(focus)!} alt="" />}
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
              {reqFor.length > 0 && (
                <div className="prereq">
                  <div className="prereq-title">前置于（{reqFor.length}）</div>
                  <div className="row wrap">
                    {reqFor.slice(0, 10).map((id) => (
                      <span className="chip" key={id}>
                        {ico(id) && <img className="chip-ico" src={ico(id)!} alt="" />}
                        {label(db.features[id])}
                      </span>
                    ))}
                    {reqFor.length > 10 && <span className="muted small">…还有 {reqFor.length - 10} 个</span>}
                  </div>
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
export function AutoList(props: { db: Db; ids: string[]; empty?: string; onDetail?: (id: string) => void }) {
  const { db, ids } = props;
  if (!ids.length) return <div className="muted small">{props.empty || "（本级没有自动获得的特性）"}</div>;
  return (
    <div className="autolist">
      {ids.map((id) => {
        const f = db.features[id];
        if (!f) return <div key={id} className="auto-row"><span className="muted">{id}</span></div>;
        return (
          <div
      key={id}
      className={"auto-row" + (props.onDetail ? " clickable" : "")}
      title={props.onDetail ? "点击看详情" : f.desc || ""}
      onClick={props.onDetail ? () => props.onDetail!(id) : undefined}
    >
            {featureIcon(db, id) && <img className="row-ico sm" src={featureIcon(db, id)!} alt="" />}
            <span className="auto-name">{label(f)}</span>
            {f.nameEn && <span className="pick-en">{f.nameEn}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 某个槽位里选出「本身还是一个选择表」的东西时，继续往下要的那一层。
 * 例：战斗专长 → 战斗流派专长 → 弓术；背景 › 学者 → 自然学者 → 光亮术。
 */
export function nextSlot(db: Db, slotId: string, picks: Record<string, string>): FeatureEntry | null {
  const c = picks[slotId];
  if (!c) return null;
  const f = db.features[c];
  return f && f.choices && f.choices.length ? f : null;
}

/** key 这个槽位或选择在当前 picks 下是否真的可达（沿着活着的链往下走） */
export function reachable(
  db: Db, roots: FeatureEntry[], picks: Record<string, string>, key: string,
): boolean {
  if (roots.some((r) => r.id === key)) return true;
  return livePicks(db, roots, picks).some((p) => p.slot === key || p.choice === key);
}

/**
 * 一个槽位 + 它下面层层嵌套的子选择。层级是数据驱动的：
 * 只要「选中的那个东西」自己还是个选择表，就再渲染一层。
 */
export function SlotChain(props: {
  db: Db;
  root: FeatureEntry;
  picks: Record<string, string>;
  verdict: (fid: string) => Verdict;
  onChange: (slotId: string, value: string | null) => void;
  depth?: number;
  /** 上一层的选择名，用来给子槽位做标题 */
  from?: string;
  /** 神话能力槽那种贴图框（素材皮用），逐层往下传 */
  icoFrame?: string;
}) {
  const { db, root, picks, verdict, onChange, depth = 0, from, icoFrame } = props;
  const child = nextSlot(db, root.id, picks);
  const cur = picks[root.id];
  return (
    <>
      <PickSlot
        db={db}
        slot={root}
        value={cur || null}
        verdict={verdict}
        onChange={(v) => onChange(root.id, v)}
        title={from ? `${from} › ${label(root)}` : undefined}
        hint={depth > 0 ? "这是上一项选择带出来的后续选择" : undefined}
        icoFrame={icoFrame}
      />
      {child && (
        <SlotChain
          db={db}
          root={child}
          picks={picks}
          verdict={verdict}
          onChange={onChange}
          depth={depth + 1}
          from={cur ? label(db.features[cur]) : from}
          icoFrame={icoFrame}
        />
      )}
    </>
  );
}

/** 从参数标签里把「名字|guid」拆成可选项（旧数据只有名字时兜底用名字当 id） */
export function mergeParamOptions(variants: string[]) {
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const v of variants) {
    const [nm, gid] = v.split("|");
    const id = gid || nm;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: nm });
  }
  return out;
}

/** SelectionFeatureGroup → 中文 */
export function paramGroupText(group: string | undefined): string {
  if (group === "Domain") return "领域";
  if (group === "Bloodline") return "血统";
  if (group === "School") return "学派";
  if (group === "Deity") return "神祇";
  return "参数";
}

/**
 * 沿「活着的选择链」收集所有还需要再选一次参数的已选项。
 * 实现在 rules.ts（纯规则，能在无头自检里跑），这里只是转出给视图用。
 */
export { pickedParams } from "./rules";

/** 参数化专长的参数选择行 */
export function ParamField(props: {
  f: FeatureEntry;
  value: string | null;
  onChange: (id: string | null) => void;
  /** 同一个特性要选多个参数时的序号提示（1 表示第一个，或省略） */
  index?: number;
  width?: number;
}) {
  const { f, value, onChange, index = 1, width = 260 } = props;
  const kind = paramGroupText(f.paramGroup);
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 4 }}>
      <span className="muted small">
        {label(f)} 的{kind}
        {index > 1 ? `（第 ${index} 个）` : ""}
      </span>
      <SearchSelect
        value={value}
        options={mergeParamOptions(f.paramVariants || [])}
        onChange={onChange}
        placeholder={`选择${kind}`}
        width={width}
      />
    </div>
  );
}
