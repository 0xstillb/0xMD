// 0xMD — Electron main process (ESM)
//
// Every line here is original work and every dependency is OSS
// (MIT/BSD/Apache). The app has no licence key and no telemetry.

import { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import iconv from 'iconv-lite';
import { SMOKE_SCRIPT } from './smoke.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
// Dev mode is only on when a dev server URL was handed to us (scripts/dev.js).
const IS_DEV = !!process.env.VITE_DEV_SERVER_URL;

const MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.mkdn', '.txt'];
const MAX_FILE_BYTES = 64 * 1024 * 1024; // refuse "oversize" files

let mainWindow = null;
let watcher = null;
let settings = null;
// Cached folder tree, handed to the MCP server so it can list documents.
let folderTreeCache = [];
// A document / folder the app was launched with.
let startupFile = null;
let startupFolder = null;

/* ------------------------------------------------------------------ *
 * Settings store — small atomic JSON file, no dependency required.
 * ------------------------------------------------------------------ */

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  theme: 'github',
  themeDark: false,
  fontFamily: '', // empty = follow the theme
  fontSize: 16,
  lineHeight: 1.6,
  contentWidth: 0, // 0 = use the width the theme defines
  codeTheme: 'github',
  showLineNumbers: false,
  showSidebar: true,
  sidebarWidth: 260,
  autoHideSidebar: false,
  spellcheck: false,
  typographer: true,
  mermaidLazy: true,
  katexEnabled: true,
  mermaidEnabled: true,
  imageFolder: '',
  recentFiles: [],
  lastFolder: '',
  mcpEnabled: true,
  mcpPort: 7331,
  window: { width: 1280, height: 820, x: undefined, y: undefined, maximized: false },
  editor: {
    smartTyping: true,
    autoPairBrackets: true,
    keepLineBreaks: false,
    showMarkdownSyntax: 'active', // active | all | none
    mathEngine: 'katex',
  },
};

async function loadSettings() {
  if (settings) return settings;
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    settings = deepMerge(structuredClone(defaultSettings), JSON.parse(raw));
    settings = migrateSettings(settings);
  } catch {
    settings = structuredClone(defaultSettings);
  }
  return settings;
}

/**
 * Bring settings written by an older build in line with the current
 * defaults, so an upgrade does not keep stale layout values.
 */
function migrateSettings(saved) {
  // 820px was the old fixed column; 0 means "use the theme's width".
  if (saved.contentWidth === 820) saved.contentWidth = 0;
  // The old default font stack is now what the themes provide themselves.
  if (saved.fontFamily === 'Open Sans, Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif') {
    saved.fontFamily = '';
  }
  return saved;
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

async function saveSettings(patch) {
  const current = await loadSettings();
  settings = deepMerge(current, patch);
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  const tmp = `${settingsPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(tmp, settingsPath());
  return settings;
}

/* ------------------------------------------------------------------ *
 * Encoding detection — so GBK / Big5 / Shift-JIS files open correctly.
 * ------------------------------------------------------------------ */

function decodeBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { content: buf.slice(3).toString('utf8'), encoding: 'utf-8-bom' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { content: iconv.decode(buf.slice(2), 'utf16-le'), encoding: 'utf-16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { content: iconv.decode(buf.slice(2), 'utf16-be'), encoding: 'utf16-be' };
  }
  // Strict UTF-8 probe: if it throws, the file is almost certainly a legacy CJK codepage.
  try {
    return { content: buf.toString('utf8'), encoding: 'utf-8' };
  } catch {
    for (const enc of ['gb18030', 'big5', 'shift_jis', 'euc-kr', 'windows-1252']) {
      try {
        const decoded = iconv.decode(buf, enc);
        if (!decoded.includes('\uFFFD')) return { content: decoded, encoding: enc };
      } catch { /* try next */ }
    }
    return { content: buf.toString('utf8'), encoding: 'utf-8 (lossy)' };
  }
}

async function readMarkdownFile(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large to render (${(stat.size / 1048576).toFixed(1)} MB).`);
  }
  const buf = await fs.readFile(filePath);
  const { content, encoding } = decodeBuffer(buf);
  return { path: filePath, name: path.basename(filePath), content, encoding, size: stat.size, mtime: stat.mtimeMs };
}

