// 0xMD — Windows file associations.
//
// Registers 0xMD as a handler for Markdown files so it shows up in the
// "Open with" list of Explorer.
//
// Everything is written under HKCU (the current user), so no administrator
// rights are needed and nothing outside the user's profile is touched.
//
// The default handler itself cannot be set from code — Windows protects
// `UserChoice` — but the app can be *offered* in the list, which is what
// "Open with" shows.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { app } from 'electron';

const run = promisify(execFile);

const PROG_ID = '0xMD.Markdown';
const EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt'];

/**
 * The file Windows should launch.
 *
 * For an installed build that is the executable itself. For the portable
 * build the executable is unpacked into a temporary folder on every run, so
 * the portable launcher — the file the user actually downloaded — is what
 * has to be registered.
 */
export function launcherPath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

async function reg(args) {
  try {
    await run('reg.exe', args, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function regQuery(key) {
  try {
    const { stdout } = await run('reg.exe', ['query', key], { windowsHide: true });
    return stdout;
  } catch {
    return null;
  }
}

function quote(value) {
  return `"${value}"`;
}

/**
 * Register 0xMD for Markdown files.
 * @returns {Promise<{ok: boolean, exe: string, error?: string}>}
 */
export async function registerFileAssociations() {
  const exe = launcherPath();

  const prog = `HKCU\\Software\\Classes\\${PROG_ID}`;
  const command = `${quote(exe)} "%1"`;

  const steps = [
    ['add', prog, '/v', '', '/t', 'REG_SZ', '/d', 'Markdown Document (0xMD)', '/f'],
    ['add', `${prog}\\DefaultIcon`, '/v', '', '/t', 'REG_SZ', '/d', `${exe},0`, '/f'],
    ['add', `${prog}\\shell\\open\\command`, '/v', '', '/t', 'REG_SZ', '/d', command, '/f'],
  ];

  for (const ext of EXTENSIONS) {
    // "Open with" reads the prog ids from here.
    steps.push(['add', `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '/v', PROG_ID, '/t', 'REG_NONE', '/f']);
    // And this is the list Explorer itself keeps.
    steps.push(['add', `HKCU\\Software\\Classes\\${ext}\\OpenWithList`, '/v', path.basename(exe), '/t', 'REG_SZ', '/d', exe, '/f']);
  }

  // The application entry, so Windows can find the icon and the command.
  const app = `HKCU\\Software\\Classes\\Applications\\${path.basename(exe)}`;
  steps.push(['add', app, '/v', '', '/t', 'REG_SZ', '/d', 'Markdown Document (0xMD)', '/f']);
  steps.push(['add', `${app}\\shell\\open\\command`, '/v', '', '/t', 'REG_SZ', '/d', command, '/f']);
  for (const ext of EXTENSIONS) {
    steps.push(['add', `${app}\\SupportedTypes`, '/v', ext, '/t', 'REG_NONE', '/f']);
  }

  for (const args of steps) {
    const ok = await reg(args);
    if (!ok) {
      return { ok: false, exe, error: `Could not write ${args[1]}` };
    }
  }

  return { ok: true, exe };
}

/** Remove every key this app created. */
export async function unregisterFileAssociations() {
  const exe = launcherPath();
  const app = `HKCU\\Software\\Classes\\Applications\\${path.basename(exe)}`;

  await reg(['delete', `HKCU\\Software\\Classes\\${PROG_ID}`, '/f']);
  await reg(['delete', app, '/f']);

  for (const ext of EXTENSIONS) {
    // Only remove our own values, leave the rest of the list intact.
    await reg(['delete', `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '/v', PROG_ID, '/f']);
    await reg(['delete', `HKCU\\Software\\Classes\\${ext}\\OpenWithList`, '/v', path.basename(exe), '/f']);
  }

  return { ok: true, exe };
}

/** Is 0xMD currently offered as a handler for .md? */
export async function fileAssociationStatus() {
  const exe = launcherPath();
  const output = await regQuery('HKCU\\Software\\Classes\\.md\\OpenWithProgids');
  const registered = !!output && output.includes(PROG_ID);
  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  return {
    registered,
    exe,
    portable,
    // Registering only makes sense for a real build: from the development
    // tree the executable is Electron itself, which would not open 0xMD.
    usable: portable || app.isPackaged,
    extensions: EXTENSIONS,
  };
}
