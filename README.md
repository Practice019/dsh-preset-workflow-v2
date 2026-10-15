# dsh-preset-workflow-v2

> 给 **DeepSeek Harness (DSH)** 用的 agent preset：把一套「七阶段工作流」压成常驻骨架注入每个会话，
> 细节走**按需技能**，踩过的坑沉淀成**可自我进化的规则账本**。

一句话说清它跟别人不一样的地方：**常驻段不设长度上限，约束放在「每条规则必须短」**——
因为「超一点就整段失效」是最坏的失败模式，而「每条都压到 60 字内」才是可持续的写法。

---

## 它解决什么

| 问题 | 做法 |
|---|---|
| 长流程提示词占用常驻上下文 | 只常驻**骨架**（约 705 字符：七阶段 + 何时走哪个 + 六条铁律），细节走技能按需加载 |
| 靠模型自觉记规矩 → 记不住、会漂移 | 规则写进 `evolve/ledger.md`，**每次会话启动自动编译进常驻段** |
| 规则越攒越长 → 常驻段膨胀 | 写入端硬拦截：**正文 >60 字符直接拒收**，长内容下沉到 `evolve/lessons/` |
| 「超上限就整体不注册」把小问题放大 | **取消总长上限**：长度永不阻止注册，只在日志里软提醒 |

## 三层结构

```
workflow.md 的 L1 区（骨架，约 705 字符）
  七阶段 P0–P6 · 何时走哪个 · 六条铁律 · 「资料在这：skill workflow-phases」
        │
        ├─ 增量：evolve/ledger.md 的活跃条目（每条 ≤60 字符）→ 编译后追加在骨架之后
        │
        └─ 按需：skills/workflow-phases/SKILL.md → 各阶段动作与判据、官方阶段技能的子文件清单、
                   调研流程、派发子代理规范
```

编译由 `workflow.mjs` 在**会话挂载时**执行，结果注册为 systemPrompt 的 `workflow:policy` 段
（`order=700`，恒早于全部工具段）。所以：**改账本 → 开新会话 → 生效**。

## 目录结构

```
preset.patch.yml        preset 声明（bundle patch）：persona / workflow-l1 / 工具行
workflow.md             L1 骨架源（<!-- L1:BEGIN/END --> 之间是常驻区），其余是候选稿正文
workflow.mjs            编译器：compile() 纯函数 + apply()（骨架 + 账本增量 → workflow:policy 段）
evolve/ledger.md        规则账本（唯一写入入口：evolve_add，或界面上改）
evolve/EDIT-GUIDE.md    改规则的指南（给人看，也给 AI 看；界面上显示的就是它）
evolve/lessons/         长条目正文（账本里只留 ≤60 字索引行）
skills/workflow-phases/ 按需通道（L1 指向它的唯一入口）
plugins/dsh-evolve/     evolve_add 工具（写账本的宿主插件）
plugins/dsh-workflow-console/  「工作流注入」页签（看 + 改/删/加规则；host 半挂 HTTP 路由）
scripts/sync-plugin.ps1 把插件同步到 DSH 真正加载的 node_modules 副本并校验哈希
tests/                  可移植单测（编译器 / 写入端守卫 / 注入台）
agent.cordis.yml        迁移前的旧版组合文件（保留作参考，不参与加载）
```

## 快速开始

需要 DSH ≥ 0.1.7（preset 以 bundle patch 声明，不再靠目录发现）。

**1) 放到 DSH 的 preset 目录**

```powershell
git clone https://github.com/Practice019/dsh-preset-workflow-v2.git "$HOME\.dsh\presets\workflow-v2"
```

**2) 改掉仓库里两处机器路径**（本仓库提交的是作者本机路径，必须替换成你自己的）

```powershell
$repo = "$HOME\.dsh\presets\workflow-v2"
$p = Join-Path $repo 'preset.patch.yml'
$t = Get-Content $p -Raw
# a) workflow-l1 行的插件 URL（必须是绝对 file: URL，相对路径会解析到 profile 目录）
$t = $t.Replace('file:///C:/Users/21877/.dsh/presets/workflow-v2/workflow.mjs',
                'file:///' + ($repo -replace '\\','/') + '/workflow.mjs')
# b) skill-filesystem 行的技能目录（必须绝对：预设行的 baseUrl 不保证是绝对 URL）
$t = $t.Replace("'C:\Users\21877\.dsh\presets\workflow-v2\skills'", "'" + $repo + '\skills' + "'")
Set-Content $p -Value $t -NoNewline
```

**3) 在 profile 里注册 bundle**

`$DSH_HOME/profiles/<profile>/package.json`：

```jsonc
{
  "dependencies": {
    "dsh-preset-workflow-v2": "link:C:/Users/YOU/.dsh/presets/workflow-v2",
    "dsh-evolve": "file:../../plugins/dsh-evolve",                  // 想要 evolve_add 才需要
    "dsh-workflow-console": "link:C:/Users/YOU/.dsh/presets/workflow-v2/plugins/dsh-workflow-console"  // 「工作流注入」页签
  },
  "dsh": { "profile": { "bundles": [ /* …, */ "dsh-preset-workflow-v2", "dsh-evolve", "dsh-workflow-console" ] } }
}
```

> 用 `link:`（而不是 `file:`）可以只留一份源码：`file:` 会被 pnpm **复制**进 `node_modules`，
> 改源码后不同步副本，运行时还是旧代码（这个坑踩过两次）。

