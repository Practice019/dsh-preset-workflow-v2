# dsh-workflow-console · 工作流注入台

看**工作流往系统提示里注入了什么**，并直接改/删/加规则。

会话顶部视图条上会多一个页签「**工作流注入**」（和 对话 / 轨迹 / 上下文 / IG5 并列）。

## 为什么需要它

工作流的常驻段是注入到系统提示里的，**用户在对话界面看不到**。这个页签把那一段摊开：

- 编译头 `[WF-v2.4 | compiled E0xx | N 条活跃]`、总字符数（含 2000 字符软阈值提示）
- L1 骨架全文（`workflow.md` 的 `<!-- L1:BEGIN/END -->` 之间）
- 每条规则：`id / scope / 命中条件 / 正文 / 长度`（超 60 字符标红）
- 一键「**交给 AI 改**」：复制一段带文件路径、当前行、硬约束与目标占位的指令

## 怎么工作

```
浏览器半 client.js ── 注册 conversation.view 页签
        │  同源 fetch
        ▼
host 半 lib/index.js ── /workflow-console/state（读）  /workflow-console/rule（写）
        │
        ▼
预设目录  workflow.md（骨架）  evolve/ledger.md（规则）  evolve/EDIT-GUIDE.md（指南）
```

两个关键设计：

1. **编译口径复用预设自己的 `compile()`**（`workflow.mjs` 导出）。不在插件里复刻第二份编译逻辑——
   否则界面显示的长度/条目迟早和真实注入漂移，那它就失去意义了。
   代价：预设目录移动时要同步改 `presetDir`（默认由 `DSH_HOME` 推导，与 `dsh-evolve` 同一约定）。
2. **写操作只动单行**，且是最外层两道同源闸：`content-type: application/json` +
   自定义头 `x-workflow-console: 1`（跨源提交会先撞预检）。因为本机 web 服务没有鉴权，
   不能"谁访问到都能改文件"。

写入校验与 `dsh-evolve` 的 `evolve_add` 完全一致：正文 ≤60 字符、无换行、scope 合法、禁止 `|`。
写盘用「写 `.tmp` + rename」原子替换；标记 `LEDGER:BEGIN/END` 各必须保留一个，否则**拒绝写入**。

## 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/workflow-console/state` | 编译结果 + 骨架 + 条目 + 限制 + 指南（JSON） |
| POST | `/workflow-console/rule` | `{action:'add'\|'save'\|'delete', id?, scope?, when?, text?}` → 返回新 state |

## 安装 / 卸载

安装（见仓库 README「快速开始」）：把本目录以 junction 或 `link:` 依赖挂进
`$DSH_HOME/profiles/<profile>/node_modules/`，并在 profile 的
`dependencies` 与 `dsh.profile.bundles` 里各加一行，然后**重启 dsh**。

卸载：从 profile 的 `package.json` 删掉那两行 → 删掉 `node_modules` 里的链接 → 重启。

## 改完什么时候生效

规则文件是**源文件**，常驻段在**会话挂载时**编译 → **开新会话**（或重启 dsh）才生效。
页签里的「刷新」只刷新**文件视图**，不会改变当前会话已经注入的内容。

## 测试

```
node tests/workflow-console.test.mjs
```

覆盖：路由注册、只读状态、三道同源闸、单个 id 的增/改/删（含元数据保留）、超长与非法 scope 拒绝、
标记损坏时拒绝写入且文件不变、client 半的工厂与 `conversation.view` 注册。
