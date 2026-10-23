// Round-trip tests for the 0xMD markdown pipeline.
//
// The parser/serializer pair is the heart of the editor: if markdown cannot
// survive a round trip, saving would corrupt the file.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMarkdown } from '../src/core/parser.js';
import { serializeMarkdown } from '../src/core/serializer.js';

const roundTrip = (source) => serializeMarkdown(parseMarkdown(source));

/** Collect every node type present in a parsed document. */
function nodeTypes(doc) {
  const types = new Set();
  doc.descendants((node) => {
    types.add(node.type.name);
    return true;
  });
  return types;
}

test('parses a plain paragraph', () => {
  const doc = parseMarkdown('Hello world');
  assert.equal(doc.childCount, 1);
  assert.equal(doc.firstChild.type.name, 'paragraph');
  assert.equal(doc.firstChild.textContent, 'Hello world');
});

test('parses headings with levels and keeps the marker attribute', () => {
  const doc = parseMarkdown('# One\n\n## Two\n\n### Three');
  const headings = [];
  doc.forEach((n) => headings.push(n));
  assert.deepEqual(headings.map((h) => h.attrs.level), [1, 2, 3]);
  assert.equal(headings[0].attrs.markup, '# ');
  assert.equal(headings[2].attrs.markup, '### ');
});

test('parses inline marks', () => {
  const doc = parseMarkdown('a **bold** and *italic* and `code` and ~~gone~~ and ==mark==');
  const marks = new Set();
  doc.descendants((node) => {
    node.marks.forEach((m) => marks.add(m.type.name));
    return true;
  });
  assert.ok(marks.has('strong'));
  assert.ok(marks.has('em'));
  assert.ok(marks.has('code'));
  assert.ok(marks.has('strikethrough'));
  assert.ok(marks.has('highlight'));
});

test('parses lists, task lists and blockquotes', () => {
  const types = nodeTypes(parseMarkdown('- a\n- b\n\n1. one\n\n> quote\n\n- [x] done\n- [ ] todo'));
  assert.ok(types.has('bullet_list'));
  assert.ok(types.has('ordered_list'));
  assert.ok(types.has('list_item'));
  assert.ok(types.has('blockquote'));
});

test('parses fenced code blocks with the info string', () => {
  const doc = parseMarkdown('```js\nconst a = 1;\n```');
  const code = doc.firstChild;
  assert.equal(code.type.name, 'code_block');
  assert.equal(code.attrs.params, 'js');
  assert.equal(code.textContent, 'const a = 1;');
});

test('parses math blocks and inline math', () => {
  const types = nodeTypes(parseMarkdown('Inline $x^2$ here.\n\n$$\n\\int_0^1 x\n$$'));
  assert.ok(types.has('math_inline'));
  assert.ok(types.has('math_block'));

  const inline = parseMarkdown('Inline $x^2$ here.').firstChild.child(1);
  assert.equal(inline.type.name, 'math_inline');
  assert.equal(inline.attrs.latex, 'x^2');
});

test('does not treat currency as math', () => {
  const doc = parseMarkdown('It costs $5 and $10 total.');
  const types = nodeTypes(doc);
  assert.ok(!types.has('math_inline'));
});

test('parses mermaid fences into their own node', () => {
  const doc = parseMarkdown('```mermaid\ngraph TD;\nA-->B;\n```');
  assert.equal(doc.firstChild.type.name, 'mermaid');
  assert.ok(doc.firstChild.textContent.includes('graph TD;'));
});

test('parses front matter into a dedicated node', () => {
  const doc = parseMarkdown('---\ntitle: Hi\n---\n\n# Doc');
  assert.equal(doc.firstChild.type.name, 'front_matter');
  assert.equal(doc.firstChild.textContent, 'title: Hi');
});

test('parses GFM tables', () => {
  const types = nodeTypes(parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |'));
  assert.ok(types.has('table'));
  assert.ok(types.has('table_row'));
  assert.ok(types.has('table_header'));
});

test('parses GitHub alerts', () => {
  const doc = parseMarkdown('> [!WARNING]\n> Be careful.');
  assert.equal(doc.firstChild.type.name, 'alert');
  assert.equal(doc.firstChild.attrs.kind, 'warning');
});

test('parses footnotes into a reference plus a footnote section', () => {
  const doc = parseMarkdown('Text with a note[^1].\n\n[^1]: The note body.');
  const types = nodeTypes(doc);
  assert.ok(types.has('footnote_ref'));
  assert.ok(types.has('footnote_block'));
});

test('parses images and links', () => {
  const doc = parseMarkdown('![alt text](img.png "Title")\n\n[label](https://example.com)');
  const types = nodeTypes(doc);
  assert.ok(types.has('image'));

  const marks = new Set();
  doc.descendants((node) => {
    node.marks.forEach((m) => marks.add(m.type.name));
    return true;
  });
  assert.ok(marks.has('link'));
});

test('keeps soft line breaks as real line breaks', () => {
  const doc = parseMarkdown('line one\nline two');
  assert.equal(doc.firstChild.textContent, 'line one\nline two');
});

test('round trips a document without losing content', () => {
  const source = [
    '---',
    'title: Demo',
    '---',
    '',
    '# Heading',
    '',
    'Some **bold**, *italic*, `code`, ~~strike~~, ==mark== and $x^2$ text.',
    '',
    '> [!NOTE]',
    '> A callout.',
    '',
    '- item one',
    '- item two',
    '',
    '1. first',
    '2. second',
    '',
    '- [x] done',
    '- [ ] open',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '$$',
    'a^2 + b^2 = c^2',
    '$$',
    '',
    '```mermaid',
    'graph TD;',
    'A-->B;',
    '```',
    '',
    '| h1 | h2 |',
    '| --- | --- |',
    '| a | b |',
    '',
    '> quoted text',
    '',
    '![pic](a.png)',
    '',
    '[link](https://example.com)',
    '',
    'Footnote here[^a].',
    '',
    '[^a]: footnote text',
  ].join('\n');

  const output = roundTrip(source);

  // Every meaningful fragment must survive the trip.
  for (const fragment of [
    'title: Demo',
    '# Heading',
    '**bold**',
    '*italic*',
    '`code`',
    '~~strike~~',
    '==mark==',
    '$x^2$',
    '[!NOTE]',
    '- item one',
    '1. first',
    '- [x] done',
    '```js',
    'const x = 1;',
    '$$',
    'a^2 + b^2 = c^2',
    '```mermaid',
    'graph TD;',
    '| h1 | h2 |',
    '| a | b |',
    '> quoted text',
    '![pic](a.png)',
    '[link](https://example.com)',
    '[^a]',
  ]) {
    assert.ok(output.includes(fragment), `round trip lost: ${fragment}\n---\n${output}\n---`);
  }
});

test('round trip is stable (idempotent)', () => {
  const source = '# Title\n\nHello **world** with `code`.\n\n- a\n- b\n';
  const once = roundTrip(source);
  const twice = roundTrip(once);
  assert.equal(once, twice);
});

test('preserves literal asterisks in prose', () => {
  const output = roundTrip('2 * 3 = 6 and snake_case_name stays intact');
  const reparsed = parseMarkdown(output);
  assert.equal(reparsed.firstChild.textContent, '2 * 3 = 6 and snake_case_name stays intact');
});
