# 工作流规格 v2.4（候选稿）

> **状态：候选稿，仅供审阅。** 尚未接入预设（组合文件仍指向旧版 `workflow.md`）。
> 核心变化：**主干换成官方技能**（`define`/`plan`/`build`/`verify`/`review`/`ship`），**按需不全走**，**模型不会自动读子文件 → L1 显式指引**，**每步先查别人做过没有**，**有疑虑就问子代理**。
> 编号 P0–P6 保留；P0 为自建独有（官方无对应）。

---

## 2. L1 常驻区

<!-- L1:BEGIN -->

**七阶段**：P0 初始化 → P1 定义 → P2 拆解 → P3 实现 → P4 验证 → P5 独立审查 → P6 收尾

**每阶段怎么做**：先 `skill <阶段技能名>`，再 `read` 它的子文件拿方法（技能正文有子文件清单，**只加载技能名只拿到路由说明，不读子文件等于没读**）。

| 阶段 | 官方技能 | 何时用 |
|---|---|---|
| P1 | `define` | 需求模糊 / 新项目起步 |
| P2 | `plan` | 规格已定、要拆任务排序依赖 |
| P3 | `build` | 有任务清单、要写代码 |
| P4 | `verify` | 要证明可用 / 跑测试 / 排障 |
| P5 | `review` | 代码已写测试已过、合并前 |
| P6 | `ship` | 过审后要发布上线 |

**按需，不全走**：必走 P2 P3；**改了"能跑的东西"才走 P4**；**改动要离开本机（发布/上线）才走 P6**；P1 P5 视风险。热修：P3→P4→P6。不可逆：先问再动。

**P0 首轮必做**（官方无对应，自建）：定位任务目录并**实跑验证**可用命令、记基线（HEAD + `git status --porcelain --ignored`）、记规格 hash 锚、与用户定级（热修 / 常规 / 不可逆）。

**P3 叠加 RED 门**：先写一个会失败的检查并**跑出红**，再改代码到绿；恒真检查（如 `exit 0`）判无效——假检查不可能先失败。

**P5 双轨**：主脑先自审，再派 ≥2 子代理（反证者 + 事实核对者）复核；`[fact]` 断言全部复核，零 `[fact]` 判未审查。

**常用子文件**：P3 → `build/incremental-implementation.md`；P4 排障 → `verify/debugging-and-error-recovery.md`；P5 → `review/code-review-and-quality.md`。

**调研先行**（动手前必做，两类都查）：
  ① **方案调研**：任何设计 / 框架决策，先查别人做过没有；有现成**直接抄并注明出处**，
     确认无人做过才创作（须给出检索证据，不是"我觉得没人做过"）。
  ② **技能调研**：先想清楚"这事可能需要哪些技能"，然后**主动搜索本地技能库**
     （catalog 可见项 + 路由型技能的入口正文，嵌套子技能不在 catalog 但真实存在）；
     本地没有 → 用 `find-skills` 的【搜索】部分找线上候选。**只读不下载**
     （沿用"缺口先读不安装"：不跑 `npx skills add`、不写扫描根）。
     找到的按需 `read`，用完即散。

**有疑虑就问子代理**：拿不准、要决策、想换角度时都可以派——**不限于技术选型**。派发时给足背景，别让它自己读文件。

**铁律**：没证据不许宣称完成 ｜ 一次一个切片 ｜ 守住范围 ｜ 失败先查根因 ｜ 缺口先读不安装

<!-- L1:END -->

---

## 3. 阶段详解

### P0 · 会话初始化（自建，官方无对应）

官方技能里搜 `porcelain` / `会话初始化` / `基线快照` **零命中**。P0 是本机实测出来的：

| 实测问题 | 数据 |
|---|---|
| `git status --porcelain` 在本仓库只见 **11/301 条**（`.gitignore:5` 是 `/*` 白名单式） | 越界检查全盲 |
| 命令探测只探 manifest 不验 script | 多个子项目 `npm test` 返回 exit 1 |
| 规格文件在评审期间被改写过 3 次 | 需要 hash 锚 |

**动作**：定位目录 → 实跑验证命令 → 记基线（含 ignored）→ 记 hash → 定级

### P1–P6 · 官方技能主干

