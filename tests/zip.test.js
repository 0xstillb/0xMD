// Tests for the EPUB reader.
//
// An EPUB is a ZIP archive with a fixed shape. These tests build one with
// the writer in tools/ and read it back with the reader the app uses — so
// both halves are exercised against real bytes.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ZipArchive } from '../electron/zip.js';
import { createZip } from '../tools/zip-writer.js';
import { parseOpf } from '../src/core/opf/opf.js';
import {
  parseContainer,
  resolveArchivePath,
  dirname,
  decodeHref,
  readEpubStructure,
  isEpubPath,
} from '../src/core/epub/container.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
    <dc:title>The Test Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="text/chapter-01.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter%2002.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

const CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>
<body><h1>Chapter One</h1><p>It was a <em>quiet</em> morning.</p></body></html>`;

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="text/chapter-01.xhtml">The First Chapter</a></li>
<li><a href="text/chapter%2002.xhtml">The Second Chapter</a></li>
</ol></nav></body></html>`;

const book = () => createZip([
  { name: 'mimetype', content: 'application/epub+zip', compress: false },
  { name: 'META-INF/container.xml', content: CONTAINER },
  { name: 'OEBPS/content.opf', content: OPF },
  { name: 'OEBPS/nav.xhtml', content: NAV },
  { name: 'OEBPS/text/chapter-01.xhtml', content: CHAPTER },
  { name: 'OEBPS/text/chapter 02.xhtml', content: CHAPTER },
  { name: 'OEBPS/images/cover.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
]);

/* ------------------------------------------------------------------ *
 * The ZIP reader
 * ------------------------------------------------------------------ */

test('lists the files of an archive', () => {
  const archive = new ZipArchive(book());
  const names = archive.names();
  assert.ok(names.includes('mimetype'));
  assert.ok(names.includes('META-INF/container.xml'));
  assert.ok(names.includes('OEBPS/text/chapter-01.xhtml'));
  assert.equal(archive.names().length, 7);
});

test('reads a stored entry and a deflated one', () => {
  const archive = new ZipArchive(book());
  assert.equal(archive.readText('mimetype'), 'application/epub+zip');
  assert.ok(archive.readText('OEBPS/text/chapter-01.xhtml').includes('Chapter One'));
  assert.equal(archive.readText('OEBPS/nothing.xhtml'), null);
  assert.equal(archive.has('OEBPS/content.opf'), true);
});

test('refuses a file that is not an archive', () => {
  assert.throws(() => new ZipArchive(Buffer.from('this is not a zip file at all')), /not a ZIP archive/);
});

/* ------------------------------------------------------------------ *
 * The inside of a book
 * ------------------------------------------------------------------ */

test('reads the container of a book', () => {
  const { rootfile, rootfiles } = parseContainer(CONTAINER);
  assert.equal(rootfile, 'OEBPS/content.opf');
  assert.equal(rootfiles.length, 1);
  assert.equal(rootfiles[0].mediaType, 'application/oebps-package+xml');
});

test('resolves the paths inside an archive', () => {
  assert.equal(dirname('OEBPS/content.opf'), 'OEBPS');
  assert.equal(dirname('content.opf'), '');
  assert.equal(resolveArchivePath('OEBPS', 'text/chapter-01.xhtml'), 'OEBPS/text/chapter-01.xhtml');
  assert.equal(resolveArchivePath('OEBPS', '../images/cover.svg'), 'images/cover.svg');
  assert.equal(resolveArchivePath('', 'text/chapter.xhtml'), 'text/chapter.xhtml');
});

test('decodes a percent-encoded href', () => {
  assert.equal(decodeHref('text/chapter%2002.xhtml'), 'text/chapter 02.xhtml');
  assert.equal(decodeHref('text/100%.xhtml'), 'text/100%.xhtml');
});

test('reads the package of a book and its chapters', () => {
  const archive = new ZipArchive(book());
  const structure = readEpubStructure(archive, parseOpf);

  assert.equal(structure.mimetype, 'application/epub+zip');
  assert.equal(structure.rootfile, 'OEBPS/content.opf');
  assert.equal(structure.base, 'OEBPS');
  assert.equal(structure.package.metadata.title, 'The Test Book');

  assert.equal(structure.chapters.length, 3);
  assert.equal(structure.chapters[0].path, 'OEBPS/nav.xhtml');
  assert.equal(structure.chapters[1].path, 'OEBPS/text/chapter-01.xhtml');
  // The href is percent-encoded in the package, but not on disk.
  assert.equal(structure.chapters[2].path, 'OEBPS/text/chapter 02.xhtml');
});

test('takes the titles of the chapters from the navigation document', () => {
  const archive = new ZipArchive(book());
  const structure = readEpubStructure(archive, parseOpf);

  assert.equal(structure.chapters[1].title, 'The First Chapter');
  assert.equal(structure.chapters[2].title, 'The Second Chapter');
});

test('refuses an archive without a container', () => {
  const archive = new ZipArchive(createZip([{ name: 'mimetype', content: 'application/epub+zip' }]));
  assert.throws(() => readEpubStructure(archive, parseOpf), /not an EPUB/);
});

test('knows which files are books', () => {
  assert.equal(isEpubPath('C:/books/book.epub'), true);
  assert.equal(isEpubPath('C:/books/book.EPUB'), true);
  assert.equal(isEpubPath('C:/books/book.opf'), false);
  assert.equal(isEpubPath(undefined), false);
});
