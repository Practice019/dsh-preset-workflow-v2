---
name: workflow-phases
description: "七阶段工作流（P0 初始化 / P1 定义 / P2 拆解 / P3 实现 / P4 验证 / P5 审查 / P6 收尾）的每阶段动作、进入与退出判据，以及该阶段官方技能有哪些子文件可读。当需要判断当前处于哪个阶段、某阶段具体该做什么、要查阶段技能的子文件清单、或要按规范派发子代理时使用。Phases of the seven-stage workflow — per-phase actions, entry/exit criteria, and the sub-file inventory of each phase skill. Use when deciding which phase you are in, what a phase requires, which sub-files a phase skill offers, or how to brief a subagent."
---

# 七阶段工作流 · 阶段详解

本文件是 L1 常驻段指向的**资料**。

**分工**：L1 里已经写死「何时走哪个阶段」和六条铁律，**那些不用在这里重复**。
本文件只补三样 L1 放不下的东西：**每阶段具体动作与判据**、**阶段技能的子文件清单**、**调研与派发的规范**。

**读取约定**：阶段技能（`define` / `plan` / `build` / `verify` / `review` / `ship`）
**正文只是路由说明**——必须 `read` 它的子文件才有方法论。子文件路径见第二节表格。

---

## 一、P0 · 会话初始化（自建，官方无对应）

### 为什么需要它

官方技能里搜 `porcelain` / `会话初始化` / `基线快照` **零命中**。P0 是本机实测出来的：

| 实测问题 | 数据 |
|---|---|
| `git status --porcelain` 在本仓库只见 **11/301 条**（`.gitignore:5` 是 `/*` 白名单式） | 越界检查全盲 |
| 命令探测只探 manifest 不验 script | 多个子项目 `npm test` 返回 exit 1 |
| 规格文件在评审期间被改写过 3 次 | 需要 hash 锚 |

**这三条都是「看起来很干净、实际不是」的坑**，所以 P0 必须先做实跑验证，而不是相信探测结果。

### 动作

1. **定位任务目录** —— 确认 `cwd` 与真实工作区一致
2. **实跑验证可用命令** —— 不读 manifest，直接执行；记录哪些真的能跑
3. **记基线** —— `HEAD` + `git status --porcelain --ignored`（**必须带 `--ignored`**）
4. **记规格 hash 锚** —— 若工作受规格文件约束，记下当前 hash，便于事后判断是否被改
5. **与用户定级** —— 热修 / 常规 / 不可逆；**不可逆必须先问再动**

---

## 二、P1–P6 · 官方技能主干

| 阶段 | 官方技能 | 子文件数 | 模式 |
|---|---|---|---|
| P1 | `define` | 9 | 按需 |
| P2 | `plan` | 5 | **必走** |
| P3 | `build` | 7 | **必走** + RED 门 |
| P4 | `verify` | 4 | 按需 |
| P5 | `review` | 4 | 按需 |
| P6 | `ship` | 6 | 按需 |

### 子文件清单

| 阶段 | 子文件 |
|---|---|
| **P1** `define` | `interview-me` · `idea-refine` · `spec-driven-development` · `constraint-driven-development` · `grilling` · `floor-guard` · `frameworks` · `examples` · `refinement-criteria` |
| **P2** `plan` | `planning-and-task-breakdown` · `zoom-out` · `codebase-design` · `DEEPENING` · `DESIGN-IT-TWICE` |
| **P3** `build` | `incremental-implementation` · `test-driven-development` · `context-engineering` · `source-driven-development` · `frontend-ui-engineering` · `api-and-interface-design` · `doubt-driven-development` |
| **P4** `verify` | `test-driven-development` · `browser-testing-with-devtools` · `debugging-and-error-recovery` · `stack-trace-triage` |
| **P5** `review` | `code-review-and-quality` · `code-simplification` · `security-and-hardening` · `performance-optimization` |
| **P6** `ship` | `git-workflow-and-versioning` · `ci-cd-and-automation` · `observability-and-instrumentation` · `documentation-and-adrs` · `deprecation-and-migration` · `shipping-and-launch` |

