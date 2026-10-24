// 0xMD — renderer bootstrap.
//
// Wires the editor, the sidebar, the file system bridge and the MCP command
// channel together.

import { createEditor } from './core/editor.js';
import { parseMarkdown } from './core/parser.js';
import { serializeMarkdown } from './core/serializer.js';
import { markdownIt } from './core/markdown-it.js';
import { TextSelection } from 'prosemirror-state';
import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { markerPlugin } from './core/plugins/markers.js';
import { buildOutline, renderOutline, highlightOutline } from './ui/outline.js';
import { renderFileTree } from './ui/file-tree.js';
import { createFind } from './ui/find.js';
import { createQuickOpen } from './ui/quick-open.js';
import { openSettings } from './ui/settings.js';
import { parseOpf, opfToMarkdown, isOpfPath } from './core/opf/opf.js';
import { renderOpf } from './ui/opf-viewer.js';
import { xhtmlToMarkdown } from './core/epub/xhtml.js';
import { isEpubPath } from './core/epub/container.js';

const api = window.api;

const el = {
  app: document.getElementById('app'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  editorHost: document.getElementById('editor-host'),
  statusPath: document.getElementById('status-path'),
  statusWords: document.getElementById('status-words'),
  statusOutline: document.getElementById('status-outline'),
  statusMcp: document.getElementById('status-mcp'),
  fileTree: document.getElementById('file-tree'),
  filePreview: document.getElementById('file-preview'),
  outlineTree: document.getElementById('outline-tree'),
  outlineFilter: document.getElementById('outline-filter'),
  searchResults: document.getElementById('search-results'),
  folderSearch: document.getElementById('folder-search'),
  findPanel: document.getElementById('find-panel'),
  findInput: document.getElementById('find-input'),
  replaceInput: document.getElementById('replace-input'),
  findStatus: document.getElementById('find-status'),
  quickOpen: document.getElementById('quick-open'),
  quickOpenInput: document.getElementById('quick-open-input'),
  quickOpenList: document.getElementById('quick-open-list'),
  settingsModal: document.getElementById('settings-modal'),
  settingsBody: document.getElementById('settings-body'),
  toast: document.getElementById('toast'),
};

const state = {
  settings: null,
  filePath: null,
  fileName: 'Untitled',
  dirty: false,
  folderRoot: null,
  folderTree: [],
  recent: [],
  outline: [],
  outlineOffsets: new Map(),
  mcpPort: null,
  loading: false,
  view: null,
  // "markdown" for the editor, "opf" for an EPUB package document,
  // "epub" for the index of a book and "epub-chapter" for one of its chapters.
  fileType: 'markdown',
  opf: null,
  opfSections: [],
  epub: null,
  epubChapter: null,
};

/** Swap the document without marking it as edited. */
function replaceDocument(doc) {
  state.loading = true;
  try {
    state.view.dispatch(state.view.state.tr.replaceWith(0, state.view.state.doc.content.size, doc.content));
  } finally {
    state.loading = false;
  }
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

let toastTimer = null;
function toast(message, kind = 'info') {
  el.toast.textContent = message;
  el.toast.className = `toast toast-${kind}`;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

function currentMarkdown() {
  // An EPUB package is not a markdown document, but it still has a
  // readable summary — that is what gets exported, and what an agent
  // receives from the MCP server.
  if (state.fileType === 'opf') return state.opf ? opfToMarkdown(state.opf) : '';
  if (!state.view) return '';
  return serializeMarkdown(state.view.state.doc);
}

/* ------------------------------------------------------------------ *
 * Theme + typography
 * ------------------------------------------------------------------ */

const THEME_FILES = {
  github: 'github.css',
  night: 'night.css',
  newsprint: 'newsprint.css',
  pixyll: 'pixyll.css',
};

function applyTheme() {
  const s = state.settings;
  const root = document.documentElement;

  // Every theme ships in the same stylesheet; switching is a matter of
  // setting the attribute on <html>.
  root.dataset.theme = s.theme in THEME_FILES ? s.theme : 'github';
  root.dataset.dark = s.themeDark ? 'true' : 'false';

  // The theme owns the measure and the type scale; the preferences only
  // scale them, exactly the way a reader would expect.
  if (s.contentWidth > 0) root.style.setProperty('--content-width', `${s.contentWidth}px`);
  else root.style.removeProperty('--content-width');

  root.style.setProperty('--fs-scale', String((s.fontSize || 16) / 16));
  root.style.setProperty('--lh-scale', String((s.lineHeight || 1.6) / 1.6));
  if (s.fontFamily) root.style.setProperty('--font-body', s.fontFamily);

  root.dataset.mermaidTheme = s.theme === 'night' ? 'dark' : 'default';

  document.body.classList.toggle('sidebar-hidden', !s.showSidebar);
  // The handle points the way it will move.
  el.sidebarToggle.textContent = s.showSidebar ? '‹' : '›';
  el.sidebarToggle.title = s.showSidebar ? 'Hide sidebar (Ctrl+Shift+L)' : 'Show sidebar (Ctrl+Shift+L)';

  // Diagrams are painted with the theme colours, so they need a repaint.
  window.dispatchEvent(new CustomEvent('0xmd:themechange'));

  api.setTheme(s.theme, s.themeDark);
}

/* ------------------------------------------------------------------ *
 * About
 * ------------------------------------------------------------------ */

const ABOUT_DEPENDENCIES = [
  ['ProseMirror', 'the editor model and view'],
  ['markdown-it', 'markdown parsing'],
  ['KaTeX', 'maths'],
  ['Mermaid', 'diagrams'],
  ['CodeMirror 6', 'code blocks'],
  ['highlight.js', 'exported code colouring'],
  ['DOMPurify', 'raw HTML sanitising'],
  ['Electron', 'the desktop runtime'],
];

async function openAbout() {
  const info = await api.info();

  document.getElementById('about-version').textContent = `version ${info.version}`;
  document.getElementById('about-runtime').textContent =
    `Electron ${info.electron} · Chromium ${info.chrome}`;
  document.getElementById('about-engine').textContent = 'ProseMirror + markdown-it';
  document.getElementById('about-mcp').textContent = state.mcpPort
    ? `http://127.0.0.1:${state.mcpPort}/mcp`
    : 'not running';

  const list = document.getElementById('about-deps');
  list.innerHTML = '';
  for (const [name, role] of ABOUT_DEPENDENCIES) {
    const item = document.createElement('li');
    item.innerHTML = '<strong></strong> — ';
    item.querySelector('strong').textContent = name;
    item.append(document.createTextNode(role));
    list.append(item);
  }

  document.getElementById('about-source').addEventListener('click', async (event) => {
    event.preventDefault();
    await api.revealFile(state.filePath || state.settings.lastFolder || '.');
  });

  document.getElementById('about-modal').hidden = false;
}

/** Switch the colour theme and remember the choice. */
async function setTheme(theme) {
  if (!theme || !(theme in THEME_FILES)) return;
  state.settings.theme = theme;
  applyTheme();
  await api.settingsSet({ theme });
  toast(`Theme: ${theme}`);
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

function updateStatus() {
  el.statusPath.textContent = `${state.dirty ? '● ' : ''}${state.fileName}${state.filePath ? '' : ' — unsaved'}`;

  if (state.fileType === 'opf') {
    // A package has no words to count — it has files and a reading order.
    el.statusWords.textContent = state.opf
      ? `EPUB ${state.opf.version || '?'} · ${state.opf.manifest.length} files · ${state.opf.spine.items.length} in reading order`
      : 'EPUB package';
    el.statusOutline.textContent = state.outline.length ? `${state.outline.length} sections` : 'EPUB package';
    return;
  }

  if (state.fileType === 'epub') {
    const book = state.epub;
    el.statusWords.textContent = book
      ? `EPUB ${book.package.version || '?'} · ${book.package.manifest.length} files · ${book.chapters.length} chapters`
      : 'EPUB book';
    el.statusOutline.textContent = state.outline.length ? `${state.outline.length} sections` : 'EPUB book';
    return;
  }

  const doc = state.view?.state.doc;
  if (!doc) return;

  const text = doc.textBetween(0, doc.content.size, ' ', ' ');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;

  el.statusWords.textContent = `${words} word${words === 1 ? '' : 's'} · ${chars} char${chars === 1 ? '' : 's'}`;
  el.statusOutline.textContent = state.outline.length ? `${state.outline.length} headings` : '';
}

/* ------------------------------------------------------------------ *
 * Outline
 * ------------------------------------------------------------------ */

function refreshOutline() {
  if (!state.view) return;

  if (state.fileType === 'opf') {
    // A package has no headings — the outline lists the sections of the
    // viewer instead, and jumps to them.
    state.outline = state.opfSections.map((section, index) => ({
      level: 1,
      text: section.title,
      pos: index,
    }));
    renderOutline(el.outlineTree, state.outline, {
      filter: el.outlineFilter.value,
      onSelect: (item) => {
        const section = state.opfSections[item.pos];
        if (section) document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
    updateStatus();
    return;
  }

  state.outline = buildOutline(state.view.state.doc);
  renderOutline(el.outlineTree, state.outline, {
    filter: el.outlineFilter.value,
    onSelect: (heading) => {
      const pos = heading.pos;
      state.view.dispatch(
        state.view.state.tr.setSelection(TextSelection.create(state.view.state.doc, pos)).scrollIntoView(),
      );
      state.view.focus();
    },
  });
  updateStatus();
}

function updateOutlineOffsets() {
  state.outlineOffsets.clear();
  if (!state.view) return;
  const dom = state.view.dom;
  state.outline.forEach((heading) => {
    const node = dom.querySelector(`[data-pos="${heading.pos}"]`);
    if (node) state.outlineOffsets.set(heading.pos, node.getBoundingClientRect().top + dom.parentElement.scrollTop);
  });
}

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

async function openDocument(filePath) {
  try {
    const file = await api.readFile(filePath);
    state.filePath = file.path;
    state.fileName = file.name;
    state.dirty = false;

    if (isEpubPath(file.path)) await openEpubDocument(file);
    else if (isOpfPath(file.path)) showOpfDocument(file);
    else showMarkdownDocument(file);

    document.title = `${file.name} — 0xMD`;
    api.recentAdd(file.path);
    state.recent = await api.recentList();
    api.watch([file.path]);
    refreshOutline();
    updateStatus();
    toast(`Opened ${file.name}`);
  } catch (err) {
    toast(`Could not open file: ${err.message}`, 'error');
  }
}

/** Load a Markdown file into the editor. */
function showMarkdownDocument(file) {
  state.fileType = 'markdown';
  state.opf = null;
  state.opfSections = [];
  setSurface('markdown');
  const doc = parseMarkdown(file.content);
  if (state.view) {
    replaceDocument(doc);
    state.view.state.doc.setAttribute?.('data-file', file.path);
  }
}

/**
 * Show an EPUB package document.
 *
 * A .opf file is the index of an EPUB, not a document 0xMD can edit, so it
 * gets its own read-only surface: the metadata, the manifest and the
 * reading order.
 */
function showOpfDocument(file) {
  state.fileType = 'opf';
  setSurface('opf');

  let model = null;
  let error = null;
  try {
    model = parseOpf(file.content);
  } catch (err) {
    error = err;
  }
  state.opf = model;

  const host = opfHost();
  const { sections } = renderOpf(host, {
    model,
    error,
    raw: file.content,
    onReveal: (href) => revealPackageFile(href),
    onSaveMarkdown: () => saveOpfAsMarkdown(),
  });
  state.opfSections = sections;
}

/** The element the package viewer lives in. */
function opfHost() {
  let host = el.editorHost.querySelector('.opf-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'opf-host';
    el.editorHost.append(host);
  }
  return host;
}

/** Switch between the editor surface and the package viewer. */
function setSurface(kind) {
  el.editorHost.classList.toggle('is-opf', kind === 'opf');
  if (kind !== 'opf') {
    el.editorHost.querySelector('.opf-host')?.remove();
  }
  if (kind !== 'epub-chapter') {
    el.editorHost.querySelector('.epub-banner')?.remove();
  }
}

/* ------------------------------------------------------------------ *
 * EPUB books
 * ------------------------------------------------------------------ */

/**
 * Open an EPUB book.
 *
 * The book is a ZIP archive: its package is read with the same reader that
 * reads a .opf file, and its chapters are read one at a time.
 */
async function openEpubDocument(file) {
  state.fileType = 'epub';
  state.epubChapter = null;

  let epub = null;
  let error = null;
  try {
    epub = await api.epubOpen(file.path);
  } catch (err) {
    error = err;
  }
  state.epub = epub;

  if (error) {
    setSurface('opf');
    state.opfSections = [];
    renderOpf(opfHost(), { model: null, error, raw: '' });
    return;
  }

  // The raw package is small, and it is what "View XML" shows.
  let raw = '';
  try {
    raw = (await api.epubRead(epub.path, epub.rootfile)).html;
  } catch {
    /* the package is already parsed — the raw text is a nicety */
  }

  renderEpubViewer(epub, raw);
}

/** Draw the index of a book. */
function renderEpubViewer(epub, raw = '') {
  setSurface('opf');
  state.fileType = 'epub';
  state.opfSections = [];

  // The chapters know where they live inside the archive.
  const model = {
    ...epub.package,
    spine: {
      ...epub.package.spine,
      items: epub.package.spine.items.map((item, index) => ({
        ...item,
        path: epub.chapters[index]?.path ?? '',
        title: epub.chapters[index]?.title || item.title,
      })),
    },
  };

  const { sections } = renderOpf(opfHost(), {
    model,
    raw,
    onOpenChapter: (item) => openEpubChapter(epub, item),
    onSaveMarkdown: () => saveOpfAsMarkdown(),
  });
  state.opfSections = sections;
}

/**
 * Open a chapter of a book.
 *
 * The chapter is XHTML; it is converted to Markdown, so it can be read and
 * edited like any other document — and saved as a Markdown file.
 */
async function openEpubChapter(epub, chapter) {
  try {
    const { html } = await api.epubRead(epub.path, chapter.path);
    const markdown = xhtmlToMarkdown(html);

    state.fileType = 'epub-chapter';
    state.epubChapter = chapter;
    state.fileName = chapter.title || chapter.path;

    setSurface('markdown');
    showChapterBanner(epub, chapter);

    if (state.view) replaceDocument(parseMarkdown(markdown));
    refreshOutline();
    updateStatus();
  } catch (err) {
    toast(`Could not open the chapter: ${err.message}`, 'error');
  }
}

/** The bar above a chapter, with the way back to the index of the book. */
function showChapterBanner(epub, chapter) {
  let banner = el.editorHost.querySelector('.epub-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'epub-banner';
    el.editorHost.prepend(banner);
  }
  banner.innerHTML = '';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'epub-back';
  back.textContent = '←';
  back.title = 'Back to the book';
  back.addEventListener('click', () => {
    state.fileType = 'epub';
    state.epubChapter = null;
    state.fileName = epub.name;
    renderEpubViewer(epub);
    refreshOutline();
    updateStatus();
  });

  const title = document.createElement('span');
  title.className = 'epub-banner-title';
  title.textContent = chapter.title || chapter.path;

  const source = document.createElement('span');
  source.className = 'epub-banner-source';
  source.textContent = `from ${epub.name}`;

  banner.append(back, title, source);
}

/** A file name a chapter can be saved under. */
function chapterFileName(chapter) {
  const base = String(chapter?.title || 'chapter')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'chapter';
}

/**
 * Show a file the package refers to, in the file manager of the system.
 * The hrefs are relative to the folder the package itself lives in.
 */
async function revealPackageFile(href) {
  if (!href || !state.filePath) return;
  const separator = state.filePath.includes('\\') ? '\\' : '/';
  const folder = state.filePath.slice(0, state.filePath.lastIndexOf(separator));
  const target = `${folder}${separator}${href.split('/').join(separator)}`;
  try {
    const exists = await api.fileExists(target);
    if (!exists) {
      toast(`Not found next to the package: ${href}`, 'error');
      return;
    }
    api.revealFile(target);
  } catch {
    toast(`Could not show ${href}`, 'error');
  }
}

/** Write the summary of a package to a Markdown file. */
async function saveOpfAsMarkdown() {
  const model = state.fileType === 'epub' ? state.epub?.package : state.opf;
  if (!model) return;
  const base = (state.fileName || 'package').replace(/\.(opf|epub)$/i, '') || 'package';
  const saved = await api.saveFileDialog(opfToMarkdown(model), `${base}.md`);
  if (saved) toast(`Saved ${saved.split(/[\\/]/).pop()}`);
}

async function saveDocument({ forceAs = false } = {}) {
  if (state.fileType === 'opf') {
    toast('EPUB package documents are read-only in 0xMD — use “Save as Markdown…” for a summary.', 'info');
    return false;
  }
  if (state.fileType === 'epub') {
    toast('EPUB books are read-only in 0xMD — open a chapter and save that.', 'info');
    return false;
  }
  if (state.fileType === 'epub-chapter') {
    // A chapter is a scratch document: it is written as a Markdown file,
    // never back into the book.
    const saved = await api.saveFileDialog(currentMarkdown(), `${chapterFileName(state.epubChapter)}.md`);
    if (!saved) return false;
    toast(`Saved ${saved.split(/[\\/]/).pop()}`);
    return true;
  }
  if (!state.view) return false;
  const content = currentMarkdown();

  let target = state.filePath;
  if (!target || forceAs) {
    const saved = await api.saveFileDialog?.(content, state.fileName);
    if (!saved) return false;
    target = saved;
    state.filePath = target;
    state.fileName = target.split(/[\\/]/).pop();
    document.title = `${state.fileName} — 0xMD`;
  }

  try {
    await api.saveFile(target, content);
    state.dirty = false;
    api.recentAdd(target);
    api.watch([target]);
    updateStatus();
    toast(`Saved ${state.fileName}`);
    return true;
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
    return false;
  }
}

async function openFolder(explicitPath) {
  let result = null;
  if (explicitPath) {
    try {
      result = await api.folderTree(explicitPath);
    } catch (err) {
      toast(`Could not open folder: ${err.message}`, 'error');
      return;
    }
  } else {
    result = await api.openFolderDialog();
  }
  if (!result) return;
  state.folderRoot = result.root;
  state.folderTree = result.tree;
  api.settingsSet({ lastFolder: result.root });
  renderTree();
  api.watch([result.root]);
  toast(`Opened folder ${result.root.split(/[\\/]/).pop()}`);
}

function renderTree() {
  renderFileTree(el.fileTree, state.folderTree, {
    activePath: state.filePath,
    onOpen: (path) => openDocument(path),
    onOpenFolder: openFolder,
  });
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function buildExportHtml() {
  const doc = state.view.state.doc;
  const html = markdownIt.render(currentMarkdown());
  const s = state.settings;
  const title = state.fileType === 'opf'
    ? (state.opf?.metadata.title || state.fileName.replace(/\.opf$/i, ''))
    : state.fileName.replace(/\.mdx?$/i, '');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: ${s.contentWidth}px; margin: 0 auto; padding: 48px 24px; line-height: ${s.lineHeight};
         font-family: ${s.fontFamily}; font-size: ${s.fontSize}px; color: #333; background: #fff; }
  pre { background: #f6f8fa; padding: 16px; overflow: auto; border-radius: 6px; }
  code { font-family: "SFMono-Regular", Consolas, monospace; }
  blockquote { border-left: 4px solid #dfe2e5; margin-left: 0; padding-left: 16px; color: #6a737d; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #dfe2e5; padding: 6px 13px; }
  img { max-width: 100%; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ *
 * Formatting commands (menu driven)
 * ------------------------------------------------------------------ */

function runCommand(command, payload) {
  const view = state.view;
  if (!view) return;

  switch (command) {
    case 'format.bold':
      view.dispatch(toggleMark(view.state.schema.marks.strong)());
      break;
    case 'format.italic':
      view.dispatch(toggleMark(view.state.schema.marks.em)());
      break;
    case 'format.strikethrough':
      view.dispatch(toggleMark(view.state.schema.marks.strikethrough)());
      break;
    case 'format.highlight':
      view.dispatch(toggleMark(view.state.schema.marks.highlight)());
      break;
    case 'format.code':
      view.dispatch(toggleMark(view.state.schema.marks.code)());
      break;
    case 'format.underline':
      view.dispatch(toggleMark(view.state.schema.marks.underline)());
      break;
    case 'format.subscript':
      view.dispatch(toggleMark(view.state.schema.marks.subscript)());
      break;
    case 'format.superscript':
      view.dispatch(toggleMark(view.state.schema.marks.superscript)());
      break;
    case 'format.paragraph':
      view.dispatch(setBlockType(view.state.schema.nodes.paragraph)());
      break;
    case 'format.heading':
      view.dispatch(setBlockType(view.state.schema.nodes.heading, { level: payload || 1 })());
      break;
    case 'format.quote':
      view.dispatch(wrapIn(view.state.schema.nodes.blockquote)());
      break;
    case 'format.bulletList':
      view.dispatch(wrapIn(view.state.schema.nodes.bullet_list)());
      break;
    case 'format.orderedList':
      view.dispatch(wrapIn(view.state.schema.nodes.ordered_list)());
      break;
    case 'format.link':
      insertLink();
      break;
    case 'format.image':
      insertImage();
      break;
    case 'format.math':
      insertMath();
      break;
    case 'format.mermaid':
      insertMermaid();
      break;
    default:
      break;
  }
  view.focus();
}

function insertLink() {
  const view = state.view;
  const href = window.prompt('Link URL');
  if (!href) return;
  const mark = view.state.schema.marks.link.create({ href });
  view.dispatch(view.state.tr.addMark(view.state.selection.from, view.state.selection.to, mark));
}

function insertImage() {
  const view = state.view;
  const src = window.prompt('Image path or URL');
  if (!src) return;
  const node = view.state.schema.nodes.image.create({ src, alt: '' });
  view.dispatch(view.state.tr.replaceSelectionWith(node));
}

function insertMath() {
  const view = state.view;
  const node = view.state.schema.nodes.math_inline.create({ latex: '' });
  view.dispatch(view.state.tr.replaceSelectionWith(node));
}

function insertMermaid() {
  const view = state.view;
  const node = view.state.schema.nodes.mermaid.create({ markup: '```mermaid' }, view.state.schema.text('graph TD;\nA-->B;'));
  view.dispatch(view.state.tr.replaceSelectionWith(node));
}

/* ------------------------------------------------------------------ *
 * MCP command channel
 * ------------------------------------------------------------------ */

/** An EPUB package is read-only — an agent may read it, not write it. */
function assertEditable() {
  if (state.fileType === 'opf' || state.fileType === 'epub') {
    throw new Error('EPUB packages and books are read-only in 0xMD.');
  }
}

const mcpCommands = {
  async open_document({ path }) {
    await openDocument(path);
    return { path: state.filePath, name: state.fileName };
  },
  read_document() {
    return { path: state.filePath, markdown: currentMarkdown() };
  },
  /**
   * Read a chapter of a book. The XHTML is turned into Markdown in the
   * renderer — that is where the DOM lives.
   */
  async read_epub_chapter({ path: filePath, index = 0, href }) {
    const epub = state.epub?.path === filePath ? state.epub : await api.epubOpen(filePath);
    const chapter = href
      ? epub.chapters.find((item) => item.path === href || item.href === href)
      : epub.chapters[index];
    if (!chapter) throw new Error(`This book has no chapter "${href ?? index}".`);

    const { html } = await api.epubRead(epub.path, chapter.path);
    return {
      path: epub.path,
      chapter: chapter.title,
      index: chapter.index,
      markdown: xhtmlToMarkdown(html),
    };
  },
  get_outline() {
    return state.outline.map((h) => ({ level: h.level, text: h.text, position: h.pos }));
  },
  get_selection() {
    const { from, to } = state.view.state.selection;
    return { text: state.view.state.doc.textBetween(from, to, ' '), from, to };
  },
  insert_text({ text }) {
    assertEditable();
    state.view.dispatch(state.view.state.tr.insertText(text));
    return { ok: true };
  },
  replace_selection({ text }) {
    assertEditable();
    const { from, to } = state.view.state.selection;
    state.view.dispatch(state.view.state.tr.insertText(text, from, to));
    return { ok: true };
  },
  append_text({ text }) {
    assertEditable();
    const end = state.view.state.doc.content.size;
    state.view.dispatch(state.view.state.tr.insertText(text, end));
    return { ok: true };
  },
  set_theme({ theme, dark }) {
    state.settings.theme = theme || state.settings.theme;
    if (typeof dark === 'boolean') state.settings.themeDark = dark;
    applyTheme();
    api.settingsSet({ theme: state.settings.theme, themeDark: state.settings.themeDark });
    return { theme: state.settings.theme, dark: state.settings.themeDark };
  },
  async save_document() {
    if (state.fileType === 'opf' || state.fileType === 'epub') {
      throw new Error('EPUB packages and books are read-only in 0xMD.');
    }
    if (state.fileType === 'epub-chapter') {
      throw new Error('A chapter of an EPUB cannot be written back into the book — export it instead.');
    }
    if (!state.filePath) {
      throw new Error('The document has no path yet — save it once in the app first.');
    }
    await api.saveFile(state.filePath, currentMarkdown());
    state.dirty = false;
    updateStatus();
    return { path: state.filePath };
  },
  async export_document({ format, directory }) {
    const base = state.fileName.replace(/\.mdx?$/i, '') || 'document';
    const html = buildExportHtml();
    const target = directory
      ? `${directory.replace(/[\\/]+$/, '')}/${base}.${format}`
      : null;

    if (format === 'pdf') {
      const saved = target
        ? await api.exportPdfTo(target, html)
        : await api.exportPdf(html, `${base}.pdf`);
      return { path: saved };
    }
    const saved = target
      ? await api.exportWrite(target, html)
      : await api.exportHtml(html, `${base}.html`);
    return { path: saved };
  },
  get_settings() {
    return state.settings;
  },
  open_preferences() {
    openPreferences();
    return { opened: true };
  },
  open_about() {
    return openAbout().then(() => ({ opened: true }));
  },
  configure_mcp({ enabled, port }) {
    // The server cannot restart itself in the middle of the request it is
    // serving, so the answer goes out first and the restart follows.
    setTimeout(() => {
      api.configureMcp({ enabled, port }).catch(() => {});
    }, 400);
    return Promise.resolve({ restarting: true, enabled: enabled ?? null, port: port ?? null });
  },
  check_updates() {
    return api.updateStatus().then((status) => {
      api.checkForUpdates().catch(() => {});
      return status;
    });
  },
  register_file_associations() {
    return api.registerFileAssoc().then((result) => {
      if (result?.ok) toast('0xMD is now registered for Markdown and EPUB package files.');
      else toast(result?.error || 'Could not register the file association.', 'error');
      refreshFileAssocStatus();
      return result;
    });
  },
  open_quick_open() {
    el.quickOpen.hidden = false;
    el.quickOpenInput.focus();
    return { opened: true };
  },
  open_find() {
    el.findPanel.hidden = false;
    el.findInput.focus();
    el.findInput.select();
    return { opened: true };
  },
  toggle_sidebar() {
    state.settings.showSidebar = !state.settings.showSidebar;
    applyTheme();
    api.settingsSet({ showSidebar: state.settings.showSidebar });
    return { showSidebar: state.settings.showSidebar };
  },
  get_app_info() {
    return { name: '0xMD', file: state.filePath, dirty: state.dirty };
  },
};

api.onMcpStatus(({ running, port, error, reason }) => {
  state.mcpPort = running ? port : null;
  el.statusMcp.textContent = running ? `MCP :${port}` : 'MCP off';
  el.statusMcp.classList.toggle('is-running', !!running);
  el.statusMcp.classList.toggle('is-error', !!error);
  el.statusMcp.title = running
    ? `MCP server listening on http://127.0.0.1:${port}/mcp`
    : error
      ? `MCP server error: ${error}`
      : reason === 'disabled'
        ? 'MCP server is switched off in the preferences'
        : 'MCP server is not running';
});

api.onMcpCommand(async ({ id, command, args }) => {
  try {
    const handler = mcpCommands[command];
    if (!handler) throw new Error(`Unknown command: ${command}`);
    const result = await handler(args || {});
    api.mcpResult(id, { ok: true, result });
  } catch (err) {
    api.mcpResult(id, { ok: false, error: String(err?.message || err) });
  }
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  const info = await api.info();
  state.settings = info.settings;
  state.recent = state.settings.recentFiles || [];

  applyTheme();

  const doc = parseMarkdown('');
  state.view = createEditor({
    mount: el.editorHost,
    doc,
    onChange: () => {
      // Loading a document replaces the content, which is not an edit.
      if (!state.loading) state.dirty = true;
      updateStatus();
      scheduleOutline();
    },
    onStateChange: () => {
      updateStatus();
    },
  });

  setupFind();
  setupQuickOpen();
  setupSidebar();
  setupMenuActions();
  setupFileEvents();
  setupDragAndDrop();
  setupBeforeUnload();
  setupAboutDialog();

  if (state.settings.lastFolder) {
    try {
      const tree = await api.folderTree(state.settings.lastFolder);
      state.folderRoot = tree.root;
      state.folderTree = tree.tree;
      renderTree();
    } catch {
      /* folder is gone */
    }
  }

  // A document or folder passed on the command line.
  try {
    const startup = await api.startup();
    if (startup?.folder) await openFolder(startup.folder);
    if (startup?.file) await openDocument(startup.file);
  } catch {
    /* nothing to open */
  }

  // Pick up the MCP server state (it may have been switched off).
  try {
    const current = await api.mcpStatus();
    state.mcpPort = current.running ? current.port : null;
    el.statusMcp.textContent = current.running ? `MCP :${current.port}` : 'MCP off';
    el.statusMcp.classList.toggle('is-running', !!current.running);
    el.statusMcp.title = current.running
      ? `MCP server listening on http://127.0.0.1:${current.port}/mcp`
      : 'MCP server is switched off';
  } catch {
    /* the status bar simply stays empty */
  }

  updateStatus();
  refreshOutline();

  // Expose the internals for the automated smoke test (and for debugging
  // from the devtools console).
  window.__0xmd = {
    state,
    parseMarkdown,
    serializeMarkdown,
    markdownIt,
    currentMarkdown,
    openDocument,
    saveDocument,
    buildExportHtml,
    openPreferences,
    openAbout,
    configureMcp: (config) => api.configureMcp(config),
    setTheme,
    mcpCommands,
    // The EPUB package reader, for the smoke test and the devtools console.
    parseOpf,
    opfToMarkdown,
    isOpfPath,
    renderOpf,
  };
  window.__0xmdReady = true;
}

let outlineTimer = null;
function scheduleOutline() {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    refreshOutline();
  }, 220);
}

function setupFind() {
  createFind({
    view: state.view,
    panel: el.findPanel,
    input: el.findInput,
    replaceInput: el.replaceInput,
    status: el.findStatus,
    onClose: () => { el.findPanel.hidden = true; state.view.focus(); },
  });
}

function setupQuickOpen() {
  createQuickOpen({
    root: el.quickOpen,
    input: el.quickOpenInput,
    list: el.quickOpenList,
    sources: () => [
      { kind: 'tree', tree: state.folderTree },
      { kind: 'recent', paths: state.recent },
    ],
    onOpen: (path) => openDocument(path),
  });
}

function setupSidebar() {
  document.querySelectorAll('.sidebar-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.sidebar-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab);
      });
      if (tab.dataset.tab === 'outline') refreshOutline();
    });
  });

  el.sidebarToggle.addEventListener('click', () => {
    state.settings.showSidebar = !state.settings.showSidebar;
    applyTheme();
    api.settingsSet({ showSidebar: state.settings.showSidebar });
  });

  // A peek at the file under the cursor.
  let previewTimer = null;
  el.fileTree.addEventListener('mouseover', async (event) => {
    const link = event.target.closest('.file-tree-file');
    if (!link) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const filePath = link.dataset.path;
      if (!filePath) return;
      try {
        const file = await api.readFile(filePath);
        el.filePreview.hidden = false;
        el.filePreview.querySelector('.sidebar-preview-title').textContent = file.name;
        el.filePreview.querySelector('.sidebar-preview-body').textContent =
          file.content.split(/\r?\n/).slice(0, 18).join('\n');
      } catch {
        el.filePreview.hidden = true;
      }
    }, 260);
  });

  el.fileTree.addEventListener('mouseleave', () => {
    clearTimeout(previewTimer);
    el.filePreview.hidden = true;
  });

  el.outlineFilter.addEventListener('input', () => refreshOutline());

  document.querySelectorAll('[data-action="open-file"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const file = await api.openFileDialog();
      if (file) openDocument(file.path);
    });
  });

  document.querySelectorAll('[data-action="open-folder"]').forEach((button) => {
    button.addEventListener('click', openFolder);
  });

  // Folder-wide search.
  let searchTimer = null;
  el.folderSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const needle = el.folderSearch.value.trim().toLowerCase();
      el.searchResults.innerHTML = '';
      if (!needle) return;

      const hits = [];
      const walk = async (nodes) => {
        for (const node of nodes) {
          if (node.type === 'dir') await walk(node.children);
          else {
            try {
              const file = await api.readFile(node.path);
              if (file.content.toLowerCase().includes(needle)) {
                hits.push({ node, count: (file.content.toLowerCase().match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length });
              }
            } catch { /* unreadable */ }
          }
        }
      };
      await walk(state.folderTree);

      if (!hits.length) {
        const empty = document.createElement('div');
        empty.className = 'sidebar-empty';
        empty.textContent = 'No matches.';
        el.searchResults.append(empty);
        return;
      }

      for (const hit of hits) {
        const button = document.createElement('button');
        button.className = 'search-hit';
        button.innerHTML = `<span class="search-hit-name"></span><span class="search-hit-count">${hit.count}</span>`;
        button.querySelector('.search-hit-name').textContent = hit.node.name;
        button.addEventListener('click', () => openDocument(hit.node.path));
        el.searchResults.append(button);
      }
    }, 260);
  });

  // Scroll spy for the outline.
  const main = document.getElementById('main');
  main.addEventListener('scroll', () => {
    if (!state.outline.length) return;
    updateOutlineOffsets();
    highlightOutline(el.outlineTree, state.outline, main.scrollTop, state.outlineOffsets);
  });
}