async function writeMarkdownFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf8');
  const stat = await fs.stat(filePath);
  return { path: filePath, mtime: stat.mtimeMs };
}

/** Render an HTML string to a PDF file with Electron's print pipeline. */
async function renderPdfToFile(html, filePath) {
  const tmp = path.join(app.getPath('temp'), `0xmd-export-${Date.now()}.html`);
  await fs.writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    await fs.writeFile(filePath, pdf);
  } finally {
    win.destroy();
    await fs.unlink(tmp).catch(() => {});
  }
  return filePath;
}

/* ------------------------------------------------------------------ *
 * Folder tree — the "Files" sidebar.
 * ------------------------------------------------------------------ */

async function buildFolderTree(root, depth = 0) {
  if (depth > 8) return [];
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const children = await buildFolderTree(full, depth + 1);
      if (children.length) nodes.push({ type: 'dir', name: entry.name, path: full, children });
    } else if (MD_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      const stat = await fs.stat(full);
      nodes.push({ type: 'file', name: entry.name, path: full, mtime: stat.mtimeMs, size: stat.size });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  return nodes;
}

/* ------------------------------------------------------------------ *
 * File watching — chokidar, so external edits reload live.
 * ------------------------------------------------------------------ */

let stopWatchingImpl = async () => {};
async function initWatcher() {
  const mod = await import('./watcher.js');
  stopWatchingImpl = mod.stopWatching;
}

/* ------------------------------------------------------------------ *
 * Opening a document from the command line / file association.
 * ------------------------------------------------------------------ */

function markdownFileFromArgv(argv) {
  return argv
    .slice(1)
    .find((arg) => !arg.startsWith('-') && arg !== '.' && /\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(arg));
}

function folderFromArgv(argv) {
  return argv
    .slice(1)
    .find((arg) => !arg.startsWith('-') && arg !== '.' && !/\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(arg) && existsSync(arg));
}

// Resolved at import time so the renderer never races the main process.
startupFile = markdownFileFromArgv(process.argv);
startupFolder = folderFromArgv(process.argv);

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

async function createWindow() {
  const saved = (await loadSettings()).window ?? defaultSettings.window;

  mainWindow = new BrowserWindow({
    width: saved.width || 1280,
    height: saved.height || 820,
    x: saved.x,
    y: saved.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#ffffff',
    title: '0xMD',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (saved.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (IS_DEV) {
    await mainWindow.loadURL(DEV_SERVER);
  } else {
    await mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }

  // Persist window state.
  const saveState = debounce(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getNormalBounds();
    await saveSettings({ window: { ...bounds, maximized: mainWindow.isMaximized() } });
  }, 400);
  mainWindow.on('resize', saveState);
  mainWindow.on('move', saveState);
  mainWindow.on('maximize', saveState);
  mainWindow.on('unmaximize', saveState);

  // External links open in the OS browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/^https?:/.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Surface renderer errors on stdout while smoke testing.
  if (process.env['0XMD_VERBOSE']) {
    mainWindow.webContents.on('console-message', (...args) => {
      const [event, ...rest] = args;
      if (event && typeof event === 'object' && 'message' in event) {
        console.log(`[renderer] ${event.level}: ${event.message}`);
      } else {
        const [, level, message] = args;
        console.log(`[renderer] ${level}: ${message}`);
      }
    });
  }

  if (process.env['0XMD_SMOKE']) {
    mainWindow.webContents.on('console-message', (...args) => {
      const [event, ...rest] = args;
      if (event && typeof event === 'object' && 'message' in event) {
        console.error(`[renderer] ${event.level}: ${event.message} (${event.sourceId}:${event.lineNumber})`);
      } else {
        const [, level, message, line, sourceId] = args;
        console.error(`[renderer] ${level}: ${message} (${sourceId}:${line})`);
      }
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] process gone:', JSON.stringify(details));
    });
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('[preload] error:', preloadPath, error);
    });
  }
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ------------------------------------------------------------------ *
 * Native menu.
 * ------------------------------------------------------------------ */

