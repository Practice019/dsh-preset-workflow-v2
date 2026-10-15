/**
 * dsh-evolve — DSH 常驻 Host 插件（静态 bundle）
 *
 * 注册 evolve_add 工具：向 workflow-v2 预设的进化账本条目级追加规则。
 *
 * 设计要点（全部实测确认，勿改）：
 *  1. 工具用 ctx.tools.register(definition) 注册 —— 与同 profile 的 dsh-smart-search 同款。
 *     不要用 harness.defineTool / harness.registerTool：那一对只存在于「动态插件」沙箱
 *     （dsh-cordis-host-runner 给沙箱注入 harness 全局，并用 DYNAMIC_TOOL 标记校验）。
 *     静态 bundle 插件没有 harness 全局，写了会 ReferenceError: harness is not defined，
 *     并且拖垮整棵插件树（dsh 直接启动失败）。2026-09-20 实测踩过。
 *  2. output 必须声明 { schema, render }，render 必须是 function —— register() 会校验。
 *  3. parameters 传原始 JSON Schema 即可（register 不校验它）。
 *  4. fs 服务是异步的：const target = await fs.resolve(path)；再 fs.readText(target) /
 *     fs.writeText(target, text)。没有 readTextFileSync。
 *  5. ledger 路径由 DSH_HOME 推导（见下方 DSH_HOME/LEDGER），不硬编码用户目录。
 *     移动预设目录（workflow-v2 → 别的）仍需改 LEDGER 那行。
 *  6. ⚠️ 本插件被 profile 以 `file:` 依赖引用，pnpm 会把它**复制**进
 *     profiles/web/node_modules/dsh-evolve（不是软链）。改完源目录必须同步副本，
 *     否则运行时加载的仍是旧代码。2026-10-15 实测踩过。
 *  7. 【长度策略的执行者】正文 > MAX_ENTRY(60) 直接拒收（2026-10-15）。
 *     配合 workflow.mjs 废除全局硬门禁：约束放在「单条短」上，不放在「总长封顶」上。
 *     scope/when/text 统一 trim 后再写，避免脏空格进账本。
 */

/** DSH 根目录。优先环境变量，回退到默认位置。 */
const DSH_HOME = process.env.DSH_HOME || 'C:\\Users\\21877\\.dsh'

const LEDGER = DSH_HOME + '\\presets\\workflow-v2\\evolve\\ledger.md'

const BEGIN = '<!-- LEDGER:BEGIN -->'
const END = '<!-- LEDGER:END -->'

/**
 * 单条规则正文长度上限（字符）。**写入端硬拦截**（2026-10-15）。
 *
 * 背景：`workflow.mjs` 原来的 MAX_L1=1500 全局硬门禁已废除（长度不再阻止注册），
 * 约束改放在「单条要短」上——贪心累积 + 每条压缩，而不是总长封顶。
 * 常驻段是每个会话都要付的税，所以这里直接拒收超长正文，而不是等编译期提醒。
 * 需要保留长内容时：用 write 工具把正文写进 evolve/lessons/<id>.md，
 * ledger 里只留一条 ≤60 字符的索引行（形如「… → lessons/E0xx.md」）。
 */
const MAX_ENTRY = 60

/** 解析条目行： - [id | scope | when] text (added: xx, hits: n) */
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

/** 同 scope + 关键词重合率 ≥0.8 → 视为重复 */
function similar(a, b) {
  if (a.scope !== b.scope) return false
  const ka = (a.text + ' ' + a.when).replace(/[^一-龥a-zA-Z0-9]/g, '')
  const kb = (b.text + ' ' + b.when).replace(/[^一-龥a-zA-Z0-9]/g, '')
  if (!ka || !kb) return false
  if (ka === kb) return true
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka]
  const set = new Set(l)
  let h = 0
  for (const c of s) if (set.has(c)) h++
  return h / s.length >= 0.8
}

export const name = 'dsh-evolve'
export const inject = ['tools', 'fs']