/* ------------------------------------------------------------------ *
 * File associations — 0xMD in the "Open with" list of Explorer.
 * ------------------------------------------------------------------ */

async function refreshFileAssocStatus() {
  const note = document.getElementById('file-assoc-note');
  const button = document.getElementById('file-assoc-button');
  if (!note || !button) return;

  try {
    const status = await api.fileAssocStatus();
    if (!status.usable) {
      note.textContent = 'This is a development run, so there is no real executable to register. Build or install 0xMD first, then register it.';
      button.textContent = 'Register 0xMD for .md and .opf files';
      button.dataset.mode = 'register';
      button.disabled = true;
      return;
    }
    button.disabled = false;

    if (status.registered) {
      note.textContent = `0xMD is registered for ${status.extensions.join(', ')}. It now appears in the "Open with" list of Explorer.`;
      button.textContent = 'Remove the file association';
      button.dataset.mode = 'unregister';
    } else {
      note.textContent = 'Register 0xMD so it shows up in the "Open with" list when you right-click a Markdown file or an EPUB package. The setting is stored for your user account only.';
      button.textContent = 'Register 0xMD for .md and .opf files';
      button.dataset.mode = 'register';
    }
  } catch (err) {
    note.textContent = `Could not read the file association state: ${err?.message || err}`;
  }
}

