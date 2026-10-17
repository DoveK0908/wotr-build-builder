import { useSyncExternalStore } from "react";
import type { Db } from "./types";
import { Chip, Desc, Modal } from "./ui";
import { featureIcon } from "./skin";
import { prereqText } from "./rules";

/**
 * 「点一下看详情」的全局开关。
 *
 * 任何一个视图只要 `onDetail={openDetail}` 就能让条目可点，详情框由 App 里的
 * `<DetailHost db={db} />` 统一渲染一次（不用每个视图各自维护状态）。
 */
let current: string | null = null;
const subs = new Set<() => void>();

function emit() {
  for (const f of subs) f();
}

export function openDetail(id?: string | null): void {
  current = id || null;
  emit();
}

export function closeDetail(): void {
  current = null;
  emit();
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** 放在 App 顶层渲染一次 */
export function DetailHost(props: { db: Db }) {
  const id = useSyncExternalStore(subscribe, () => current, () => current);
  if (!id) return null;
  const e: any = props.db.features[id] || props.db.spells[id] || props.db.races[id]
    || props.db.classes[id] || props.db.archetypes[id] || {};
  return (
    <Modal title={e.name || "详情"} onClose={closeDetail} wide>
      <EntityBody db={props.db} id={id} />
    </Modal>
  );
}

/** 法术目标：数据里是四个布尔，拼成「敌人 / 盟友」这种文本 */
function targetText(sp: { targets?: any }): string {
  const t = sp.targets;
  if (!t || typeof t !== "object") return typeof t === "string" && t ? t : "—";
  const parts = [
    t.enemies ? "敌人" : "",
    t.friends ? "盟友" : "",
    t.self ? "自身" : "",
    t.point ? "地点" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}

/** 一个特性 / 法术 / 种族 / 职业 / 变体的详情体 */
export function EntityBody(props: { db: Db; id: string }) {
  const { db, id } = props;
  const f = db.features[id];
  const sp = db.spells[id];
  const race = db.races[id];
  const cls = db.classes[id];
  const arch = db.archetypes[id];
  const any: any = f || sp || race || cls || arch || {};
  const name = any.name || any.nameEn || id.slice(0, 8);
  const nameEn = any.nameEn || "";
  const desc = any.desc || "";
  const ico = featureIcon(db, id);
  const groups: string[] = any.groups || [];
  const prereqs: any[] = any.prereq || [];
  const kind = f
    ? f.choices?.length
      ? "选择项"
      : "特性"
    : sp
      ? "法术"
      : race
        ? "种族"
        : cls
          ? cls.prestige
            ? "进阶职业"
            : "基础职业"
          : arch
            ? "变体"
            : "条目";
  return (
    <div className="entity">
      <div className="dhead">
        {ico ? (
          <img className="dhead-ico detail-ico" src={ico} alt="" />
        ) : (
          <span className="dhead-glyph">{name.slice(0, 1)}</span>
        )}
        <div className="dhead-txt">
          <h3 className="dhead-title">{name}</h3>
          {nameEn && <div className="dhead-en">{nameEn}</div>}
        </div>
      </div>
      <div className="row wrap mt6">
        <Chip>{kind}</Chip>
        {f?.type && <Chip>{f.type}</Chip>}
        {sp?.school && <Chip>{sp.school}</Chip>}
        {sp?.range && <Chip>{sp.range}</Chip>}
        {cls?.hitDie && <Chip>HD {cls.hitDie}</Chip>}
        {cls?.maxLevel ? <Chip>最高 {cls.maxLevel} 级</Chip> : null}
        {groups.map((g) => <Chip key={g}>{g}</Chip>)}
      </div>

      {sp && (
        <div className="srows mt8">
          {[
            ["目标", targetText(sp)],
            ["施法时间", sp.action || "—"],
            ["持续时间", sp.duration || "—"],
            ["豁免检定", sp.saveText || "—"],
          ].map(([k, v]) => (
            <div className="srow" key={k as string}>
              <span className="sk">{k}</span>
              <span className="sv">{v}</span>
            </div>
          ))}
        </div>
      )}

      <Desc text={desc} limit={2000} />

      {prereqs.length > 0 && (
        <div className="prereq mt8">
          <div className="prereq-title">前置条件</div>
          <ul>
            {prereqs.map((p, i) => (
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
    </div>
  );
}

/** 列表行/芯片用：有东西可看就返回 handler，否则 undefined */
export function detailOf(db: Db, id?: string | null): (() => void) | undefined {
  if (!id) return undefined;
  if (!(db.features[id] || db.spells[id] || db.races[id] || db.classes[id] || db.archetypes[id])) {
    return undefined;
  }
  return () => openDetail(id);
}
