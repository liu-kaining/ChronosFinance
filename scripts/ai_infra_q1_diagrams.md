# 2026 AI 基础设施 Q1 观察笔记 · 配图集（PlantUML）

> 本文档为配图素材集。每个代码块都是独立的 PlantUML 图，复制到 https://www.plantuml.com/plantuml/ 或任意支持 PlantUML 的渲染器即可导出 PNG / SVG。
>
> 公众号使用建议：图 1 / 图 2 / 图 4 / 图 6 / 图 7 是最适合作插图的几张；图 3 / 图 5 更适合作为小号辅图。

---

## 图 1：一季度成绩单大图（MindMap · 全景）

**放在文章开篇或第一节收尾**，给读者一眼看懂"过去一季度发生了什么"。

```plantuml
@startmindmap
<style>
mindmapDiagram {
  node {
    BackgroundColor #F6F8FA
    BorderColor #2E86AB
    FontName Helvetica
  }
  .hot {
    BackgroundColor #FFE5B4
    BorderColor #E67E22
  }
  .cold {
    BackgroundColor #F4D4D4
    BorderColor #C0392B
  }
  .neutral {
    BackgroundColor #E8F0FE
    BorderColor #2E86AB
  }
}
</style>
* AI Infra 50\nQ1 2026\n(2026-01-02 → 2026-04-17)
** 整体成绩 <<neutral>>
*** 上涨 38 只
*** 下跌 12 只
*** 中位数 +23.75%
*** 均值 +38.11%
** 最强主线 <<hot>>
*** Optics +110.35%
**** AAOI +303%
**** LITE +132%
**** CIEN +106%
*** Memory +93.22%
**** SNDK +235%
**** WDC +98%
**** STX +90%
*** Servers & Thermal +64.40%
**** VRT +75%
**** DELL +54%
** 最弱板块 <<cold>>
*** Battery & Storage −37.83%
**** EOSE −45%
**** FLNC −41%
*** Hyperscale Cloud −0.53%
**** MSFT −11%
**** ORCL −11%
** 单只极值 <<neutral>>
*** 最高 AAOI +302.58%
*** 最低 EOSE −44.80%
@endmindmap
```

---

## 图 2：Core-12 跟踪池三层结构（MindMap）

**放在 "第八节 · Core-12" 开头**，承载这一节最关键的视觉信息——12 只、3 层、6 条主线。

```plantuml
@startmindmap
<style>
mindmapDiagram {
  node {
    BackgroundColor #F6F8FA
    BorderColor #2E86AB
    FontName Helvetica
  }
  .core {
    BackgroundColor #FFE5B4
    BorderColor #E67E22
  }
  .assist {
    BackgroundColor #D5E8F5
    BorderColor #2E86AB
  }
  .option {
    BackgroundColor #E8E3F5
    BorderColor #8E44AD
  }
}
</style>
* Chronos\nAI Infra\nCore-12
** 核心 6\n每日扫一眼 <<core>>
*** LITE\n光电·EML 芯片\n+132%
*** COHR\n光电·模块产能\n+78%
*** MU\n存储·HBM4 核心\n+44%
*** SNDK\n存储·企业级 SSD\n+235%
*** VRT\n散热·液冷真神\n+75%
*** NVDA\n芯片·算力基准\n+7%
** 辅线 4\n每周一次 <<assist>>
*** AVGO\n芯片·定制 ASIC\n+17%
*** TSM\n芯片·产业链底座\n+16%
*** CIEN\n光电·DCI\n+106%
*** WDC\n存储·大容量 HDD\n+98%
** 期权 2\n每月 / 催化剂 <<option>>
*** VST\n能源·核能种子仓\n−1%
*** NBIS\nNeocloud·欧洲叙事\n+75%
@endmindmap
```

---

## 图 3：从 50 只收窄到 12 只的筛选流程（Activity）

**放在 "第八节 · Core-12 · 筛选逻辑" 子节**，把决策过程可视化。