function openPreferences() {
  openSettings({
    modal: el.settingsModal,
    body: el.settingsBody,
    settings: state.settings,
    onAssocChanged: refreshFileAssocStatus,
    onSave: async (draft) => {
      state.settings = { ...state.settings, ...draft, editor: { ...state.settings.editor, ...draft.editor } };
      applyTheme();
      await api.settingsSet(state.settings);

      // Restart the MCP server if it was switched on or off / moved.
      if (draft.mcpEnabled !== undefined || draft.mcpPort !== undefined) {
        const result = await api.configureMcp({ enabled: draft.mcpEnabled, port: draft.mcpPort });
        if (result?.error) toast(`MCP server: ${result.error}`, 'error');
        else if (result?.running) toast(`MCP server listening on port ${result.port}`);
        else toast('MCP server disabled');
      }

      toast('Preferences saved');
    },
    onClose: () => state.view?.focus(),
  });

  // The file-association state is read after the dialog is on screen.
  setTimeout(refreshFileAssocStatus, 60);
}

function setupMenuActions() {
  api.onMenuAction(async ({ action, payload }) => {
    switch (action) {
      case 'file.new':
        state.filePath = null;
        state.fileName = 'Untitled';
        state.dirty = false;
        state.fileType = 'markdown';
        state.opf = null;
        state.opfSections = [];
        state.epub = null;
        state.epubChapter = null;
        setSurface('markdown');
        replaceDocument(parseMarkdown(''));
        document.title = '0xMD';
        updateStatus();
        break;
      case 'file.open':
        document.querySelector('[data-action="open-file"]')?.click();
        break;
      case 'file.openPath':
        openDocument(payload);
        break;
      case 'file.openFolder':
        openFolder();
        break;
      case 'file.openFolderPath':
        openFolder(payload);
        break;
      case 'file.save':
        saveDocument();
        break;
      case 'file.saveAs':
        saveDocument({ forceAs: true });
        break;
      case 'file.exportHtml': {
        const saved = await api.exportHtml(buildExportHtml(), `${state.fileName.replace(/\.mdx?$/i, '')}.html`);
        if (saved) toast(`Exported to ${saved}`);
        break;
      }
      case 'file.exportPdf': {
        const saved = await api.exportPdf(buildExportHtml(), `${state.fileName.replace(/\.mdx?$/i, '')}.pdf`);
        if (saved) toast(`Exported to ${saved}`);
        break;
      }
      case 'edit.find':
        el.findPanel.hidden = false;
        el.findInput.focus();
        el.findInput.select();
        break;
      case 'edit.quickOpen':
        el.quickOpen.hidden = false;
        el.quickOpenInput.focus();
        break;
      case 'edit.wordCount':
        el.statusWords.classList.toggle('is-highlighted');
        break;
      case 'edit.sourceMode':
        document.body.classList.toggle('source-mode');
        break;
      case 'view.sidebar':
        state.settings.showSidebar = !state.settings.showSidebar;
        applyTheme();
        api.settingsSet({ showSidebar: state.settings.showSidebar });
        break;
      case 'view.zoomIn':
        state.settings.fontSize = Math.min(32, state.settings.fontSize + 1);
        applyTheme();
        break;
      case 'view.zoomOut':
        state.settings.fontSize = Math.max(10, state.settings.fontSize - 1);
        applyTheme();
        break;
      case 'view.zoom':
        state.settings.fontSize = payload || 16;
        applyTheme();
        break;
      case 'view.preferences':
        openPreferences();
        break;
      case 'theme.set':
        setTheme(payload);
        break;
      case 'help.about':
        openAbout();
        break;
      case 'help.checkUpdates':
        toast('Checking for updates…');
        api.checkForUpdates().catch(() => toast('Could not check for updates.', 'error'));
        break;
      case 'help.markdown':
        window.open('https://commonmark.org/help/', '_blank');
        break;      default:
        if (action.startsWith('format.')) runCommand(action, payload);
        break;
    }
  });
}

