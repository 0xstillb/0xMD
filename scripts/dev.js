// Development launcher: start Vite, then Electron pointed at the dev server.
//
//   npm run dev

import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer();
await server.listen();

const url = server.resolvedUrls?.local?.[0];
server.printUrls();

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: url },
});

child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

process.on('SIGINT', async () => {
  child.kill();
  await server.close();
  process.exit(0);
});
