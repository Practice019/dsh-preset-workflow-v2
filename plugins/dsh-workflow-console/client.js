/**
 * dsh-workflow-console — client 半（浏览器）
 *
 * 在会话顶部视图条上注册一个「工作流注入」页签：
 *   · 看：工作流预设往系统提示里注入了什么（编译头 + 骨架 + 每条规则 + 总字符数）
 *   · 改：单条规则的行内编辑 / 删除 / 新增（走 host 半的 HTTP 路由，原子写单行）
 *   · 交：把「改这条」的完整指令复制给 AI（附指南与格式约束，避免 AI 瞎改）
 *
 * 约定（照本机现有插件 dsh-infinite-gen-5 / dsh-purge 的写法）：
 *   1. 浏览器半用 window.__ModuleLoader__.load({id, factory}) 包一层，factory 里 require('react')；
 *   2. 只注册 conversation.view（列表协议，label 用函数），不替换任何根级 slot；
 *   3. 与 host 通信走同源 fetch（host 半在 DSH web 服务上挂 /workflow-console/*）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-workflow-console',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useCallback = React.useCallback

    var ID = 'dsh-workflow-console'
    var API = '/workflow-console'
    var TAB_LABEL = '工作流注入'

    // ── 主题变量（带 fallback，深浅色都可用） ─────────────────────────────────
    var C = {
      text: 'var(--dsw-alias-label-primary, #1a1a1a)',
      sub: 'var(--dsw-alias-label-secondary, #6b6b6b)',
      dim: 'var(--dsw-alias-label-tertiary, #8c8c8c)',
      bg: 'var(--dsw-alias-bg-layer-2, #ffffff)',
      bg1: 'var(--dsw-alias-bg-layer-1, #f7f6f3)',
      line: 'var(--dsw-alias-border-l1, #d9d5cc)',
      brand: 'var(--dsw-alias-brand-primary, #4a7d63)',
      danger: 'var(--dsw-alias-state-error-primary, #c0392b)',
      ok: 'var(--dsw-alias-state-success-primary, #2e7d54)',
    }
    var mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

    // ── HTTP ─────────────────────────────────────────────────────────────────
    function api(path, init) {
      return fetch(API + path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init || {})).then(
        function (r) {
          return r.text().then(function (t) {
            var data = null
            try {
              data = t ? JSON.parse(t) : null
            } catch (e) {
              throw new Error('响应不是 JSON（HTTP ' + r.status + '）：' + t.slice(0, 200))
            }
            if (!r.ok || (data && data.ok === false)) throw new Error((data && data.error) || 'HTTP ' + r.status)
            return data
          })
        }
      )
    }
    function postRule(payload) {
      return api('/rule', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workflow-console': '1' },
        body: JSON.stringify(payload),
      })
    }
    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text)
      } catch (e) {}
      try {
        var ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch (e) {}
      return Promise.resolve()
    }

    // ── 小组件 ───────────────────────────────────────────────────────────────
    function Btn(props) {
      var style = {
        appearance: 'none',
        border: '1px solid ' + (props.danger ? C.danger : C.line),
        background: props.primary ? C.brand : 'transparent',
        color: props.primary ? '#fff' : props.danger ? C.danger : C.text,
        borderRadius: 7,
        padding: '4px 10px',
        fontSize: 12,
        lineHeight: '20px',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }
      return h(
        'button',
        { type: 'button', style: style, disabled: props.disabled === true, onClick: props.onClick, title: props.title || '' },
        props.label
      )
    }

    function Badge(props) {
      var color = props.tone === 'bad' ? C.danger : props.tone === 'ok' ? C.ok : C.sub
      return h(
        'span',
        {
          style: {
            fontFamily: mono,
            fontSize: 11,
            color: color,
            border: '1px solid ' + color,
            borderRadius: 99,
            padding: '0 7px',
            lineHeight: '17px',
            flex: '0 0 auto',
          },
        },
        props.text
      )
    }

    function Section(props) {
      var openState = useState(props.defaultOpen === true)
      var open = openState[0]
      var setOpen = openState[1]
      return h(
        'div',
        { style: { border: '1px solid ' + C.line, borderRadius: 8, background: C.bg, overflow: 'hidden' } },
        h(
          'button',
          {
            type: 'button',
            onClick: function () {
              setOpen(!open)
            },
            style: {
              width: '100%',
              textAlign: 'left',
              appearance: 'none',
              border: 0,
              background: 'transparent',
              color: C.text,
              cursor: 'pointer',
              padding: '9px 12px',
              fontSize: 13,
              fontWeight: 600,
            },
          },
          (open ? '▾ ' : '▸ ') + props.title + (props.hint ? '  ·  ' + props.hint : '')
        ),
        open ? h('div', { style: { padding: '0 12px 12px' } }, props.children) : null
      )
    }

    // ── 主面板 ───────────────────────────────────────────────────────────────
    function Console() {
      var st = useState(null)
      var state = st[0]
      var setState = st[1]
      var et = useState('')
      var error = et[0]
      var setError = et[1]
      var lt = useState(false)
      var loading = lt[0]
      var setLoading = lt[1]
      var ed = useState(null) // 正在编辑的 id
      var editing = ed[0]
      var setEditing = ed[1]
      var dr = useState(null) // 待确认删除的 id
      var deleting = dr[0]
      var setDeleting = dr[1]
      var nt = useState({ scope: 'always', when: '', text: '' })
      var draft = nt[0]
      var setDraft = nt[1]
      var ft = useState('')
      var flash = ft[0]
      var setFlash = ft[1]

      var load = useCallback(function () {
        setLoading(true)
        api('/state')
          .then(function (s) {
            setState(s)
            setError('')
          })
          .catch(function (e) {
            setError(String(e.message || e))
          })
          .then(function () {
            setLoading(false)
          })
      }, [])

      useEffect(function () {
        load()
      }, [load])

      function say(msg) {
        setFlash(msg)
        setTimeout(function () {
          setFlash('')
        }, 2500)
      }

      function submit(payload, okMsg) {
        setError('')
        return postRule(payload)
          .then(function (s) {
            setState(s)
            say(okMsg)
            setEditing(null)
            setDeleting(null)
            return true
          })
          .catch(function (e) {
            setError(String(e.message || e))
            return false
          })
      }

      if (state === null && loading) {
        return h('div', { style: { padding: 20, color: C.sub, fontSize: 13 } }, '读取中…')
      }
      if (state === null) {
        return h(
          'div',
          { style: { padding: 20, fontSize: 13 } },
          h('div', { style: { color: C.danger, marginBottom: 8 } }, '读不到工作流状态：' + error),
          h(Btn, { label: '重试', onClick: load, primary: true })
        )
      }

      var comp = state.compiled || {}
      var limits = state.limits || {}
      var entries = state.entries || []

      var rowStyle = {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderBottom: '1px solid ' + C.line,
        fontSize: 13,
        color: C.text,
      }

      var head = h(
        'div',
        { style: { border: '1px solid ' + C.line, borderRadius: 8, background: C.bg, padding: '12px 14px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: { fontFamily: mono, fontSize: 13, color: C.text } }, comp.header || '(编译头缺失)'),
          h(Badge, {
            text: comp.chars + ' 字符',
            tone: comp.overWarn ? 'bad' : 'ok',
          }),
          h(Badge, { text: '骨架 ' + comp.skeletonChars + ' + 规则 ' + comp.deltaChars }),
          h(Badge, { text: entries.length + ' 条规则' }),
          comp.overWarn ? h(Badge, { text: '超软阈值 ' + limits.warnL1 + '（不阻断）', tone: 'bad' }) : null,
          h('span', { style: { flex: 1 } }),
          flash ? h('span', { style: { color: C.ok, fontSize: 12 } }, flash) : null,
          h(Btn, { label: loading ? '刷新中…' : '刷新', onClick: load, disabled: loading }),
          h(Btn, {
            label: '复制注入全文',
            title: '把当前会注入系统提示的这一整段复制走',
            onClick: function () {
              copyText(comp.l1 || '')
              say('已复制注入全文')
            },
          })
        ),
        h(
          'div',
          { style: { marginTop: 8, fontSize: 11, color: C.dim, fontFamily: mono, wordBreak: 'break-all' } },
          '账本 ' + state.ledgerPath
        ),
        comp.ok === false
          ? h('div', { style: { marginTop: 8, color: C.danger, fontSize: 12 } }, '编译失败：' + comp.error)
          : null,
        (comp.warnings || []).length
          ? h(
              'div',
              { style: { marginTop: 8, color: C.danger, fontSize: 12 } },
              comp.warnings.join(' / ')
            )
          : null
      )

      var ruleList = h(
        'div',
        { style: { border: '1px solid ' + C.line, borderRadius: 8, background: C.bg, overflow: 'hidden' } },
        h(
          'div',
          {
            style: {
              padding: '8px 12px',
              borderBottom: '1px solid ' + C.line,
              fontSize: 12,
              color: C.sub,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            },
          },
          h('span', null, '规则账本（正文 ≤' + limits.maxEntry + ' 字符；改完开新会话才生效）'),
          h('span', { style: { flex: 1 } })
        ),
        entries.length === 0
          ? h('div', { style: { padding: 12, color: C.sub, fontSize: 13 } }, '（暂无规则）')
          : entries.map(function (e) {
              if (editing === e.id) {
                return h(
                  'div',
                  { key: e.id, style: Object.assign({}, rowStyle, { display: 'block', background: C.bg1 }) },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 } },
                    h('span', { style: { fontFamily: mono, color: C.text } }, e.id),
                    h('span', { style: { fontFamily: mono, color: C.sub } }, '正文 ' + draft.text.length + '/' + limits.maxEntry),
                    h('span', { style: { flex: 1 } }),
                    h(Btn, {
                      label: '保存',
                      primary: true,
                      onClick: function () {
                        submit(
                          { action: 'save', id: e.id, scope: draft.scope, when: draft.when, text: draft.text },
                          '已保存 ' + e.id + '（开新会话生效）'
                        )
                      },
                    }),
                    h(Btn, { label: '取消', onClick: function () { setEditing(null) } })
                  ),
                  h('input', {
                    value: draft.scope,
                    onChange: function (ev) { setDraft(Object.assign({}, draft, { scope: ev.target.value })) },
                    style: inputStyle(90),
                    placeholder: 'scope',
                  }),
                  h('input', {
                    value: draft.when,
                    onChange: function (ev) { setDraft(Object.assign({}, draft, { when: ev.target.value })) },
                    style: inputStyle(220),
                    placeholder: '命中条件',
                  }),
                  h('input', {
                    value: draft.text,
                    onChange: function (ev) { setDraft(Object.assign({}, draft, { text: ev.target.value })) },
                    style: inputStyle(0, true),
                    placeholder: '正文（≤' + limits.maxEntry + ' 字符）',
                  })
                )
              }
              return h(
                'div',
                { key: e.id, style: rowStyle },
                h('span', { style: { fontFamily: mono, fontSize: 12, color: C.text, flex: '0 0 auto' } }, e.id),
                h('span', { style: { fontFamily: mono, fontSize: 11, color: C.sub, flex: '0 0 auto' } }, e.scope),
                h('span', { style: { fontSize: 11, color: C.dim, flex: '0 0 auto' } }, e.when || '—'),
                h(
                  'span',
                  { style: { flex: 1, wordBreak: 'break-all', color: C.text } },
                  e.text
                ),
                h(Badge, { text: e.length + '', tone: e.over ? 'bad' : 'ok' }),
                h(Btn, {
                  label: '复制',
                  title: '复制这一行的原文',
                  onClick: function () {
                    copyText('- [' + e.id + ' | ' + e.scope + ' | ' + e.when + '] ' + e.text)
                    say('已复制 ' + e.id)
                  },
                }),
                h(Btn, {
                  label: '交给 AI 改',
                  title: '复制一段带约束的修改指令，粘给 AI 即可',
                  onClick: function () {
                    copyText(buildAiPrompt(state, e))
                    say('已复制给 AI 的指令（记得补一句要改成什么）')
                  },
                }),
                h(Btn, {
                  label: '编辑',
                  onClick: function () {
                    setDraft({ scope: e.scope, when: e.when, text: e.text })
                    setEditing(e.id)
                    setDeleting(null)
                  },
                }),
                deleting === e.id
                  ? h(Btn, {
                      label: '确认删除',
                      danger: true,
                      onClick: function () {
                        submit({ action: 'delete', id: e.id }, '已删除 ' + e.id + '（开新会话生效）')
                      },
                    })
                  : h(Btn, {
                      label: '删除',
                      danger: true,
                      onClick: function () {
                        setDeleting(e.id)
                      },
                    })
              )
            })
      )

      var addForm = h(
        'div',
        { style: { border: '1px solid ' + C.line, borderRadius: 8, background: C.bg, padding: '10px 12px' } },
        h('div', { style: { fontSize: 12, color: C.sub, marginBottom: 8 } }, '加一条规则（等价于 evolve_add，正文本地校验）'),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            value: draft.scope,
            onChange: function (ev) { setDraft(Object.assign({}, draft, { scope: ev.target.value })) },
            style: inputStyle(90),
            placeholder: 'scope',
          }),
          h('input', {
            value: draft.when,
            onChange: function (ev) { setDraft(Object.assign({}, draft, { when: ev.target.value })) },
            style: inputStyle(220),
            placeholder: '命中条件',
          }),
          h('input', {
            value: draft.text,
            onChange: function (ev) { setDraft(Object.assign({}, draft, { text: ev.target.value })) },
            style: inputStyle(0, true),
            placeholder: '正文（≤' + limits.maxEntry + ' 字符）',
          }),
          h('span', {
            style: { fontFamily: mono, fontSize: 11, color: draft.text.length > limits.maxEntry ? C.danger : C.dim },
          }, draft.text.length + '/' + limits.maxEntry),
          h(Btn, {
            label: '添加',
            primary: true,
            disabled: loading,
            onClick: function () {
              submit({ action: 'add', scope: draft.scope, when: draft.when, text: draft.text }, '已新增（开新会话生效）').then(function (ok) {
                if (ok) setDraft({ scope: 'always', when: '', text: '' })
              })
            },
          })
        )
      )

      return h(
        'div',
        { style: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, color: C.text, height: '100%', overflowY: 'auto' } },
        h(
          'div',
          { style: { fontSize: 12, color: C.sub } },
          '这里显示的就是工作流往系统提示里注入的内容。改的是源文件，**开新会话**才生效。'
        ),
        error ? h('div', { style: { color: C.danger, fontSize: 12, border: '1px solid ' + C.danger, borderRadius: 8, padding: '8px 10px' } }, error) : null,
        head,
        ruleList,
        addForm,
        h(Section, { title: '骨架（workflow.md 的 L1 区）', hint: comp.skeletonChars + ' 字符', defaultOpen: false },
          h('pre', { style: preStyle }, comp.skeleton || '')),
        h(Section, { title: '改工作流规则的指南（给 AI 看的那份）', hint: 'evolve/EDIT-GUIDE.md', defaultOpen: false },
          h('pre', { style: preStyle }, state.guide || ''))
      )
    }

    function inputStyle(width, flex) {
      return Object.assign(
        { background: C.bg1, color: C.text, border: '1px solid ' + C.line, borderRadius: 7, padding: '5px 8px', fontSize: 12, fontFamily: mono },
        width ? { width: width } : {},
        flex ? { flex: 1, minWidth: 240, width: 'auto' } : {}
      )
    }

    var preStyle = {
      margin: '10px 0 0',
      padding: 10,
      background: C.bg1,
      color: C.text,
      border: '1px solid ' + C.line,
      borderRadius: 7,
      fontSize: 12,
      lineHeight: 1.6,
      fontFamily: mono,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '48vh',
      overflow: 'auto',
    }

    /** 生成交给 AI 的修改指令：带文件、当前行、硬约束与目标占位。 */
    function buildAiPrompt(state, entry) {
      return [
        '请按预设自带的指南改一条工作流规则。',
        '',
        '【指南】' + state.ledgerPath.replace(/\\evolve\\ledger\.md$/, '\\evolve\\EDIT-GUIDE.md'),
        '【要改的文件】' + state.ledgerPath + '（只改这一行，其它行与标记不要动）',
        '',
        '【当前这一行】',
        '- [' + entry.id + ' | ' + entry.scope + ' | ' + entry.when + '] ' + entry.text + '   (added: ' + (entry.added || '') + ', hits: ' + (entry.hits || 0) + ')',
        '',
        '【硬约束】',
        '1. 只增删改单条，禁止整篇重写；LEDGER:BEGIN/END 标记各保留一个',
        '2. 正文 ≤ 60 字符；写不下就先写进 evolve/lessons/' + entry.id + '.md，本行只留 ≤60 字符索引',
        '3. 保留行尾 (added: …, hits: …) 元数据',
        '4. 改完提醒我：开新会话才生效',
        '',
        '【要改成什么】← 在这里补一句你的目标（例如"把结论改成 XXX"或"这条删掉，因为已被骨架覆盖"）',
      ].join('\n')
    }

    // ── 注册 ─────────────────────────────────────────────────────────────────
    function apply(ctx) {
      var slots = ctx.get ? ctx.get('slots') : undefined
      if (slots === undefined) return
      slots.inject('conversation.view', function () {
        return slots.register(
          { name: 'conversation.view', id: ID, order: 26, label: function () { return TAB_LABEL } },
          function (props) {
            return h(Console, props)
          }
        )
      })
    }

    exports.name = ID
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
