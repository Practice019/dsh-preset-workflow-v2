// evolve_add 写入端单测 —— 假 ctx + 假 fs，不碰真账本。
//
// 断言：
//   ① 正文 > 60 字符被拒收，并给出可执行 hint（压短 / 走 lessons 索引行），且不写账本
//   ② 正常正文写入成功，行格式严格正确，字段已 trim
//   ③ 空 text / 空 when 被拒
//   ④ 重复条目走 hits++ 不新增
//
// 顺手做漂移检测：本机若存在 profile 的 node_modules 副本，也一起测 ——
// 副本红 = 源码改了但没同步（跑 scripts/sync-plugin.ps1）。
//
// 跑法：node tests/evolve-guard.test.mjs

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const REPO_PLUGIN = new URL('../plugins/dsh-evolve/lib/index.js', import.meta.url)
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const INSTALLED = join(DSH_HOME, 'profiles/web/node_modules/dsh-evolve/lib/index.js')

const TARGETS = [['仓库源码 plugins/dsh-evolve', REPO_PLUGIN.href]]
if (existsSync(INSTALLED)) TARGETS.push(['本机 node_modules 副本（运行时真正加载的）', pathToFileURL(INSTALLED).href])

const LEDGER_FIXTURE = [
  '# 进化账本（fixture）',
  '',
  '<!-- LEDGER:BEGIN -->',
  '',
  '- [E015 | always | 引用外部输出字段前] 先实测其语义与覆盖度 → lessons/E015.md   (added: 2026-01-01, hits: 0)',
  '',
  '<!-- LEDGER:END -->',
  '',
].join('\n')

const LONG = '这是一条故意写得很长的规则正文用来触发超长拒收'.repeat(4)

async function loadTool(file) {
  const mod = await import(file)
  let def = null
  const ctx = {
    tools: { register: (d) => { def = d } },
    fs: {
      resolve: async () => 'Z:\\fixture\\ledger.md',
      readText: async () => LEDGER_FIXTURE,
      writeText: async (_p, t) => { ctx.__written = t },
    },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  }
  mod.apply(ctx)
  if (def === null) throw new Error('apply() 没有注册工具')
  return { def, ctx }
}

let allGreen = true
for (const [label, file] of TARGETS) {
  console.log('\n=== ' + label + ' ===')
  const { def, ctx } = await loadTool(file)
  const results = []
  const check = (name, ok, detail) => { results.push(ok); console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  —— ' + String(detail).slice(0, 140) : '')) }

  const long = await def.execute({ scope: 'always', when: '某命中条件', text: LONG })
  check('① 正文 >60 拒收（ok:false）', long?.ok === false, JSON.stringify(long))
  check('① 带 action=rejected-too-long 与 length/max', long?.action === 'rejected-too-long' && long?.length === LONG.length && long?.max === 60, `length=${long?.length} max=${long?.max}`)
  check('① 给出可执行的 hint（压短 / lessons 索引行）', typeof long?.hint === 'string' && /lessons/.test(long.hint), long?.hint)
  check('① 拒收时没有写账本', ctx.__written === undefined, ctx.__written ? '竟然写了' : 'ok')

  const ok1 = await def.execute({ scope: ' always ', when: ' 某命中条件 ', text: ' 规则正文内容 ' })
  check('② 正常写入 ok:true / added', ok1?.ok === true && ok1?.action === 'added', JSON.stringify(ok1))
  check('② 分配了新 id（E015 之后 → E016）', ok1?.id === 'E016', ok1?.id)
  const line = String(ok1?.line ?? '')
  check('② 行格式正确且字段已 trim', /^- \[E016 \| always \| 某命中条件\] 规则正文内容 {3}\(added: \d{4}-\d{2}-\d{2}, hits: 0\)$/.test(line), line)

  check('③ 空 text 拒收', (await def.execute({ scope: 'always', when: 'x', text: '   ' }))?.ok === false)
  check('③ 空 when 拒收', (await def.execute({ scope: 'always', when: '  ', text: '短规则' }))?.ok === false)

  const dup = await def.execute({ scope: 'always', when: '引用外部输出字段前', text: '先实测其语义与覆盖度 → lessons/E015.md' })
  check('④ 重复条目走 hits++ 不新增', dup?.ok === true && dup?.action === 'hits++' && dup?.id === 'E015', JSON.stringify(dup))

  const red = results.filter((x) => !x).length
  console.log(`  → ${results.length - red}/${results.length} 通过` + (red ? '（红）' : '（绿）'))
  if (red) allGreen = false
}
console.log('\n总判定：' + (allGreen ? '全部绿' : '存在红 —— 若只有副本红，说明源码改了但副本未同步（跑 scripts/sync-plugin.ps1）'))
process.exitCode = allGreen ? 0 : 1
