// Build the demo book.
//
// The demo folder holds an unpacked EPUB: a package, three chapters and a
// cover. This zips them into demo/book.epub, so the book can be opened
// like any other EPUB.
//
//   node tools/make-demo-epub.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './zip-writer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const demo = path.join(here, '..', 'demo');

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const read = (name) => fs.readFile(path.join(demo, name));

const files = [
  // The mimetype comes first and is stored, as the format asks.
  { name: 'mimetype', content: 'application/epub+zip', compress: false },
  { name: 'META-INF/container.xml', content: CONTAINER },
  { name: 'content.opf', content: await read('package.opf') },
  { name: 'style.css', content: await read('style.css') },
  { name: 'text/nav.xhtml', content: await read(path.join('text', 'nav.xhtml')) },
  { name: 'text/chapter-01.xhtml', content: await read(path.join('text', 'chapter-01.xhtml')) },
  { name: 'text/chapter-02.xhtml', content: await read(path.join('text', 'chapter-02.xhtml')) },
  { name: 'text/chapter-03.xhtml', content: await read(path.join('text', 'chapter-03.xhtml')) },
  { name: 'images/cover.svg', content: await read(path.join('images', 'cover.svg')) },
];

const target = path.join(demo, 'book.epub');
await fs.writeFile(target, createZip(files));

console.log(`wrote ${target} (${files.length} files)`);