```plantuml
@startuml
skinparam backgroundColor #FDFDFD
skinparam activity {
  BackgroundColor #F6F8FA
  BorderColor #2E86AB
  FontName Helvetica
}
skinparam activityDiamond {
  BackgroundColor #FFE5B4
  BorderColor #E67E22
}

start
:50 只 AI 基础设施候选池;
:叠加 Q1 涨跌数据\n+ 1 月叙事硬度评分;

if (板块 Q1 整体\n下跌？) then (是)
  :放弃整块板块\n(Battery / Cloud 大部分);
  stop
else (否)
endif

if (和头部股高度\n同步？) then (是)
  :放弃\n(Manufacturing / 部分 Mining);
  stop
else (否)
endif

if (故事和 Core-12\n已有代表重叠？) then (是)
  :放入观察清单\n(CRDO / STX / ALAB ...);
  stop
else (否)
endif

if (有独立叙事\n+ 硬产能约束？) then (是)
  :纳入 Core-12\n分配层级: 核心 / 辅线 / 期权;
  stop
else (否)
  :放弃\n(估值打满 / 低跟踪价值);
  stop
endif

@enduml
```

---

## 图 4：12 个子板块 Q1 涨跌光谱（WBS · 近似热图）

**适合作为 "第四节 · 板块成绩单" 的辅图**。不是真正的柱状图，但用 WBS 层级 + 颜色已经能传达"光谱分化"的感觉。

```plantuml
@startwbs
<style>
wbsDiagram {
  node {
    FontName Helvetica
    Padding 8
  }
  .hot {
    BackgroundColor #E67E22
    FontColor white
  }
  .warm {
    BackgroundColor #F5B041
  }
  .mild {
    BackgroundColor #F9E79F
  }
  .cool {
    BackgroundColor #D6DBDF
  }
  .cold {
    BackgroundColor #E74C3C
    FontColor white
  }
}
</style>
* AI Infra 12 板块\nQ1 表现光谱
** Optics\n+110% <<hot>>
** Memory\n+93% <<hot>>
** Servers & Thermal\n+64% <<warm>>
** Foundry\n+45% <<warm>>
** Networking\n+37% <<warm>>
** Compute Mining\n+35% <<warm>>
** Neocloud\n+35% <<warm>>
** Manufacturing\n+28% <<mild>>
** Chip Design\n+24% <<mild>>
** Energy Infra\n+13% <<mild>>
** Hyperscale Cloud\n−0.5% <<cool>>
** Battery & Storage\n−38% <<cold>>
@endwbs
```

---

## 图 5：四种策略在 30 万本金下的终值对比（组件图）

**适合作为 "第六节 / 第八节 Q1 回测" 的插图**。用卡片式组件直观对比 4 种策略。

```plantuml
@startuml
skinparam backgroundColor #FDFDFD
skinparam rectangle {
  FontName Helvetica
  Padding 10
}
skinparam rectangle<<best>> {
  BackgroundColor #E67E22
  FontColor white
  BorderColor #D35400
}
skinparam rectangle<<good>> {
  BackgroundColor #F5B041
  BorderColor #E67E22
}
skinparam rectangle<<fair>> {
  BackgroundColor #D5E8F5
  BorderColor #2E86AB
}
skinparam rectangle<<weak>> {
  BackgroundColor #F4D4D4
  BorderColor #C0392B
}

rectangle "**Core-12 等权**\n30 万 → **52.0 万**\n**+73.42%**\n(12 只)" as c12 <<best>>
rectangle "Core-8 等权\n30 万 → 51.9 万\n+73.21%\n(8 只)" as c8 <<good>>
rectangle "全 50 只等权\n30 万 → 41.4 万\n+38.11%\n(50 只)" as full <<fair>>
rectangle "All-Star 6\n30 万 → 37.0 万\n+23.42%\n(6 只)" as stars <<weak>>

c12 -right[hidden]-> c8
c8 -right[hidden]-> full
full -right[hidden]-> stars
@enduml
```

