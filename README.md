# 开拓者：正义之怒 · 构筑规划器（网页版）

[rt-planner](https://rt-planner.pages.dev/) 式的《Pathfinder: Wrath of the Righteous》**中文**构筑规划器。

与网上流传的构筑资料不同，**本项目的全部数据都不是手抄的**：直接从本机安装的游戏本体解包提取——

- `blueprints.zip`：25 万个游戏蓝图（职业、变体、专长、法术、神话道途、种族、背景……），含逐级升级表与前置条件
- `StreamingAssets/Localization/zhCN.json`：11 万条**官方简体中文**名称与描述

因此规划器里的每一个专长名、每一段描述、每一条「前置要求」都是游戏原版数据；连「角色创建时能选哪些职业/种族/神话道途」也是读游戏自己的 `BlueprintRoot.Progression` 拿到的，不是手写清单。

## 功能

- **角色**：种族（含传承选择、人类/半精灵/半兽人的任选属性 +2）、背景（按游戏里的层级选：大类 → 具体背景 → 有些背景还要再选一项，例如自然学者要选一个德鲁伊戏法）、阵营、神祇、属性点买（标准 25 点表）、角色创建时自动获得的东西
- **升级（1–20 级）**：逐级选职业（27 基础 + 13 进阶）、选变体、填每个选择槽；奇数级的**通用专长**来自游戏的角色通用升级表；参数化专长（武器专攻、法术专攻、超魔……）会额外要求你选参数
- **选择里的选择**：很多选择项本身又是选择表（`战斗专长 › 战斗流派专长`、`额外专长 › 高等元素专攻`、`神话能力 › 巅峰元素`、`种族传承 › 基本 › 一技之长`……），界面会一层层往下展开；改写上层后，下层不再可达的旧选择会被丢掉，不会悄悄留在构筑里
- **前置校验**：每一条候选都会实时判定 `可用 / 前置不足 / 无法判定`，并把不满足的条件用中文写出来（属性、职业等级、前置专长、选择列表……）
- **神话**：10 条可选道途、10 个神话等级、神话能力/神话专长轮换
- **技能**：本职技能、逐级技能点、关键属性调整
- **法术**：每个施法职业的已知/每日法术位、按环位选择法术、领域/血统/庇护主额外送的法术
- **汇总**：角色卡、战斗数值（BAB/AC/生命/三豁免）、升级记录、未选完清单
- **分享与存档**：分享链接（`#b=…`）、构筑代码（可粘贴回填）、JSON 导出/导入
- **预置构筑**：内置 24 套中文队友 BD（来源与解析说明见 [`docs/presets-source.md`](docs/presets-source.md)），一键载入后继续改

## 目录结构

```
.
├── archive/                 旧 Tkinter 构筑工具（独立归档，自带 git 仓库）
├── pipeline/                Python 数据管线
│   ├── build_data.py        游戏数据 → web/public/data/*.json（带硬校验）
│   ├── check_data.py        管线产物自检
│   └── import_presets.py    中文 BD 合集 → web/public/data/presets.json
├── web/                     前端（Vite + React + TypeScript）
│   ├── public/data/         管线产物（构建时原样进 dist/data/）
│   ├── src/                 数据层（load/store/rules）+ 六个界面
│   └── scripts/             冒烟测试与无头渲染检查
└── docs/                    数据格式、预置来源等说明
```

## 数据来源

默认读取本机 Steam 安装目录：

```
D:\SteamLibrary\steamapps\common\Pathfinder Second Adventure
```

可用环境变量 `WOTR_GAME_DIR` 或 `--game <目录>` 覆盖。管线只读游戏目录里的 `blueprints.zip` 与 `Localization/*.json`，不修改游戏本体。

## 开发

```powershell
# 1) 提取官方数据（约 7 秒，产出 web\public\data\*.json 约 9 MB）
python pipeline\build_data.py --out web\public\data

# 2) 数据自检（有硬错误会以退出码 1 结束）
python pipeline\check_data.py

# 3) 可选：重新生成预置构筑（需要 D:\DSH\temp\Wotr-BD- 这份 BD 合集）
python pipeline\import_presets.py

# 4) 起前端
cd web
npm.cmd install          # PowerShell 下必须带 .cmd，npm.ps1 被执行策略拦住
npm.cmd run dev          # http://127.0.0.1:5173
npm.cmd run build        # 产出 web\dist（含 dist\data）
```

验证：

```powershell
cd web
node scripts\smoke.mjs                    # 规则引擎冒烟测试
powershell -File scripts\render-check.ps1 # 无头 Chrome 渲染六个页签
```

## 许可

本项目自身代码以 GPL-3.0 发布（与原 Tkinter 工具一致）。

- 游戏数据（蓝图与本地化文本）版权归 **Owlcat Games** 所有；本项目只在本机提取供个人构筑规划使用，不再分发游戏资源本体。
- 预置构筑的文字内容来自社区中文 BD 合集，版权归原作者，详见 [`docs/presets-source.md`](docs/presets-source.md)。
