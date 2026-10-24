// 0xMD — MCP server.
//
// Exposes the running editor over the Model Context Protocol so an AI agent
// can read the open document, browse the folder and edit the text.
//
// Transport: Streamable HTTP, bound to 127.0.0.1 only.
//
//   POST http://127.0.0.1:7331/mcp   → JSON-RPC
//   GET  http://127.0.0.1:7331/mcp   → server→client stream
//
// Every editor mutation is executed as a ProseMirror transaction inside the
// renderer, so undo history stays intact and the document never gets
// corrupted by a partially applied change.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
// The EPUB package reader is shared with the renderer — it is plain data in,
// plain data out, so both processes can use it.
import { parseOpf, opfToMarkdown, isOpfPath } from '../src/core/opf/opf.js';
import { isEpubPath, readEpubStructure } from '../src/core/epub/container.js';
import { ZipArchive } from './zip.js';

const MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt'];

let serverFactory = null;
let httpServer = null;
let currentPort = null;

/**
 * Build a fully configured MCP server. A fresh instance is created for every
 * request, which is the stateless pattern the SDK recommends.
 */
function buildServer({ callRenderer, getContext }) {
  const server = new McpServer(
    { name: '0xmd', version: '1.0.0' },
    {
      instructions:
        '0xMD is a Markdown editor whose rendered document is the editor. '
        + 'Use `read_document` to read the open file, '
        + '`list_documents` to browse the opened folder, and `insert_text` / `replace_selection` '
        + 'to edit. The markdown on disk is the source of truth.',
    },
  );

  const ok = (result) => ({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
  const fail = (error) => ({ content: [{ type: 'text', text: `Error: ${error?.message || error}` }], isError: true });

  /* ---------------- tools ---------------- */

  server.registerTool(
    'open_document',
    {
      title: 'Open a Markdown document',
      description: 'Opens a .md file in the editor and returns its path.',
      inputSchema: { path: z.string().describe('Absolute path of the Markdown file') },
    },
    async ({ path: filePath }) => {
      try {
        return ok(await callRenderer('open_document', { path: filePath }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'read_document',
    {
      title: 'Read the open document',
      description: 'Returns the full Markdown source of the document currently open in 0xMD.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('read_document', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_outline',
    {
      title: 'Get the document outline',
      description: 'Returns the heading tree of the open document.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('get_outline', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List documents in the opened folder',
      description: 'Returns every Markdown file inside the folder that is currently open.',
      inputSchema: {},
    },
    async () => {
      try {
        const tree = getContext().folderTree || [];
        const files = [];
        const walk = (nodes, prefix = '') => {
          for (const node of nodes) {
            if (node.type === 'dir') walk(node.children, `${prefix}${node.name}/`);
            else files.push({ path: node.path, name: node.name, location: `${prefix}${node.name}` });
          }
        };
        walk(tree);
        return ok(files);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read a file from disk',
      description: 'Reads any Markdown file from disk without opening it in the editor. An EPUB package (.opf) comes back as its parsed structure, an EPUB book (.epub) as its table of contents.',
      inputSchema: { path: z.string().describe('Absolute path of the file') },
    },
    async ({ path: filePath }) => {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        if (isOpfPath(filePath)) {
          const model = parseOpf(content);
          return ok({
            path: filePath,
            kind: 'epub-package',
            markdown: opfToMarkdown(model),
            package: {
              version: model.version,
              title: model.metadata.title,
              language: model.metadata.language,
              creators: model.metadata.creators.map((person) => person.name),
              manifest: model.manifest.map((item) => ({
                id: item.id,
                href: item.href,
                mediaType: item.mediaType,
                properties: item.properties,
              })),
              spine: model.spine.items.map((item) => ({ idref: item.idref, href: item.href, linear: item.linear })),
              guide: model.guide,
            },
          });
        }
        if (isEpubPath(filePath)) {
          const archive = new ZipArchive(await fs.readFile(filePath));
          const structure = readEpubStructure(archive, parseOpf);
          return ok({
            path: filePath,
            kind: 'epub-book',
            markdown: opfToMarkdown(structure.package),
            book: {
              version: structure.package.version,
              title: structure.package.metadata.title,
              language: structure.package.metadata.language,
              creators: structure.package.metadata.creators.map((person) => person.name),
              chapters: structure.chapters.map((chapter) => ({
                index: chapter.index,
                title: chapter.title,
                href: chapter.href,
                path: chapter.path,
              })),
            },
          });
        }
        return ok({ path: filePath, markdown: content });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'read_epub_chapter',
    {
      title: 'Read a chapter of an EPUB book',
      description: 'Reads one chapter of an EPUB book and returns it as Markdown. Use `read_file` on the book first to see its chapters.',
      inputSchema: {
        path: z.string().describe('Absolute path of the .epub file'),
        index: z.number().optional().describe('The number of the chapter (default 0)'),
        href: z.string().optional().describe('The href of the chapter, as listed by read_file'),
      },
    },
    async ({ path: filePath, index = 0, href }) => {
      try {
        return ok(await callRenderer('read_epub_chapter', { path: filePath, index, href }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'search_documents',
    {
      title: 'Search the opened folder',
      description: 'Greps every Markdown file in the opened folder for a string.',
      inputSchema: {
        query: z.string().describe('Text to search for'),
        limit: z.number().optional().describe('Maximum number of hits to return (default 50)'),
      },
    },
    async ({ query, limit = 50 }) => {
      try {
        const { folderRoot, folderTree } = getContext();
        if (!folderRoot) return ok({ message: 'No folder is open in 0xMD.', hits: [] });

        const hits = [];
        const walk = async (nodes) => {
          for (const node of nodes) {
            if (hits.length >= limit) return;
            if (node.type === 'dir') {
              await walk(node.children);
              continue;
            }
            // Only the text documents are searched — a package or an image
            // would only add noise.
            const extension = node.path.slice(node.path.lastIndexOf('.')).toLowerCase();
            if (!MD_EXTENSIONS.includes(extension)) continue;
            try {
              const content = await fs.readFile(node.path, 'utf8');
              const lines = content.split(/\r?\n/);
              lines.forEach((line, index) => {
                if (hits.length >= limit) return;
                if (line.includes(query)) {
                  hits.push({ path: node.path, line: index + 1, text: line.trim().slice(0, 300) });
                }
              });
            } catch { /* unreadable file */ }
          }
        };
        await walk(folderTree);
        return ok({ query, hits });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'insert_text',
    {
      title: 'Insert text at the cursor',
      description: 'Inserts text at the current cursor position in the open document.',
      inputSchema: { text: z.string().describe('Text to insert') },
    },
    async ({ text }) => {
      try {
        return ok(await callRenderer('insert_text', { text }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'replace_selection',
    {
      title: 'Replace the current selection',
      description: 'Replaces the selected text in the open document.',
      inputSchema: { text: z.string().describe('Replacement text') },
    },
    async ({ text }) => {
      try {
        return ok(await callRenderer('replace_selection', { text }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'append_text',
    {
      title: 'Append text to the document',
      description: 'Appends text at the end of the open document.',
      inputSchema: { text: z.string().describe('Text to append') },
    },
    async ({ text }) => {
      try {
        return ok(await callRenderer('append_text', { text }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'save_document',
    {
      title: 'Save the open document',
      description: 'Writes the current editor content back to the file on disk.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('save_document', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'export_document',
    {
      title: 'Export the document',
      description: 'Exports the open document as a standalone HTML or PDF file.',
      inputSchema: {
        format: z.enum(['html', 'pdf']).describe('Output format'),
        directory: z.string().optional().describe('Target directory (defaults to the Documents folder)'),
      },
    },
    async ({ format, directory }) => {
      try {
        return ok(await callRenderer('export_document', { format, directory }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'set_theme',
    {
      title: 'Change the theme',
      description: 'Switches the 0xMD colour theme.',
      inputSchema: {
        theme: z.enum(['github', 'night', 'newsprint', 'pixyll']).optional(),
        dark: z.boolean().optional(),
      },
    },
    async ({ theme, dark }) => {
      try {
        return ok(await callRenderer('set_theme', { theme, dark }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'open_preferences',
    {
      title: 'Open the preferences dialog',
      description: 'Opens the 0xMD preferences window (themes, typography, features).',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('open_preferences', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'open_find',
    {
      title: 'Open find & replace',
      description: 'Opens the in-document find and replace bar.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('open_find', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'open_about',
    {
      title: 'Open the about dialog',
      description: 'Opens the 0xMD about window (version, licence, credits).',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('open_about', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'toggle_sidebar',
    {
      title: 'Show or hide the sidebar',
      description: 'Toggles the file tree / outline / search sidebar.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('toggle_sidebar', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'configure_mcp',
    {
      title: 'Configure the MCP server',
      description:
        'Switches the MCP server on or off, or moves it to another port. '
        + 'Switching it off ends this connection — use the preferences to bring it back.',
      inputSchema: {
        enabled: z.boolean().optional().describe('Start or stop the server'),
        port: z.number().optional().describe('New port (the server restarts on it)'),
      },
    },
    async ({ enabled, port }) => {
      try {
        const result = await callRenderer('configure_mcp', { enabled, port });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'check_updates',
    {
      title: 'Check for updates',
      description: 'Looks for a newer 0xMD release on GitHub.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('check_updates', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'register_file_associations',
    {
      title: 'Register the file associations',
      description:
        'Registers 0xMD as a handler for Markdown files, so it appears in the '
        + '"Open with" list of the file explorer.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await callRenderer('register_file_associations', {});
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_app_info',
    {
      title: 'Get application info',
      description: 'Returns the 0xMD version, the open file and the current settings.',
      inputSchema: {},
    },
    async () => {
      try {
        const info = await callRenderer('get_app_info', {});
        return ok({ ...info, mcp: { port: currentPort, running: !!currentPort, transport: 'streamable-http' } });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_settings',
    {
      title: 'Get the current settings',
      description: 'Returns the preferences 0xMD is currently using.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await callRenderer('get_settings', {}));
      } catch (err) {
        return fail(err);
      }
    },
  );

  /* ---------------- resources ---------------- */

  server.registerResource(
    'current-document',
    'oxmd://document/current',
    {
      title: 'Current document',
      description: 'The Markdown source of the document open in 0xMD.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      try {
        const doc = await callRenderer('read_document', {});
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: doc.markdown ?? '' }],
        };
      } catch (err) {
        return {
          contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Error: ${err?.message || err}` }],
        };
      }
    },
  );

  /* ---------------- transport ---------------- */

  return server;
}

/**
 * @param {object} options
 * @param {number} options.port
 * @param {(command: string, args: object) => Promise<any>} options.callRenderer
 * @param {() => object} options.getContext  filesystem facts the main process owns
 */
export async function startMcpServer({ port = 7331, callRenderer, getContext }) {
  if (httpServer) return { port: currentPort };

  serverFactory = () => buildServer({ callRenderer, getContext });

  httpServer = http.createServer(async (req, res) => {
    // Only local clients may talk to the editor.
    const remote = req.socket.remoteAddress || '';
    if (!/^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(remote)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('0xMD MCP server is local-only.');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (process.env['0XMD_MCP_DEBUG']) {
      console.log(`[mcp] ${req.method} ${url.pathname} from ${req.socket.remoteAddress} accept=${req.headers.accept}`);
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', hint: 'Use POST /mcp' }));
      return;
    }

    // Stateless mode: a fresh server + transport for every request, which is
    // the pattern the MCP SDK documents.
    const server = serverFactory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
      if (process.env['0XMD_MCP_DEBUG']) {
        console.log(`[mcp] ${req.method} ${url.pathname} -> ${res.statusCode}`);
      }
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', resolve);
  });

  currentPort = httpServer.address()?.port ?? port;
  return { port: currentPort };
}

export async function stopMcpServer() {
  const http = httpServer;
  httpServer = null;
  serverFactory = null;
  currentPort = null;
  if (!http) return;

  try {
    // An MCP client may keep an SSE stream open, and close() would then wait
    // for it forever — so the connections are dropped first.
    http.closeAllConnections?.();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      http.close(() => { clearTimeout(timer); resolve(); });
    });
  } catch { /* already closed */ }
}

export function mcpServerPort() {
  return currentPort;
}
