// 0xMD — the EPUB package document (.opf) reader.
//
// An .opf file is the index of an EPUB: the metadata of the book, the list
// of the files it contains (the manifest) and the order those files are read
// in (the spine). This module turns that XML into a plain object, so the
// renderer can show it and the MCP server can describe it.
//
// Nothing here touches the file system or the DOM — it is pure data in,
// pure data out, which keeps it testable and shareable between the two
// processes.

import { parseXml, childElements, childrenNamed, childNamed, textOf } from './xml.js';

/** The file extensions that hold an EPUB package document. */
export const OPF_EXTENSIONS = ['.opf'];

/** Is this path an EPUB package document? */
export function isOpfPath(filePath) {
  return /\.(opf)$/i.test(String(filePath ?? ''));
}

/** The file name part of an href, without the directory or the extension. */
function fileNameOf(href) {
  const name = String(href ?? '').split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
  return name.replace(/\.[^.]+$/, '');
}

/** "chapter-01" → "Chapter 01" */
function prettify(text) {
  return String(text ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitProperties(value) {
  return String(value ?? '').split(/\s+/).filter(Boolean);
}

/**
 * Read an EPUB package document.
 *
 * @param {string} source the raw XML
 * @returns {object} the package model
 * @throws {Error} when the file is not a package document at all
 */
export function parseOpf(source) {
  const { root, errors } = parseXml(source);
  const pkg = childElements(root).find((child) => child.local === 'package');

  if (!pkg) {
    const error = new Error('This file is not an EPUB package document — it has no <package> element.');
    error.code = 'OPF_NO_PACKAGE';
    throw error;
  }

  const metadataElement = childNamed(pkg, 'metadata');
  const manifestElement = childNamed(pkg, 'manifest');
  const spineElement = childNamed(pkg, 'spine');
  const guideElement = childNamed(pkg, 'guide');

  /* ---- metadata ---------------------------------------------------- */

  const metadata = {
    title: '',
    titles: [],
    subtitle: '',
    creators: [],
    contributors: [],
    language: '',
    publisher: '',
    date: '',
    description: '',
    rights: '',
    subjects: [],
    identifiers: [],
    source: '',
    type: '',
    relation: '',
    coverage: '',
    metas: [],
    links: [],
    cover: null,
  };

  const people = (node) => ({
    id: node.attrs.id ?? '',
    name: textOf(node),
    role: '',
    fileAs: '',
    // The EPUB 3 way of saying it: the role sits in a child element.
    roleHint: textOf(childNamed(node, 'role')),
    fileAsHint: textOf(childNamed(node, 'file-as')),
  });

  for (const node of childElements(metadataElement)) {
    const { local, prefix } = node;

    if (prefix === 'dc') {
      const value = textOf(node);
      switch (local) {
        case 'title':
          metadata.titles.push(value);
          if (!metadata.title) metadata.title = value;
          else if (!metadata.subtitle) metadata.subtitle = value;
          break;
        case 'creator':
          metadata.creators.push(people(node));
          break;
        case 'contributor':
          metadata.contributors.push(people(node));
          break;
        case 'language':
          metadata.language ||= value;
          break;
        case 'publisher':
          metadata.publisher ||= value;
          break;
        case 'date':
          metadata.date ||= value;
          break;
        case 'description':
          metadata.description ||= value;
          break;
        case 'rights':
          metadata.rights ||= value;
          break;
        case 'subject':
          if (value) metadata.subjects.push(value);
          break;
        case 'identifier':
          metadata.identifiers.push({
            id: node.attrs.id ?? '',
            value,
            scheme: node.attrs['opf:scheme'] ?? node.attrs.scheme ?? '',
          });
          break;
        case 'source':
          metadata.source ||= value;
          break;
        case 'type':
          metadata.type ||= value;
          break;
        case 'relation':
          metadata.relation ||= value;
          break;
        case 'coverage':
          metadata.coverage ||= value;
          break;
        default:
          break;
      }
      continue;
    }

    if (local === 'meta') {
      // EPUB 2 writes <meta name="cover" content="item-id"/>; EPUB 3 writes
      // <meta property="dcterms:modified">2024-01-01</meta>.
      const entry = {
        name: node.attrs.name ?? '',
        property: node.attrs.property ?? '',
        content: node.attrs.content ?? '',
        value: node.attrs.content ?? textOf(node),
        scheme: node.attrs.scheme ?? '',
        refines: node.attrs.refines ?? '',
      };
      metadata.metas.push(entry);
      continue;
    }

    if (local === 'link') {
      metadata.links.push({
        rel: node.attrs.rel ?? '',
        href: node.attrs.href ?? '',
        mediaType: node.attrs['media-type'] ?? '',
        properties: splitProperties(node.attrs.properties),
        refines: node.attrs.refines ?? '',
      });
    }
  }

  /* ---- manifest ---------------------------------------------------- */

  const manifest = childrenNamed(manifestElement, 'item').map((node) => ({
    id: node.attrs.id ?? '',
    href: node.attrs.href ?? '',
    mediaType: node.attrs['media-type'] ?? '',
    properties: splitProperties(node.attrs.properties),
    fallback: node.attrs.fallback ?? '',
    mediaOverlay: node.attrs['media-overlay'] ?? '',
  }));

  const byId = new Map(manifest.map((item) => [item.id, item]));

  /* ---- spine ------------------------------------------------------- */

  const spine = {
    toc: spineElement?.attrs.toc ?? '',
    items: childrenNamed(spineElement, 'itemref').map((node) => {
      const idref = node.attrs.idref ?? '';
      const target = byId.get(idref);
      return {
        idref,
        linear: node.attrs.linear ?? 'yes',
        properties: splitProperties(node.attrs.properties),
        href: target?.href ?? '',
        mediaType: target?.mediaType ?? '',
        title: prettify(fileNameOf(target?.href ?? idref)),
      };
    }),
  };

  /* ---- guide (EPUB 2) ----------------------------------------------- */

  const guide = childrenNamed(guideElement, 'reference').map((node) => ({
    type: node.attrs.type ?? '',
    title: node.attrs.title ?? '',
    href: node.attrs.href ?? '',
  }));

  /* ---- collections and bindings ------------------------------------- */

  const collections = childrenNamed(pkg, 'collection').map((node) => ({
    role: node.attrs.role ?? '',
    title: textOf(childNamed(node, 'title')),
    items: childrenNamed(node, 'link').map((link) => link.attrs.href ?? ''),
  }));

  const bindings = childrenNamed(childNamed(pkg, 'bindings'), 'mediaType').map((node) => ({
    mediaType: node.attrs.mediaType ?? '',
    handler: node.attrs.handler ?? '',
  }));

  /* ---- the cover --------------------------------------------------- */

  const coverMeta = metadata.metas.find((entry) => entry.name === 'cover');
  const coverItem =
    (coverMeta?.content ? byId.get(coverMeta.content) : null)
    ?? manifest.find((item) => item.properties.includes('cover-image'))
    ?? null;
  metadata.cover = coverItem
    ? { id: coverItem.id, href: coverItem.href, mediaType: coverItem.mediaType }
    : null;

  /* ---- the refinements ---------------------------------------------- */

  // EPUB 3 refines an element by its id: <meta refines="#creator01"
  // property="role">aut</meta>. Apply them once the people are known.
  const peopleById = new Map(
    [...metadata.creators, ...metadata.contributors].filter((person) => person.id).map((person) => [person.id, person]),
  );
  for (const entry of metadata.metas) {
    const person = peopleById.get(String(entry.refines).replace(/^#/, ''));
    if (!person) continue;
    if (entry.property === 'role' && !person.role) person.role = entry.value;
    if (entry.property === 'file-as' && !person.fileAs) person.fileAs = entry.value;
  }
  for (const person of [...metadata.creators, ...metadata.contributors]) {
    if (!person.role) person.role = person.roleHint;
    if (!person.fileAs) person.fileAs = person.fileAsHint;
  }

  return {
    version: pkg.attrs.version ?? '',
    uniqueIdentifier: pkg.attrs['unique-identifier'] ?? '',
    language: pkg.attrs['xml:lang'] ?? metadata.language,
    metadata,
    manifest,
    spine,
    guide,
    collections,
    bindings,
    errors,
  };
}

/* ------------------------------------------------------------------ *
 * A readable summary
 * ------------------------------------------------------------------ */

function escapeCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function personLine(person) {
  const role = person.role ? ` (${person.role})` : '';
  return `${person.name}${role}`;
}

/**
 * The metadata of a package, as label/value pairs.
 * @returns {[string, string][]}
 */
export function metadataRows(model) {
  const { metadata } = model;
  const rows = [];
  const add = (label, value) => {
    if (value != null && String(value).trim()) rows.push([label, String(value).trim()]);
  };

  add('Title', metadata.title);
  add('Subtitle', metadata.subtitle);
  if (metadata.creators.length) add('Author', metadata.creators.map(personLine).join(', '));
  if (metadata.contributors.length) add('Contributor', metadata.contributors.map(personLine).join(', '));
  add('Language', metadata.language);
  add('Publisher', metadata.publisher);
  add('Date', metadata.date);
  add('Description', metadata.description);
  add('Rights', metadata.rights);
  if (metadata.subjects.length) add('Subject', metadata.subjects.join(', '));
  for (const identifier of metadata.identifiers) {
    add(identifier.scheme ? `Identifier (${identifier.scheme})` : 'Identifier', identifier.value);
  }
  add('Source', metadata.source);
  add('Type', metadata.type);
  add('Relation', metadata.relation);
  add('Coverage', metadata.coverage);
  add('Cover', metadata.cover ? metadata.cover.href : '');
  add('Package version', model.version);
  add('Unique identifier', model.uniqueIdentifier);

  return rows;
}

/**
 * Turn a package into a Markdown document — the shape 0xMD exports and
 * the shape an agent gets from the MCP server.
 *
 * @param {object} model
 * @returns {string}
 */
export function opfToMarkdown(model) {
  if (!model) return '';

  const { metadata, manifest, spine, guide } = model;
  const lines = [];

  lines.push(`# ${metadata.title || 'Untitled package'}`);
  if (metadata.subtitle) lines.push('', `*${metadata.subtitle}*`);

  const byline = [
    metadata.creators.map((person) => person.name).filter(Boolean).join(', '),
    metadata.publisher,
    metadata.date,
  ].filter(Boolean).join(' · ');
  if (byline) lines.push('', byline);

  lines.push('', '> An EPUB package document (`.opf`) — read-only summary produced by 0xMD.', '');

  // ---- metadata
  lines.push('## Metadata', '');
  const rows = metadataRows(model);
  if (rows.length) {
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    for (const [label, value] of rows) lines.push(`| ${label} | ${escapeCell(value)} |`);
  } else {
    lines.push('_The package carries no metadata._');
  }
  lines.push('');

  // ---- manifest
  lines.push(`## Manifest (${manifest.length})`, '');
  if (manifest.length) {
    lines.push('| ID | File | Media type | Properties |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of manifest) {
      lines.push(`| ${item.id} | ${escapeCell(item.href)} | ${item.mediaType} | ${item.properties.join(' ')} |`);
    }
  } else {
    lines.push('_The manifest is empty._');
  }
  lines.push('');

  // ---- reading order
  lines.push(`## Reading order (${spine.items.length})`, '');
  if (spine.items.length) {
    spine.items.forEach((item, index) => {
      const linear = item.linear === 'no' ? ' _(non-linear)_' : '';
      const properties = item.properties.length ? ` _(${item.properties.join(' ')})_` : '';
      lines.push(`${index + 1}. ${item.title} — \`${item.href}\`${linear}${properties}`);
    });
  } else {
    lines.push('_The spine is empty._');
  }
  lines.push('');

  // ---- guide
  if (guide.length) {
    lines.push(`## Guide (${guide.length})`, '');
    lines.push('| Type | Title | File |');
    lines.push('| --- | --- | --- |');
    for (const reference of guide) {
      lines.push(`| ${reference.type} | ${escapeCell(reference.title)} | ${escapeCell(reference.href)} |`);
    }
    lines.push('');
  }

  // ---- the rest of the metadata
  if (metadata.metas.length) {
    lines.push(`## Other metadata (${metadata.metas.length})`, '');
    for (const entry of metadata.metas) {
      const key = entry.name || entry.property;
      lines.push(`- **${key}**: ${entry.value}`);
    }
    lines.push('');
  }

  if (metadata.links.length) {
    lines.push(`## Links (${metadata.links.length})`, '');
    for (const link of metadata.links) {
      lines.push(`- **${link.rel || 'link'}** → ${link.href}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