| 编号 | 官方技能 | 子文件 | 模式 |
|---|---|---|---|
| P1 | `define` | interview-me / idea-refine / spec-driven-development / constraint-driven-development / grilling / floor-guard / frameworks / examples / refinement-criteria（9） | 按需 |
| P2 | `plan` | planning-and-task-breakdown / zoom-out / codebase-design / DEEPENING / DESIGN-IT-TWICE（5） | **必走** |
| P3 | `build` | incremental-implementation / test-driven-development / context-engineering / source-driven-development / frontend-ui-engineering / api-and-interface-design / doubt-driven-development（7） | **必走** + RED 门 |
| P4 | `verify` | test-driven-development / browser-testing-with-devtools / debugging-and-error-recovery / stack-trace-triage（4） | 按需 |
| P5 | `review` | code-review-and-quality / code-simplification / security-and-hardening / performance-optimization（4） | 按需 |
| P6 | `ship` | git-workflow-and-versioning / ci-cd-and-automation / observability-and-instrumentation / documentation-and-adrs / deprecation-and-migration / shipping-and-launch（6） | 按需 |

**官方技能自带 `whenToUse` 自动路由**，互相引用成闭环（需求没定走 define → 规格明确走 plan → …）。**不确定走哪个时读 `meta`。**

### 两个叠加约束（官方没覆盖，必须保留）

**① RED 门（P3）**
官方 `test-driven-development` 规定"先写测试"，但**缺两个可证伪判据**：「必须观测到红」「恒真即无效」。`exit 0` 这类假检查在官方 TDD 下照样通过。RED 门是 TDD 的**加强子集**，成本仅一次运行。

**② 子代理复核（P5）**
官方 review 写「不由子代理做的主脑自查」——**禁的是"替代"，不是"补充"**。所以：**主脑先自审 → 再派 ≥2 子代理复核**。两者都做。

---

## 4. 调研先行 + 有疑虑就问

### 调研先行（找现成方案）

| 优先级 | 源 | 适用 |
|---|---|---|
| **1** | **本机官方技能**（define/plan/build/verify/review/ship，v0.6.9，49.4k★） | **第一优先**——先确认本地有没有 |
| 2 | spec-kit | spec-first 流程 |
| 3 | Superpowers | 技能化工作流 |
| 4 | BMAD | 角色化敏捷 |
| 5 | Kiro | EARS 需求文法 |

**规则**：有现成 → 直接抄 + 注明出处；确认无人做过 → 才创作（须有检索证据）。

### 技能调研（找可用技能，**只读不下载**）

**这是独立于"方案调研"的一步**——前者找方法论，后者找工具。

```
动手前 → 想清楚"这事可能需要哪些技能"
       → ① 主动搜索【本地技能库】
            · catalog 可见项（<available_skills>）
            · 路由型技能的入口正文（嵌套子技能不在 catalog 但真实存在）
            · 例：pdf-official 不在 catalog，但 office-docs/SKILL.md 明确路由到它
       → ② 本地没有 → 用 find-skills 的【搜索】部分找线上候选
            · npx skills find / skills.sh 排行榜 / GitHub 搜索
       → ③ 找到的按需 read，用完即散
```

**硬约束**：
- **只读不下载** —— 不跑 `npx skills add`、不写 `~/.dsh/skills` 与 `.agents/skills`（自动扫描根）、不跑 `update`、不建常驻条目
- 沿用「缺口先读不安装」：`find-skills` **只用搜索那一半**，`add` / `update` 明确禁用

### 有疑虑就问（不限于技术选型）

> **拿不准、要决策、想换角度、觉得可能想漏了 —— 任何时刻都可以派子代理讨论。**
> 目的是**给自己更多启发**，不是让子代理替你决策。**决策权始终在主代理。**

**派发规范（提速关键）**：
- 一次性给足背景、事实、已验证数字，**不让它自己去找**
- 明确写「不要读文件、不要联网（信息已给全）」
- 限定输出格式与字数（如"600 字内、先给结论"）
- 调研场景派 2 路（方案派 + 反证派）互不交流，主代理合并；日常疑虑派 1 个即可

---

## 5. 已知边界（明说）

| 项 | 状态 |
|---|---|
| **L1 只是提示层** | 能"告诉"流程，**拦不住**不遵守（拦截要等 `workflow_check`，尚未建） |
| **挂载成功 ≠ L1 生效** | 实测：`specPath` 指向不存在的文件，`check` 仍返回 MOUNT OK（fail-closed 设计） |
| **官方技能是路由层** | 必须 `read` 子文件才有方法论，L1 已显式写明 |
| **P0 自建** | 官方无对应，是本机实测产物 |
| **预算** | L1 约 1,350 B（此前 1,146 B），用户已表示预算无所谓，做好即可 |

---

## 6. 一句话

**官方技能当主干（`skill` + `read` 子文件），P0 自建补全，RED 门与子代理复核作为官方没覆盖到的叠加约束，按需不全跑；每步先查别人做过没有；有疑虑就问子代理，派发时给足信息让它秒回。**
