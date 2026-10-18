import React, { useMemo, useState } from "react";
import type { Db, FeatureEntry } from "../types";
import { act, useBuild } from "../store";
import { backgroundRoot, childFeatures, label } from "../rules";
import { Chip, Desc } from "../ui";
import { reachable } from "../pick";
import { DetailHead, IconGrid, ListPane, ListRow, PinBar, Sect, StatRows, ThreePane } from "../pane";
import { featureIcon } from "../skin";

/** 游戏里背景的显示顺序（照实机 1704xx / 1705xx 那组截图抄的，不是数据顺序） */
const GROUP_ORDER = ["修士", "出身地区", "学者", "工匠", "无", "武者", "流浪者", "街巷流浪儿", "贵族"];
const CHILD_ORDER: Record<string, string[]> = {
  修士: ["习武者", "侍祭", "医师"],
  出身地区: [
    "乌斯塔拉夫农民", "切利亚克斯魔鬼学者", "卡蒂拉游民", "奈克斯学术家", "奥肯斯塔炼金师",
    "安多安外交官", "欧西里昂历史学家", "河域诸国亡命徒", "瓦里西亚探索者", "盖布死灵师",
    "莽迹猎人", "蒙蒂维孤儿", "蛇龙王之地勇士", "镣铐群岛海盗", "阿尔多瑞剑客",
  ],
  学者: ["奥法学者", "神圣学者", "自然学者"],
  自然学者: ["光亮术", "恩赐", "提升抗力", "神导术", "闪光术"],
  工匠: ["伐木工", "农民", "矿工", "铁匠"],
  武者: ["卫兵", "角斗士", "赏金猎人", "佣兵"],
  流浪者: ["游民", "猎人", "隐士"],
  街巷流浪儿: ["劫匪", "扒手", "杂耍艺人"],
  贵族: ["侍臣", "特使", "领袖"],
};

const orderOf = (key: string, names: string[]): string[] => {
  const want = CHILD_ORDER[key] || (key === "" ? GROUP_ORDER : []);
  const idx = (n: string) => {
    const i = want.indexOf(n);
    return i < 0 ? 999 : i;
  };
  return [...names].sort((a, b) => idx(a) - idx(b));
};