**4) 可选：让插件只有一份源码**（避免改了一处忘了另一处）

```powershell
# 用 junction 把本机插件目录指到仓库里那份
Rename-Item "$HOME\.dsh\plugins\dsh-evolve" "$HOME\.dsh\plugins\dsh-evolve.old"
cmd /c mklink /J "$HOME\.dsh\plugins\dsh-evolve" "$HOME\.dsh\presets\workflow-v2\plugins\dsh-evolve"
pwsh -File "$HOME\.dsh\presets\workflow-v2\scripts\sync-plugin.ps1"
```

**5) 重启 DSH，然后在新会话里验证**

| 验证 | 期望 |
|---|---|
| 系统提示里搜 `WF-v2.4` | 出现 `[WF-v2.4 \| compiled E0xx \| N 条活跃]` + 骨架（七阶段 / 铁律） |
| 让模型加载 `workflow-phases` 技能 | 能返回「七阶段工作流 · 阶段详解」正文 |
| 让模型 `evolve_add` 一段 >60 字符的规则 | `{"ok":false,"action":"rejected-too-long"}` |

## 看不见的那部分，怎么看

常驻段是注入到**系统提示**里的，对话界面看不见它。所以本仓库带一个页签：

**会话顶部视图条 → 「工作流注入」**（和 对话 / 轨迹 / 上下文 并列）

它显示编译头、总字符数、骨架全文、每条规则的 `id/scope/命中条件/正文/长度`，并且可以：

- 直接**改 / 删 / 加**单条规则（只动单行、原子写、写坏标记会被拒绝）
- 点「**交给 AI 改**」复制一段带文件路径、当前行、硬约束与目标占位的指令，粘给 AI 即可
- 读 `evolve/EDIT-GUIDE.md` —— 人和 AI 看的是同一份指南，不另抄一份

页面数据走插件自己的同源 HTTP 路由（`/workflow-console/state` / `/rule`），
**编译口径复用 `workflow.mjs` 的 `compile()`**，所以界面上的长度与编译头永远等于真实注入。

> ⚠️ 界面上改的是**源文件**；常驻段在**会话挂载时**编译 → **开新会话**（或重启 dsh）才生效。

## 长度策略（本仓库的核心设计）

```
全局上限   ：无         ← 长度永不阻止注册（解析失败仍 fail-closed，那是另一回事）
写入端     ：正文 ≤60  ← evolve_add 硬拒收，并告知「压短」或「写 lessons 再留索引行」
编译期     ：>2000     ← 只写日志提醒，不影响注册
```

为什么不是「总长封顶」：长度本身不是错误，而 fail-closed 会把「稍微长了」升级成
**整个工作流静默失效**（实测：账本 25 条时 2434 字符 → 常量全丢）。
把约束下沉到单条，才能既贪心累积、又保证每条都便宜。

## 测试

```powershell
npm test
```

- `tests/compiler.test.mjs` —— 假 ctx 跑真编译器：超长账本仍注册、软提醒触发、
  **规格解析失败必须不注册**（fail-closed 守卫）、账本标记缺失只注入骨架。
- `tests/evolve-guard.test.mjs` —— 假 fs 跑真插件：超长拒收且不落盘、行格式与 trim、
  空值拒收、重复走 `hits++`；**若本机存在 `node_modules` 副本也一起测**（副本红 = 没同步）。
- `tests/workflow-console.test.mjs` —— 假 ctx/假 req-res 跑真路由：注册、只读状态、三道同源闸、
  单条增改删（元数据保留）、超长与非法 scope 拒绝、标记损坏拒写且文件不变；
  再以桩 `window` + 最小 React 跑 client 半：工厂形状与 `conversation.view` 页签注册。

## 已知约束与设计取舍

- **L1 只是提示层**：能「告诉」流程，拦不住不遵守。真正的拦截层（`workflow_check`）尚未实现。
- **解析失败 fail-closed**：`workflow.md` 的 L1 标记找不到时宁可不注册，也不把整份文件塞进常驻段。
- **预设行的 `baseUrl` 不保证是绝对 URL**：`new URL(rel, baseUrl)` 会抛 `Invalid URL` 且**静默失效**
  （skill 目录读不到不报错，只返回空列表）。路径一律写绝对。
- **`file:` 依赖会被复制**：改了插件源码必须同步 `node_modules` 副本 + 重启，否则运行时还是旧代码。
- **与上游耦合**：`preset.patch.yml` 的插件行结构跟随 DSH 出厂 `cordis` 预设，上游升级可能需要同步调整。
- **常驻段没有上限是有代价的**：账本长期膨胀不会报错，只会稀释注意力——靠 git diff 复查 + 软提醒。

## 归属

MIT（见 `LICENSE`）。`preset.patch.yml` 由 DSH 出厂 `cordis` 预设派生，
其中 persona、plan-mode 文本与插件行结构沿用上游内容，**权利属上游**，不在 MIT 范围内；
详见 [`NOTICE.md`](NOTICE.md)。

## 状态

已可用并自用中：编译 / 常驻注入 / 按需技能 / 账本写入与去重 / 长度策略 / 单测。
尚未做：安装脚本（目前是 README 手工步骤）、`workflow_check` 拦截层、跨平台路径参数化。
