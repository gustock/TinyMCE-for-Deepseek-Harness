# TinyMCE HTML Editor for DeepSeek Harness

**Edit `.html` and `.htm` files visually with [TinyMCE](https://www.tiny.cloud/) inside the DeepSeek Harness Better Sidebar.**

Open an HTML file from the file tree (or from an agent file link) and it opens in a
WYSIWYG editor instead of the plain code editor. Edits save back to disk with
conflict detection, while the document's doctype, `<head>`, scripts and comments
are preserved byte-for-byte.

![TinyMCE editing surface](https://raw.githubusercontent.com/gustock/TinyMCE-for-Deepseek-Harness/main/docs/tinymce-editor.png)

- **Category:** UI & Experience
- **License:** MIT
- **DSH:** `>= 0.2.1-rc.2`
- **Requires:** [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) `>= 0.28.0`

## What you get

- TinyMCE 6 WYSIWYG editing of the document body, with a toolbar tuned for the
  narrow sidebar: history, blocks/headings, inline formatting, colors, lists,
  alignment, links, images, tables, media, and a source-code dialog.
- **Preview** (rendered page) and **Fullscreen** buttons from the OSS plugins.
- **Save** button and `Ctrl`/`Cmd`+`S`, with dirty indicator and save states.
- Disk-conflict detection: if the file changed on disk after it was opened, the
  save is refused and a **Reload** action is offered instead of clobbering it.
- Head `<style>` blocks are replayed in the editing surface so the WYSIWYG view
  resembles the real page.
- English and Chinese UI strings; the viewer can be disabled from the sidebar's
  Side card settings page like any other file viewer.

## Install

### From npm

```bash
dsh plugin --profile web add dsh-tinymce-html-editor
```

### From source (available now)

```bash
dsh plugin --profile web add github:gustock/TinyMCE-for-Deepseek-Harness
```

### From the DSH UI or a local checkout

Use **Settings → Plugins → Install bundle**, or:

```js
// plugin_manager
{ action: 'install_bundle', target: 'dsh-tinymce-html-editor@1.0.0' }
```

Either way the bundle inserts one Loader row, `tinymce-html-editor`. The Better
Sidebar bundle must already be installed and enabled for the viewer to appear.

After installing into an already-open GUI, refresh the page once if the viewer
does not appear immediately: a freshly added client module is picked up by the
live plugin graph, but a page that booted before the install may still be
running its old module set.

To remove it: `plugin_manager` `remove_bundle` with `dsh-tinymce-html-editor`, or
the Plugins page.

## Compatibility

| Item | Requirement |
|---|---|
| DeepSeek Harness | `>= 0.2.1-rc.2` |
| Better Sidebar | `>= 0.28.0` (the viewer registers through its `ctx.betterSidebar` service) |
| Host Node.js | `>= 20` |
| Platforms | macOS, Windows, Linux through the DSH web/desktop UI |
| TinyMCE | 6.8.6, vendored (MIT) |

Verified on DSH `0.2.1-rc.2` (desktop, macOS) with Better Sidebar `0.28.0`; the
package's unit tests and a headless-browser editor/save test pass.

## Permissions and safety

- Reads and writes **local workspace** `.html`/`.htm` files through the Better
  Sidebar editor. Saves carry the file's mtime and are refused if it changed on
  disk.
- **No network access at runtime.** TinyMCE and its skins/plugins are vendored in
  this package and served by the plugin's own Host route; there is no CDN, no
  API key, no telemetry, and no external service.
- Serves only the vendored asset directory (`GET`/`HEAD`, traversal-guarded).
- No credentials, environment variables, or other file types are accessed.

## Screenshot / demo

The image above is the plugin's TinyMCE editing surface. A safe demo page ships in
[`sample.html`](sample.html); open it in the Better Sidebar and try editing,
saving, and reopening it.

## How it works

| Half | File | Responsibility |
|---|---|---|
| Host | `index.js` | Serves `vendor/tinymce/**` at `/tinymce-editor/vendor/tinymce` (GET/HEAD, MIME, traversal guard, ETag/304). |
| Client | `client.js` | Registers the `.html`/`.htm` viewer (priority 20, `fsRead`), mounts TinyMCE, splices the edited body back into the original document, saves through `/sidebar/write`. |

### Body-only editing

TinyMCE 6 removed the `fullpage` plugin, so the viewer never feeds the whole
document to the editor. It splits the file at the `<body>` / `</body>` tags:

```
prefix (doctype + <html> + <head> + <body …>)   ← untouched
body                                             ← edited by TinyMCE
suffix (</body> + </html>)                       ← untouched
```

On save the editor's body HTML is placed back between prefix and suffix, so
doctypes, meta tags, head scripts/styles and comments survive exactly. Body
`<script>`/`<style>` blocks are additionally passed through TinyMCE's `protect`
option so they round-trip unchanged.

Files without a `<body>` tag (fragments/partials) are edited as a whole.

### Saving

Saving uses the sidebar's own `POST /sidebar/write` route with the `mtime` the
file was loaded with. That keeps the workspace fence and the conflict check in
one place. A `fs-conflict` response becomes the reload banner.

## Limitations

- **Body only.** Content outside `<body>` is preserved but not editable; use the
  code editor for head changes.
- **Relative assets.** Relative image/link URLs are kept verbatim on save, but
  the editor canvas resolves them against the Harness page, so relative images
  may show as broken while editing. Absolute URLs and data URLs render normally.
- **TinyMCE normalizes markup** you touch (attribute quoting, self-closing tags,
  whitespace). Untouched documents round-trip unchanged; edited regions follow
  TinyMCE's serializer.
- **Better Sidebar is required in this version.** Without it the plugin installs
  but registers no viewer. A native document-preview renderer is planned as a
  dependency-free fallback.
- TinyMCE's own UI is English (the plugin's own labels are localized).

## Development

```bash
node --test test/client.test.mjs
```

The tests evaluate the real client bundle with a minimal React/DOM stub and cover
the body splice, head-style extraction and viewer registration.

### Health check

`GET http://127.0.0.1:<port>/tinymce-editor/health` reports:

```json
{ "ok": true, "version": "1.0.0", "clientUrl": "plugins/??dsh-tinymce-html-editor/client.js&rev=…",
  "clientReady": true, "clientReadyAt": 1730000000000 }
```

`clientReady` flips to `true` when a connected page has loaded the client half
and registered the viewer.

### Layout

```
.
├── package.json          # dsh.bundle patch + dsh.client web module
├── cordis.patch.yml      # inserts the tinymce-html-editor row
├── index.js              # Host: static TinyMCE asset route
├── client.js             # Client: file viewer + editor component
├── locale/{en,zh}.json   # Plugin Manager title/description
├── icon.svg
├── docs/                 # README screenshot and submission notes
├── sample.html           # safe demo page
├── test/client.test.mjs  # document splice + registration tests
└── vendor/tinymce/       # TinyMCE 6.8.6 subset (MIT, see license.txt)
```

## License

MIT. See [LICENSE](LICENSE).

## Third-party notices

TinyMCE 6.8.6 is © Tiny Technologies, Inc. and is redistributed under the MIT
license; the full text and third-party notices are in
`vendor/tinymce/license.txt` and `vendor/tinymce/notices.txt`.
