// 0xMD — preload bridge (CommonJS, sandboxed).
//
// contextIsolation is ON and nodeIntegration is OFF, so the renderer only
// ever sees the narrow, explicit surface below.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  // ---- app -------------------------------------------------------------
  info: () => invoke('app:info'),
  startup: () => invoke('app:startup'),

  // ---- settings --------------------------------------------------------
  settingsGet: () => invoke('settings:get'),
  settingsSet: (patch) => invoke('settings:set', patch),

  // ---- files -----------------------------------------------------------
  openFileDialog: () => invoke('dialog:openFile'),
  openFolderDialog: () => invoke('dialog:openFolder'),
  readFile: (filePath) => invoke('file:read', filePath),
  saveFile: (filePath, content) => invoke('file:save', { filePath, content }),
  saveFileDialog: (content, suggestedName) => invoke('dialog:saveFile', { content, suggestedName }),
  revealFile: (filePath) => invoke('file:reveal', filePath),
  folderTree: (root) => invoke('folder:tree', root),

  // ---- MCP --------------------------------------------------------------
  // The MCP server lives in the main process; editor work is executed in the
  // renderer and the result travels back over this channel.
  mcpStatus: () => invoke('mcp:status'),
  configureMcp: (config) => invoke('mcp:configure', config),
  mcpClientConfig: () => invoke('mcp:clientConfig'),
  onMcpCommand: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('mcp:command', listener);
    return () => ipcRenderer.removeListener('mcp:command', listener);
  },
  mcpResult: (id, result) => ipcRenderer.send('mcp:result', { id, result }),
  onMcpStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('mcp:status', listener);
    return () => ipcRenderer.removeListener('mcp:status', listener);
  },

  // ---- watching --------------------------------------------------------
  watch: (targets) => invoke('watch:set', targets),

  // ---- recent ----------------------------------------------------------
  recentList: () => invoke('recent:list'),
  recentAdd: (filePath) => invoke('recent:add', filePath),
  recentClear: () => invoke('recent:clear'),

  // ---- export ----------------------------------------------------------
  exportHtml: (html, suggestedName) => invoke('export:html', { html, suggestedName }),
  exportPdf: (html, suggestedName) => invoke('export:pdf', { html, suggestedName }),
  exportWrite: (filePath, html) => invoke('export:write', { filePath, html }),
  exportPdfTo: (filePath, html) => invoke('export:pdfTo', { filePath, html }),

  // ---- theme -----------------------------------------------------------
  setTheme: (theme, dark) => invoke('theme:set', { theme, dark }),

  // ---- updates ---------------------------------------------------------
  checkForUpdates: () => invoke('update:check'),
  updateStatus: () => invoke('update:status'),

  // ---- events from main ------------------------------------------------
  onMenuAction: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
  onFileChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('file:changed', listener);
    return () => ipcRenderer.removeListener('file:changed', listener);
  },
});
