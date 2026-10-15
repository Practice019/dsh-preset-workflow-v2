/**
 * dsh-workflow-console — host 半
 *
 * 提供「工作流注入台」的数据与写入通道：读取 workflow-v2 预设往提示词里注入的内容
 * （L1 骨架 + 规则账本，用预设自己的 compile() 编译，口径绝对一致），并支持改/删/加单条规则。
 *
 * 设计要点（都踩过）：
 *  1. 编译口径**复用** `<presetDir>/workflow.mjs` 的 `compile()`，不在这里复刻一份 ——
 *     否则查看器显示的长度/条目/编译头迟早与真实注入漂移，那它就失去意义。
 *     代价：预设目录被移动时要同步改 presetDir 配置（与 dsh-evolve 的 LEDGER 同一约定）。
 *  2. 路由走 `ctx.inject(['webServer'], host => host.webServer.register({kind:'exact', path, handler}, label))`。
 *     `register` 返回 disposer，必须收进 `host.effect(...)` 的 cleanup ——
 *     否则插件 reload 时旧 handler 还挂着，新的一层层叠上去（dsh-purge 同样坑）。
 *  3. 写操作：**原子写**（写 .tmp + rename），并且只改**单行**；标记与注释一律不碰。
 *  4. 写操作最外层加两道同源闸（本机 web 服务没有任何鉴权，不能谁来都能改文件）：
 *     · `content-type: application/json`（跨源提交需预检）
 *     · 自定义头 `x-workflow-console: 1`（只有本插件的 client 会带）
 *  5. 长度约束的执行者仍然在写入端：这里与 dsh-evolve 的 evolve_add 用同一套校验
 *     （≤60 字符、无换行、scope 合法），避免两处口径不一致。
 *
 * 只读接口：GET  /workflow-console/state   → 编译结果 + 骨架 + 条目 + 限制 + 指南
 * 写接口  ：POST /workflow-console/rule    → {action:'add'|'save'|'delete', ...} → 返回新 state
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'dsh-workflow-console'

/** webServer 在无 web 的环境不存在，走运行时 inject，不在插件级硬依赖。 */
export const inject = []

const ROUTE = '/workflow-console'
const MAX_ENTRY = 60
const WARN_L1 = 2000
const ALLOWED_SCOPES = ['always', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']
const BEGIN = '<!-- LEDGER:BEGIN -->'
const END = '<!-- LEDGER:END -->'

/** 预设目录：config.presetDir > env DSH_HOME 推导（与 dsh-evolve 的 LEDGER 同一约定）。 */
function resolvePresetDir(config) {
  if (config?.presetDir) return String(config.presetDir)
  const home = process.env.DSH_HOME || 'C:\\Users\\21877\\.dsh'
  return join(home, 'presets', 'workflow-v2')
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** 同源闸：本机 web 服务无鉴权，写接口必须自证来自本插件的前端。 */
function sameOriginGate(request) {
  const ct = String(request.headers['content-type'] ?? '')
  if (!ct.includes('application/json')) return '需要 content-type: application/json'
  if (request.headers['x-workflow-console'] !== '1') return '缺少 x-workflow-console 头'
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let host
    try {
      host = new URL(origin).host
    } catch {
      return 'origin 非法'
    }
    if (host !== request.headers.host) return `origin 与 host 不一致（${host}）`
  }
  return null
}

async function readJsonBody(request, limit = 128 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length ? JSON.parse(raw) : {}
}

// ── 账本行操作 ────────────────────────────────────────────────────────────────

const LINE_RE = /^-\s*\[([^\]|]*)\|([^\]|]*)\|([^\]]*)\]\s*(.*)$/

function parseLine(line) {
  const m = LINE_RE.exec(line.trim())
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
  return { id, scope, when, text: rest, hits, added }
}

function formatLine({ id, scope, when, text, added, hits }) {
  const date = added || new Date().toISOString().slice(0, 10)
  return `- [${id} | ${scope} | ${when}] ${text}   (added: ${date}, hits: ${hits ?? 0})`
}

