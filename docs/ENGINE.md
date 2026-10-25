# 0xMD — engine notes

How the editor is put together, and why each piece is the way it is.

> Every line in this repository is original work and every dependency is
> MIT / BSD / Apache licensed. 0xMD is MIT licensed, has no activation and
> sends nothing anywhere.

---

## 1. The shape of the app

0xMD is an Electron desktop application. The interesting part is not the
window — it is the **document model**.

```
                    ┌──────────────────────────────────────────┐
                    │              0xMD (main process)         │
   markdown file ──▶│  file system · window · menus · watcher   │
                    │  MCP server (127.0.0.1 only)              │
                    └───────────────────┬──────────────────────┘
                                        │ contextBridge (IPC)
                    ┌───────────────────▼──────────────────────┐
                    │            renderer process                │
                    │  ProseMirror view  ◀── the editing surface│
                    └──────────────────────────────────────────┘
```

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`
and `sandbox: true`. It can only reach the file system through the narrow
API in `electron/preload.cjs`.

## 2. The three-stage pipeline

The single most important decision: **there is no second surface**. The
document you are editing *is* the rendered document.

```
markdown ──▶ parser ──▶ node model ──▶ serializer ──▶ markdown
                  │           │
                  │           └──▶ the live DOM (what you edit)
                  │
                  └──▶ ProseMirror document
```

* **`src/core/parser.js`** turns markdown text into the node model.
* **`src/core/serializer.js`** turns the node model back into markdown text.
* **`src/core/schema.js`** defines the node model.

Because the file on disk has to survive a round trip untouched, the
serializer is the inverse of the parser. `tests/pipeline.test.js` asserts
that for a document containing front matter, headings, every inline mark,
maths, code fences, Mermaid blocks, tables, callouts, task lists,
footnotes, images and links — and that serialising twice changes nothing.

### The node model

`src/core/schema.js` is a DOM-like model: every node carries an attribute
map, and blocks nest through `content`. The vocabulary covers the whole
document language:

| Block | Inline |
|---|---|
| `paragraph` `heading` `blockquote` `code_block` | `text` `strong` `em` `code` `strikethrough` |
| `math_block` `mermaid` `html_block` `front_matter` | `highlight` `underline` `subscript` `superscript` |
| `bullet_list` `ordered_list` `list_item` `table` | `link` `image` `footnote_ref` `math_inline` |
| `alert` `footnote_block` `horizontal_rule` | `hard_break` |

Each block also stores the literal markdown marker it came from
(`markup: '### '`), which is what lets the editor reveal the syntax when
the cursor enters the block.

## 3. The markdown dialect

`src/core/markdown-it.js` uses markdown-it plus four purpose-written rules:

| Syntax | Node |
|---|---|
| `---\n…\n---` at the top of the file | `front_matter` |
| `$x$` / `$$x$$` | `math_inline` / `math_block` |
| ` ```mermaid ` | `mermaid` |
| `> [!NOTE]` | `alert` |

Footnotes are handled by hand as well, so that the **raw** definition text
survives into the node model and is written back to the file verbatim.
Task lists are detected by a core rule that strips `[x] ` and records the
state on the list item, so the checkbox is a real DOM control rather than
painted text.

## 4. The editing surface

* **Hidden syntax.** `src/core/plugins/markers.js` adds a widget
  decoration at the start of the block the cursor is in, so the `#`, the
  `-` or the `$$` appears only where you are working.
* **Live maths.** `src/core/nodeviews/math.js` renders KaTeX and swaps to a
  source editor on click.
* **Live diagrams.** `src/core/nodeviews/mermaid.js` imports Mermaid only
  when a document actually contains a diagram, then paints the resulting
  SVG with the active theme's colours.
* **Real code editor.** `src/core/nodeviews/code-block.js` mounts
  CodeMirror 6 inside a fenced block. The language modes are fetched when
  a block asks for one, so a document without code does not pay for twelve
  parsers.
* **Raw HTML.** `src/core/nodeviews/html-block.js` renders it, but only
  after DOMPurify has stripped anything that could run.

## 5. EPUB package documents

An `.opf` file is not a document 0xMD can edit — it is the *index* of an
EPUB: the metadata of the book, the files it contains (the manifest) and
the order they are read in (the spine).

It is read in two steps, both in `src/core/opf/`:

```
.opf XML ──▶ xml.js ──▶ element tree ──▶ opf.js ──▶ package model
                                                        │
                                                        ├──▶ the viewer (read-only)
                                                        └──▶ a Markdown summary
```

* **`src/core/opf/xml.js`** is a small XML reader — elements, attributes,
  text, CDATA, entities, comments and the doctype. It never throws: a
  broken file is reported, not crashed on.
* **`src/core/opf/opf.js`** turns the tree into the model: the `dc:` metadata
  (title, authors and their roles, language, identifiers, publisher, date,
  cover), the manifest, the spine and the EPUB 2 guide. EPUB 3 refinements
  (`<meta refines="#…">`) are resolved, so an author's role is known.
* **`src/ui/opf-viewer.js`** draws it: metadata as a table, the manifest as a
  table, the reading order as a list. The raw XML is one button away.

The two modules are plain JavaScript — no DOM, no Node — so the **main
process** can use them as well. That is how the MCP server answers
`read_file` for a package with its structure rather than with raw XML.

A package is **read-only**: the file on disk is never rewritten, and the
editor surface steps aside while the package is open. What can be written is
a *summary* — `Save as Markdown…`, or **File → Export as HTML/PDF**.

