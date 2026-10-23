// Minimal ASAR reader: list entries and extract files from an Electron .asar archive.
// Usage:
//   node asar.js list <asarPath> [filter]
//   node asar.js cat  <asarPath> <entryPath>
//   node asar.js find <asarPath> <regex>
import fs from 'node:fs';
import path from 'node:path';

function readHeader(fd) {
  const sizeBuf = Buffer.alloc(8);
  fs.readSync(fd, sizeBuf, 0, 8, 0);
  const headerSize = sizeBuf.readUInt32LE(4);
  const raw = Buffer.alloc(headerSize);
  fs.readSync(fd, raw, 0, headerSize, 8);
  // inner pickle: 4-byte length prefix then UTF-8 JSON
  for (const start of [0, 4, 8]) {
    try {
      const len = raw.readUInt32LE(start);
      const text = raw.slice(start + 4, start + 4 + len).toString('utf8');
      const json = JSON.parse(text);
      if (json && json.files) return { header: json, dataOffset: 8 + headerSize };
    } catch (_) { /* try next offset */ }
  }
  throw new Error('could not parse asar header');
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, p, out);
    else out.push({ path: p, size: entry.size, offset: entry.offset, unpacked: !!entry.unpacked });
  }
  return out;
}

let DATA_OFFSET = 0;
let ARCHIVE_DIR = '';

function extract(fd, entries, target) {
  const hit = entries.find((e) => e.path === target);
  if (!hit) return null;
  if (hit.unpacked) {
    return fs.readFileSync(path.join(ARCHIVE_DIR, hit.path));
  }
  const buf = Buffer.alloc(hit.size);
  fs.readSync(fd, buf, 0, hit.size, DATA_OFFSET + parseInt(hit.offset, 10));
  return buf;
}

const [cmd, asarPath, arg] = process.argv.slice(2);
const fd = fs.openSync(asarPath, 'r');
const { header, dataOffset } = readHeader(fd);
DATA_OFFSET = dataOffset;
ARCHIVE_DIR = path.dirname(asarPath);
const entries = walk(header, '', []);

if (cmd === 'list') {
  const filter = arg ? new RegExp(arg, 'i') : null;
  for (const e of entries) {
    if (!filter || filter.test(e.path)) console.log(`${String(e.size).padStart(9)}  ${e.path}`);
  }
} else if (cmd === 'cat') {
  const buf = extract(fd, entries, arg);
  if (!buf) { console.error('not found:', arg); process.exit(1); }
  process.stdout.write(buf);
} else if (cmd === 'find') {
  const re = new RegExp(arg, 'i');
  for (const e of entries) if (re.test(e.path)) console.log(`${String(e.size).padStart(9)}  ${e.path}`);
} else if (cmd === 'extract-all') {
  const outDir = arg;
  for (const e of entries) {
    const dest = path.join(outDir, e.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const buf = extract(fd, entries, e.path);
    if (buf) fs.writeFileSync(dest, buf);
  }
  console.log(`extracted ${entries.length} entries -> ${outDir}`);
} else if (cmd === 'grep') {
  // scan file contents inside the archive for a regex
  const re = new RegExp(arg, arg.includes('i') ? 'i' : '');
  for (const e of entries) {
    if (!e.size || e.size > 12 * 1024 * 1024) continue;
    let buf;
    try { buf = extract(fd, entries, e.path); } catch (_) { continue; }
    if (!buf) continue;
    const text = buf.toString('latin1');
    const m = re.exec(text);
    if (m) {
      const idx = m.index;
      const ctx = text.slice(Math.max(0, idx - 120), idx + 160).replace(/[^\x20-\x7e]/g, '.');
      console.log(`\n### ${e.path}  (${e.size}b)\n${ctx}`);
    }
  }
}
fs.closeSync(fd);
