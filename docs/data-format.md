# 数据格式与设计说明

## 概述

`web/public/data/` 下的 JSON 全部由 `pipeline/build_data.py` 从本机游戏本体提取，前端只读它们，不读游戏目录。构建时 `public/data` 会原样复制到 `dist/data`。

管线在写盘**之前**会做硬校验：40 个职业的升级表/变体/法术书、197 个变体、14 条神话道途、12 个种族、55 个背景引用的每一条特性都必须落地，每条法术必须有环位；不通过就 `SystemExit(2)` 且一个文件都不写（避免前端拿到半成品数据）。

## 蓝图解析要点

游戏本体 `blueprints.zip` 里是 25 万个 `.jbp`（JSON）文件：

- 标识：`{"AssetId": "<32位guid>", "Data": {...}, "Meta": {...}}`
- 类型：`Data.$type` 形如 `"<guid>, BlueprintCharacterClass"`，取逗号后那段
- 交叉引用：字符串 `"!bp_<guid>"` 或 `{"guid": "<guid>"}` 两种写法都有，`ref()/refs()` 都认
- 本地化：`LocalizedString` 对象按 **`m_Key` → `Shared.stringkey` → 沿 `PrototypeLink` 上溯** 的顺序取键，再去 `Localization/zhCN.json` 的 `strings` 里查。**`Shared.assetguid` 不是本地化键**（踩过）
- 描述里有 Owlcat 富文本标记（`{g|Encyclopedia:X}…{/g}`、`{d|…}`、`{b}`），管线会清洗并截断到 800 字

## 权威名单：不要靠猜

「角色创建时能选什么」不在职业蓝图本身，而在 **`Root/BlueprintRoot.jbp` 的 `Data.Progression`**：

| 字段 | 含义 | 数量 |
| --- | --- | --- |
| `m_CharacterClasses` | 可选职业（27 基础 + 13 进阶） | 40 |
| `m_CharacterMythics` | 可选神话道途 | 14（其中 10 条对玩家可选） |
| `m_CharacterRaces` | 可选种族 | 12 |
| `m_FeatsProgression` | **角色通用升级表** | → `Classes/Basic/BasicFeatsProgression.jbp` |
| `m_BasicFeatSelection` | 通用专长槽的候选池 | 276 |
| `m_DeitySelection` | 神祇选择 | 33 |

早先试过的启发式（`HideInUI`、`StartingGold`、`m_Progression` 是否存在、`Groups` 里有没有 `BackgroundSelection`）**全都不可靠**：化形师不在任何职业分组表里却是可选职业；怪物职业的 `HideInUI` 也是 false；背景叶子的 `Groups` 是空数组。所以最终一律以 `Progression.m_Character*` 为准。

角色通用升级表给的是：**1 级**给一堆基础机制 + 选择背景 + 神祇选择，**3/5/7/…/19 级**各给一个通用专长（`BasicFeatSelection`）。这条数据不在任何职业的升级表里，漏掉就会「奇数级没有专长可点」。

## 游戏里没有、必须内置的常量

