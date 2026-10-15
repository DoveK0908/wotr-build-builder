# 开拓者：正义之怒 · 构筑规划器（网页版）

[rt-planner](https://rt-planner.pages.dev/) 式的《Pathfinder: Wrath of the Righteous》中文构筑规划器。

与网上流传的构筑资料不同，**本项目的全部数据都不是手抄的**：直接从本机安装的游戏本体解包提取——

- `blueprints.zip`：25 万个游戏蓝图（职业、变体、专长、法术、神话道途、种族……），含逐级升级表与前置条件
- `StreamingAssets/Localization/zhCN.json`：11 万条**官方简体中文**名称与描述

因此规划器里的每一个专长名、每一段描述、每一条「前置要求」都是游戏原版数据。

## 目录结构

```
.
├── archive/                 旧 Tkinter 构筑工具（独立归档，自带 git 仓库）
├── pipeline/                Python 数据管线：把游戏数据抽成前端可用的 JSON
├── data/                    管线产物（官方数据 JSON）
├── web/                     前端（Vite + React + TypeScript）
└── docs/                    数据格式与设计说明
```

## 数据来源

默认读取本机 Steam 安装目录：

```
D:\SteamLibrary\steamapps\common\Pathfinder Second Adventure
```

可用环境变量 `WOTR_GAME_DIR` 覆盖。

## 开发

```powershell
# 1) 提取官方数据
python pipeline\run_all.py

# 2) 起前端
cd web
npm install
npm run dev
```

## 许可

本项目自身代码以 GPL-3.0 发布（与原 Tkinter 工具一致）。
游戏数据（蓝图与本地化文本）版权归 Owlcat Games 所有，本项目仅在本机提取供个人构筑规划使用，不再分发游戏资源本体。