function send(action, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', { action, payload });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => send('file.new') },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: () => send('file.open') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('file.openFolder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('file.save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('file.saveAs') },
        { type: 'separator' },
        { label: 'Export as HTML…', click: () => send('file.exportHtml') },
        { label: 'Export as PDF…', click: () => send('file.exportPdf') },
        { type: 'separator' },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => send('edit.find') },
        { label: 'Quick Open…', accelerator: 'CmdOrCtrl+P', click: () => send('edit.quickOpen') },
        { type: 'separator' },
        { label: 'Source Code Mode', accelerator: 'CmdOrCtrl+/', click: () => send('edit.sourceMode') },
        { label: 'Toggle Word Count', accelerator: 'CmdOrCtrl+Shift+W', click: () => send('edit.wordCount') },
      ],
    },
    {
      label: 'Paragraph',
      submenu: [
        { label: 'Paragraph', click: () => send('format.paragraph') },
        { label: 'Heading 1', click: () => send('format.heading', 1) },
        { label: 'Heading 2', click: () => send('format.heading', 2) },
        { label: 'Heading 3', click: () => send('format.heading', 3) },
        { label: 'Heading 4', click: () => send('format.heading', 4) },
        { label: 'Heading 5', click: () => send('format.heading', 5) },
        { label: 'Heading 6', click: () => send('format.heading', 6) },
        { type: 'separator' },
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => send('format.bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => send('format.italic') },
        { label: 'Strikethrough', accelerator: 'CmdOrCtrl+Shift+X', click: () => send('format.strikethrough') },
        { label: 'Highlight', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('format.highlight') },
        { label: 'Inline Code', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('format.code') },
        { label: 'Insert Link…', accelerator: 'CmdOrCtrl+K', click: () => send('format.link') },
        { label: 'Insert Image…', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('format.image') },
        { type: 'separator' },
        { label: 'Bullet List', click: () => send('format.bulletList') },
        { label: 'Ordered List', click: () => send('format.orderedList') },
        { label: 'Task List', click: () => send('format.taskList') },
        { label: 'Quote', accelerator: 'CmdOrCtrl+Shift+Q', click: () => send('format.quote') },
        { type: 'separator' },
        { label: 'Insert Math', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('format.math') },
        { label: 'Insert Mermaid Diagram', click: () => send('format.mermaid') },
      ],
    },
    {
      label: 'Format',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => send('format.bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => send('format.italic') },
        { label: 'Strikethrough', click: () => send('format.strikethrough') },
        { label: 'Highlight', click: () => send('format.highlight') },
        { label: 'Inline Code', click: () => send('format.code') },
        { label: 'Underline', click: () => send('format.underline') },
        { label: 'Subscript', click: () => send('format.subscript') },
        { label: 'Superscript', click: () => send('format.superscript') },
      ],
    },
    {
      label: 'Themes',
      submenu: [
        { label: 'GitHub', click: () => send('theme.set', 'github') },
        { label: 'Newsprint', click: () => send('theme.set', 'newsprint') },
        { label: 'Night', click: () => send('theme.set', 'night') },
        { label: 'Pixyll', click: () => send('theme.set', 'pixyll') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('view.sidebar') },
        { label: 'Toggle Full Screen', accelerator: 'F11', click: () => send('view.fullscreen') },
        { type: 'separator' },
        { label: 'Actual Size', click: () => send('view.zoom', 1) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => send('view.zoomIn') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('view.zoomOut') },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => send('view.preferences') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Markdown Guide', click: () => send('help.markdown') },
        { label: 'About 0xMD', click: () => send('help.about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ *
 * MCP bridge — the MCP server lives here, the editor work happens in the
 * renderer. Commands are sent over IPC and the result comes back.
 * ------------------------------------------------------------------ */

const mcpPending = new Map();
let mcpCounter = 0;

function callRenderer(command, args = {}) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      reject(new Error('0xMD has no open window.'));
      return;
    }
    const id = ++mcpCounter;
    const timer = setTimeout(() => {
      mcpPending.delete(id);
      reject(new Error(`Renderer did not answer "${command}" in time.`));
    }, 20000);

    mcpPending.set(id, (payload) => {
      clearTimeout(timer);
      mcpPending.delete(id);
      if (payload?.ok) resolve(payload.result);
      else reject(new Error(payload?.error || 'Unknown renderer error'));
    });

    mainWindow.webContents.send('mcp:command', { id, command, args });
  });
}

ipcMain.on('mcp:result', (_event, { id, result }) => {
  const settle = mcpPending.get(id);
  if (settle) settle(result);
});

/* ------------------------------------------------------------------ *
 * MCP server lifecycle — it can be switched on and off at runtime.
 * ------------------------------------------------------------------ */

let mcpStatus = { running: false, port: null, error: null };

function broadcastMcpStatus(status) {
  mcpStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mcp:status', status);
}

/**
 * (Re)start the MCP server according to the current settings.
 * @returns {Promise<{running: boolean, port?: number, error?: string}>}
 */
async function applyMcpSettings(options = {}) {
  const settings = await loadSettings();
  // Accept both the plain shape and the persisted-settings shape.
  const enabled = options.enabled ?? options.mcpEnabled;
  const port = options.port ?? options.mcpPort;
  const wantEnabled = enabled ?? settings.mcpEnabled !== false;
  // An explicit request wins; the environment variable comes next, so a
  // second instance can be pointed at a different port (used by the tests).
  const wantPort = Number(port) || Number(process.env['0XMD_MCP_PORT']) || Number(settings.mcpPort ?? 7331);

  try {
    const { stopMcpServer, startMcpServer } = await import('./mcp.js');
    console.log('[0xMD] MCP: stopping (want enabled=' + wantEnabled + ', port=' + wantPort + ')');
    await stopMcpServer();
    console.log('[0xMD] MCP: stopped');

    if (!wantEnabled) {
      broadcastMcpStatus({ running: false, port: null, reason: 'disabled' });
      return { running: false };
    }

    const started = await startMcpServer({
      port: wantPort,
      callRenderer,
      getContext: () => ({
        folderRoot: settings.lastFolder || null,
        folderTree: folderTreeCache,
      }),
    });

    console.log('[0xMD] MCP: started on ' + started.port);
    broadcastMcpStatus({ running: true, port: started.port });
    console.log(`[0xMD] MCP server listening on http://127.0.0.1:${started.port}/mcp`);
    return { running: true, port: started.port };
  } catch (err) {
    const message = String(err?.message || err);
    broadcastMcpStatus({ running: false, port: null, error: message });
    console.error('[0xMD] MCP server failed to start:', message);
    return { running: false, error: message };
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:info', async () => {
    const s = await loadSettings();
    return {
      version: app.getVersion(),
      name: app.getName(),
      platform: process.platform,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      settings: s,
    };
  });

  // The document or folder the app was launched with, if any.
  ipcMain.handle('app:startup', () => ({
    file: startupFile ? path.resolve(startupFile) : null,
    folder: startupFolder ? path.resolve(startupFolder) : null,
  }));

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', async (_e, patch) => saveSettings(patch));

  ipcMain.handle('dialog:openFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Markdown File',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'mkdn'] },
        { name: 'Text', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return readMarkdownFile(res.filePaths[0]);
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const root = res.filePaths[0];
    const tree = await buildFolderTree(root);
    folderTreeCache = tree;
    return { root, tree };
  });

  ipcMain.handle('file:read', async (_e, filePath) => readMarkdownFile(filePath));
  ipcMain.handle('file:save', async (_e, { filePath, content }) => writeMarkdownFile(filePath, content));
  ipcMain.handle('file:reveal', async (_e, filePath) => { shell.showItemInFolder(filePath); });

  ipcMain.handle('dialog:saveFile', async (_e, { content, suggestedName }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Markdown File',
      defaultPath: path.join(app.getPath('documents'), suggestedName || 'untitled.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await writeMarkdownFile(res.filePath, content);
    return res.filePath;
  });

  ipcMain.handle('folder:tree', async (_e, root) => {
    const tree = await buildFolderTree(root);
    folderTreeCache = tree;
    return { root, tree };
  });

  ipcMain.handle('watch:set', async (_e, targets) => {
    await initWatcher();
    await stopWatchingImpl(watcher);
    watcher = null;
    if (!targets?.length) return;
    const { startWatching: start } = await import('./watcher.js');
    watcher = start(targets, (event, filePath) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file:changed', { event, path: filePath });
    });
  });

  ipcMain.handle('recent:list', async () => (await loadSettings()).recentFiles ?? []);
  ipcMain.handle('recent:add', async (_e, filePath) => {
    const s = await loadSettings();
    const list = (s.recentFiles ?? []).filter((p) => p !== filePath);
    list.unshift(filePath);
    await saveSettings({ recentFiles: list.slice(0, 12) });
    return list;
  });
  ipcMain.handle('recent:clear', async () => { await saveSettings({ recentFiles: [] }); return []; });

  ipcMain.handle('export:html', async (_e, { html, suggestedName }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export as HTML',
      defaultPath: path.join(app.getPath('documents'), suggestedName || 'document.html'),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, html, 'utf8');
    return res.filePath;
  });

  ipcMain.handle('export:pdf', async (_e, { html, suggestedName }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export as PDF',
      defaultPath: path.join(app.getPath('documents'), suggestedName || 'document.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await renderPdfToFile(html, res.filePath);
    return res.filePath;
  });

  // Direct (non-dialog) export, used by the MCP server.
  ipcMain.handle('export:write', async (_e, { filePath, html }) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, html, 'utf8');
    return filePath;
  });

  ipcMain.handle('export:pdfTo', async (_e, { filePath, html }) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await renderPdfToFile(html, filePath);
    return filePath;
  });

  ipcMain.handle('theme:set', async (_e, { theme, dark }) => {
    nativeTheme.themeSource = dark ? 'dark' : 'light';
    await saveSettings({ theme, themeDark: dark });
    return true;
  });

  // ---- MCP ---------------------------------------------------------------
  ipcMain.handle('mcp:status', () => mcpStatus);

  ipcMain.handle('mcp:configure', async (_e, config) => {
    const patch = {};
    if (typeof config?.enabled === 'boolean') patch.mcpEnabled = config.enabled;
    if (Number.isFinite(Number(config?.port))) patch.mcpPort = Number(config.port);
    if (Object.keys(patch).length) await saveSettings(patch);
    return applyMcpSettings(patch);
  });

  // A snippet the user can paste into an MCP client configuration.
  ipcMain.handle('mcp:clientConfig', async () => {
    const settings = await loadSettings();
    const port = settings.mcpPort || 7331;
    return {
      url: `http://127.0.0.1:${port}/mcp`,
      config: JSON.stringify({ mcpServers: { '0xmd': { url: `http://127.0.0.1:${port}/mcp` } } }, null, 2),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setName('0xMD');
    await loadSettings();
    await initWatcher();
    registerIpc();
    buildMenu();
    await createWindow();

    // The MCP server binds to localhost only and can be switched off.
    await applyMcpSettings();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });

    // Automated smoke test: drive the real app, assert on the real DOM.
    if (process.env['0XMD_SMOKE']) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const result = await mainWindow.webContents.executeJavaScript(SMOKE_SCRIPT, true);
        console.log(`SMOKE_RESULT ${JSON.stringify(result)}`);
        app.exit(result.ok ? 0 : 1);
      } catch (err) {
        console.error('SMOKE_RESULT', JSON.stringify({ ok: false, error: String(err?.message || err) }));
        app.exit(1);
      }
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await stopWatchingImpl(watcher).catch(() => {});
  try {
    const { stopMcpServer } = await import('./mcp.js');
    await stopMcpServer();
  } catch { /* not started */ }
});