- **购点花费表**：全库搜不到 `PointBuy`/`AttributePoints`，标准 25 点表（7:-4 … 18:17）写在 `build_data.py` 的 `POINT_BUY`
- **技能 → 关键属性**：蓝图里没有这张映射，写在 `web/src/rules.ts` 的 `SKILL_ATTR`
- **技能枚举别名**：职业的 `ClassSkills` 里有 `SkillThievery`（= 巧手 Trickery）、`CheckIntimidate`（不是技能，丢弃）
- **金龙道途的显示名**：`GoldenDragonClass` 的 `m_DisplayName` 与 `LocalizedName` 都是空的，用 `MYTHIC_PATH_NAMES` 硬编码「金龙」
- **种族的任选属性 +2**：人类 / 半精灵 / 半兽人的 `SelectableRaceStat` 只是个 `true`（没有数值），所以 +2 写在 `web/src/rules.ts` 的 `attrsAtLevel()` 里；界面用 `Build.raceStatPick` 记录选了哪一项
- **神话道途按阶层算的属性加值**：神话阶层本身**不**给属性（游戏文本只写「奇数阶给神话能力、偶数阶给神话专长」，全库搜不到任何「提升阶层 +2 属性」的文案或蓝图）。加属性的是道途自己的特性，其中两条只有文字、没有数值组件，写在 `attrBreakdown()` 里：传奇 = 所有属性 +4（`Mythic/Legend` 的 `传奇` 特性只有 `m_Description`），恶魔的**高等恶魔之相** = 某一项属性 +（阶层的一半 + 1）（`威加魔相`→力量、`霸烙魔相`→体质、`空奢魔相`→智力、`遁影魔相`→感知；沤泥/食魂厉两相给 DR 与快速回复，不给属性）。其余带数值组件的（例如碎片之力的「诅咒之力」全属性 +4、龙脉术士的「属性增强」+2、深渊蛮力的血统加值）都已经由 `statBonuses` 自动计入
- **神话阶层与「神话英雄」的对应关系**：前几阶**没有道途**。`Mythic/MythicStartingClass.jbp`（`神话英雄`，非 `selectable`）有 7 级，第 1 阶给「超凡飞升」+ 一项神话能力、第 2 阶给神话专长（之后每阶奇数能力/偶数专长）。六条主道途（天使/恶魔/御衡者/灵使/诡计大师/巫妖）的升级表是 8 级 → **第 3 阶**才生效，映射关系是 `道途第 N 级 = 神话第 N + 2 阶`；金龙 / 虫群行者 / 魔鬼（3 级）与传奇（1 级）是晚期道途 → **第 8 阶**才生效，`N + 7`。7 + 3 = 10、2 + 8 = 10，正好盖满 10 阶 —— 这也是「起点 = 11 − 升级表级数」这条规则的由来，蓝图里**没有**任何字段直接写起点（`MythicCompanionClass.AdditionalLevel` 恒为 0）。前端用 `mythicHeroPath()` / `pathStartRank()` / `mythicSource()` 表达这条规则，阶层门控（只算走到的阶层）在 `ownedFeatures()`

## 选择链：选择项本身可能还是选择表

蓝图里的「选择表」（`BlueprintFeatureSelection`）放进 `choices` 时，**池子里可能出现另一张选择表**，于是形成多层：

- 背景：`选择背景 → 学者 → 自然学者 → 光亮术`（`BackgroundsDruidSpellLikeSelection`）
- 专长：`战斗专长 → 战斗流派专长 → 弓术`、`额外专长 → 高等元素专攻`、`额外巫术（萨满）→ 秘咒`
- 种族：`种族传承 → 基本 → 一技之长`；人类/半精灵/半兽人的传承槽其实是「额外专长」（276 项）
- 神话：`神话能力 → 巅峰元素 / 转瞬即发 / 巅峰血承 / 奇迹领域`（神话能力 67 项、神话专长 48 项，奇数级给能力、偶数级给专长）。**前两阶（晚期道途前七阶）的槽位来自「神话英雄」**，与是否选道途无关，见上一节

因此**不能**把 `children`/`choices` 当成扁平的候选列表来渲染：界面用 `web/src/pick.tsx` 的 `SlotChain` 沿「选中的东西是否还有 `choices`」逐层展开（最多 8 层），规则层用 `web/src/rules.ts` 的 `livePicks()` 只统计**当前真的可达**的那条链——换了上层选择后，残留在存档里的下层旧选择不会再泄漏进 `ownedFeatures()`。

⚠️ **重名蓝图**：`学者` 下面的三项里，「自然学者」有两个蓝图 —— `Scholar/BackgroundScholarNature.jbp`（`BlueprintFeature`，0 个 choices，是背景本体）和 `Scholar/BackgroundsDruidSpellLikeSelection.jbp`（`BlueprintFeatureSelection`，5 个戏法）。**按名字查会走错**，必须顺着父级的 `choices`/`children` 用 id 往下走。同理 `奥法学者` 的戏法选择（`BackgroundsWizardSpellLikeSelection`）只挂在妮妮欧与术士预生成角色身上，**不属于背景**，已确认不在背景树里。

