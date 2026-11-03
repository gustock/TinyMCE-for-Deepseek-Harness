/**
 * TinyMCE HTML Editor — Client half.
 *
 * Registers a Better Sidebar file viewer for `.html` / `.htm` files. The
 * viewer edits the document BODY with TinyMCE and splices the result back
 * between the original `<body>` tags, so the doctype, `<head>`, scripts and
 * comments outside the body survive unchanged (TinyMCE 6 removed the
 * `fullpage` plugin).
 *
 * Saving goes through the sidebar's own `/sidebar/write` route, which keeps
 * the existing workspace fence and mtime conflict detection.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tinymce-html-editor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const VIEWER_ID = 'tinymce-html-editor'
    const LOCALE_NS = 'tinymceHtmlEditor'
    /** Document-relative base of the vendored runtime (see index.js). */
    const ASSET_BASE = 'tinymce-editor/vendor/tinymce/'

    const EN = {
      viewerTitle: 'TinyMCE HTML',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Save failed',
      unsaved: 'Unsaved changes',
      conflict: 'The file changed on disk. Reload it before saving again.',
      reload: 'Reload',
      dismiss: 'Dismiss',
      loading: 'Loading editor…',
      tooLarge: 'This file is too large for the visual editor.',
      loadFailed: 'The TinyMCE editor could not be loaded.',
    }
    const ZH = {
      viewerTitle: 'TinyMCE HTML',
      save: '保存',
      saving: '正在保存…',
      saved: '已保存',
      saveFailed: '保存失败',
      unsaved: '有未保存的修改',
      conflict: '文件已在磁盘上被修改。请重新加载后再保存。',
      reload: '重新加载',
      dismiss: '忽略',
      loading: '正在加载编辑器…',
      tooLarge: '文件过大，无法使用可视化编辑器。',
      loadFailed: '无法加载 TinyMCE 编辑器。',
    }

    // ── Document splicing ──────────────────────────────────────────────────

    /**
     * Split a document into the text before `<body>`, the body content, and
     * the text from `</body>` on. A fragment with no body tag is edited whole.
     */
    function splitDocument(source) {
      const text = typeof source === 'string' ? source : ''
      const open = /<body(\s[^>]*)?>/i.exec(text)
      if (open === null) return { prefix: '', body: text, suffix: '' }
      const bodyStart = open.index + open[0].length
      const close = text.toLowerCase().lastIndexOf('</body>')
      if (close < bodyStart) {
        return { prefix: text.slice(0, bodyStart), body: text.slice(bodyStart), suffix: '' }
      }
      return {
        prefix: text.slice(0, bodyStart),
        body: text.slice(bodyStart, close),
        suffix: text.slice(close),
      }
    }

    function joinDocument(parts, body) {
      return parts.prefix + body + parts.suffix
    }

    /** Inline `<style>` blocks from the head, replayed inside the editor. */
    function extractHeadStyles(prefix) {
      const styles = []
      const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
      let match
      while ((match = re.exec(prefix)) !== null) styles.push(match[1])
      return styles.join('\n')
    }

    // ── Browser helpers ────────────────────────────────────────────────────

    function hostUrl(path) {
      // Resolve under the page's own DIRECTORY: a SPA served at `/app` without
      // the trailing slash would otherwise turn `sidebar/write` into `/sidebar/write`,
      // and a query token on the page URL must not leak into route URLs.
      const raw = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : 'http://dsh.internal/'
      const base = new URL(raw, 'http://dsh.internal/')
      base.search = ''
      base.hash = ''
      if (!base.pathname.endsWith('/')) base.pathname += '/'
      return new URL(path.replace(/^\/+/, ''), base)
    }

    function assetBase() {
      return hostUrl(ASSET_BASE).href
    }

    function basename(path) {
      const text = typeof path === 'string' ? path : ''
      const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
      return index === -1 ? text : text.slice(index + 1)
    }

    function isDarkTheme(ctx) {
      try {
        const scheme = ctx?.theme?.getTheme?.()?.active?.colorScheme
        if (scheme === 'dark' || scheme === 'light') return scheme === 'dark'
      } catch {
        // Fall through to the OS preference.
      }
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches
      } catch {
        return false
      }
    }

    let tinyPromise = null

    /** Load the vendored TinyMCE runtime once per page. */
    function loadTinyMCE() {
      if (typeof globalThis.tinymce?.init === 'function') return Promise.resolve(globalThis.tinymce)
      if (tinyPromise !== null) return tinyPromise
      tinyPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = hostUrl(ASSET_BASE + 'tinymce.min.js').href
        script.async = true
        script.dataset.dshTinymce = '1'
        script.onload = () => {
          if (typeof globalThis.tinymce?.init === 'function') resolve(globalThis.tinymce)
          else reject(new Error('TinyMCE loaded without exposing a global'))
        }
        script.onerror = () => reject(new Error('Failed to load ' + script.src))
        document.head.appendChild(script)
      }).catch((error) => {
        tinyPromise = null
        throw error
      })
      return tinyPromise
    }

    /** POST the document through the sidebar's write route (mtime-guarded). */
    async function writeDocument(scope, path, text, expectedMtimeMs) {
      const url = hostUrl('sidebar/write')
      url.searchParams.set('sessionId', scope.sessionId)
      if (scope.cwd !== undefined && scope.cwd !== '') url.searchParams.set('cwd', scope.cwd)
      url.searchParams.set('path', path)
      if (expectedMtimeMs !== undefined && expectedMtimeMs !== null) {
        url.searchParams.set('expectedMtimeMs', String(expectedMtimeMs))
      }
      const response = await fetch(url.href, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: text,
      })
      const parsed = await response.json().catch(() => null)
      if (!response.ok || parsed === null || parsed.ok !== true) {
        const error = new Error(parsed?.error?.message ?? `HTTP ${response.status}`)
        error.code = parsed?.error?.code ?? 'http'
        throw error
      }
      return parsed.value ?? {}
    }

    // ── Styles ─────────────────────────────────────────────────────────────

    const CSS = `
.tme-root { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden;
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary);
  font-family:var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif); }
.tme-bar { flex:none; display:flex; align-items:center; gap:7px; height:32px; padding:0 8px 0 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
.tme-mark { display:grid; place-items:center; flex:none; color:var(--dsw-alias-label-secondary); }
.tme-name { font-weight:600; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tme-dot { width:6px; height:6px; border-radius:50%; flex:none; background:var(--dsw-alias-state-warn-primary); }
.tme-spacer { flex:1 1 auto; min-width:6px; }
.tme-state { font-size:11px; white-space:nowrap; color:var(--dsw-alias-label-secondary); }
.tme-state[data-state="error"] { color:var(--dsw-alias-state-error-primary); }
.tme-save { flex:none; height:24px; padding:0 10px; border-radius:6px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary); font:inherit; font-size:11.5px; }
.tme-save:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2); }
.tme-save:disabled { opacity:.45; cursor:default; }
.tme-banner { flex:none; display:flex; align-items:center; gap:8px; padding:6px 10px; font-size:11.5px;
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary); }
.tme-banner[data-kind="error"] { background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base)); }
.tme-banner > span { flex:1 1 auto; min-width:0; }
.tme-banner button { flex:none; height:22px; padding:0 8px; border-radius:5px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary); font:inherit; font-size:11px; }
.tme-body { position:relative; flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.tme-canvas { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.tme-canvas .tox-tinymce { flex:1 1 auto; height:100% !important; border:0 !important; border-radius:0 !important; }
.tme-loading { position:absolute; inset:0; display:grid; place-items:center; pointer-events:none;
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-secondary); font-size:12px; }
.tme-note { padding:22px 16px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:1.6; }
`

    function installStyles() {
      const id = 'dsh-tinymce-html-editor-styles'
      const previous = document.getElementById(id)
      if (previous !== null) previous.remove()
      const style = document.createElement('style')
      style.id = id
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // ── Icons ──────────────────────────────────────────────────────────────

    function MarkIcon({ size = 14 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
      h('rect', { x: 2, y: 1.5, width: 12, height: 13, rx: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', { d: 'M5 5.2h6M5 8h4.2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    // ── Viewer component ───────────────────────────────────────────────────

    function createViewer(t, ctx) {
      return function TinyMceViewer(props) {
        const { path, title, content, mtimeMs, largeFile, scope } = props

        const containerRef = React.useRef(null)
        const editorRef = React.useRef(null)
        const partsRef = React.useRef({ prefix: '', body: '', suffix: '' })
        const mtimeRef = React.useRef(typeof mtimeMs === 'number' ? mtimeMs : null)
        const dirtyRef = React.useRef(false)
        const savingRef = React.useRef(false)
        const saveRef = React.useRef(null)

        const [ready, setReady] = React.useState(false)
        const [dirty, setDirty] = React.useState(false)
        const [saveState, setSaveState] = React.useState('idle')
        const [message, setMessage] = React.useState(null)
        const [conflict, setConflict] = React.useState(false)

        React.useEffect(() => {
          mtimeRef.current = typeof mtimeMs === 'number' ? mtimeMs : null
        }, [mtimeMs])

        const save = async () => {
          const editor = editorRef.current
          if (editor === null || savingRef.current) return
          savingRef.current = true
          setSaveState('saving')
          setMessage(null)
          try {
            const body = editor.getContent()
            const documentText = joinDocument(partsRef.current, body)
            const result = await writeDocument(scope, path, documentText, mtimeRef.current)
            if (result !== null && typeof result.mtimeMs === 'number') mtimeRef.current = result.mtimeMs
            dirtyRef.current = false
            setDirty(false)
            setConflict(false)
            setSaveState('saved')
            window.setTimeout(() => {
              setSaveState((current) => (current === 'saved' ? 'idle' : current))
            }, 1600)
          } catch (error) {
            setSaveState('error')
            if (error?.code === 'fs-conflict') {
              setConflict(true)
              setMessage(t('conflict'))
            } else {
              setMessage(error?.message ?? String(error))
            }
          } finally {
            savingRef.current = false
          }
        }
        saveRef.current = save

        React.useEffect(() => {
          if (largeFile !== undefined || typeof content !== 'string') return undefined
          const container = containerRef.current
          if (container === null) return undefined

          let disposed = false
          let initialized = false
          let editor = null

          setReady(false)
          setDirty(false)
          setSaveState('idle')
          setMessage(null)
          setConflict(false)
          dirtyRef.current = false

          const parts = splitDocument(content)
          partsRef.current = parts
          const headStyles = extractHeadStyles(parts.prefix)

          const host = document.createElement('div')
          container.replaceChildren(host)

          const markDirty = () => {
            if (disposed || !initialized || dirtyRef.current) return
            dirtyRef.current = true
            setDirty(true)
          }

          loadTinyMCE().then((tinymce) => {
            if (disposed) return
            tinymce.init({
              target: host,
              base_url: assetBase(),
              suffix: '.min',
              skin: isDarkTheme(ctx) ? 'oxide-dark' : 'oxide',
              content_css: 'default',
              content_style: [
                'html, body { min-height: 100%; }',
                'body { margin: 16px; font-size: 15px; line-height: 1.55; }',
                headStyles,
              ].filter(Boolean).join('\n'),
              menubar: false,
              branding: false,
              promotion: false,
              statusbar: true,
              elementpath: false,
              resize: false,
              height: '100%',
              min_height: 240,
              plugins: 'autolink lists link image table media code preview searchreplace wordcount visualblocks fullscreen charmap anchor insertdatetime pagebreak',
              toolbar: 'undo redo | blocks | bold italic underline strikethrough | forecolor backcolor | bullist numlist | alignleft aligncenter alignright | link image table media | removeformat | code preview fullscreen',
              toolbar_mode: 'sliding',
              contextmenu: 'link image table',
              image_uploadtab: false,
              browser_spellcheck: true,
              convert_urls: false,
              relative_urls: true,
              remove_script_host: false,
              entity_encoding: 'raw',
              verify_html: false,
              // Body scripts/styles stay byte-identical through a round trip.
              protect: [
                /<script\b[^>]*>[\s\S]*?<\/script>/gi,
                /<style\b[^>]*>[\s\S]*?<\/style>/gi,
              ],
              setup(instance) {
                editor = instance
                editorRef.current = instance
                instance.on('init', () => {
                  if (disposed) return
                  instance.setContent(parts.body, { format: 'html' })
                  instance.undoManager.clear()
                  instance.setDirty(false)
                  initialized = true
                  setReady(true)
                  try {
                    fetch(hostUrl('tinymce-editor/client-ready?editor=1'), { method: 'POST', keepalive: true }).catch(() => {})
                  } catch {
                    // Diagnostics only.
                  }
                })
                instance.on('dirty', markDirty)
                instance.on('input undo redo change', markDirty)
                // The code dialog and other programmatic edits go through
                // setContent; 'change' alone does not always fire for those.
                instance.on('SetContent', markDirty)
                instance.on('keydown', (event) => {
                  if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
                    event.preventDefault()
                    saveRef.current?.()
                  }
                })
              },
            }).then((editors) => {
              if (!disposed) return
              for (const instance of editors) {
                try {
                  instance.remove()
                } catch {
                  // Already gone.
                }
              }
            }).catch((error) => {
              if (disposed) return
              setMessage(error?.message ?? String(error))
              setSaveState('idle')
            })
          }).catch((error) => {
            if (disposed) return
            setMessage(`${t('loadFailed')} ${error?.message ?? ''}`.trim())
            setSaveState('idle')
          })

          return () => {
            disposed = true
            editorRef.current = null
            if (editor !== null) {
              try {
                editor.remove()
              } catch {
                // Already gone.
              }
            }
            host.remove()
          }
        }, [path, content, largeFile])

        const stateLabel = saveState === 'saving'
          ? t('saving')
          : saveState === 'saved'
            ? t('saved')
            : saveState === 'error'
              ? t('saveFailed')
              : ''

        const header = h('div', { className: 'tme-bar' },
          h('span', { className: 'tme-mark' }, h(MarkIcon, { size: 14 })),
          h('span', { className: 'tme-name', title: path }, title || basename(path)),
          dirty ? h('span', { className: 'tme-dot', title: t('unsaved') }) : null,
          h('span', { className: 'tme-spacer' }),
          stateLabel !== '' ? h('span', { className: 'tme-state', 'data-state': saveState }, stateLabel) : null,
          h('button', {
            type: 'button',
            className: 'tme-save',
            onClick: save,
            disabled: !dirty || saveState === 'saving',
          }, t('save')),
        )

        const banner = message === null ? null : h('div', { className: 'tme-banner', 'data-kind': 'error' },
          h('span', null, message),
          conflict
            ? h('button', { type: 'button', onClick: () => { setConflict(false); props.onReload?.() } }, t('reload'))
            : h('button', { type: 'button', onClick: () => { setMessage(null); setSaveState('idle') } }, t('dismiss')),
        )

        if (largeFile !== undefined) {
          return h('div', { className: 'tme-root' }, header,
            h('div', { className: 'tme-note' }, `${t('tooLarge')} (${Math.round((largeFile.size ?? 0) / 1024)} KB)`))
        }

        if (typeof content !== 'string') {
          return h('div', { className: 'tme-root' }, header,
            h('div', { className: 'tme-note' }, t('loadFailed')))
        }

        return h('div', { className: 'tme-root' }, header, banner,
          h('div', { className: 'tme-body' },
            h('div', { className: 'tme-canvas', ref: containerRef }),
            ready ? null : h('div', { className: 'tme-loading' }, t('loading'))))
      }
    }

    // ── Plugin ─────────────────────────────────────────────────────────────

    function apply(ctx) {
      const service = ctx.get('betterSidebar')
      if (service === undefined) return

      const locale = ctx.get('locale')
      let t = (key) => EN[key] ?? key
      if (locale !== undefined) {
        try {
          ctx.effect(
            () => locale.register(LOCALE_NS, { en: EN, zh: ZH }),
            'tinymce-html-editor: locale dictionary',
          )
          t = locale.bind(LOCALE_NS)
        } catch {
          // A locale service that refuses this namespace must not take the
          // editor down with it; English labels are a fine fallback.
        }
      }

      ctx.effect(() => installStyles(), 'tinymce-html-editor: styles')

      const Viewer = createViewer(t, ctx)
      ctx.effect(
        () => service.registerFileViewer({
          id: VIEWER_ID,
          title: () => t('viewerTitle'),
          icon: (size) => h(MarkIcon, { size }),
          exts: ['html', 'htm'],
          priority: 20,
          fetchStrategy: 'fsRead',
          component: Viewer,
        }),
        'tinymce-html-editor: file viewer',
      )

      // Fire-and-forget beacon: the Host health route reports whether the
      // viewer is actually live in a connected page.
      try {
        fetch(hostUrl('tinymce-editor/client-ready'), { method: 'POST', keepalive: true }).catch(() => {})
      } catch {
        // A page without fetch still gets the editor; only the beacon is lost.
      }
    }

    return {
      inject: ['betterSidebar'],
      apply,
      // Exposed for the package's own unit tests; the module loader ignores it.
      __test: { splitDocument, joinDocument, extractHeadStyles },
    }
  },
})
