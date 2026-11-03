# DSH Plugin Hub submission

Use this body when opening an issue at
<https://github.com/dshplugin/dsh-plugin-hub/issues/new> (or use the hub's
auto-filled link). The npm install command requires the package to be published
to npm first; the source command works today.

**Title:** `[Plugin submission] gustock/TinyMCE-for-Deepseek-Harness — Edit HTML files visually with TinyMCE in the DeepSeek Harness Better Sidebar`

### Repository
https://github.com/gustock/TinyMCE-for-Deepseek-Harness

### One-line value
Edit HTML files visually with TinyMCE in the DeepSeek Harness Better Sidebar.

### Category
UI & Experience

### Install command
```bash
dsh plugin --profile web add dsh-tinymce-html-editor
```

Source-only fallback:

```bash
dsh plugin --profile web add github:gustock/TinyMCE-for-Deepseek-Harness
```

### Compatibility
DSH `>= 0.2.1-rc.2`; Better Sidebar `>= 0.28.0`; web/desktop on macOS, Windows and
Linux; Host Node.js `>= 20`.

### License
MIT

### Screenshots / demo
https://raw.githubusercontent.com/gustock/TinyMCE-for-Deepseek-Harness/main/docs/tinymce-editor.png

Safe demo page: [`sample.html`](../sample.html)

### Notes
- Reads and writes local `.html`/`.htm` workspace files through the Better
  Sidebar; saves are mtime-guarded and refused on disk conflicts.
- No network, telemetry, external services, or credentials; TinyMCE 6.8.6 is
  vendored (MIT).
- Known limitations: body-only editing; relative images may not render in the
  editor canvas; TinyMCE normalizes edited markup.
- Requires `dsh-better-sidebar` for the viewer in this version.

### Pre-submission checklist
- [x] Repository is public
- [x] GitHub topic `dsh-plugin` added
- [x] README includes the install command
- [x] Plugin exports an `apply(ctx)` module
- [x] Repository root includes a `package.json`