## 文件一览

| 文件 | 内容 |
| --- | --- |
| `rules.json` | 6 属性、11 技能、9 阵营、8 法术学派、购点表、角色通用升级表、各种选择表 id |
| `classes.json` | 40 个职业：生命骰、技能点、本职技能、BAB/三豁免进度表、升级表、变体列表、法术书 |
| `archetypes.json` | 197 个变体：`addFeatures`/`removeFeatures` 逐级增删、是否 `buildChanging`、换法术书、适用职业 |
| `features.json` | 10675 条特性（专长/职业能力/种族特性/背景/选择表…）：中文名与描述、选择池 `choices`、参数化专长的参数类型、前置条件、属性加值、授予的法术 |
| `spells.json` | 699 条法术：环位（按职业）、神话环位、范围、组件 |
| `spellLists.json` | 62 个法术列表（领域/血统/庇护主），按环位给法术 |
| `spellbooks.json` | 45 本施法书：施法属性、是否自发施法、是否已知全部法术、法术位表 |
| `races.json` | 12 个种族：体型、种族特性、传承选择、属性加值 |
| `backgrounds.json` | 55 条背景（10 个大类 + 45 个具体背景），用 `children` 表达层级 |

## 一个职业只能有一个变体

游戏本体**不允许**同一个职业同时叠两个变体（桌面的 Pathfinder 允许「不冲突就叠」，Owlcat 没实现）——
社区为此专门做了 MOD（[Vek17/WrathMods-MultipleArchetypes](https://github.com/Vek17/WrathMods-MultipleArchetypes)，
描述就是「enables multiple compatible archetypes to be applied at the same time … using tabletop's standard rules」），
用 Toybox 也得先打开「Allow Multiple Archetypes When Selecting a New Class」这个开关。

规划器的对应处理：`Build.classArchetypes` 虽然还是 `Record<classId, string[]>`（分享码/预置沿用这个形状），
但**每个职业只会有一项** —— `act.toggleArchetype()` 选中新变体会顶掉旧的，再点一次取消，另有 `act.clearArchetype()`；
`migrate()` 与 `applyPreset()` 也会把外部塞进来的多个变体截断成第一个。
变体只能在该职业的第 1 级选（与游戏一致），界面也只在那一级的卡片上显示变体块。
| `mythic.json` | 14 条道途（含 `higher`/`selectable`）+ 3 个神话选择表（超凡飞升 6 / 神话能力 67 / 神话专长 48） |
| `presets.json` | 24 套社区预置构筑，见 [`presets-source.md`](presets-source.md) |
| `meta.json` | 蓝图数、本地化条数、各文件大小、耗时、未解析引用 |

## 前置条件的数据格式

`features.json` 里每条特性的 `prereq` 是一个数组，元素形如 `{k, group, hide, ...}`：

- `group`: `All`（全部满足）或 `Any`（满足其一）
- `k` 的取值与对应字段：`feat{m_Feature}`、`nofeat`、`oneof{ids,amount}`、`stat{stat,value,full}`、`clvl{class,level}`、`nocl`、`alvl{class,arch,level}`、`noarch`、`prof{armor,weapon}`、`notprof`、`align{align}`、`chlvl{level}`、`classspell{class,level}`、`paramfeat`、`castertype`、`condition`、`ispet`/`pet`、`selpossible`、`classlevels`、`replacestat`、`mrank{level}`、`mainchar{companion}`、`etude{id}` 等（共 30 种组件）

前端对 `stat`/`clvl`/`alvl`/`feat`/`nofeat`/`oneof`/`align`/`chlvl`/`mrank` 这类可判定的做三态判定（`可用`/`前置不足`/`无法判定`），`condition` 这种逻辑树太复杂的保留原文展示，不拦人；`mainchar`（仅主角/仅同伴）与 `etude`（剧情进度）恒为 `无法判定`，不拦人。

## 条件树：`PrerequisiteCondition` 怎么变成可算的前置（2026-10-17）

游戏里 29 条专长前置不是「有某特性/某属性」这种单条判断，而是一棵 `OrAndLogic` 条件树
（`ConditionsChecker.Operation` + `Conditions[]`，节点带 `Not`）。管线把树拆成可求值的小结构：

| 叶子类型（`t`） | 来源组件 | 字段 | 前端怎么算 |
| --- | --- | --- | --- |
| `fact` | `ContextConditionHasFact` | `id` | 构筑里有没有这个特性 |
| `factrank` | `ContextConditionBuffRank` | `id` + `min` | 这个特性**拿了几遍** ≥ min（`UseFactInsteadBuff` 时取 `Fact`） |
| `class` | `ContextConditionCharacterClass` | `id` + `min` | 该职业等级 ≥ min |
| `mrank` | `IsUnitMythicLevel` | `min` | 神话阶层 ≥ min |
| `align` | `ContextConditionAlignment` | `v` | 阵营是否在允许集合里 |
| `other` | `ContextConditionBuffRank` 之外的 Buff 类 | `type` | 判不出来 → 不拦人（显示「条件复杂（类型名）」） |

要点：

- `factrank` 是这批条件里最关键的一类 —— 「额外奥秘 / 额外奥能技艺 / 额外科研发现 / 额外救赎 / 额外狂暴特技」
  这些**可以重复拿、但有上限**的专长，游戏就是用「该特性层数 < 3」来表达上限。判定时要数
  「这个构筑里选了几遍」，不能只看集合里有没有（`LevelCtx.factCount`）。
- `weaponcond`（`PrerequisiteConditionForWeaponCategory`）只是「有某武器擅长时才附带一条额外条件」的**展示项**，
  真正的门槛由同一蓝图上的 `PrerequisiteProficiency` 表达；它的文案是空串，明细里会被滤掉，不参与判定。
- **暂不拦人的三类口径调整**（2026-10-17 用户确认「先按不拦人处理」）：
  `ReplaceStatForPrerequisites`（算前置时改用另一个属性）、`PrerequisiteSelectionPossible`（只影响「还能不能选」的提示）、
  `ClassLevelsForPrerequisites`（算前置时按另一个职业的等级算，变体常用）。它们改的是「怎么算」，不是门槛本身；
  目前 `evalPrereq` 对这三类返回 `unknown`，既不判失败也不判通过 —— **别当成 bug 去「修」**。
- 文案：`factrank` → 「已有 N 层：X」、`fact` → 「已有：X」、树 → 用「且 / 或」连接，`Not` 包一层「非（…）」。

## 已知的无害异常

- 2 条非特性引用解析不到，直接原样展示：`02b4bdf2ef7b4296923219f361caec92`（不在库里）、`daca06a3f3355664bba1e87e67f3b5b3`（`Races/MongrelmanRace.jbp`，非玩家种族）
- 少量非玩家蓝图的本地化会取错名（如 `MythicLichSkeletonFighterClass` 解成「动物」），玩家可选内容不受影响
- 火球术等法术在 `Spells/CutsceneSpells/` 下有剧情副本没有环位，前端按路径去重，优先 `Spells/Level*`


## 阵营限制（职业 / 变体 / 神祇 / 领域）

`PrerequisiteAlignment` 的 `Alignment` 字段是 **token 列表**，token 既可能是具体阵营（`LawfulGood`、`TrueNeutral`），
也可能是**轴**（`Lawful`、`Chaotic`、`Good`、`Evil`、`Neutral`）。前端 `alignAllows()` 先把轴展开成具体阵营再比对
（`Lawful` → 守序善良 / 守序中立 / 守序邪恶），所以「守序」这种写法也能正确判定。

限制分散在四个地方：

| 位置 | 落在哪个导出文件 | 实测 |
| --- | --- | --- |
| 职业蓝图自身的 `Components` | `classes.json` 的 `prereq` | 40/40 个职业都带 `prereq`；圣武士 `LawfulGood`、武僧/地狱骑士/地狱骑士持节士 `Lawful`、德鲁伊与化形师 `NeutralGood, LawfulNeutral, TrueNeutral, ChaoticNeutral, NeutralEvil`、野蛮人 `NeutralGood, TrueNeutral, NeutralEvil, Chaotic`、刺客 `TrueNeutral, Evil`。同一字段还带别的门槛（地狱骑士要 BAB 5 + 沟通 5 + 知识：神秘 2 + 擅长重甲） |
| 变体蓝图自身的 `Components` | `archetypes.json` 的 `prereq` | 8/203 个变体带阵营要求：觅血者/暗元素使 `Evil`、改革邪魔 `Good`、平衡之祭司 `LawfulNeutral, TrueNeutral, ChaoticNeutral`、醉拳僧与狂暴易形者 `NeutralGood, TrueNeutral, NeutralEvil, Chaotic`、瘟疫先知 `TrueNeutral, NeutralEvil, ChaoticEvil`、暗姐妹 `ChaoticNeutral, NeutralEvil, ChaoticEvil` |
| 神祇特性 | `features.json` 里各神祇的 `prereq` | 33 个神祇里 31 个带 `align`（阿巴达 `TrueNeutral, Lawful`、艾奥梅黛 `LawfulGood, NeutralGood, LawfulNeutral`、诺格巴 `TrueNeutral, Evil`…），只有「无神论」没有限制。游戏自己的百科文本也写着「各神祇还会限制你对起始阵营和特定职业的选择」 |
| 领域 / 忠诚类特性 | `features.json` 的 `prereq` | 善良领域 `Good`、守序领域 `Lawful`，并且用 `PrerequisiteFeature` 指向该神祇的特性 —— 所以**选错神祇连领域都开不出来** |

### 变体的阵营要求「取代」母职业的要求（不是取并集）

全库 197 个变体 × 39 个职业里只有一处出现互斥：**武僧（`Lawful`）× 醉拳大师（`NeutralGood, TrueNeutral, NeutralEvil, Chaotic`）**
——两个集合**交集为空**。按「同时满足」判定的话，醉拳大师对任何角色都不可选，显然不对；游戏自己给这个变体标的分类就是
「**Alignment: Any non-lawful**」（Reddit / Steam 指南 / fextralife 三处一致）。数据层面也有旁证：全库 32 个带 `align`
的组件里，只有醉拳大师这一条带 `IngorePrerequisiteCheck: True`（拼写就是如此），武僧本体的那条是 `False`。

所以规则定为：**变体自带阵营要求时以变体为准**（`rules.ts` 的 `classAlignTokens()`、`alignOverrideOf()`）。
连带放宽职业下拉：只要「母职业要求满足，或者该职业有一个自带阵营要求、且当前阵营满足它的变体」就允许选该项
（`classSelectableAt()` 会一并返回 `viaArchetype`，界面提示「需要 守序，或选「醉拳大师」则改为它的阵营要求」）。
反向也照实报：守序善良的武僧一旦勾上醉拳大师，`alignConflicts()` 会给出
`武僧 · 醉拳大师 需要 任意非守序`。

为确认「只有这一处」，做过两轮全库交叉核对（`arch1.mjs` 对全部「母职业 × 其名下变体」的阵营集合求交集；
`arch5.py` 再对全部前置组件种类做矛盾检测）：交集为空且两边都非空的组合**只有 1 个**，就是武僧 × 醉拳大师，
其余变体的阵营要求都是母职业要求的子集或同义写法，不需要特殊处理。

⚠ 早期只有**特性**导出了 `prereq`，职业与变体蓝图的 `Components` 被丢掉了，于是「圣武士可以是混乱邪恶」这类漏洞在
2026-10-16 的修复里才补上：`classes.json` / `archetypes.json` 现在也带 `prereq`（重新跑一次 `python pipeline\build_data.py`
即可，`classes.json` 从 125 KB 涨到 137 KB）。

前端行为：阵营下拉把与已选职业/变体/神祇冲突的阵营标灰并写出原因；神祇下拉把与当前阵营不符的信仰标灰
（提示 `需要 守序 / 绝对中立`）；职业下拉标注「阵营不符」并禁用该选项；变体 chip 标红并拒绝点选。
已经排好的构筑出现冲突时，`derive().unfinished` 会带上 `阵营不符：圣武士 需要 守序善良`，角色页与汇总页都会显示。

**有意与游戏不同**：游戏里神祇选定后不可更改（阵营在部分流程里也是），规划器**允许随时改**——这是刻意的，
方便对比不同信仰/阵营的构筑；改了阵营会立刻按新阵营重判职业、变体、神祇与领域（冲突项标灰并给出原因）。

## 前置条件普查（2026-10-16）

对 `Classes/`、`Feats/`、`Mythic/`、`Traits/`、`Spells/` 等 16712 个蓝图做了一次组件普查，把
`Prerequisite*` 组件的出现次数与字段名全部核对了一遍，结论与改动：

| 发现 | 说明 | 处置 |
| --- | --- | --- |
| 组件共 30 种 | 出现次数最多的是 `PrerequisiteFeature` 1231、`NoFeature` 848、`NoArchetype` 509、`ClassLevel` 444、`StatValue` 286、`FeaturesFromList` 194、`ClassSpellLevel` 188、`ArchetypeLevel` 163、`Condition` 162、`NoClassLevel` 159、`Alignment` 79、`Proficiency` 45、`IsPet` 43 | 全部映射进 `{k, group, hide, ...}` |
| 原先漏了 3 种 | `PrerequisiteMythicLevel`（3 处：魔鬼 / 金龙 / 虫群行者，`Level: 7`）、`PrerequisiteMainCharacter`（13 处，`Companion` 真假）、`PrerequisiteEtude`（16 处，剧情卷标） | 补成 `mrank{level}` / `mainchar{companion}` / `etude{id}` |
| `oneof` 有 `amount` | `PrerequisiteFeaturesFromList` 的 `Amount` 分布是 1×176、0×8、2×1、4×1、3×1 —— 有 3 条要求「满足 2 项及以上」 | 前端按 `amount` 计数判定，不再只看「有没有一项」 |
| **选择表可以「不检查前置」** | `IgnorePrerequisites: true` 共 **88 个 `BlueprintFeatureSelection`**（圣教军额外专长、战士额外专长、武僧额外专长、游荡者天赋…… 游戏里显示为「不检查前置条件」） | `features.json` 里带 `ignorePrereq: true`，槽位与候选不再标「前置不足」而标「不检查前置」 |
| 道途自带门槛 | 天使/灵使/御衡者/恶魔的升级表带 `etude`；金龙/魔鬼/虫群行者带 `mainchar` + `mrank 7` + `etude` | 神话页对道途做三态判定：`mrank` 可判定（选金龙但只有 3 阶 → 「门槛未达：神话阶层 ≥ 7」），`mainchar`/`etude` 恒 `无法判定`、不拦人 |
| `m_Prerequisite` / `IgnorePrerequisites` 不在组件里 | 在 `Components[]` 内扫描 `m_Prerequisite`(~131 次) 与 `IgnorePrerequisites`(460 次) 命中均为 **0** —— 它们其实是蓝图**根** `Data` 上的字段，组件层面没有漏读的开发量 | 无需处理（`IgnorePrerequisites` 已按上面的方式读取） |


## proficiencies.json

武器 / 护甲的「擅长」在数据里是内部 token（`Light`、`Dagger`、`HeavyShield`…），
玩家看到的是中文名。这个文件由 `pipeline/make_prof_cn.py` 生成：

```json
{ "weapon": { "Dagger": "匕首", "Longsword": "长剑" },
  "armor":  { "Light": "轻甲", "TowerShield": "塔盾" } }
```

- 护甲 / 盾牌 / 天生武器没有「武器类型蓝图」，用固定叫法（脚本里两张小表）。
- 普通武器按**物品名反推**：武器类型蓝图自己没有本地化名字，但「精制品匕首 / 寒铁巨剑 /
  +1炽焰细剑」这类物品名带着基名，剥掉词缀后取最常见的那个。
- 覆盖：游戏里出现的 71 种玩家向武器 token **全部有中文名**；剩下 59 种是怪物天生攻击
  （`BiteDragonType` 之类），规划器用不到。
