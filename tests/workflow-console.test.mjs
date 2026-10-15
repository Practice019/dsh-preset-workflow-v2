// dsh-workflow-console 测试：host 半（路由 + 单行改删加 + 鉴权）与 client 半（工厂与 slot 注册）
// 跑法：node tests/workflow-console.test.mjs

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const PRESET = join(REPO)
const HOST_ENTRY = pathToFileURL(join(REPO, 'plugins/dsh-workflow-console/lib/index.js')).href

const results = []
const check = (name, ok, detail) => {
  results.push(ok)
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  —— ' + String(detail).slice(0, 170) : ''))
}

// ── fixture：一个自包含的临时预设目录（workflow.mjs 的相对路径会解析到它自己旁边） ──
const dir = mkdtempSync(join(tmpdir(), 'wfc-'))
mkdirSync(join(dir, 'evolve/lessons'), { recursive: true })
copyFileSync(join(PRESET, 'workflow.mjs'), join(dir, 'workflow.mjs'))
copyFileSync(join(PRESET, 'workflow.md'), join(dir, 'workflow.md'))
writeFileSync(join(dir, 'evolve/EDIT-GUIDE.md'), '# 指南\n只改单条，正文 ≤60 字符。\n', 'utf8')
const ledgerPath = join(dir, 'evolve/ledger.md')
const ledgerText = [
  '# 账本 fixture',
  '',
  '<!-- LEDGER:BEGIN -->',
  '',
  '- [E001 | always | 场景一] 规则正文一 → lessons/E001.md   (added: 2026-01-01, hits: 3)',
  '- [E002 | P3 | 场景二] 规则正文二',
  '',
  '<!-- LEDGER:END -->',
  '',
].join('\n')
writeFileSync(ledgerPath, ledgerText, 'utf8')

// ── 假 ctx / 假 host / 假 req-res ──
const routes = new Map()
const disposers = []
function fakeHost() {
  return {
    effect: (fn) => {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
    webServer: {
      register: (spec, label) => {
        routes.set(spec.path, { spec, label })
        return () => routes.delete(spec.path)
      },
    },
  }
}
function makeCtx() {
  return {
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    inject: (names, cb) => cb(fakeHost()),
  }
}
function makeReq(method, headers = {}, body) {
  return {
    method,
    headers: Object.assign({ host: '127.0.0.1:3080' }, headers),
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body, 'utf8')
    },
  }
}
function makeRes() {
  const out = { status: 0, headers: null, body: '' }
  return {
    out,
    writeHead(s, hh) {
      out.status = s
      out.headers = hh
    },
    end(t) {
      out.body = t === undefined ? '' : String(t)
    },
  }
}
async function call(path, { method = 'GET', headers = {}, body } = {}) {
  const route = routes.get(path)
  if (!route) throw new Error('路由未注册：' + path)
  const res = makeRes()
  await route.spec.handler(makeReq(method, headers, body), res)
  let json = null
  try {
    json = JSON.parse(res.out.body)
  } catch {}
  return { status: res.out.status, json, raw: res.out.body }
}
const JSON_HEADERS = { 'content-type': 'application/json', 'x-workflow-console': '1' }

console.log('=== 1. host 半：注册与只读状态 ===')
{
  const mod = await import(HOST_ENTRY)
  mod.apply(makeCtx(), { presetDir: dir })
  check('注册了 2 条路由', routes.size === 2, [...routes.keys()].join(', '))
  check('路由标签可读', [...routes.values()].every((r) => typeof r.label === 'string'), [...routes.values()].map((r) => r.label).join(' | '))

  const s = await call('/workflow-console/state')
  check('GET /state → 200', s.status === 200, s.status)
  check('state.ok = true', s.json?.ok === true, JSON.stringify(s.json?.error ?? ''))
  check('读到 2 条规则', s.json?.entries?.length === 2, (s.json?.entries ?? []).map((e) => e.id).join(','))
  check('编译头含 compiled E002', /compiled E002/.test(s.json?.compiled?.header ?? ''), s.json?.compiled?.header)
  check('骨架字符数 > 0 且带 L1 内容', (s.json?.compiled?.skeletonChars ?? 0) > 100 && /七阶段/.test(s.json?.compiled?.skeleton ?? ''), `skeletonChars=${s.json?.compiled?.skeletonChars}`)
  check('条目带长度与超限标记', s.json?.entries?.[0]?.length > 0 && s.json?.entries?.[0]?.over === false, JSON.stringify(s.json?.entries?.[0]))
  check('limits 与写入端一致（60）', s.json?.limits?.maxEntry === 60, s.json?.limits?.maxEntry)
  check('指南已读出', /只改单条/.test(s.json?.guide ?? ''), (s.json?.guide ?? '').slice(0, 40))
}

