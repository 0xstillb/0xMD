// Tests for the EPUB package reader.
//
// A .opf file is read in two steps: the XML reader turns the text into a
// tree, and the package reader turns the tree into the model the viewer
// shows. Both are plain JavaScript, so they are tested here without an
// Electron window.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseXml, decodeEntities, childNamed, childrenNamed, textOf } from '../src/core/opf/xml.js';
import { parseOpf, opfToMarkdown, metadataRows, isOpfPath } from '../src/core/opf/opf.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const EPUB3 = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:12345678-1234-1234-1234-123456789012</dc:identifier>
    <dc:title>The Lighthouse at the Edge of Winter</dc:title>
    <dc:creator id="creator01">Mira Halvorsen</dc:creator>
    <meta refines="#creator01" property="role" scheme="marc:relators">aut</meta>
    <dc:language>en</dc:language>
    <dc:publisher>Northlight Press</dc:publisher>
    <dc:date>2024-03-18</dc:date>
    <dc:description>A keeper who refuses the dark.</dc:description>
    <dc:rights>Copyright &#169; 2024 Mira Halvorsen</dc:rights>
    <dc:subject>Fiction</dc:subject>
    <dc:subject>Sea stories</dc:subject>
    <meta property="dcterms:modified">2024-03-20T10:00:00Z</meta>
    <meta name="cover" content="cover-image"/>
    <link rel="cc:license" href="https://example.com/license"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="ch1" href="text/chapter-01.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter-02.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2" linear="no"/>
  </spine>
</package>`;

const EPUB2 = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:isbn:9780000000001</dc:identifier>
    <dc:title>An Old Book</dc:title>
    <dc:creator opf:role="aut" opf:file-as="Tolkien, J. R. R.">J. R. R. Tolkien</dc:creator>
    <dc:language>en-GB</dc:language>
    <dc:publisher>Allen &amp; Unwin</dc:publisher>
    <meta name="cover" content="my-cover"/>
  </metadata>
  <manifest>
    <item id="my-cover" href="cover.jpg" media-type="image/jpeg"/>
    <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="toc">
    <itemref idref="c1"/>
  </spine>
  <guide>
    <reference type="cover" title="Cover Page" href="cover.xhtml"/>
    <reference type="toc" title="Table of Contents" href="toc.xhtml"/>
  </guide>
</package>`;

/* ------------------------------------------------------------------ *
 * The XML reader
 * ------------------------------------------------------------------ */

test('decodes the XML entities', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('&#169; &#x27;'), '© \'');
  // An entity the reader does not know stays as it is.
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('reads elements, attributes and text', () => {
  const { root, errors } = parseXml('<package version="3.0"><title>Hello</title></package>');
  assert.deepEqual(errors, []);

  const pkg = childNamed(root, 'package');
  assert.ok(pkg);
  assert.equal(pkg.attrs.version, '3.0');
  assert.equal(textOf(childNamed(pkg, 'title')), 'Hello');
});

test('reads namespaced names apart', () => {
  const { root } = parseXml('<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">T</dc:title>');
  const node = childNamed(root, 'title');
  assert.equal(node.name, 'dc:title');
  assert.equal(node.prefix, 'dc');
  assert.equal(node.local, 'title');
});

test('skips comments, the declaration and the doctype', () => {
  const { root } = parseXml(
    '<?xml version="1.0"?><!DOCTYPE package [ <!ENTITY x "y"> ]><!-- a note --><package><a/></package>',
  );
  assert.equal(childNamed(root, 'package').local, 'package');
  assert.equal(childrenNamed(root, 'package').length, 1);
});

test('reads CDATA as plain text', () => {
  const { root } = parseXml('<d><![CDATA[<b>not markup</b> & friends]]></d>');
  assert.equal(textOf(childNamed(root, 'd')), '<b>not markup</b> & friends');
});

test('reports a mismatched end tag instead of throwing', () => {
  const { root, errors } = parseXml('<a><b>text</a>');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Unclosed element <b>/);
  assert.ok(childNamed(root, 'a'));
});

test('reads an attribute with a single quote and one without', () => {
  const { root } = parseXml(`<item href='a.xhtml' media-type="application/xhtml+xml"/>`);
  const item = childNamed(root, 'item');
  assert.equal(item.attrs.href, 'a.xhtml');
  assert.equal(item.attrs['media-type'], 'application/xhtml+xml');
});

/* ------------------------------------------------------------------ *
 * The package reader
 * ------------------------------------------------------------------ */

test('reads the metadata of an EPUB 3 package', () => {
  const model = parseOpf(EPUB3);

  assert.equal(model.version, '3.0');
  assert.equal(model.uniqueIdentifier, 'pub-id');
  assert.equal(model.language, 'en');

  assert.equal(model.metadata.title, 'The Lighthouse at the Edge of Winter');
  assert.equal(model.metadata.creators[0].name, 'Mira Halvorsen');
  assert.equal(model.metadata.language, 'en');
  assert.equal(model.metadata.publisher, 'Northlight Press');
  assert.equal(model.metadata.date, '2024-03-18');
  assert.equal(model.metadata.description, 'A keeper who refuses the dark.');
  assert.equal(model.metadata.rights, 'Copyright © 2024 Mira Halvorsen');
  assert.deepEqual(model.metadata.subjects, ['Fiction', 'Sea stories']);
  assert.equal(model.metadata.identifiers[0].value, 'urn:uuid:12345678-1234-1234-1234-123456789012');
});

