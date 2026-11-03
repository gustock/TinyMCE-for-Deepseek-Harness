/**
 * TinyMCE HTML Editor — Host half.
 *
 * Serves the vendored TinyMCE 6 runtime (core, theme, model, icons, skins and
 * the open-source plugins this viewer uses) so the browser never reaches a CDN
 * and the editor works offline and under the desktop shell's `dsh-app://`
 * origin.
 *
 * The route is a plain static file route: no session data, no file access
 * outside the vendored directory. Requests are read-only (GET/HEAD).
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** URL prefix owned by this plugin. The client builds asset URLs from it. */
const ROUTE = '/tinymce-editor/vendor/tinymce'

/** Absolute directory holding the vendored TinyMCE runtime. */
const VENDOR_ROOT = fileURLToPath(new URL('./vendor/tinymce/', import.meta.url)).replace(/[\\/]+$/, '')

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

export const inject = ['webServer']

export function apply(ctx) {
  let clientReadyAt = null
  let editorReadyAt = null
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: handleAsset }),
    'tinymce-html-editor: vendored TinyMCE assets',
  )
  // Small diagnostic: confirms the Host half is live and reports the client
  // module URL the web boot graph published for this package.
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/tinymce-editor/health',
      handler: (req, res) => {
        const modules = ctx.get('clientModules')
        let clientPath = null
        let clientUrl = null
        try {
          clientPath = modules?.clientPath?.('dsh-tinymce-html-editor') ?? null
          const row = modules?.graph?.()?.entries?.find((entry) => entry.id === 'dsh-tinymce-html-editor')
          clientUrl = row?.url ?? null
        } catch {
          // Diagnostics only: a missing module graph leaves both fields null.
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({
          ok: true,
          version: '1.0.0',
          clientPath,
          clientUrl,
          clientReady: clientReadyAt !== null,
          clientReadyAt,
          editorReady: editorReadyAt !== null,
          editorReadyAt,
        }))
      },
    }),
    'tinymce-html-editor: health route',
  )
  // The client half posts here once its viewer is registered, so the health
  // route can distinguish "bundle served" from "viewer actually live".
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/tinymce-editor/client-ready',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        if (url.searchParams.get('editor') === '1') editorReadyAt = Date.now()
        else clientReadyAt = Date.now()
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
      },
    }),
    'tinymce-html-editor: client-ready beacon',
  )
}

async function handleAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }

  const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
  let relative
  try {
    relative = decodeURIComponent(pathname.slice(ROUTE.length))
  } catch {
    res.writeHead(400)
    res.end('bad request')
    return
  }

  // `resolve(root, './x')` keeps the join honest; the separator check rejects
  // `..` segments and any absolute path that escaped the vendor directory.
  const file = resolve(VENDOR_ROOT, '.' + relative)
  if (file !== VENDOR_ROOT && !file.startsWith(VENDOR_ROOT + sep)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }

  const info = await stat(file).catch(() => undefined)
  if (info === undefined || !info.isFile()) {
    res.writeHead(404)
    res.end('not found')
    return
  }

  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
  const headers = {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': 'no-cache',
    etag,
    'x-content-type-options': 'nosniff',
  }

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { 'cache-control': 'no-cache', etag })
    res.end()
    return
  }

  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const stream = createReadStream(file)
  stream.on('error', () => {
    // The headers are already out; destroying the response is the only
    // honest signal left for a read that raced a delete.
    res.destroy()
  })
  stream.pipe(res)
}