console.log('=== 2. 写接口鉴权（同源闸）===')
{
  const noHeader = await call('/workflow-console/rule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  check('缺 x-workflow-console 头 → 403', noHeader.status === 403, JSON.stringify(noHeader.json))
  const noCt = await call('/workflow-console/rule', { method: 'POST', headers: { 'x-workflow-console': '1' }, body: '{}' })
  check('缺 content-type → 403', noCt.status === 403, JSON.stringify(noCt.json))
  const wrongOrigin = await call('/workflow-console/rule', {
    method: 'POST',
    headers: Object.assign({ origin: 'http://evil.example' }, JSON_HEADERS),
    body: '{}',
  })
  check('跨源 origin → 403', wrongOrigin.status === 403, JSON.stringify(wrongOrigin.json))
  const wrongMethod = await call('/workflow-console/state', { method: 'POST', headers: JSON_HEADERS })
  check('GET 端点收到 POST → 405', wrongMethod.status === 405, wrongMethod.status)
}

console.log('=== 3. 加 / 改 / 删（只动单行）===')
{
  const add = await call('/workflow-console/rule', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'add', scope: 'always', when: '新场景', text: '新规则正文' }) })
  check('新增 → 200 且分配 E003', add.status === 200 && add.json?.changed?.id === 'E003', JSON.stringify(add.json?.changed))
  let lines = readFileSync(ledgerPath, 'utf8').split('\n')
  check('文件里出现 E003，且格式正确', lines.some((l) => /^- \[E003 \| always \| 新场景\] 新规则正文 {3}\(added: \d{4}-\d{2}-\d{2}, hits: 0\)$/.test(l)), lines.find((l) => l.includes('E003')))
  check('标记仍各 1 个、其它行未变', lines.filter((l) => l.trim() === '<!-- LEDGER:BEGIN -->').length === 1 && lines.filter((l) => l.trim() === '<!-- LEDGER:END -->').length === 1 && lines.includes('- [E002 | P3 | 场景二] 规则正文二'))

  const tooLong = await call('/workflow-console/rule', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'add', scope: 'always', when: 'x', text: '超'.repeat(61) }) })
  check('正文 61 字符 → 400 且提示上限', tooLong.status === 400 && /超过上限 60/.test(tooLong.json?.error ?? ''), JSON.stringify(tooLong.json))
  const badScope = await call('/workflow-console/rule', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'add', scope: 'P9', when: 'x', text: '短' }) })
  check('非法 scope → 400', badScope.status === 400, JSON.stringify(badScope.json))

  const save = await call('/workflow-console/rule', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'save', id: 'E001', scope: 'always', when: '场景一', text: '改过的正文' }) })
  check('修改 → 200', save.status === 200 && save.json?.changed?.id === 'E001', JSON.stringify(save.json?.changed))
  lines = readFileSync(ledgerPath, 'utf8').split('\n')
  const e1 = lines.find((l) => l.includes('E001'))
  check('正文已改、元数据 (added/hits) 保留', /改过的正文/.test(e1) && /added: 2026-01-01, hits: 3/.test(e1), e1)

  const del = await call('/workflow-console/rule', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'delete', id: 'E002' }) })
  check('删除 → 200', del.status === 200, JSON.stringify(del.json?.changed))
  lines = readFileSync(ledgerPath, 'utf8').split('\n')
  check('被删行消失、其余完整、无孤立空行串', !lines.some((l) => l.includes('E002')) && lines.includes('<!-- LEDGER:END -->') && !/\n\n\n/.test(lines.join('\n')))
  check('删除后重新编译：只剩 E001/E003', del.json?.entries?.length === 2 && /compiled E003/.test(del.json?.compiled?.header ?? ''), del.json?.compiled?.header)

  const missing = await call('/workflow-console/rule', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'delete', id: 'E999' }) })
  check('删不存在的 id → 400', missing.status === 400, JSON.stringify(missing.json))
}