test('resolves the role of a creator through refines', () => {
  const model = parseOpf(EPUB3);
  assert.equal(model.metadata.creators[0].role, 'aut');
});

test('reads the manifest', () => {
  const model = parseOpf(EPUB3);
  assert.equal(model.manifest.length, 5);

  const nav = model.manifest[0];
  assert.equal(nav.id, 'nav');
  assert.equal(nav.href, 'nav.xhtml');
  assert.equal(nav.mediaType, 'application/xhtml+xml');
  assert.deepEqual(nav.properties, ['nav']);
});

test('reads the reading order and resolves the files it names', () => {
  const model = parseOpf(EPUB3);
  assert.equal(model.spine.toc, 'ncx');
  assert.equal(model.spine.items.length, 3);

  assert.equal(model.spine.items[0].idref, 'nav');
  assert.equal(model.spine.items[0].href, 'nav.xhtml');

  assert.equal(model.spine.items[1].href, 'text/chapter-01.xhtml');
  assert.equal(model.spine.items[1].title, 'chapter 01');

  assert.equal(model.spine.items[2].linear, 'no');
  assert.equal(model.spine.items[2].href, 'text/chapter-02.xhtml');
});

test('finds the cover of a package', () => {
  const model = parseOpf(EPUB3);
  assert.equal(model.metadata.cover.id, 'cover-image');
  assert.equal(model.metadata.cover.href, 'images/cover.jpg');
});

test('keeps the extra metadata and the links', () => {
  const model = parseOpf(EPUB3);
  const modified = model.metadata.metas.find((entry) => entry.property === 'dcterms:modified');
  assert.equal(modified.value, '2024-03-20T10:00:00Z');
  assert.equal(model.metadata.links[0].rel, 'cc:license');
  assert.equal(model.metadata.links[0].href, 'https://example.com/license');
});

test('reads an EPUB 2 package with a guide', () => {
  const model = parseOpf(EPUB2);

  assert.equal(model.version, '2.0');
  assert.equal(model.metadata.title, 'An Old Book');
  assert.equal(model.metadata.publisher, 'Allen & Unwin');
  assert.equal(model.metadata.identifiers[0].scheme, '');

  assert.equal(model.guide.length, 2);
  assert.equal(model.guide[0].type, 'cover');
  assert.equal(model.guide[0].title, 'Cover Page');
  assert.equal(model.guide[0].href, 'cover.xhtml');

  // The cover is named by a <meta name="cover"> entry.
  assert.equal(model.metadata.cover.href, 'cover.jpg');
});

test('refuses a file that is not a package document', () => {
  assert.throws(() => parseOpf('<html><body>Not an OPF</body></html>'), /not an EPUB package/);
});

test('survives a truncated package', () => {
  // The closing tags are missing — the reader still finds what it can.
  const model = parseOpf('<package version="3.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Half a book');
  assert.equal(model.version, '3.0');
  assert.equal(model.metadata.title, 'Half a book');
  assert.ok(model.errors.length > 0);
});

/* ------------------------------------------------------------------ *
 * The summary
 * ------------------------------------------------------------------ */

test('turns a package into a Markdown summary', () => {
  const markdown = opfToMarkdown(parseOpf(EPUB3));

  assert.ok(markdown.startsWith('# The Lighthouse at the Edge of Winter'));
  assert.ok(markdown.includes('Mira Halvorsen · Northlight Press · 2024-03-18'));
  assert.ok(markdown.includes('## Metadata'));
  assert.ok(markdown.includes('| Language | en |'));
  assert.ok(markdown.includes('## Manifest (5)'));
  assert.ok(markdown.includes('| nav | nav.xhtml | application/xhtml+xml | nav |'));
  assert.ok(markdown.includes('## Reading order (3)'));
  assert.ok(markdown.includes('1. nav — `nav.xhtml`'));
  assert.ok(markdown.includes('_(non-linear)_'));
});

test('lists the metadata rows', () => {
  const rows = metadataRows(parseOpf(EPUB3));
  const labels = rows.map(([label]) => label);
  assert.ok(labels.includes('Title'));
  assert.ok(labels.includes('Author'));
  assert.ok(labels.includes('Language'));
  assert.ok(!labels.includes('Subtitle'));
});

test('knows which files are packages', () => {
  assert.equal(isOpfPath('C:/books/book.opf'), true);
  assert.equal(isOpfPath('C:/books/book.OPF'), true);
  assert.equal(isOpfPath('C:/books/book.md'), false);
  assert.equal(isOpfPath(undefined), false);
});