function setupFileEvents() {
  // The watcher in the main process reports every change on disk. A package
  // and a book are read-only, so they can simply be read again and shown
  // anew.
  api.onFileChanged(async ({ path }) => {
    if (!path || path !== state.filePath) return;
    if (state.fileType !== 'opf' && state.fileType !== 'epub') return;
    try {
      const file = await api.readFile(path);
      if (state.fileType === 'epub') await openEpubDocument(file);
      else showOpfDocument(file);
      refreshOutline();
      updateStatus();
      toast('Reloaded');
    } catch {
      /* the file is gone */
    }
  });
}

function setupDragAndDrop() {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('dragover', stop);
  window.addEventListener('drop', async (event) => {
    stop(event);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.(md|markdown|mdown|mkd|mdx|txt|opf|epub)$/i.test(file.name)) {
      toast('Only Markdown files and EPUB books can be opened.', 'error');
      return;
    }
    // Electron exposes the real path through the webUtils shim in preload;
    // fall back to reading the dropped file directly.
    const path = window.api.pathForFile?.(file);
    if (path) openDocument(path);
  });
}

function setupAboutDialog() {
  const modal = document.getElementById('about-modal');
  const close = () => {
    modal.hidden = true;
    state.view?.focus();
  };
  document.getElementById('about-close')?.addEventListener('click', close);
  document.getElementById('about-done')?.addEventListener('click', close);
  modal.addEventListener('mousedown', (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
}

function setupBeforeUnload() {  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

boot().catch((err) => {
  console.error(err);
  toast(`Startup failed: ${err.message}`, 'error');
});