function readLedger(dir) {
  const path = join(dir, 'evolve', 'ledger.md')
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  const b = lines.findIndex((l) => l.trim() === BEGIN)
  const e = lines.findIndex((l) => l.trim() === END)
  const rows = []
  if (b >= 0 && e > b) {
    for (let i = b + 1; i < e; i++) {
      const parsed = parseLine(lines[i])
      if (parsed) rows.push({ ...parsed, lineIndex: i })
    }
  }
  return { path, text, lines, begin: b, end: e, rows }
}

function writeLedgerAtomic(path, lines) {
  const tmp = `${path}.tmp-wfc`
  writeFileSync(tmp, lines.join('\n'), 'utf8')
  renameSync(tmp, path)
}

function nextId(rows) {
  let max = 0
  for (const r of rows) {
    const n = parseInt(String(r.id).replace(/\D/g, ''), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return 'E' + String(max + 1).padStart(3, '0')
}

/** 写入前校验：与 dsh-evolve 的 evolve_add 同一套（≤60、无换行、scope 合法）。 */
function validateRule({ scope, when, text }) {
  const s = String(scope ?? '').trim()
  const w = String(when ?? '').trim()
  const t = String(text ?? '').trim()
  if (!t) return { error: '正文不能为空' }
  if (!w) return { error: '命中条件（when）不能为空' }
  if (ALLOWED_SCOPES.includes(s) === false) return { error: `scope 必须是 always 或 P0..P6（收到：${s}）` }
  if (/[\r\n]/.test(t)) return { error: '正文不能含换行' }
  if (/[\r\n]/.test(w)) return { error: '命中条件不能含换行' }
  if (/\|/.test(t) || /\|/.test(w)) return { error: '正文/命中条件不能含 |（会破坏行格式）' }
  if (t.length > MAX_ENTRY) return { error: `正文 ${t.length} 字符，超过上限 ${MAX_ENTRY}（长内容写 evolve/lessons/）` }
  return { scope: s, when: w, text: t }
}

// ── 状态聚合 ─────────────────────────────────────────────────────────────────

let cachedCompiler = null
let cachedKey = ''

async function loadCompiler(dir) {
  const url = pathToFileURL(join(dir, 'workflow.mjs')).href
  if (cachedCompiler !== null && cachedKey === url) return cachedCompiler
  const mod = await import(url)
  if (typeof mod.compile !== 'function') throw new Error('workflow.mjs 没有导出 compile()（该版本太旧？）')
  cachedCompiler = mod
  cachedKey = url
  return mod
}

function readGuide(dir) {
  const p = join(dir, 'evolve', 'EDIT-GUIDE.md')
  if (!existsSync(p)) return '（缺少 evolve/EDIT-GUIDE.md：本预设未附带改写指南）'
  return readFileSync(p, 'utf8')
}

async function buildState(dir) {
  const mod = await loadCompiler(dir)
  const ledger = readLedger(dir)
  const compiled = mod.compile()
  const entries = ledger.rows.map((r, i) => ({
    index: i + 1,
    id: r.id,
    scope: r.scope,
    when: r.when,
    text: r.text,
    length: r.text.length,
    over: r.text.length > MAX_ENTRY,
    added: r.added,
    hits: r.hits,
  }))
  const header = /\[WF-v2\.4[^\]]*\]/.exec(compiled.l1)?.[0] ?? ''
  return {
    ok: true,
    presetDir: dir,
    ledgerPath: ledger.path,
    specPath: join(dir, 'workflow.md'),
    lessonsDir: join(dir, 'evolve', 'lessons'),
    compiled: {
      ok: compiled.ok,
      error: compiled.error ?? null,
      warnings: compiled.warnings,
      header,
      chars: compiled.chars,
      skeletonChars: compiled.skeletonChars,
      deltaChars: compiled.deltaChars,
      overWarn: compiled.chars > WARN_L1,
      l1: compiled.l1,
      skeleton: compiled.base,
    },
    entries,
    limits: { maxEntry: MAX_ENTRY, warnL1: WARN_L1, scopes: ALLOWED_SCOPES },
    guide: readGuide(dir),
  }
}

async function mutate(dir, body) {
  const ledger = readLedger(dir)
  if (ledger.begin < 0 || ledger.end <= ledger.begin) return { error: '账本标记缺失（LEDGER:BEGIN / LEDGER:END），拒绝写入' }
  const action = String(body.action ?? '')
  const lines = ledger.lines

  if (action === 'add') {
    const v = validateRule(body)
    if (v.error) return v
    const id = nextId(ledger.rows)
    lines.splice(ledger.end, 0, formatLine({ id, scope: v.scope, when: v.when, text: v.text, added: '', hits: 0 }))
    writeLedgerAtomic(ledger.path, lines)
    return { ok: true, action, id }
  }

  if (action === 'save' || action === 'delete') {
    const row = ledger.rows.find((r) => r.id === String(body.id ?? '').trim())
    if (row === undefined) return { error: `找不到条目 ${body.id}` }
    if (action === 'delete') {
      lines.splice(row.lineIndex, 1)
      writeLedgerAtomic(ledger.path, lines)
      return { ok: true, action, id: row.id }
    }
    const v = validateRule({ scope: body.scope, when: body.when, text: body.text })
    if (v.error) return v
    lines[row.lineIndex] = formatLine({ id: row.id, scope: v.scope, when: v.when, text: v.text, added: row.added, hits: row.hits })
    writeLedgerAtomic(ledger.path, lines)
    return { ok: true, action, id: row.id }
  }

  return { error: `未知 action：${action}（支持 add / save / delete）` }
}

// ── 插件入口 ─────────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
  const dir = resolvePresetDir(config)

  const install = (host) => {
    if (host?.webServer?.register === undefined) {
      ctx.logger?.warn?.('workflow-console: webServer 不可用，页签数据通道未挂载')
      return
    }
    host.effect(
      () => {
        const disposers = []
        const track = (d) => {
          if (typeof d === 'function') disposers.push(d)
          return d
        }

        track(
          host.webServer.register(
            {
              kind: 'exact',
              path: `${ROUTE}/state`,
              handler: async (request, response) => {
                if (request.method !== 'GET') {
                  response.writeHead(405, { allow: 'GET' })
                  response.end()
                  return
                }
                try {
                  sendJson(response, 200, await buildState(dir))
                } catch (error) {
                  sendJson(response, 500, { ok: false, error: String(error?.message ?? error), presetDir: dir })
                }
              },
            },
            'workflow-console: state'
          )
        )

        track(
          host.webServer.register(
            {
              kind: 'exact',
              path: `${ROUTE}/rule`,
              handler: async (request, response) => {
                if (request.method !== 'POST') {
                  response.writeHead(405, { allow: 'POST' })
                  response.end()
                  return
                }
                const gate = sameOriginGate(request)
                if (gate !== null) {
                  sendJson(response, 403, { ok: false, error: gate })
                  return
                }
                try {
                  const body = await readJsonBody(request)
                  const result = await mutate(dir, body)
                  if (result.error) {
                    sendJson(response, 400, { ok: false, error: result.error })
                    return
                  }
                  sendJson(response, 200, { ...(await buildState(dir)), changed: result })
                } catch (error) {
                  sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
                }
              },
            },
            'workflow-console: rule'
          )
        )

        return () => {
          for (const d of disposers) {
            try {
              d()
            } catch {
              /* 卸载失败不影响其它路由 */
            }
          }
        }
      },
      'workflow-console routes'
    )
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (host) => install(host))
  } else if (ctx.get?.('webServer') !== undefined) {
    install(ctx)
  } else {
    ctx.logger?.warn?.('workflow-console: 拿不到 webServer，页签数据通道未挂载')
  }
}
