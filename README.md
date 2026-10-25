# 0xMD

**A Markdown editor where the rendered document _is_ the editor. No licence key, no activation, no telemetry.**

---

0xMD reads and writes `.md` files the way a writing tool should: you type
markdown syntax and watch it become a heading, a table, a formula or a
diagram **in place**. There is no preview pane — the document you are editing
*is* the rendered document.

| | |
|---|---|
| **Live editing** | Markdown markers are hidden until you click into the block. |
| **Document vocabulary** | Front matter, maths, Mermaid, callouts, footnotes, task lists, tables, alerts, raw HTML. |
| **Real code editor** | Fenced blocks open in CodeMirror 6 with syntax highlighting. |
| **Live maths** | `$x$` inline and `$$x$$` block, rendered with KaTeX, click to edit the source. |
| **Diagrams** | Mermaid, loaded lazily — only when a document actually contains one. |
| **Outline & file tree** | Sidebar with headings, a folder tree, a folder-wide search and a file preview on hover. |
| **EPUB packages** | `.opf` files open as a readable index: metadata, manifest, reading order. |
| **EPUB books** | `.epub` files open as the index of the book — and its chapters, read as Markdown. |
| **Find & replace, quick open** | `Ctrl+F` and `Ctrl+P`. |
| **Themes** | GitHub, Newsprint, Night, Pixyll. |
| **Export** | Standalone HTML (syntax highlighted) and PDF. |
| **MCP server** | Lets an AI agent read and edit the open document — and it can be switched off. |

## Screenshots

| | |
|---|---|
| ![The editor](demo/0xmd-full.png) | The whole surface: maths, a diagram, code, tables, callouts, footnotes. |
| ![EPUB package](demo/0xmd-opf.png) | An `.opf` package opened as a readable index. |
| ![EPUB book](demo/0xmd-epub.png) | An `.epub` book: its metadata, its files and its reading order. |
| ![EPUB chapter](demo/0xmd-epub-chapter.png) | A chapter of the book, read as Markdown in the editor. |
| ![About](demo/0xmd-about.png) | The about dialog. |
| ![Preferences](demo/0xmd-preferences.png) | Preferences, including the MCP section. |
| ![Night theme](demo/theme-night.png) | The Night theme. |

## Licence

* Every dependency is MIT / BSD / Apache licensed.
* **0xMD itself is MIT licensed** and will never require a licence key.
* Nothing is phoned home. The MCP server binds to `127.0.0.1` only.

## Keeping it light

The editor should feel instant, so the heavy parts are only there when
something asks for them:

| Loaded at start | Loaded when needed |
|---|---|
| the editor, the parser, the theme | the twelve CodeMirror language modes |
| | KaTeX, when a document has maths |
| | highlight.js, when a document is exported |
| | Mermaid and its diagram set, when a document has a diagram |
| | electron-updater, when an update is looked for |

That keeps the start-up at roughly **800 kB** of JavaScript instead of
1.9 MB, and the typing smooth: the hidden syntax follows the cursor
instead of walking the whole document, the word count runs on a timer, and
the scroll spy measures the headings once per frame.

---

## Building a release

The repository publishes itself. Tag a version and the CI does the rest:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The [release workflow](.github/workflows/release.yml) then:

1. builds the renderer and packages the app on **Windows** (portable exe +
   NSIS installer) and on **macOS** (`.dmg` + `.zip`, Intel and Apple
   Silicon);
2. uploads everything as workflow artefacts;
3. creates a GitHub release for the tag, marked as **Latest**, with the
   `latest.yml` update manifests attached.

Those manifests are what the app's own update check reads, so a tagged
release also reaches anyone running an older build — 0xMD checks for a
newer version a few seconds after it starts, and installs it on the next
quit. There is also **Help → Check for Updates…** for a manual check.

You can trigger the same build without publishing by hand:

```bash
gh workflow run release.yml --ref main -f publish=false
```

> A `.dmg` has to be assembled with Apple's own tooling, so the macOS
> build always runs on a `macos-latest` runner — it cannot be produced
> from Windows or Linux.

## EPUB package documents

An `.opf` file is the index of an EPUB: the metadata of the book, the files
it contains (the *manifest*) and the order they are read in (the *spine*).

0xMD opens one as a **read-only** surface of its own — the metadata as a
table, the manifest as a table, the reading order as a list. Clicking a file
shows it in the file manager of the system, next to the package.

* the **View XML** button shows the raw source of the package;
* **Save as Markdown…** writes a summary of what was found;
* **File → Export as HTML/PDF** exports the same summary;
* the outline in the sidebar lists the sections of the package, and clicking
  one jumps to it.