---

## 图 6：Core-12 分层跟踪节奏（Gantt · 时间周期）

**放在 "第八节 · 跟踪节奏" 子节**，让读者一眼看明白"每天 / 每周 / 每月分别看谁"。

```plantuml
@startgantt
<style>
ganttDiagram {
  task {
    FontName Helvetica
    FontColor black
    BackgroundColor #F6F8FA
    LineColor #2E86AB
  }
  .daily { BackgroundColor #FFE5B4 LineColor #E67E22 }
  .weekly { BackgroundColor #D5E8F5 LineColor #2E86AB }
  .monthly { BackgroundColor #E8E3F5 LineColor #8E44AD }
}
</style>
Project starts 2026-04-20
[核心 6 · 每日收盘扫一眼] <<daily>> lasts 1 day and starts 2026-04-20
[(LITE / COHR / MU / SNDK / VRT / NVDA)] as [D1] lasts 1 day and starts 2026-04-20
[辅线 4 · 每周日晚整理] <<weekly>> lasts 7 days and starts 2026-04-20
[(AVGO / TSM / CIEN / WDC)] as [W1] lasts 7 days and starts 2026-04-20
[期权 2 · 每月 + 催化剂] <<monthly>> lasts 30 days and starts 2026-04-20
[(VST / NBIS)] as [M1] lasts 30 days and starts 2026-04-20
@endgantt
```

> 如果 Gantt 渲染效果不理想（某些在线渲染器对 style 支持有限），可以改用下面这张更简单的 MindMap 作为"节奏图"替代：

```plantuml
@startmindmap
* Core-12\n分层跟踪节奏
** 每日 · 核心 6
*** LITE
*** COHR
*** MU
*** SNDK
*** VRT
*** NVDA
** 每周 · 辅线 4
*** AVGO
*** TSM
*** CIEN
*** WDC
** 每月 / 催化剂 · 期权 2
*** VST
*** NBIS
@endmindmap
```

---

## 图 7：叙事兑现对照表（Component · 对 vs 错）

**放在 "第五节 · 对照判断" 附近**，一目了然地展示 1 月那篇的对错打分。

```plantuml
@startuml
skinparam backgroundColor #FDFDFD
skinparam rectangle {
  FontName Helvetica
  Padding 8
}
skinparam rectangle<<ok>> {
  BackgroundColor #ABEBC6
  BorderColor #27AE60
}
skinparam rectangle<<mid>> {
  BackgroundColor #F9E79F
  BorderColor #D4AC0D
}
skinparam rectangle<<bad>> {
  BackgroundColor #F5B7B1
  BorderColor #C0392B
}

package "✓ 兑现得漂亮 (6)" {
  rectangle "光进铜退·1.6T\nLITE/COHR/AAOI/CIEN" <<ok>>
  rectangle "HBM 超级周期\nMU/SNDK/WDC/STX" <<ok>>
  rectangle "液冷标配\nVRT/DELL" <<ok>>
  rectangle "定制 ASIC\nAVGO/ARM/ANET" <<ok>>
  rectangle "矿企转 HPC\nWULF/HUT/IREN/CIFR" <<ok>>
  rectangle "代工底座\nTSM (稳) · INTC 政策底" <<ok>>
}

package "⚠ 方向对·时点偏 (2)" {
  rectangle "核能基荷 PPA\nVST/CEG/TLN/LEU" <<mid>>
  rectangle "OKLO 小堆\n里程碑未到" <<mid>>
}

package "✗ 明显错判 (4)" {
  rectangle "储能三只全崩\nEOSE/FLNC/SLDP" <<bad>>
  rectangle "MSFT 防御性持有\n−11%" <<bad>>
  rectangle "ORCL 动量首选\n−11%" <<bad>>
  rectangle "BE 分类偏差\n+111% 但非 AI 核心" <<bad>>
}
@enduml
```

