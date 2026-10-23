// Render the application icon.
//
// Electron is used as the renderer, because it is already a dependency and
// it can rasterise text properly. The result is a square PNG that
// electron-builder converts into .ico (Windows) and .icns (macOS).
//
//   npm run icon

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');
const outFile = path.join(outDir, 'icon.png');
const SIZE = 1024;

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; width: ${SIZE}px; height: ${SIZE}px; overflow: hidden; }
      .icon {
        width: ${SIZE}px; height: ${SIZE}px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 22%;
        background: linear-gradient(135deg, #4a9eff 0%, #2f7fd1 55%, #1f5fa8 100%);
        box-shadow: inset 0 -18px 60px rgba(0, 0, 0, .18);
        font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      .label { color: #fff; font-weight: 700; letter-spacing: -0.04em; font-size: ${SIZE * 0.30}px; line-height: 1; }
      .label .soft { opacity: .7; font-weight: 300; }
    </style>
  </head>
  <body>
    <div class="icon"><div class="label">0x<span class="soft">MD</span></div></div>
  </body>
</html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  // Give the font a moment to settle before the capture.
  await new Promise((resolve) => setTimeout(resolve, 600));

  const image = await win.webContents.capturePage();
  const png = image.toPNG();

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, png);

  console.log(`icon written: ${outFile} (${png.length} bytes)`);
  app.quit();
});