The package itself is never written to — it stays exactly as it is on disk.
Both EPUB 2 and EPUB 3 are understood.

> An `.opf` file is usually inside an unpacked EPUB. 0xMD reads the package
> only; the chapters it points at are XHTML and stay untouched.

> `demo/package.opf` is a small package to try it with — open it and the
> viewer shows everything it found.

## EPUB books

An `.epub` file is a ZIP archive: the package, the chapters and the images.
0xMD opens one in two steps:

1. **the index of the book** — the same surface as a `.opf` file, with the
   reading order of the book in it;
2. **the chapters** — click one and it is read as Markdown, in the editor
   itself: the headings, paragraphs, lists, quotes, tables, code and links
   of the chapter become a normal document.

A bar above the chapter says where it came from, and its **←** button takes
you back to the index of the book.

The book is never written to. A chapter can be edited, and **Ctrl+S** then
saves it as a Markdown file of its own — the archive stays untouched.

> The stylesheet of the book is left behind: the theme of 0xMD owns the
> page, so every book looks the same. Images are kept as references —
> they live inside the archive, so they are shown by name.

> `demo/book.epub` is a small book to try it with — open it and read a
> chapter.

## Opening .md files from Explorer

Right-click a Markdown file → **Open with** → 0xMD.

0xMD registers itself for `.md`, `.markdown`, `.mdown`, `.mkd` and `.mdx`:

* the **installer** (`0xMD-*-setup.exe`) does it automatically;
* the **portable** build can do it from the app: **File → Register as Markdown
  Handler**, or *Preferences → File associations*.

The registration lives under `HKEY_CURRENT_USER\Software\Classes`, so it
belongs to your user account only — no administrator rights, and nothing
outside your profile is touched. The same section in the preferences has a
button to remove it again.

> Windows protects the *default* handler for a file type, so 0xMD shows up
> in the "Open with" list but does not silently take over every `.md` file
> on the machine. Picking it once in "Open with" and choosing **Always use
> this app** makes it the default.

## Installing

| Platform | File | Notes |
|---|---|---|
| Windows | `0xMD-*-portable.exe` | A single file — run it, no installation. |
| Windows | `0xMD-*-setup.exe` | A regular installer with a shortcut. |
| macOS | `0xMD-*.dmg` | Drag **0xMD** into your Applications folder. |
| macOS | `0xMD-*.zip` | The bare `.app` bundle. |

The macOS build is **not signed**, so Gatekeeper quarantines it on first
launch. Either right-click the app and choose **Open**, or clear the
quarantine flag once:

```bash
xattr -cr /Applications/0xMD.app
```

> The macOS artefacts are produced by the
> [release workflow](.github/workflows/release.yml), which runs the macOS
> build on a `macos-latest` runner — a `.dmg` has to be assembled with
> Apple's own tooling, so it cannot be produced from Windows or Linux.

## Running it

```bash
npm install
npm run dev      # Vite dev server + Electron
npm start        # production build, then Electron
npm run smoke    # headless self-test against the real DOM
```

Packaging a portable Windows executable:

```bash
npm run dist     # → release/0xMD-1.0.0-portable.exe
```

### Opening files from the command line

```bash
0xMD.exe notes.md                 # open a document
0xMD.exe book.opf                 # open an EPUB package document
0xMD.exe book.epub                # open an EPUB book
0xMD.exe ./notes                  # open a folder in the sidebar
0xMD.exe ./notes notes/todo.md    # both
```

## The demo document

`demo/Welcome.md` exercises every feature at once — headings, every inline
mark, maths, a Mermaid diagram, a syntax-highlighted code block, a table,
task lists, callouts and footnotes. Open it to see the whole surface.

`demo/package.opf` is a small EPUB package — the metadata, three chapters
and a cover — for trying the package viewer.

`demo/book.epub` is the same book as a real EPUB, for trying the reader. It
is built from the files in `demo/` by `node tools/make-demo-epub.js`.

Screenshots in `demo/` were captured with the helper scripts in `tools/`
(`capture.ps1`, `interact.ps1`), which drive the real window and grab the
screen — handy for regenerating them after UI changes.

## The MCP server

