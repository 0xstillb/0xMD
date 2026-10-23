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
  view: null,
};

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
  const doc = state.view?.state.doc;
  if (!doc) return;

  const text = doc.textBetween(0, doc.content.size, ' ', ' ');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;

  el.statusWords.textContent = `${words} word${words === 1 ? '' : 's'} · ${chars} char${chars === 1 ? '' : 's'}`;
  el.statusPath.textContent = `${state.dirty ? '● ' : ''}${state.fileName}${state.filePath ? '' : ' — unsaved'}`;
  el.statusOutline.textContent = state.outline.length ? `${state.outline.length} headings` : '';
}

/* ------------------------------------------------------------------ *
 * Outline
 * ------------------------------------------------------------------ */

function refreshOutline() {
  if (!state.view) return;
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

    const doc = parseMarkdown(file.content);
    if (state.view) {
      state.view.dispatch(state.view.state.tr.replaceWith(0, state.view.state.doc.content.size, doc.content));
      state.view.state.doc.setAttribute?.('data-file', file.path);
    }
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

async function saveDocument({ forceAs = false } = {}) {
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
  const title = state.fileName.replace(/\.mdx?$/i, '');

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

const mcpCommands = {
  async open_document({ path }) {
    await openDocument(path);
    return { path: state.filePath, name: state.fileName };
  },
  read_document() {
    return { path: state.filePath, markdown: currentMarkdown() };
  },
  get_outline() {
    return state.outline.map((h) => ({ level: h.level, text: h.text, position: h.pos }));
  },
  get_selection() {
    const { from, to } = state.view.state.selection;
    return { text: state.view.state.doc.textBetween(from, to, ' '), from, to };
  },
  insert_text({ text }) {
    state.view.dispatch(state.view.state.tr.insertText(text));
    return { ok: true };
  },
  replace_selection({ text }) {
    const { from, to } = state.view.state.selection;
    state.view.dispatch(state.view.state.tr.insertText(text, from, to));
    return { ok: true };
  },
  append_text({ text }) {
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
      state.dirty = true;
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
      if (file) {
        state.filePath = file.path;
        state.fileName = file.name;
        state.dirty = false;
        const parsed = parseMarkdown(file.content);
        state.view.dispatch(state.view.state.tr.replaceWith(0, state.view.state.doc.content.size, parsed.content));
        document.title = `${file.name} — 0xMD`;
        api.recentAdd(file.path);
        state.recent = await api.recentList();
        api.watch([file.path]);
        refreshOutline();
        updateStatus();
      }
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

function openPreferences() {  openSettings({
    modal: el.settingsModal,
    body: el.settingsBody,
    settings: state.settings,
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
}

function setupMenuActions() {
  api.onMenuAction(async ({ action, payload }) => {
    switch (action) {
      case 'file.new':
        state.filePath = null;
        state.fileName = 'Untitled';
        state.dirty = false;
        state.view.dispatch(state.view.state.tr.replaceWith(0, state.view.state.doc.content.size, parseMarkdown('').content));
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
    if (!/\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(file.name)) {
      toast('Only Markdown files can be opened.', 'error');
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