## 6. EPUB books

An `.epub` file is a ZIP archive: the package, the chapters and the images.
Reading it takes three steps, and each one lives where it belongs.

```
book.epub ──▶ zip.js ──▶ META-INF/container.xml ──▶ content.opf
                     │                                   │
                     │                                   ▼
                     │                            the package model
                     ▼                                   │
             the chapter files ◀──────────────── the reading order
                     │
                     ▼
              xhtml.js ──▶ Markdown ──▶ the editor
```

* **`electron/zip.js`** is a small ZIP reader: the central directory, the
  local headers, and `zlib.inflateRawSync` for the deflated entries. No
  dependency, and it reads the whole archive into memory — which is what a
  book wants.
* **`src/core/epub/container.js`** reads `META-INF/container.xml`, finds
  the package inside the archive and works out where each file of the
  package really lives (`text/chapter-01.xhtml` in `OEBPS/content.opf`
  means `OEBPS/text/chapter-01.xhtml`). Hrefs are percent-decoded on the
  way.
* **`src/core/epub/xhtml.js`** turns a chapter into Markdown. It runs in
  the renderer, where the DOM lives: headings, paragraphs, lists, quotes,
  tables, code, images, links and line breaks all become Markdown, and
  the editor treats the chapter like any other document.

The book is **read-only**: the archive is never written to. A chapter can
be edited, and saving it writes a Markdown file of its own.

The XHTML → Markdown step happens in the renderer on purpose. That is also
why the MCP server asks the renderer for a chapter (`read_epub_chapter`)
instead of converting it itself: the main process has no DOM.

## 7. Rendering engines

| Concern | Engine | Why |
|---|---|---|
| Window / rendering | **Electron 40** (Chromium 144) | a desktop app that reads local files |
| Document model | **ProseMirror** | a real editing model with transactions, history and a pluggable schema |
| Markdown | **markdown-it** | fast, small, and easy to extend with custom rules |
| Maths | **KaTeX** | renders synchronously to HTML + CSS; no SVG blob, no worker |
| Diagrams | **Mermaid** | the de-facto standard, loaded on demand |
| Code | **CodeMirror 6** | the maintained line, with a language per block |
| Export colouring | **highlight.js** | covers the exported HTML |
| Raw HTML | **DOMPurify** | a `.md` file must never be able to run scripts |

## 8. Themes

A theme is a set of CSS custom properties in `src/styles/themes/`. The
structural metrics — heading scale, block spacing, indents, code and table
borders — live in `src/styles/editor.css` and read from those variables, so
a theme can change the measure and the type scale without touching the
editor.

| | GitHub | Newsprint | Night | Pixyll |
|---|---|---|---|---|
| measure | 860px | 34em | 914px | 914px |
| body font | Open Sans | PT Serif | Helvetica Neue | Merriweather |
| heading font | inherit | inherit | Lucida Grande / Corbel | inherit |
| h1 | 2.25em / 1.2 | 1.875em / 1.6em | 2em | 2rem / 2.5rem |
| h2 | 1.75em / 1.225 | 1.3125em / 1.15 | 1.75em | 1.5rem / 2rem |
| h3 | 1.5em / 1.43 | 1.3125em / 1.15 | 1.5em | 1.25rem / 1.5rem |
| block margin | 0.8em | 0.8em | 0.8em | 0.8em |
| list indent | 30px | 30px | 30px | 30px |

The column widens on large displays (860 → 1024 → 1200px) and the theme
owns the measure; the preferences only *scale* the type and can override the
width explicitly.

## 9. MCP

0xMD runs an MCP server inside the main process
(`electron/mcp.js`), reachable at `http://127.0.0.1:7331/mcp` over the
Streamable HTTP transport, bound to loopback only.

The server never touches the DOM. Every mutation is sent to the renderer as
a named command and executed there as a ProseMirror transaction, so:

* the undo history stays intact;
* a partially applied change is impossible;
* the file on disk stays the source of truth.

The server can be switched on and off, and moved to another port, from the
Preferences dialog or through the `configure_mcp` tool. The status bar
always shows the current state.

The open document is also exposed as an MCP resource at
`oxmd://document/current` with `text/markdown`.

(The scheme is `oxmd://` rather than `0xmd://` because a URL scheme may not
start with a digit — the MCP SDK parses resource URIs with `new URL()`.)

## 10. Staying light

The editor is a small program that should feel instant. Three rules keep it
that way.

**Nothing is fetched before it is needed.** The heavy parts — the twelve
CodeMirror language modes, KaTeX, highlight.js, Mermaid, electron-updater —
are loaded when something actually asks for them (`src/core/renderers.js`
holds the two that the editor and the export share). A document without
code and without maths starts on ~800 kB of JavaScript instead of ~1.9 MB.

**Nothing walks the whole document on every keystroke.** The hidden-syntax
decorations used to visit every block of the document; now they walk the
*ancestors* of the cursor, which is all that is needed to find the block
being edited. The word count in the status bar reads the whole document, so
it runs on a timer. The scroll spy measures the headings once per frame
instead of once per scroll event.

**The start-up does one thing at a time.** The document of the last session
is opened before the folder tree is scanned — a big folder can take a
moment, and there is no reason to wait for it before showing the text.

The MCP server is the one place where a restart used to be slow: closing it
waited for the open streams to end, which could take a second and a half.
It now frees the port at once and moves on.
