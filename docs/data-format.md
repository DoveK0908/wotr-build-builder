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

- **点买花费表**：全库搜不到 `PointBuy`/`AttributePoints`，标准 25 点表（7:-4 … 18:17）写在 `build_data.py` 的 `POINT_BUY`
- **技能 → 关键属性**：蓝图里没有这张映射，写在 `web/src/rules.ts` 的 `SKILL_ATTR`
- **技能枚举别名**：职业的 `ClassSkills` 里有 `SkillThievery`（= 巧手 Trickery）、`CheckIntimidate`（不是技能，丢弃）
- **金龙道途的显示名**：`GoldenDragonClass` 的 `m_DisplayName` 与 `LocalizedName` 都是空的，用 `MYTHIC_PATH_NAMES` 硬编码「金龙」
- **种族的任选属性 +2**：人类 / 半精灵 / 半兽人的 `SelectableRaceStat` 只是个 `true`（没有数值），所以 +2 写在 `web/src/rules.ts` 的 `attrsAtLevel()` 里；界面用 `Build.raceStatPick` 记录选了哪一项

## 选择链：选择项本身可能还是选择表

蓝图里的「选择表」（`BlueprintFeatureSelection`）放进 `choices` 时，**池子里可能出现另一张选择表**，于是形成多层：

- 背景：`选择背景 → 学者 → 自然学者 → 光亮术`（`BackgroundsDruidSpellLikeSelection`）
- 专长：`战斗专长 → 战斗流派专长 → 弓术`、`额外专长 → 高等元素专攻`、`额外巫术（萨满）→ 秘咒`
- 种族：`种族传承 → 基本 → 一技之长`；人类/半精灵/半兽人的传承槽其实是「额外专长」（276 项）
- 神话：`神话能力 → 巅峰元素 / 转瞬即发 / 巅峰血承 / 奇迹领域`（神话能力 67 项、神话专长 48 项，奇数级给能力、偶数级给专长）

因此**不能**把 `children`/`choices` 当成扁平的候选列表来渲染：界面用 `web/src/pick.tsx` 的 `SlotChain` 沿「选中的东西是否还有 `choices`」逐层展开（最多 8 层），规则层用 `web/src/rules.ts` 的 `livePicks()` 只统计**当前真的可达**的那条链——换了上层选择后，残留在存档里的下层旧选择不会再泄漏进 `ownedFeatures()`。

⚠️ **重名蓝图**：`学者` 下面的三项里，「自然学者」有两个蓝图 —— `Scholar/BackgroundScholarNature.jbp`（`BlueprintFeature`，0 个 choices，是背景本体）和 `Scholar/BackgroundsDruidSpellLikeSelection.jbp`（`BlueprintFeatureSelection`，5 个戏法）。**按名字查会走错**，必须顺着父级的 `choices`/`children` 用 id 往下走。同理 `奥法学者` 的戏法选择（`BackgroundsWizardSpellLikeSelection`）只挂在妮妮欧与术士预生成角色身上，**不属于背景**，已确认不在背景树里。

## 文件一览

| 文件 | 内容 |
| --- | --- |
| `rules.json` | 6 属性、11 技能、9 阵营、8 法术学派、点买表、角色通用升级表、各种选择表 id |
| `classes.json` | 40 个职业：生命骰、技能点、本职技能、BAB/三豁免进度表、升级表、变体列表、法术书 |
| `archetypes.json` | 197 个变体：`addFeatures`/`removeFeatures` 逐级增删、是否 `buildChanging`、换法术书、适用职业 |
| `features.json` | 10675 条特性（专长/职业能力/种族特性/背景/选择表…）：中文名与描述、选择池 `choices`、参数化专长的参数类型、前置条件、属性加值、授予的法术 |
| `spells.json` | 699 条法术：环位（按职业）、神话环位、范围、组件 |
| `spellLists.json` | 62 个法术列表（领域/血统/庇护主），按环位给法术 |
| `spellbooks.json` | 45 本施法书：施法属性、是否自发施法、是否已知全部法术、法术位表 |
| `races.json` | 12 个种族：体型、种族特性、传承选择、属性加值 |
| `backgrounds.json` | 55 条背景（10 个大类 + 45 个具体背景），用 `children` 表达层级 |
| `mythic.json` | 14 条道途（含 `higher`/`selectable`）+ 3 个神话选择表（超凡飞升 6 / 神话能力 67 / 神话专长 48） |
| `presets.json` | 24 套社区预置构筑，见 [`presets-source.md`](presets-source.md) |
| `meta.json` | 蓝图数、本地化条数、各文件大小、耗时、未解析引用 |

## 前置条件的数据格式

`features.json` 里每条特性的 `prereq` 是一个数组，元素形如 `{k, group, hide, ...}`：

- `group`: `All`（全部满足）或 `Any`（满足其一）
- `k` 的取值与对应字段：`feat{m_Feature}`、`nofeat`、`oneof{ids,amount}`、`stat{stat,value,full}`、`clvl{class,level}`、`nocl`、`alvl{class,arch,level}`、`noarch`、`prof{armor,weapon}`、`notprof`、`align{align}`、`chlvl{level}`、`classspell{class,level}`、`paramfeat`、`castertype`、`condition`、`ispet`/`pet`、`selpossible`、`classlevels`、`replacestat` 等（共 27 种组件）

前端对 `stat`/`clvl`/`alvl`/`feat`/`nofeat`/`oneof`/`align`/`chlvl` 这类可判定的做三态判定（`可用`/`前置不足`/`无法判定`），`condition` 这种逻辑树太复杂的保留原文展示，不拦人。

## 已知的无害异常

- 2 条非特性引用解析不到，直接原样展示：`02b4bdf2ef7b4296923219f361caec92`（不在库里）、`daca06a3f3355664bba1e87e67f3b5b3`（`Races/MongrelmanRace.jbp`，非玩家种族）
- 少量非玩家蓝图的本地化会取错名（如 `MythicLichSkeletonFighterClass` 解成「动物」），玩家可选内容不受影响
- 火球术等法术在 `Spells/CutsceneSpells/` 下有剧情副本没有环位，前端按路径去重，优先 `Spells/Level*`
