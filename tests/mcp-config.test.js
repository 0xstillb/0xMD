// The MCP server must be configurable: it can be moved to another port and
// switched on and off, while the app is running.

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

const PORT = Number(process.env['0XMD_TEST_MCP_PORT'] || 7342);
const BASE = `http://127.0.0.1:${PORT}`;

// Its own profile directory, so this test can run beside the others.
const userDataDir = path.join(os.tmpdir(), `0xmd-test-mcp-config-${PORT}`);

let app = null;

/** Is something answering on the MCP port? */
async function ping(port = PORT) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
      }),
    });
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

async function connect(port = PORT) {
  const client = new Client({ name: '0xmd-config-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  await client.connect(transport);
  return client;
}

test('the MCP server can be reconfigured at runtime', async (t) => {
  app = spawn(electronPath, ['.', `--user-data-dir=${userDataDir}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', '0XMD_MCP_PORT': String(PORT) },
  });
  app.stdout.on('data', () => {});
  app.stderr.on('data', () => {});
  t.after(() => { if (app && !app.killed) app.kill(); });

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (await ping()) break;
    await sleep(400);
  }
  assert.ok(await ping(), 'MCP server should be running after launch');

  const client = await connect();
  t.after(() => client.close());

  // ---- the configuration tool is advertised --------------------------------
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes('configure_mcp'), 'configure_mcp tool missing');

  // ---- it reports what it is doing ---------------------------------------
  const status = await client.callTool({ name: 'get_app_info', arguments: {} });
  const info = JSON.parse(status.content[0].text);
  assert.equal(info.mcp.running, true);
  assert.equal(info.mcp.port, PORT);

  // ---- moving it to another port -----------------------------------------
  const moved = await client.callTool({ name: 'configure_mcp', arguments: { port: PORT + 1 } });
  const movedResult = JSON.parse(moved.content[0].text);
  assert.equal(movedResult.restarting, true);
  assert.equal(movedResult.port, PORT + 1);

  await sleep(800);
  assert.equal(await ping(PORT), false, 'the old port should be closed');
  assert.ok(await ping(PORT + 1), 'the new port should answer');

  const movedClient = await connect(PORT + 1);
  const { tools: movedTools } = await movedClient.listTools();
  assert.ok(movedTools.length >= 10);
  await movedClient.close();

  // ---- and put it back ----------------------------------------------------
  const back = await connect(PORT + 1);
  const restored = await back.callTool({ name: 'configure_mcp', arguments: { port: PORT } });
  assert.equal(JSON.parse(restored.content[0].text).port, PORT);
  await back.close();
  await sleep(800);
  assert.ok(await ping(PORT), 'the original port should answer again');
});
