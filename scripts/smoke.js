// Automated smoke test: boots the app, checks the real DOM, exits.
//
//   npm run smoke

import { spawn } from 'node:child_process';
import electronPath from 'electron';

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, '0XMD_SMOKE': '1' },
});

child.on('close', (code) => process.exit(code ?? 0));
