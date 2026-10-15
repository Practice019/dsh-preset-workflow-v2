/**
 * workflow-v2 — L1 常驻段落 + 自我进化（v2.4 进化机制）
 *
 * 职责：
 *  1. 【骨架】读 workflow.md 的 L1 区 → 这是「整个工作流」的载体
 *     （七阶段 + 何时走哪个 + 铁律 + 资料获取方式）。必须自足。
 *  2. 【增量】读 evolve/ledger.md 的活跃条目 → 编译成规则列表，**追加**在骨架之后（不替代）
 *  3. 【注册】合并结果注册为 systemPrompt 的 `workflow:policy` 段（order 700，早于工具段 1000+）
 *  4. 【软提醒】超 WARN_L1 字符、或单条正文超 MAX_ENTRY → 只写日志，**不阻止注册**
 *
 * 关键约束（违反即静默失效）：
 *  1. 段落名固定 `workflow:policy`，order=700。不用 persona 的 PERSONA_PREFIX_SECTION
 *     （固定常量会被争抢），也不设 complete:true（会被整体丢弃规则吞掉且不报错）。
 *  2. 编译写在 apply() 内 —— 源码已验证：apply() 在世代建立时执行，section() 插入的
 *     就是本次新世代的 layer，所以【本会话即最新】，无需再开第二次会话。
 *      （dsh-system-prompt/lib/index.js:238）
 *  3. 解析/读取失败必须 fail-closed：宁可段落缺失，也不能把整份文件塞进常驻区。
 *     —— 这条**只针对解析失败**。**长度永不阻止注册**（见第 5 条）。
 *  4. .mjs 不能 import 裸包名（预设目录无 node_modules）→ 文件读写走 node:fs 内置模块。
 *  5. 【无全局上限，2026-10-15 决策】取消原来的 MAX_L1=1500 硬门禁。
 *     理由：长度本身不是错误，而「超一点就整段不注册」会把小毛病升级成
 *     「整个工作流静默失效」——最坏的失败模式（已实测：账本 25 条时 2434/1500 → 全丢）。
 *     约束改为放在**单条质量**上（贪心累积 + 每条压短）：
 *       · 每条正文 ≤ MAX_ENTRY（超出只提醒；真正的拦截在写入端 dsh-evolve 的 evolve_add）；
 *       · 超过 WARN_L1 时日志提醒「该把长条目下沉到 evolve/lessons/」。
 *     代价：常驻段会随条目线性增长，人若不定期复查会稀释注意力——所以保留「软提醒 + git 可回滚」。
 */

import { readFileSync, writeFileSync } from 'node:fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-l1'

/** 常驻段落名。 */
const SECTION_NAME = 'workflow:policy'

/** 恒早于全部 TOOL_* 段（1000+），晚于 PLAN_POLICY(500) / TEAM_POLICY(600)。 */
const SECTION_ORDER = 700

/**
 * L1 常驻段长度的**软**阈值：超过只在日志里提醒，**不阻止注册**。
 * 取代原来的 MAX_L1=1500 硬门禁（fail-closed），见文件头关键约束第 5 条。
 */
const WARN_L1 = 2000

/** 单条规则正文长度上限。编译期只提醒；真正的拦截在写入端 evolve_add。 */
const MAX_ENTRY = 60

/** 骨架段与增量段之间的分隔（也是人读时的视觉分界）。 */
const JOIN = '\n\n---\n\n'

const BEGIN = '<!-- LEDGER:BEGIN -->'
const END = '<!-- LEDGER:END -->'
const L1_BEGIN = '<!-- L1:BEGIN -->'
const L1_END = '<!-- L1:END -->'

/** 依赖：systemPrompt 注册段落，fs 读写 ledger，tools 注册 evolve.add。 */
export const inject = ['systemPrompt', 'tools']

