// End-to-end test of the 0xMD MCP server.
//
// Boots the real app, connects a real MCP client over Streamable HTTP and
// exercises the tools. Nothing is stubbed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
});