export function apply(ctx) {
  ctx.tools.register({
    name: 'evolve_add',
    description:
      '向进化账本 workflow-v2/evolve/ledger.md 追加一条规则（条目级 delta，不整篇重写）。' +
      '只写 ledger，不碰 workflow.md。追加前自动去重：与已有条目高度相似则 hits++ 不新增。' +
      '正文必须 ≤60 字符（常驻段每个会话都要付这份税），超出会被拒收并给出改写建议。' +
      '改完开新会话即生效（workflow.mjs 自动编译进 L1）。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: '作用域：always 或 P0..P6' },
        when: { type: 'string', description: '命中条件：什么时候该想起这条' },
        text: { type: 'string', description: '规则正文（一句话，可执行）' },
      },
      required: ['scope', 'when', 'text'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
    },
    execute: async (args) => {
      try {
        // ── 写入端硬约束：正文必须短（长度策略的执行者在这里，不在编译期）──
        const text = String(args.text ?? '').trim()
        const scope = String(args.scope ?? '').trim() || 'always'
        const when = String(args.when ?? '').trim()
        if (!text) return { ok: false, reason: 'text 不能为空' }
        if (!when) return { ok: false, reason: 'when（命中条件）不能为空' }
        if (text.length > MAX_ENTRY) {
          return {
            ok: false,
            action: 'rejected-too-long',
            reason: `规则正文 ${text.length} 字符，超过上限 ${MAX_ENTRY}`,
            length: text.length,
            max: MAX_ENTRY,
            hint:
              '两条路：① 压到 ' + MAX_ENTRY + ' 字符内重试；② 先用 write 工具把完整正文写进 ' +
              'evolve/lessons/<id>.md，再提交一条 ≤' + MAX_ENTRY +
              ' 字符的索引行（形如「… → lessons/E0xx.md」）。',
          }
        }

        const fs = ctx.fs
        const target = fs.resolve ? await fs.resolve(LEDGER) : LEDGER
        const cur = await fs.readText(target)
        const lines = String(cur).split(/\r?\n/)

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
        if (b < 0 || e <= b) return { ok: false, reason: 'ledger 标记缺失' }

        const existing = lines
          .slice(b + 1, e)
          .map(parseEntry)
          .filter(Boolean)

        const next = { id: '', scope, when, text, hits: 0 }
        const dup = existing.find((x) => similar(x, next))

        if (dup) {
          const idx = lines.findIndex((l) => l === dup.raw)
          if (idx >= 0) {
            dup.hits += 1
            lines[idx] =
              '- [' +
              dup.id +
              ' | ' +
              dup.scope +
              ' | ' +
              dup.when +
              '] ' +
              dup.text +
              '   (added: ' +
              (dup.added || new Date().toISOString().slice(0, 10)) +
              ', hits: ' +
              dup.hits +
              ')'
            await fs.writeText(target, lines.join('\n'))
            return { ok: true, action: 'hits++', id: dup.id, hits: dup.hits }
          }
        }

        let maxId = 0
        for (const x of existing) {
          const n = parseInt(String(x.id).replace(/\D/g, ''), 10)
          if (Number.isFinite(n) && n > maxId) maxId = n
        }
        const id = 'E' + String(maxId + 1).padStart(3, '0')
        const date = new Date().toISOString().slice(0, 10)
        const line =
          '- [' +
          id +
          ' | ' +
          scope +
          ' | ' +
          when +
          '] ' +
          text +
          '   (added: ' +
          date +
          ', hits: 0)'
        lines.splice(e, 0, line)
        await fs.writeText(target, lines.join('\n'))
        return {
          ok: true,
          action: 'added',
          id,
          line,
          note: '开新会话后自动编译进 L1 生效',
        }
      } catch (err) {
        return { ok: false, reason: String((err && err.message) || err) }
      }
    },
  })
  console.log('[dsh-evolve] tool registered: evolve_add')
}
