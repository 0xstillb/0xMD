// 0xMD — a small ZIP writer.
//
// The reader in electron/zip.js needs something to read. This writes the
// archives used by the tests and by the demo book, so both the reader and
// the writer are exercised against real bytes.
//
//   import { createZip } from './zip-writer.js';
//   const buffer = createZip([{ name: 'mimetype', content: 'hello' }]);

import zlib from 'node:zlib';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** The CRC-32 of a buffer, as the ZIP format wants it. */
function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

/**
 * Build a ZIP archive.
 *
 * @param {{name: string, content: string|Buffer, compress?: boolean}[]} files
 * @returns {Buffer}
 */
export function createZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content ?? '', 'utf8');
    const stored = file.compress === false;
    const body = stored ? data : zlib.deflateRawSync(data);
    const method = stored ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra

    parts.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0, 8); // flags
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12); // time
    header.writeUInt16LE(0x21, 14); // date
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // disk
    header.writeUInt16LE(0, 36); // internal attributes
    header.writeUInt32LE(0, 38); // external attributes
    header.writeUInt32LE(offset, 42);

    central.push(Buffer.concat([header, name]));
    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, directory, end]);
}

export default createZip;
