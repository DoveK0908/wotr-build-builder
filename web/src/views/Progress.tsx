import React, { useState } from "react";
import type { Db } from "../types";
import { Feats } from "./Feats";
import { Spells } from "./Spells";
import { Mythic } from "./Mythic";

/**
 * 第 ⑥ 步「逐级」：技能之后、神祇之前的所有内容合成这一大步。
 *
 * 里面三块（子页签切换）：
 *   ① 逐级专长与特性 —— 1..20 级逐级填：通用专长 / 职业特性槽 / 参数；
 *      卡片底部同时显示「并行的神话第 M 阶」（职业与神话是并行的）
 *   ② 法术 —— 各施法职业（含道途法术书）的已知法术
 *   ③ 神话阶层 —— 1..10 阶的道途与各阶选择
 *
 * 动态子块（职业的「先知诅咒 / 秘示域 …」、神话的「神话能力 / 骷髅战将 …」、
 * 道途法术书的「法术:等级 N」）不再各占一块牌匾，全部收在这里按级/按阶显示。
 */
export function Progress(props: { db: Db }) {
  const [tab, setTab] = useState<"feats" | "spells" | "mythic">("feats");
  return (
    <div className="progress">
      <div className="subnav">
        {(
          [
            ["feats", "逐级专长与特性"],
            ["spells", "法术"],
            ["mythic", "神话阶层"],
          ] as [typeof tab, string][]
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            className={"subtab" + (tab === id ? " on" : "")}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="progress-body">
        {tab === "feats" && <Feats db={props.db} />}
        {tab === "spells" && <Spells db={props.db} />}
        {tab === "mythic" && <Mythic db={props.db} />}
      </div>
    </div>
  );
}