---

## 图 8：观察清单与放弃板块（MindMap · 决策边界）

**放在 "第八节 · Core-12 · 观察清单 / 放弃板块" 子节**，让读者看清楚"收窄"后边界在哪里。

```plantuml
@startmindmap
<style>
mindmapDiagram {
  node {
    FontName Helvetica
  }
  .watch {
    BackgroundColor #F9E79F
    BorderColor #D4AC0D
  }
  .drop {
    BackgroundColor #F5B7B1
    BorderColor #C0392B
  }
  .core {
    BackgroundColor #ABEBC6
    BorderColor #27AE60
  }
}
</style>
* 决策边界\n50 → 12 + 5 + 弃
** Core-12\n主跟踪 (12) <<core>>
*** 光电互联 3
*** HBM/存储 3
*** 散热 1
*** 芯片/代工 3
*** 能源 1
*** Neocloud 1
** 观察清单\n每月扫一眼 (5) <<watch>>
*** CRDO\nAEC 核心
*** STX\nHAMR
*** ALAB\nCXL 拐点
*** CRWV\nIPO 催化
*** GEV\n电力前瞻
** 刻意放弃\n38 只 <<drop>>
*** Battery & Storage
**** 逻辑被证伪
*** Compute Mining 多数
**** 套利窗口短
*** Manufacturing 整块
**** 跟头部同步
*** MSFT/GOOGL/ORCL
**** 日常已在看
*** 能源 6 只
**** VST 足够
*** ARM/ASML/AMD/INTC
**** 低跟踪价值
@endmindmap
```

---

## 图 9：关键数字速查卡（MindMap · 文末收尾用）

**适合放在文末或独立作为一张总结图**，让读者带一张"备忘卡"回去。

```plantuml
@startmindmap
* Q1 · 关键数字
** 市场整体
*** 涨 38 / 跌 12
*** 均值 +38.11%
*** 中位 +23.75%
** 30 万等权买 50 只
*** 终值 41.4 万
*** 净赚 11.4 万
** 30 万全仓单板块 (最好/最差)
*** Optics → 63.1 万
*** Battery → 18.7 万
*** 差距 44.5 万
** Core-12 (30 万等权)
*** 终值 52.0 万
*** 回报 +73.42%
*** 11 涨 1 跌
** 极值
*** 最高 AAOI +303%
*** 最低 EOSE −45%
@endmindmap
```

---

## 使用备忘

| 图号 | 推荐位置 | 类型 |
|---|---|---|
| 图 1 | 文章开篇 / 第一节收尾 | MindMap 全景 |
| 图 2 | 第八节 Core-12 开头 | MindMap 三层结构 |
| 图 3 | 第八节 · 筛选逻辑 | Activity 决策流程 |
| 图 4 | 第四节 · 板块成绩单 | WBS 近似热图 |
| 图 5 | 第六节 / 第八节 Q1 回测 | Component 策略对比 |
| 图 6 | 第八节 · 跟踪节奏 | Gantt（或 MindMap 替代） |
| 图 7 | 第五节 · 对错打分 | Component 叙事对照 |
| 图 8 | 第八节 · 观察清单 | MindMap 决策边界 |
| 图 9 | 文末 / 独立收尾图 | MindMap 备忘卡 |

### 渲染方式（任选其一）

1. **在线渲染**：https://www.plantuml.com/plantuml/ —— 粘贴 `@startxxx` 到 `@endxxx` 之间的内容
2. **VS Code 插件**：PlantUML（by jebbs），配合本地 Java / 远程服务
3. **Mermaid 风格导出**：部分 MindMap 可以改写成 Mermaid `mindmap`，对公众号编辑器（如墨滴、135 编辑器）更友好——如有需要我再转一版
4. **导出格式建议**：公众号用 **PNG @ 1.5x**（宽度 ~900px），清晰度够、不糊边
