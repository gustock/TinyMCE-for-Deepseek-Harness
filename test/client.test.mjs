import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = join(here, '..')

/** Minimal DOM + React so the bundle factory can be evaluated outside a browser. */
function installGlobals() {
  const element = () => ({ id: '', textContent: '', dataset: {}, remove() {}, appendChild() {} })
  globalThis.document = {
    baseURI: 'http://127.0.0.1:51777/',
    getElementById: () => null,
    createElement: element,
    head: { appendChild() {} },
    body: { appendChild() {} },
  }
  globalThis.window = {
    __ModuleLoader__: { load: (definition) => { globalThis.__definition = definition } },
    matchMedia: () => ({ matches: false }),
  }
}

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
}

const requireStub = (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
}

async function loadPlugin() {
  installGlobals()
  const url = pathToFileURL(join(packageDir, 'client.js')).href + `?t=${Date.now()}`
  // Execute the bundle exactly as the browser does: it registers a factory.
  await import(url)
  assert.ok(globalThis.__definition, 'client.js must register a module factory')
  assert.equal(globalThis.__definition.id, 'dsh-tinymce-html-editor')
  return globalThis.__definition.factory(requireStub)
}

test('client bundle registers a factory and loads', async () => {
  const plugin = await loadPlugin()
  assert.deepEqual(plugin.inject, ['betterSidebar'])
  assert.equal(typeof plugin.apply, 'function')
})

test('splitDocument keeps head and doctype outside the edited body', async () => {
  const { splitDocument, joinDocument } = (await loadPlugin()).__test
  const source = '<!doctype html>\n<html><head><title>T</title></head><body class="x">\n<p>Hi</p>\n</body></html>'
  const parts = splitDocument(source)
  assert.equal(parts.prefix, '<!doctype html>\n<html><head><title>T</title></head><body class="x">')
  assert.equal(parts.body, '\n<p>Hi</p>\n')
  assert.equal(parts.suffix, '</body></html>')
  assert.equal(
    joinDocument(parts, '<p>Edited</p>'),
    '<!doctype html>\n<html><head><title>T</title></head><body class="x"><p>Edited</p></body></html>',
  )
})

test('splitDocument handles uppercase tags, fragments and a missing close', async () => {
  const { splitDocument } = (await loadPlugin()).__test
  assert.deepEqual(splitDocument('<HTML><BODY><p>x</p></BODY></HTML>'), {
    prefix: '<HTML><BODY>', body: '<p>x</p>', suffix: '</BODY></HTML>',
  })
  assert.deepEqual(splitDocument('<p>fragment</p>'), {
    prefix: '', body: '<p>fragment</p>', suffix: '',
  })
  assert.deepEqual(splitDocument('<body><p>open</p>'), {
    prefix: '<body>', body: '<p>open</p>', suffix: '',
  })
})

test('extractHeadStyles replays inline style blocks only', async () => {
  const { extractHeadStyles } = (await loadPlugin()).__test
  const prefix = '<head><style>body{color:red}</style><link rel="stylesheet" href="a.css"><style media="print">p{}</style></head><body>'
  assert.equal(extractHeadStyles(prefix), 'body{color:red}\np{}')
  assert.equal(extractHeadStyles('<body>'), '')
})

test('apply registers an html/htm viewer ahead of the built-ins', async () => {
  const plugin = await loadPlugin()
  let viewer = null
  const ctx = {
    get(name) {
      if (name === 'betterSidebar') {
        return { registerFileViewer: (descriptor) => { viewer = descriptor; return () => {} } }
      }
      if (name === 'locale') {
        return { register: () => () => {}, bind: () => (key) => key }
      }
      return undefined
    },
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
  }
  plugin.apply(ctx)
  assert.ok(viewer, 'a file viewer must be registered')
  assert.equal(viewer.id, 'tinymce-html-editor')
  assert.deepEqual([...viewer.exts], ['html', 'htm'])
  assert.equal(viewer.fetchStrategy, 'fsRead')
  assert.ok(viewer.priority > 0, 'the viewer must outrank the built-in html viewer')
  assert.equal(typeof viewer.component, 'function')
})
