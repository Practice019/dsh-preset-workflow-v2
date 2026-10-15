// workflow-l1 编译器单测 —— 直接用假 ctx 跑真模块，不依赖 DSH 运行时。
//
// 断言：
//   A. 账本很长（编译结果远超软阈值）时【仍然注册】段 —— 长度永不阻止注册
//   B. 超软阈值 / 单条超长时【只写 warn】，不影响注册
//   C. 规格解析失败时【不注册】并打 error（fail-closed 必须保留）
//   D. 账本标记缺失时【只注册骨架】
//
// 跑法：node tests/compiler.test.mjs   （退出码非 0 = 有失败）

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = new URL('..', import.meta.url)          // tests/ 的上一层 = 仓库根
const SPEC_OK = new URL('workflow.md', REPO).href
const { apply } = await import(new URL('workflow.mjs', REPO).href)

const dir = mkdtempSync(join(tmpdir(), 'wf-l1-'))
const fixture = (name, text) => {
  const p = join(dir, name)
  writeFileSync(p, text, 'utf8')
  return pathToFileURL(p).href
}

const entry = (i, n = 40) =>
  `- [E${100 + i} | always | 场景编号${i}] ${'规则正文'.repeat(Math.ceil(n / 4)).slice(0, n)}   (added: 2026-01-01, hits: 0)`
const ledgerBody = (rows) => `# ledger fixture\n\n<!-- LEDGER:BEGIN -->\n\n${rows.join('\n')}\n\n<!-- LEDGER:END -->\n`

const LEDGER_OVER = fixture('ledger-over.md', ledgerBody(Array.from({ length: 25 }, (_, i) => entry(i))))
const LONG_TEXT = '这是一条故意写得很长的规则正文用来触发超长提醒'.repeat(4)
const LEDGER_SMALL = fixture('ledger-small.md', ledgerBody([
  entry(0, 30),
  `- [E200 | always | 某场景] ${LONG_TEXT}   (added: 2026-01-01, hits: 0)`,
]))
const LEDGER_NO_MARKERS = fixture('ledger-nomarkers.md', '# 没有标记\n- [E001 | always | x] y\n')
const SPEC_BROKEN = fixture('spec-broken.md', '# 没有 L1 标记的规格\n\n正文若干\n')

function run({ specPath, ledgerPath }) {
  const calls = { section: [], warn: [], error: [] }
  const ctx = {
    systemPrompt: { section: (o) => { calls.section.push(o); return () => {} } },
    logger: { warn: (m) => calls.warn.push(String(m)), error: (m) => calls.error.push(String(m)), info: () => {} },
    // apply() 用 ctx.effect(() => sp.section(...)) 注册段落，假 ctx 必须真的执行回调
    effect: (fn) => fn(),
    get: () => undefined,
  }
  apply(ctx, { specPath, ledgerPath })
  return { calls, text: calls.section[0]?.text ?? null, len: calls.section[0]?.text?.length ?? 0 }
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  —— ' + detail : ''))
}

console.log('=== A/B 超长账本（25 条，编译结果远超软阈值）===')
{
  const r = run({ specPath: SPEC_OK, ledgerPath: LEDGER_OVER })
  check('A 段落仍然注册（长度不阻止注册）', r.text !== null, r.text === null ? `未注册；error=${r.calls.error[0] ?? '(无)'}` : `${r.len} 字符`)
  check('A 25 条规则全在段里', r.text !== null && r.text.includes('E124'), r.text?.includes('E124') ? 'E124 在' : '缺 E124')
  check('B 超软阈值时给出 warn（不阻止注册）', r.calls.warn.some((w) => /软阈值/.test(w)) && r.text !== null, r.calls.warn.join(' | ').slice(0, 120) || '(没有 warn)')
}

console.log('=== C 单条正文 > 60 字符 ===')
{
  console.log('  （前置条件）E200 正文长度 =', LONG_TEXT.length, LONG_TEXT.length > 60 ? '(>60 ✔)' : '(不构成前置条件 ❌)')
  const r = run({ specPath: SPEC_OK, ledgerPath: LEDGER_SMALL })
  check('C 超长条目被点名 warn', r.calls.warn.some((w) => /E200/.test(w)), r.calls.warn.join(' | ').slice(0, 140) || '(没有 warn)')
}

console.log('=== D 规格解析失败（fail-closed 必须保留）===')
{
  const r = run({ specPath: SPEC_BROKEN, ledgerPath: LEDGER_SMALL })
  check('D 不注册段落', r.text === null, r.text === null ? 'ok' : `竟然注册了 ${r.len} 字符`)
  check('D 且打了 error', r.calls.error.length > 0, r.calls.error[0]?.slice(0, 100) ?? '(无 error)')
}

console.log('=== E 账本标记缺失 ===')
{
  const r = run({ specPath: SPEC_OK, ledgerPath: LEDGER_NO_MARKERS })
  check('E 只注册骨架（不含 fixture 条目）', r.text !== null && !r.text.includes('E001'), r.text === null ? '未注册' : `${r.len} 字符`)
}

const failed = results.filter((x) => !x.ok).length
console.log(`\n结果：${results.length - failed}/${results.length} 通过` + (failed ? ` —— ${failed} 条红` : ' —— 全绿'))
try { rmSync(dir, { recursive: true, force: true }) } catch {}
process.exitCode = failed ? 1 : 0
