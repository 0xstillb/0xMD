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
  CodeMirror 6 inside a fenced block.
* **Raw HTML.** `src/core/nodeviews/html-block.js` renders it, but only
  after DOMPurify has stripped anything that could run.

## 5. Rendering engines

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

## 6. Themes

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

## 7. MCP

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