**最常用的三个**：

- P3 写代码 → `build/incremental-implementation.md`
- P4 排障 → `verify/debugging-and-error-recovery.md`
- P5 评审 → `review/code-review-and-quality.md`

**不确定走哪个阶段时** → 读 `meta`（它是全生命周期的路由器）。

官方技能自带 `whenToUse` 可自动路由，且互相引用成闭环
（需求没定走 define → 规格明确走 plan → …）。

---

## 三、两个叠加约束（官方没覆盖，必须保留）

### ① RED 门（P3）

官方 `test-driven-development` 规定「先写测试」，但**缺两个可证伪判据**：

- 「必须**观测到红**」
- 「**恒真即无效**」

`exit 0` 这类假检查在官方 TDD 下照样通过。RED 门是 TDD 的**加强子集**，成本仅一次运行。

**动作**：先写一个**会失败的**检查 → 跑 → **看到它红** → 再改代码到绿。

### ② 子代理复核（P5）

官方 `review` 写「不由子代理做的主脑自查」—— **它禁的是「替代」，不是「补充」**。

所以两件事都要做：

1. 主脑**先自审**
2. 再派 **≥2 个子代理**（一个**反证者** + 一个**事实核对者**）复核

`[fact]` 类断言**全部**要复核；**零 `[fact]` 判未审查**。

---

## 四、调研先行

**动手前必做，两类都要查。**

### 4.1 方案调研（找方法论）

**任何设计 / 框架决策，先查别人做过没有。**

| 优先级 | 源 | 适用 |
|---|---|---|
| **1** | **本机官方技能**（define/plan/build/verify/review/ship） | **第一优先**——先确认本地有没有 |
| 2 | spec-kit | spec-first 流程 |
| 3 | Superpowers | 技能化工作流 |
| 4 | BMAD | 角色化敏捷 |
| 5 | Kiro | EARS 需求文法 |

**规则**：有现成 → **直接抄并注明出处**；确认无人做过 → 才创作，
**且须给出检索证据**（不是「我觉得没人做过」）。

### 4.2 技能调研（找工具）

**这是独立于方案调研的一步**——前者找方法论，后者找工具。

```
动手前 → 想清楚「这事可能需要哪些技能」
       → ① 主动搜索【本地技能库】
            · catalog 可见项（<available_skills>）
            · 路由型技能的入口正文（嵌套子技能不在 catalog 但真实存在）
            · 例：pdf-official 不在 catalog，但 office-docs/SKILL.md 明确路由到它
       → ② 本地没有 → 用 find-skills 的【搜索】部分找线上候选
            · npx skills find / skills.sh 排行榜 / GitHub 搜索
       → ③ 找到的按需 read，用完即散
```

**硬约束**：

- **只读不下载** —— 不跑 `npx skills add`、不写 `~/.dsh/skills` 与 `.agents/skills`
  （它们是自动扫描根）、不跑 `update`、不建常驻条目
- 沿用「缺口先读不安装」：`find-skills` **只用搜索那一半**，`add` / `update` 明确禁用
- **读到全文再评估**，禁止用「下载」代替「阅读」

---

## 五、派发子代理的规范（提速关键）

> **拿不准、要决策、想换角度、觉得可能想漏了 —— 任何时刻都可以派子代理讨论。**
> 目的是**给自己更多启发**，不是让子代理替你决策。**决策权始终在主代理。**

### 派发时必做

1. **一次性给足背景、事实、已验证数字** —— **不让它自己去找**
2. 明确写「**不要读文件、不要联网**（信息已给全）」
3. **限定输出格式与字数**（如「600 字内、先给结论」）

### 派几路

| 场景 | 路数 |
|---|---|
| 调研 | **2 路**（方案派 + 反证派），**互不交流**，主代理合并 |
| 日常疑虑 | **1 个**即可 |

**不限于技术选型** —— 任何需要另一个视角的地方都可以派。