console.log('=== 4. 标记损坏时拒绝写入 ===')
{
  const broken = mkdtempSync(join(tmpdir(), 'wfc-broken-'))
  mkdirSync(join(broken, 'evolve'), { recursive: true })
  copyFileSync(join(PRESET, 'workflow.mjs'), join(broken, 'workflow.mjs'))
  copyFileSync(join(PRESET, 'workflow.md'), join(broken, 'workflow.md'))
  writeFileSync(join(broken, 'evolve/ledger.md'), '# 没有标记\n- [E001 | always | x] y\n', 'utf8')

  const r2 = new Map()
  const mod = await import(HOST_ENTRY)
  const ctx2 = {
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    inject: (n, cb) =>
      cb({
        effect: (fn) => { const d = fn(); return d },
        webServer: { register: (spec) => { r2.set(spec.path, spec); return () => r2.delete(spec.path) } },
      }),
  }
  mod.apply(ctx2, { presetDir: broken })
  const res = makeRes()
  await r2.get('/workflow-console/rule').handler(makeReq('POST', JSON_HEADERS, JSON.stringify({ action: 'add', scope: 'always', when: 'x', text: 'y' })), res)
  const json = JSON.parse(res.out.body)
  check('标记缺失 → 400 且拒绝写入', res.out.status === 400 && /标记缺失/.test(json.error ?? ''), JSON.stringify(json))
  const res2 = makeRes()
  await r2.get('/workflow-console/state').handler(makeReq('GET'), res2)
  const st = JSON.parse(res2.out.body)
  check('只读仍可用，且 warnings 报标记缺失', st.ok === true && (st.compiled.warnings ?? []).some((w) => /标记缺失/.test(w)), JSON.stringify(st.compiled.warnings))
  check('账本文件未被改动', readFileSync(join(broken, 'evolve/ledger.md'), 'utf8') === '# 没有标记\n- [E001 | always | x] y\n')
  rmSync(broken, { recursive: true, force: true })
}

console.log('=== 5. client 半：工厂与 slot 注册（桩 window + react）===')
{
  let loaded = null
  globalThis.window = { __ModuleLoader__: { load: (spec) => { loaded = spec } } }
  const src = readFileSync(join(PRESET, 'plugins/dsh-workflow-console/client.js'), 'utf8')
  // 本机 react 可能只存在于浏览器侧（这里 react 是个断掉的 junction），所以：
  // 能解析到真 react 就用真的，否则用最小桩 —— 被测对象是我们的代码，不是 react。
  const stubReact = () => ({
    createElement: (type, props) => ({ type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    Fragment: 'Fragment',
  })
  let react = null
  let reactFrom = 'stub(最小桩)'
  for (const b of [join(PRESET, 'plugins/dsh-workflow-console/package.json'), 'C:/Users/21877/.dsh/profiles/node_modules/', 'D:/npm-global/node_modules/']) {
    try {
      react = createRequire(b)('react')
      reactFrom = b
      break
    } catch {}
  }
  if (react === null) react = stubReact()
  console.log('  react 来源：' + reactFrom)

  new Function('window', src)(globalThis.window)
  check('调用 __ModuleLoader__.load 且 id 正确', loaded !== null && loaded.id === 'dsh-workflow-console', loaded?.id)
  const plugin = loaded.factory((n) => (n === 'react' ? react : require(n)))
  check('工厂返回 {name, inject, apply}', plugin?.name === 'dsh-workflow-console' && Array.isArray(plugin?.inject) && typeof plugin?.apply === 'function', JSON.stringify({ name: plugin?.name, inject: plugin?.inject }))
  const reg = []
  plugin.apply({
    get: (n) => (n === 'slots' ? { inject: (slot, cb) => cb(), register: (opts, render) => { reg.push({ opts, render }); return () => {} } } : undefined),
  })
  check('注册到 conversation.view', reg.length === 1 && reg[0].opts.name === 'conversation.view', JSON.stringify(reg[0]?.opts))
  check('页签名可取到「工作流注入」', typeof reg[0].opts.label === 'function' && reg[0].opts.label() === '工作流注入', reg[0]?.opts?.label?.())
  check('渲染函数可调用且产出元素', (() => { try { const el = reg[0].render({}); return el !== null && typeof el === 'object' } catch (e) { return 'throw: ' + e.message } })(), '')
  check('没有 slots 服务时不炸', (() => { try { plugin.apply({ get: () => undefined }); return true } catch (e) { return 'throw: ' + e.message } })(), '')
  delete globalThis.window
}

rmSync(dir, { recursive: true, force: true })
const failed = results.filter((x) => !x).length
console.log(`\n结果：${results.length - failed}/${results.length} 通过` + (failed ? ` —— ${failed} 条红` : ' —— 全绿'))
process.exitCode = failed ? 1 : 0
