/**
 * workflow-v2 — L1 常驻段落 + 自我进化（v2.4 进化机制）
 *
 * 职责：
 *  1. 【编译】读 evolve/ledger.md 的活跃条目 → 渲染成 L1 常驻段文本（含版本号）
 *  2. 【注册】注册为 systemPrompt 的 `workflow:policy` 段（order 700，恒早于工具段 1000+）
 *  3. 【写入】注册 evolve.add 工具：只向 ledger 追加单条（含去重），不碰 workflow.md
 *
 * 关键约束（违反即静默失效）：
 *  1. 段落名固定 `workflow:policy`，order=700。不用 persona 的 PERSONA_PREFIX_SECTION
 *     （固定常量会被争抢），也不设 complete:true（会被整体丢弃规则吞掉且不报错）。
 *  2. 编译写在 apply() 内 —— 源码已验证：apply() 在世代建立时执行，section() 插入的
 *     就是本次新世代的 layer，所以【本会话即最新】，无需再开第二次会话。
 *      （dsh-system-prompt/lib/index.js:238）
 *  3. 解析/读取失败必须 fail-closed：宁可段落缺失，也不能把整份文件塞进常驻区。
 *  4. .mjs 不能 import 裸包名（预设目录无 node_modules）→ 文件读写走 node:fs 内置模块。
 */

import { readFileSync, writeFileSync } from 'node:fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-l1'

/** 常驻段落名。 */
const SECTION_NAME = 'workflow:policy'

/** 恒早于全部 TOOL_* 段（1000+），晚于 PLAN_POLICY(500) / TEAM_POLICY(600)。 */
const SECTION_ORDER = 700

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

  // ── 1. 编译 L1：优先 ledger，失败/为空则回退 workflow.md 的 L1 区 ──
  let l1 = null
  try {
    const ledgerText = readText(ctx, ledgerUrl)
    const lines = ledgerText.split(/\r?\n/)
    const { b, e } = findMarkers(lines, BEGIN, END)
    if (b >= 0 && e > b) {
      const entries = lines
        .slice(b + 1, e)
        .map(parseEntry)
        .filter(Boolean)
      if (entries.length) l1 = compileL1(entries)
    }
  } catch (error) {
    ctx.logger?.warn?.(`workflow-l1: ledger 读取失败，回退 workflow.md：${String(error?.message ?? error)}`)
  }

  if (l1 === null) {
    try {
      const text = readText(ctx, specUrl)
      const lines = text.split(/\r?\n/)
      const { b, e } = findMarkers(lines, L1_BEGIN, L1_END)
      if (b < 0 || e <= b) throw new Error('未找到独立成行的 L1 标记')
      l1 = lines.slice(b + 1, e).join('\n').trim()
      if (!l1) throw new Error('L1 区为空')
    } catch (error) {
      ctx.logger?.error?.(`workflow-l1: workflow.md 解析失败，段落未注册：${String(error?.message ?? error)}`)
      return
    }
  }

  // ── 2. 注册常驻段 ──
  ctx.effect(
    () =>
      sp.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: l1,
      }),
    'workflow-l1.section()'
  )

  // ── 3. 注册 evolve_add 工具：只追加单条到 ledger（去重），不碰 workflow.md ──
  // DSH 强制：动态工具必须用 harness.defineTool(...) 包装后再 register，
  // 直接传对象会抛 "must use a tool returned by harness.defineTool(...)"。
  // harness 不可用时跳过工具注册（段落已注册，不影响核心功能）。
  const tools = ctx.tools
  if (tools?.register && typeof harness !== 'undefined' && harness?.defineTool) {
    ctx.effect(
      () =>
        tools.register(
          harness.defineTool({
            name: 'evolve_add',
            description:
              '向进化账本追加一条规则（条目级 delta）。只写 evolve/ledger.md，不碰 workflow.md。' +
              '新增前会与已有条目去重，命中则 hits++ 不新增。',
          parameters: {
            type: 'object',
            properties: {
              scope: { type: 'string', description: '作用域：always 或 P0..P6' },
              when: { type: 'string', description: '命中条件：什么时候该想起这条' },
              text: { type: 'string', description: '规则正文（一句话，可执行）' },
            },
            required: ['scope', 'when', 'text'],
          },
          // DSH 硬性要求：工具必须声明 output（含 schema 与 render），否则挂载报错
          // "must declare output { schema, render, presentationMeta? }"
          output: {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                action: { type: 'string' },
                id: { type: 'string' },
                hits: { type: 'number' },
                line: { type: 'string' },
                reason: { type: 'string' },
              },
            },
            render: (args, value) => [
              { type: 'text', text: JSON.stringify(value, null, 1) },
            ],
          },
          execute: async (args) => {
            const cur = readText(ctx, ledgerUrl)
            const lines = cur.split(/\r?\n/)
            const { b, e } = findMarkers(lines, BEGIN, END)
            if (b < 0 || e <= b) return { ok: false, reason: 'ledger 标记缺失' }
            const existing = lines.slice(b + 1, e).map(parseEntry).filter(Boolean)
            const next = { id: '', scope: args.scope, when: args.when, text: args.text, hits: 0 }
            const dup = existing.find((x) => similar(x, next))
            if (dup) {
              // 命中：hits++ 并回写该行
              const idx = lines.findIndex((l) => l === dup.raw)
              if (idx >= 0) {
                dup.hits += 1
                lines[idx] =
                  `- [${dup.id} | ${dup.scope} | ${dup.when}] ${dup.text}   ` +
                  `(added: ${dup.added || new Date().toISOString().slice(0, 10)}, hits: ${dup.hits})`
                writeText(ctx, ledgerUrl, lines.join('\n'))
                return { ok: true, action: 'hits++', id: dup.id, hits: dup.hits }
              }
            }
            const maxId = existing.reduce((m, x) => {
              const n = parseInt(String(x.id).replace(/\D/g, ''), 10)
              return Number.isFinite(n) && n > m ? n : m
            }, 0)
            const id = 'E' + String(maxId + 1).padStart(3, '0')
            const date = new Date().toISOString().slice(0, 10)
            const line = `- [${id} | ${args.scope} | ${args.when}] ${args.text}   (added: ${date}, hits: 0)`
            lines.splice(e, 0, line)
            writeText(ctx, ledgerUrl, lines.join('\n'))
            return { ok: true, action: 'added', id, line }
          },
          })
        ),
      'workflow-l1.evolve_add()'
    )
  }
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