/** 按「独立成行 + 行首」找标记（避免正文里同名字符串命中，实测踩过）。 */
function findMarkers(lines, begin, end) {
  let b = -1
  let e = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (b < 0 && t === begin) b = i
    else if (b >= 0 && t === end) {
      e = i
      break
    }
  }
  return { b, e }
}

/** 解析 ledger 条目行： - [id | scope | when] text (added: xx, hits: n) */
function parseEntry(line) {
  const m = /^-\s*\[([^\]|]*)\|([^\]|]*)\|([^\]]*)\]\s*(.*)$/.exec(line.trim())
  if (!m) return null
  const id = m[1].trim()
  const scope = m[2].trim()
  const when = m[3].trim()
  let rest = m[4].trim()
  let hits = 0
  let added = ''
  const meta = /\(([^)]*)\)\s*$/.exec(rest)
  if (meta) {
    const hm = /hits:\s*(\d+)/.exec(meta[1])
    if (hm) hits = parseInt(hm[1], 10)
    const am = /added:\s*([\d-]+)/.exec(meta[1])
    if (am) added = am[1]
    rest = rest.slice(0, meta.index).trim()
  }
  return { id, scope, when, text: rest, hits, added, raw: line }
}

/** 相似比对：scope 相同 + 关键词重合 → 视为重复（用于 evolve.add 去重）。 */
function similar(a, b) {
  if (a.scope !== b.scope) return false
  const ka = (a.text + ' ' + a.when).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
  const kb = (b.text + ' ' + b.when).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
  if (!ka || !kb) return false
  if (ka === kb) return true
  // 取较长串的字符集合，计算重合率
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka]
  const set = new Set(long)
  let hit = 0
  for (const ch of short) if (set.has(ch)) hit++
  return hit / short.length >= 0.8
}

/** 编译：ledger 活跃条目 → L1 文本（含版本号）。 */
function compileL1(entries) {
  const last = entries.length ? entries[entries.length - 1].id : 'E000'
  const header = `[WF-v2.4 | compiled ${last} | ${entries.length} 条活跃]`
  const body = entries
    .map((e) => `- [${e.id} | ${e.scope} | ${e.when}] ${e.text}`)
    .join('\n')
  return `${header}\n\n**工作流规则（来自 ledger，共 ${entries.length} 条）**\n\n${body}`
}

