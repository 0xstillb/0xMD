// File watching — chokidar (v4, ESM).
// The open document and the opened folder are watched, and external
// modifications are pushed to the renderer.

import chokidar from 'chokidar';

let watcher = null;

export function startWatching(targets, onChange) {
  if (!targets?.length) return null;

  watcher = chokidar.watch(targets, {
    ignoreInitial: true,
    persistent: true,
    // Editors often write via temp-file + rename; keep watching through that.
    awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 40 },
    ignored: (filePath) => /(^|[\\/])(\.git|node_modules|\.DS_Store|Thumbs\.db)$/.test(filePath),
  });

  watcher.on('all', (event, filePath) => {
    if (event === 'change' || event === 'add' || event === 'unlink' || event === 'addDir' || event === 'unlinkDir') {
      onChange(event, filePath);
    }
  });

  watcher.on('error', () => { /* a vanished watch target must never crash the app */ });

  return watcher;
}

export async function stopWatching(instance) {
  if (!instance) return;
  try {
    await instance.close();
  } catch { /* already closed */ }
}
