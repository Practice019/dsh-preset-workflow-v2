# dsh-evolve

DSH 常驻 Host 插件：注册 `evolve_add` 工具，让 `workflow-v2` 预设能自我进化。

## 做什么

`evolve_add(scope, when, text)` → 向 `workflow-v2/evolve/ledger.md` **追加一条规则**：

```
- [E008 | always | 命中条件] 规则正文   (added: 2026-09-19, hits: 0)
```

- **条目级 delta**：只追加/修改/删除单条，**不整篇重写**（防 context collapse 与 brevity bias）
- **自动去重**：与已有条目同 scope + 关键词重合率 ≥0.8 → `hits++` 不新增
- **长度硬拦截**：正文 > **60 字符**直接拒收并给出改写建议（常驻段策略是「无全局上限、单条要短」）
- **不碰 `workflow.md`**（那是编译产物）

## 配套：读+编译+生效由预设负责

| 环节 | 谁做 |
|---|---|
| **写** ledger | 本插件的 `evolve_add` 工具 |
| **读+编译+注册 L1** | `workflow-v2/workflow.mjs`（每次会话启动自动跑） |
| **回滚** | workflow-v2 目录的 git（`git checkout`） |

流程：

```
evolve_add 加规则 → ledger 多一行
                → 开新会话 → workflow.mjs 自动编译 → L1 变成 [WF-v2.4 | compiled E008 | 8 条活跃]
```

## 设计约束（实测确认，勿改）

1. 工具必须 `harness.defineTool(...)` 包装后再 `register`
2. `output` 必须声明 `{ schema, render }`，`render` 是 function
3. `parameters` **不能**写 `additionalProperties: false`（参数根默认开放）
4. `fs` 服务是**异步**的：`await fs.readText(await fs.resolve(path))`，无 `readTextFileSync`
5. 动态插件代码里**不能**写 `import`（代码作为函数体执行）

## 路径

LEDGER 由 `DSH_HOME` 推导：`$DSH_HOME/presets/workflow-v2/evolve/ledger.md`。
若改预设目录名，需同步改 `lib/index.js` 的 `LEDGER` 常量。

> ⚠️ 本 README 的「设计约束」一节已过时（`harness.defineTool` / 禁 `import` 等旧结论），
> 以 `lib/index.js` 文件头的实测注释为准。