0xMD runs a [Model Context Protocol](https://modelcontextprotocol.io) server
inside the main process:

```
POST http://127.0.0.1:7331/mcp     → JSON-RPC
GET  http://127.0.0.1:7331/mcp     → server→client stream
```

Point any MCP client at it:

```json
{
  "mcpServers": {
    "0xmd": {
      "url": "http://127.0.0.1:7331/mcp"
    }
  }
}
```

The **Preferences** dialog has an *MCP* section where the server can be
switched on or off, moved to another port, and its client configuration
copied to the clipboard. The status bar always shows the current state.

### Tools

| Tool | What it does |
|---|---|
| `open_document` | Open a `.md` file in the editor, an `.opf` package or an `.epub` book |
| `read_document` | Read the markdown source of the open document |
| `read_file` | Read any markdown file from disk without opening it — an `.opf` comes back as its structure, an `.epub` as its table of contents |
| `read_epub_chapter` | Read one chapter of an `.epub` book, as Markdown |
| `get_outline` | Heading tree of the open document |
| `list_documents` | Every markdown file in the opened folder |
| `search_documents` | Grep the opened folder |
| `insert_text` | Insert text at the cursor |
| `replace_selection` | Replace the selected text |
| `append_text` | Append text at the end of the document |
| `save_document` | Write the document back to disk |
| `export_document` | Export as HTML or PDF |
| `set_theme` | Switch the colour theme |
| `configure_mcp` | Switch the MCP server on/off or move it to another port |
| `open_preferences` | Open the preferences dialog |
| `open_about` | Open the about dialog |
| `open_find` | Open find & replace |
| `toggle_sidebar` | Show or hide the sidebar |
| `get_settings` | Read the current preferences |
| `get_app_info` | Version, open file, MCP status |

### Resources

`oxmd://document/current` — the open document as `text/markdown`.

### Why edits are safe

The MCP server never touches the DOM. Every mutation is sent to the renderer
as a named command and executed there as a **ProseMirror transaction**, so the
undo history stays intact, a partially applied change is impossible, and the
file on disk stays the source of truth.

## Architecture

```
electron/
  main.js            main process — windows, menus, IPC, file system, MCP lifecycle
  preload.cjs        contextBridge surface (contextIsolation + sandbox ON)
  mcp.js             MCP server (Streamable HTTP, loopback only)
  zip.js             a small ZIP reader, for EPUB books
  watcher.js         chokidar file watcher
  smoke.js           headless self-test script

src/
  core/
    schema.js        the node model — every block and inline type
    markdown-it.js   markdown-it + custom rules (math, front matter, alerts, task lists)
    parser.js        markdown  → node model
    serializer.js    node model → markdown
    editor.js        ProseMirror view + plugin stack
    nodeviews/       KaTeX, Mermaid, CodeMirror, footnotes, raw HTML, task checkbox
    plugins/         hidden markers, keymap, input rules, live styles, placeholder
    renderers.js     the heavy engines (KaTeX, highlight.js), fetched on demand
    opf/             XML reader + EPUB package reader (shared with the main process)
    epub/            the inside of a book: container, paths, XHTML → Markdown
  ui/                outline, file tree, find, quick open, settings, package viewer
  styles/            base, editor, sidebar, package viewer, and four themes

tests/
  pipeline.test.js   markdown round-trip guarantees (17 assertions)
  opf.test.js        the XML reader and the EPUB package reader
  zip.test.js        the ZIP reader and the inside of a book
  mcp.test.js        end-to-end MCP client against the running app
  mcp-config.test.js the MCP server can be reconfigured at runtime
```

The document model is a three-stage pipeline:

```
markdown ──parser──▶ node model ──serializer──▶ markdown
                         │
                         └──────▶ the live DOM you edit
```

## Round-trip guarantee

The file on disk is the source of truth, so 0xMD guarantees that

```
parse(markdown) → node model → serialize(node model) → markdown
```

preserves your document. `tests/pipeline.test.js` asserts this for front
matter, headings, every inline mark, maths, code fences, Mermaid blocks,
tables, callouts, task lists, footnotes, images and links — and that the
result is idempotent.

```bash
npm test           # pipeline
npm run test:all   # pipeline + MCP end-to-end + MCP configuration
```

## Keyboard shortcuts

| | |
|---|---|
| `Ctrl+O` / `Ctrl+Shift+O` | Open file / open folder |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save as |
| `Ctrl+F` / `Ctrl+P` | Find / quick open |
| `Ctrl+,` | Preferences |
| `Ctrl+B` `Ctrl+I` | Bold / italic |
| `Ctrl+Shift+X` `Ctrl+Shift+H` | Strikethrough / highlight |
| `Ctrl+Alt+1…6` / `Ctrl+Alt+0` | Heading 1…6 / paragraph |
| `Ctrl+Shift+8` `Ctrl+Shift+7` | Bullet list / ordered list |
| `Ctrl+Shift+Q` | Quote |
| `Ctrl+Shift+L` | Toggle sidebar |
| `Ctrl+/` | Source code mode |

## Licence

MIT. The bundled third-party packages keep their own licences; see
`node_modules` after `npm install`.
