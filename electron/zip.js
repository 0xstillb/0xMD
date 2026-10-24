// 0xMD — a small ZIP reader.
//
// An EPUB file is a ZIP archive: the mimetype, META-INF/container.xml and
// the package (the .opf) with the documents of the book. Node can inflate
// the entries, so all that is left to do here is to find them.
//
// The whole archive is read into memory, which is what an EPUB wants — they
// are small, and a book is usually a few megabytes.

import zlib from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

/** Find the end-of-central-directory record, which sits at the very end. */
function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i;
  }
  return -1;
}

/**
 * Read the central directory of a ZIP archive.
 *
 * @param {Buffer} buffer
 * @returns {Map<string, {name: string, method: number, compressedSize: number, size: number, offset: number}>}
 */
export function readZipDirectory(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) throw new Error('This file is not a ZIP archive.');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    entries.set(name, { name, method, compressedSize, size, offset: localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Read one entry of an archive into a buffer. */
export function readZipEntry(buffer, entry) {
  if (!entry) return null;
  if (buffer.readUInt32LE(entry.offset) !== LOCAL_FILE_HEADER) {
    throw new Error(`The archive entry "${entry.name}" is damaged.`);
  }

  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === STORED) return Buffer.from(data);
  if (entry.method === DEFLATED) return zlib.inflateRawSync(data);
  throw new Error(`The archive uses a compression method 0xMD cannot read (${entry.method}).`);
}

/** A ZIP archive held in memory. */
export class ZipArchive {
  /** @param {Buffer} buffer */
  constructor(buffer) {
    this.buffer = buffer;
    this.entries = readZipDirectory(buffer);
  }

  /** The names of every file in the archive. */
  names() {
    return [...this.entries.keys()];
  }

  /** Does the archive hold this file? */
  has(name) {
    return this.entries.has(name);
  }

  /** The contents of a file, or null when the archive has no such file. */
  read(name) {
    return readZipEntry(this.buffer, this.entries.get(name));
  }

  /** The contents of a file as text, or null. */
  readText(name) {
    const data = this.read(name);
    return data ? data.toString('utf8') : null;
  }
}

export default ZipArchive;