/** 第 ③ 步：背景（大类 → 具体背景 → 有些背景还要再选一项），左栏做成可展开/收起的折叠列表 */
export function Background(props: { db: Db }) {
  const { db } = props;
  const build = useBuild();
  const [hover, setHover] = useState<string | null>(null);
  /** 点一下锁定查看这一项（再点一次取消） */
  const [pinned, setPinned] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open1, setOpen1] = useState<string | null>(null); // 展开的大类
  const [open2, setOpen2] = useState<string | null>(null); // 展开的二级选择表（如自然学者）

  const bgRootSlot = backgroundRoot(db);
  const bgPicks = build.bgPicks || {};
  const companionOnly = useMemo(() => {
    const s = new Set<string>();
    for (const b of Object.values(db.backgrounds)) if (b.companionOnly) s.add(b.id);
    return s;
  }, [db]);

  const isGroup = (id: string): boolean => {
    const f = db.features[id];
    return !!(f && f.choices && f.choices.length);
  };
  const kidsOf = (id: string | null): string[] => {
    if (!id) {
      const slot = bgRootSlot;
      if (!slot) return [];
      return (slot.choices || []).filter((x) => !companionOnly.has(x) && !!db.features[x]);
    }
    if (!isGroup(id)) return [];
    return (db.features[id].choices || []).filter((x) => !!db.features[x]);
  };

  const rootOptions = useMemo(() => {
    const ids = kidsOf(null);
    return orderOf("", ids.map((id) => label(db.features[id])))
      .map((name) => ids.find((id) => label(db.features[id]) === name))
      .filter((x): x is string => !!x);
  }, [db, bgRootSlot, companionOnly]);

  /** 当前选择路径：[大类, 具体背景, 子选择] */
  const path = useMemo(() => {
    const out: string[] = [];
    let slot: FeatureEntry | undefined = bgRootSlot;
    for (let d = 0; slot && d < 4; d += 1) {
      const chosen = bgPicks[slot.id];
      if (!chosen) break;
      out.push(chosen);
      const f = db.features[chosen];
      slot = f && f.choices && f.choices.length ? f : undefined;
    }
    return out;
  }, [db, bgRootSlot, bgPicks]);

  const picked = path.length ? path[path.length - 1] : null;
  const pickedGroup = path[0] || null;

  const pick = (ids: string[]) => {
    const next: Record<string, string> = {};
    let slot: FeatureEntry | undefined = bgRootSlot;
    for (const id of ids) {
      if (!slot) break;
      next[slot.id] = id;
      const f = db.features[id];
      slot = f && f.choices && f.choices.length ? f : undefined;
    }
    const roots: FeatureEntry[] = bgRootSlot ? [bgRootSlot] : [];
    for (const key of Object.keys(next)) if (!reachable(db, roots, next, key)) delete next[key];
    act.setBgPicks(next, ids.length ? ids[ids.length - 1] : null);
  };

  const toggleGroup = (id: string) => {
    if (!isGroup(id)) {
      pick([id]); // 「无」这类直接就是叶子
      setOpen1(null);
      setOpen2(null);
      return;
    }
    setOpen1((cur) => (cur === id ? null : id));
    setOpen2(null);
  };

  const kw = q.trim().toLowerCase();
  const hit = (id: string): boolean => {
    const f = db.features[id];
    const self = (label(f) + " " + (f?.nameEn || "")).toLowerCase().includes(kw);
    if (self) return true;
    return kidsOf(id).some((k) => {
      const c = db.features[k];
      return (label(c) + " " + (c?.nameEn || "")).toLowerCase().includes(kw);
    });
  };

  const focusId = pinned || hover || picked || rootOptions[0] || null;
  const focus = focusId ? db.features[focusId] : null;
  const focusChildren = focus ? childFeatures(db, focus) : [];

  const row = (id: string, depth: number, onOpen?: () => void) => {
    const f = db.features[id];
    const group = isGroup(id);
    const expanded = (depth === 1 && open1 === id) || (depth === 2 && open2 === id);
    return (
      <ListRow
        key={id}
        ico={featureIcon(db, id)}
        glyph={label(f).slice(0, 1)}
        name={label(f)}
        sub={depth === 1 ? f?.nameEn : undefined}
        arrow={group ? expanded : undefined}
        sel={group ? expanded : picked === id}
        title={pinned === id ? "点击取消固定" : "点击固定这一项"}
        onClick={() => {
          setPinned((cur) => (cur === id ? null : id));
          (onOpen || (() => pick(depth === 1 ? [id] : [pickedGroup || "", id])))();
        }}
        onHover={() => setHover(id)}
      />
    );
  };

  return (
    <ThreePane
      left={
        <ListPane
          title={<span>选择背景</span>}
          search={q}
          onSearch={setQ}
          foot={
            path.length ? (
              <span>已选：{path.map((id) => label(db.features[id])).join(" › ")}</span>
            ) : (
              <span>点大类展开，再点具体背景；点已展开的大类可收起。</span>
            )
          }
        >
          {rootOptions
            .filter((id) => !kw || hit(id))
            .map((gid) => {
              const gname = label(db.features[gid]);
              const kids = kidsOf(gid);
              const expanded = open1 === gid;
              return (
                <React.Fragment key={gid}>
                  {row(gid, 1, () => toggleGroup(gid))}
                  {expanded && (
                    <div className="lrow-sub">
                      {orderOf(gname, kids.map((k) => label(db.features[k])))
                        .map((nm) => kids.find((k) => label(db.features[k]) === nm))
                        .filter((x): x is string => !!x)
                        .map((kid) => {
                          const kidGroup = isGroup(kid);
                          const kidName = label(db.features[kid]);
                          const grand = kidsOf(kid);
                          return (
                            <React.Fragment key={kid}>
                              <ListRow
                                ico={featureIcon(db, kid)}
                                glyph={kidName.slice(0, 1)}
                                name={kidName}
                                arrow={kidGroup ? open2 === kid : undefined}
                                sel={kidGroup ? open2 === kid : picked === kid}
                                title={pinned === kid ? "点击取消固定" : "点击固定这一项"}
                                onClick={() => {
                                  setPinned((cur) => (cur === kid ? null : kid));
                                  if (kidGroup) setOpen2((cur) => (cur === kid ? null : kid));
                                  else pick([gid, kid]);
                                }}
                                onHover={() => setHover(kid)}
                              />
                              {kidGroup && open2 === kid && (
                                <div className="lrow-sub">
                                  {orderOf(kidName, grand.map((k) => label(db.features[k])))
                                    .map((nm) => grand.find((k) => label(db.features[k]) === nm))
                                    .filter((x): x is string => !!x)
                                    .map((leaf) => (
                                      <ListRow
                                        key={leaf}
                                        ico={featureIcon(db, leaf)}
                                        glyph={label(db.features[leaf]).slice(0, 1)}
                                        name={label(db.features[leaf])}
                                        sel={picked === leaf}
                                        title={pinned === leaf ? "点击取消固定" : "点击固定这一项"}
                                        onClick={() => {
                                          setPinned((cur) => (cur === leaf ? null : leaf));
                                          pick([gid, kid, leaf]);
                                        }}
                                        onHover={() => setHover(leaf)}
                                      />
                                    ))}
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
        </ListPane>
      }
      center={
        !focus ? (
          <div className="muted">在左边选一个背景。</div>
        ) : (
          <>
            <DetailHead
              ico={featureIcon(db, focus.id)}
              glyph={label(focus).slice(0, 1)}
              title={label(focus)}
              en={focus.nameEn}
              big
            />
            <PinBar
              pinned={pinned === focus.id}
              onUnpin={() => {
                setHover(focus.id);
                setPinned(null);
              }}
            />
            {focus.desc ? <Desc text={focus.desc} limit={900} /> : <div className="muted small">没有说明文本。</div>}

            {focusChildren.length > 0 && (
              <Sect title={`再选一项（${focusChildren.length}）`}>
                <IconGrid
                  cols={2}
                  items={focusChildren.map((c) => ({
                    id: c.id,
                    name: label(c),
                    ico: featureIcon(db, c.id),
                    title: c.desc,
                  }))}
                />
              </Sect>
            )}

            {focus.proficiencies && (focus.proficiencies.armor?.length || focus.proficiencies.weapon?.length) ? (
              <Sect title="获得擅长">
                <div className="row wrap">
                  {(focus.proficiencies.armor || []).map((p) => (
                    <Chip key={"a" + p}>护甲：{p}</Chip>
                  ))}
                  {(focus.proficiencies.weapon || []).map((p) => (
                    <Chip key={"w" + p}>武器：{p}</Chip>
                  ))}
                </div>
              </Sect>
            ) : null}

            {focus.knownSpells && focus.knownSpells.length > 0 && (
              <Sect title="赠送法术">
                <IconGrid
                  cols={3}
                  items={focus.knownSpells.map((ks) => ({
                    id: ks.id,
                    name: db.spells[ks.id]?.name || ks.id,
                    ico: featureIcon(db, ks.id),
                    glyph: (db.spells[ks.id]?.name || "?").slice(0, 1),
                  }))}
                />
              </Sect>
            )}
          </>
        )
      }
      right={
        <>
          <Sect title="已选背景">
            <StatRows
              items={path.map((id, i) => [["大类", "具体背景", "再选一项"][i] || "附加", label(db.features[id])])}
              dense
            />
            {!path.length && (
              <div className="muted small">还没选。背景会给本职技能、技能加值或一项额外专长。</div>
            )}
          </Sect>

          {picked && db.backgrounds[picked] && (
            <Sect title="最终背景">
              <StatRows
                items={[
                  ["名称", db.backgrounds[picked].name],
                  ["英文", db.backgrounds[picked].nameEn || "—"],
                ]}
              />
            </Sect>
          )}
          {path.length === 1 && (
            <div className="muted small" style={{ marginTop: 6 }}>
              还差一步：在左边展开后选一个具体背景（有的还要再选一项）。
            </div>
          )}
        </>
      }
    />
  );
}
