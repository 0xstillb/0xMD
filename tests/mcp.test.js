// End-to-end test of the 0xMD MCP server.
//
// Boots the real app, connects a real MCP client over Streamable HTTP and
// exercises the tools. Nothing is stubbed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createZip } from '../tools/zip-writer.js';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const PORT = Number(process.env['0XMD_TEST_MCP_PORT'] || 7341);
const URL_BASE = `http://127.0.0.1:${PORT}/mcp`;

// Each test gets its own profile directory, otherwise Electron's
// single-instance lock makes the second app quit straight away.
const userDataDir = path.join(os.tmpdir(), `0xmd-test-mcp-${PORT}`);

let app = null;

/** Boot the app and wait until the MCP server answers. */
const logs = [];

async function boot() {
  app = spawn(electronPath, ['.', `--user-data-dir=${userDataDir}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', '0XMD_MCP_PORT': String(PORT) },
  });

  app.stdout.on('data', (chunk) => logs.push(String(chunk)));
  app.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }),
      });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  throw new Error(`MCP server did not come up in time:\n${logs.join('')}`);
}

function stop() {
  if (app && !app.killed) app.kill();
  app = null;
}

test('MCP server exposes the 0xMD tools and can edit the document', async (t) => {
  await boot();
  t.after(stop);

  const client = new Client({ name: '0xmd-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(URL_BASE));
  try {
    await client.connect(transport);
  } catch (err) {
    throw new Error(`connect failed: ${err?.message || err}\n--- app log ---\n${logs.join('')}`);
  }
  t.after(() => client.close());

  // ---- tools are advertised --------------------------------------------
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const expected of [
    'open_document', 'read_document', 'get_outline', 'list_documents',
    'read_file', 'search_documents', 'insert_text', 'replace_selection',
    'append_text', 'save_document', 'export_document', 'set_theme', 'get_app_info',
  ]) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }

  // ---- the open document is exposed as a resource ----------------------
  const { resources } = await client.listResources();
  const uris = resources.map((resource) => resource.uri);
  assert.ok(uris.includes('oxmd://document/current'), 'document resource missing');

  // ---- editing through the editor --------------------------------------
  const before = await client.callTool({ name: 'read_document', arguments: {} });
  const beforeText = JSON.parse(before.content[0].text).markdown;

  await client.callTool({ name: 'insert_text', arguments: { text: 'MCP was here.\n' } });

  const after = await client.callTool({ name: 'read_document', arguments: {} });
  const afterText = JSON.parse(after.content[0].text).markdown;
  assert.ok(afterText.includes('MCP was here.'), 'insert_text did not reach the document');
  assert.ok(afterText.length > beforeText.length);

  // ---- appending and replacing ----------------------------------------
  await client.callTool({ name: 'append_text', arguments: { text: '\nAppended by MCP.\n' } });
  const appended = await client.callTool({ name: 'read_document', arguments: {} });
  assert.ok(JSON.parse(appended.content[0].text).markdown.includes('Appended by MCP.'));

  // ---- theme switching --------------------------------------------------
  const themed = await client.callTool({ name: 'set_theme', arguments: { theme: 'night' } });
  assert.equal(JSON.parse(themed.content[0].text).theme, 'night');
  await client.callTool({ name: 'set_theme', arguments: { theme: 'github' } });

  // ---- app info ---------------------------------------------------------
  const info = await client.callTool({ name: 'get_app_info', arguments: {} });
  const parsed = JSON.parse(info.content[0].text);
  assert.equal(parsed.name, '0xMD');
  assert.equal(parsed.mcp.transport, 'streamable-http');

  // ---- the document resource carries the markdown -----------------------
  const resource = await client.readResource({ uri: 'oxmd://document/current' });
  assert.ok(resource.contents[0].text.includes('MCP was here.'));
  assert.equal(resource.contents[0].mimeType, 'text/markdown');

  // ---- an EPUB package is read as a structure ---------------------------
  const opfPath = path.join(os.tmpdir(), '0xmd-test-package.opf');
  await fs.writeFile(
    opfPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">',
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
      '    <dc:identifier id="pub-id">urn:uuid:mcp</dc:identifier>',
      '    <dc:title>MCP Book</dc:title>',
      '    <dc:creator>Ada Lovelace</dc:creator>',
      '    <dc:language>en</dc:language>',
      '  </metadata>',
      '  <manifest>',
      '    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
      '    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>',
      '  </manifest>',
      '  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>',
      '</package>',
    ].join('\n'),
    'utf8',
  );

  const packageResult = await client.callTool({ name: 'read_file', arguments: { path: opfPath } });
  const packageData = JSON.parse(packageResult.content[0].text);
  assert.equal(packageData.kind, 'epub-package');
  assert.equal(packageData.package.title, 'MCP Book');
  assert.equal(packageData.package.manifest.length, 2);
  assert.equal(packageData.package.spine.length, 2);
  assert.ok(packageData.markdown.includes('# MCP Book'));

  // ---- a Markdown file is still read as Markdown ------------------------
  const mdPath = path.join(os.tmpdir(), '0xmd-test-note.md');
  await fs.writeFile(mdPath, '# A note\n', 'utf8');
  const mdResult = await client.callTool({ name: 'read_file', arguments: { path: mdPath } });
  assert.equal(JSON.parse(mdResult.content[0].text).markdown, '# A note\n');

  // ---- an EPUB book is read as a book ----------------------------------
  const bookPath = path.join(os.tmpdir(), '0xmd-test-book.epub');
  await fs.writeFile(bookPath, createZip([
    { name: 'mimetype', content: 'application/epub+zip', compress: false },
    {
      name: 'META-INF/container.xml',
      content: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
        + '<rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: 'content.opf',
      content: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
        + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        + '<dc:identifier id="id">urn:uuid:mcp</dc:identifier><dc:title>MCP Book</dc:title>'
        + '<dc:language>en</dc:language></metadata>'
        + '<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest>'
        + '<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    },
    {
      name: 'c1.xhtml',
      content: '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>'
        + '<body><h1>Chapter One</h1><p>It was a <em>quiet</em> morning.</p></body></html>',
    },
    {
      name: 'c2.xhtml',
      content: '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head>'
        + '<body><h1>Chapter Two</h1><p>The glass fell half a degree.</p></body></html>',
    },
  ]), 'utf8');

  const bookResult = await client.callTool({ name: 'read_file', arguments: { path: bookPath } });
  const bookData = JSON.parse(bookResult.content[0].text);
  assert.equal(bookData.kind, 'epub-book');
  assert.equal(bookData.book.title, 'MCP Book');
  assert.equal(bookData.book.chapters.length, 2);

  const chapterResult = await client.callTool({ name: 'read_epub_chapter', arguments: { path: bookPath, index: 1 } });
  const chapterData = JSON.parse(chapterResult.content[0].text);
  assert.ok(chapterData.markdown.includes('# Chapter Two'), chapterData.markdown);
  assert.ok(chapterData.markdown.includes('half a degree'), chapterData.markdown);

  const firstChapter = await client.callTool({ name: 'read_epub_chapter', arguments: { path: bookPath, href: 'c1.xhtml' } });
  assert.ok(JSON.parse(firstChapter.content[0].text).markdown.includes('*quiet*'));
});
