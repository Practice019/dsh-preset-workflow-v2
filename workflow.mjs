/**
 * workflow-cordis — L1 常驻段落插件（T3 / 3b）
 * 职责：把 workflow.md 的「L1 常驻区」抽出来，注册为 systemPrompt 的
 * `workflow:policy` 段（order 700，恒早于全部工具段 1000+）。
 *
 * 关键约束（来自评审，违反即静默失效）：
 *  1. 段落名固定为 `workflow:policy`，order = 700。不得使用 persona 的
 *     PERSONA_PREFIX_SECTION 段名（那会被其它行争抢），也不得设 complete:true。
 *  2. 只抽取 <!-- L1:BEGIN --> 与 <!-- L1:END --> 之间——§3 的完整 Check 表不进常驻区。
 *  3. 解析失败必须 fail-closed：宁可段落缺失（并由规格自检 S1 报出），
 *     也不能把整份 workflow.md 塞进常驻区（那是 27KB 级的常驻税）。
 */

import { readFileSync } from 'node:fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'workflow-l1'

/** 常驻段落名。独立段名，避免与 persona 的固定段名冲突。 */
const SECTION_NAME = 'workflow:policy'

/** 恒早于全部 TOOL_* 段（1000+），晚于 PLAN_POLICY(500) / TEAM_POLICY(600)。 */
const SECTION_ORDER = 700

const BEGIN = '<!-- L1:BEGIN -->'
const END = '<!-- L1:END -->'

/**
 * 抽取 L1 常驻区。缺任一标记即抛错（由调用方 fail-closed）。
 * @param {string} text workflow.md 全文
 * @returns {string} L1 区内文
 */
function extractL1(text) {
  // 只认「独立成行且行首」的标记：
  // workflow.md 第 4 行的说明文字里就写着这两个标记名，朴素 indexOf 会命中那里，
  // 抽出一段 7 字节的垃圾（实测）。这是 S6「解析时跳过围栏内伪章节」的同类坑。
  const lines = text.split(/\r?\n/)
  let b = -1
  let e = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (b < 0 && t === BEGIN) b = i
    else if (b >= 0 && t === END) {
      e = i
      break
    }
  }
  if (b < 0 || e < 0 || e <= b) {
    throw new Error(
      `workflow-l1: 未找到独立成行的 L1 标记 (BEGIN=${b}, END=${e})；` +
        `workflow.md 必须有且仅有一对独立成行的 ${BEGIN} / ${END}`
    )
  }
  const inner = lines.slice(b + 1, e).join('\n').trim()
  if (inner.length === 0) {
    throw new Error('workflow-l1: L1 区为空')
  }
  return inner
}

/** systemPrompt 是硬依赖：不声明就不能用 ctx.systemPrompt 访问。 */
export const inject = ['systemPrompt']

export function apply(ctx, config) {
  // 读 ctx.systemPrompt 前必须声明 inject（Cordis 硬性要求：
  // 未声明的服务不得作为 ctx 属性访问），否则抛
  // "cannot get property \"systemPrompt\" without inject"。
  const sp = ctx.systemPrompt
  if (sp === undefined) {
    ctx.logger?.warn?.('workflow-l1: systemPrompt 服务不可用，常驻段落未注册')
    return
  }

  const rel = String(config.specPath ?? './workflow.md')
  const url = new URL(rel, import.meta.url)

  let l1
  try {
    l1 = extractL1(readFileSync(url, 'utf8'))
  } catch (error) {
    // fail-closed：不注册段落，让规格自检 S1 去报，而不是静默塞全文或静默通过
    ctx.logger?.error?.(
      `workflow-l1: 读取或解析 L1 区失败，常驻段落未注册：${String(error?.message ?? error)}`
    )
    return
  }

  ctx.effect(
    () =>
      sp.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: l1,
      }),
    'workflow-l1.section()'
  )
}