export function apply(ctx, config) {
  const sp = ctx.systemPrompt
  if (sp === undefined) {
    ctx.logger?.warn?.('workflow-l1: systemPrompt 不可用，常驻段落未注册')
    return
  }

  const specUrl = new URL(String(config.specPath ?? './workflow.md'), import.meta.url)
  const ledgerUrl = new URL(String(config.ledgerPath ?? './evolve/ledger.md'), import.meta.url)

  // ── 1. 骨架段：workflow.md 的 L1 区（必须注入）──
  //    这是「整个工作流」的载体：七阶段 + 何时走哪个 + 六条铁律 + 资料获取与阅读方式。
  //    它必须自足 —— 看完就知道怎么干；不知道细节时，里面有一个明确的 skill 名可以去加载。
  //    详细资料（阶段动作、子文件清单、调研流程）不进常驻区，走 skill 按需加载。
  let base = null
  try {
    const text = readText(ctx, specUrl)
    const lines = text.split(/\r?\n/)
    const { b, e } = findMarkers(lines, L1_BEGIN, L1_END)
    if (b < 0 || e <= b) throw new Error('未找到独立成行的 L1 标记')
    base = lines.slice(b + 1, e).join('\n').trim()
    if (!base) throw new Error('L1 区为空')
  } catch (error) {
    ctx.logger?.error?.(`workflow-l1: workflow.md 解析失败，段落未注册：${String(error?.message ?? error)}`)
    return
  }

  // ── 2. 增量段：ledger 编译结果（追加在骨架之后，不替代它）──
  //    旧实现在这里做二选一（ledger 优先、workflow.md 兜底），后果是 ledger 一旦有内容，
  //    工作流骨架就被整体挤掉 —— 模型只看到零散规则，看不到流程。改为叠加：
  //    骨架恒在，进化出来的规则追加。
  let delta = null
  let entries = []
  try {
    const ledgerText = readText(ctx, ledgerUrl)
    const lines = ledgerText.split(/\r?\n/)
    const { b, e } = findMarkers(lines, BEGIN, END)
    if (b >= 0 && e > b) {
      entries = lines
        .slice(b + 1, e)
        .map(parseEntry)
        .filter(Boolean)
      if (entries.length) delta = compileL1(entries)
    }
  } catch (error) {
    ctx.logger?.warn?.(`workflow-l1: ledger 读取失败，仅注入骨架段：${String(error?.message ?? error)}`)
  }

  // ── 3. 注册常驻段（长度永不阻止注册）──
  //    旧实现在这里做 MAX_L1=1500 硬门禁：超一点就整段不注册。已废弃（2026-10-15）——
  //    那会把「稍微长了」升级成「整个工作流静默失效」，是最坏的失败模式。
  //    现在：骨架 + 增量一定注册；长度只在日志里提醒（下一步）。
  const l1 = delta === null ? base : base + JOIN + delta
  ctx.effect(
    () =>
      sp.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: l1,
      }),
    'workflow-l1.section()'
  )

  // ── 4. 软提醒（只写日志，不改变行为）──
  //    设计意图：约束落在「单条要短」上（贪心累积 + 每条压缩），而不是「总长封顶」。
  //    写入端的硬拦截在 dsh-evolve 的 evolve_add（正文 > MAX_ENTRY 直接拒收）。
  if (l1.length > WARN_L1) {
    ctx.logger?.warn?.(
      `workflow-l1: L1 已 ${l1.length} 字符（软阈值 ${WARN_L1}，不影响注册）。` +
        `骨架 ${base.length} + 增量 ${delta === null ? 0 : delta.length}。` +
        `建议复查：把长条目正文搬到 evolve/lessons/，ledger 里只留 ≤${MAX_ENTRY} 字符的索引行。`
    )
  }
  const longEntries = entries.filter((e) => e.text.length > MAX_ENTRY)
  if (longEntries.length) {
    ctx.logger?.warn?.(
      `workflow-l1: ${longEntries.length} 条规则正文超 ${MAX_ENTRY} 字符：` +
        longEntries.map((e) => `${e.id}(${e.text.length})`).join(', ') +
        `。建议压短，或搬到 evolve/lessons/<id>.md 后只留索引行。`
    )
  }

  // ── 5. 【已移除】evolve_add 专属工具注册 ──
  // 实测结论：预设插件（.mjs）里 ctx.tools.register 注册的工具不进入 agent 可见集。
  //   证据：scoped 与 global 查询均为 14 个且完全一致，scoped-only 为空；
  //   而动态插件用 harness.registerTool 注册的 preset_admin 可见。
  //   原因：预设 scope 与 agent scope 层级不同 —— 预设注册的是"能力"，
  //   动态插件才注册到 agent 会话工具表。官方工具走 dsh-tool-* npm 包
  //   （可 import defineTool），但预设目录无 node_modules，不能 import 裸包名。
  //
  // 替代方案（已采用）：不注册专属工具，改为在 ledger 顶部写明
  //   "要加规则就用 edit 工具向本文件 LEDGER:BEGIN/END 之间追加一行"。
  //   模型本就有 edit/write 工具；去重改为人工保证。
  //
  // 保留并已实测生效：自动编译 + 版本号 + git 回滚。
}

/**
 * 读文本。node:fs 是内置模块（不是裸包），ESM 下可直接 import。
 * 注意：预设目录没有 node_modules，任何 npm 包都不能 import。
 */
function readText(_ctx, url) {
  return readFileSync(url, 'utf8')
}

/** 写文本。 */
function writeText(_ctx, url, text) {
  return writeFileSync(url, text, 'utf8')
}
