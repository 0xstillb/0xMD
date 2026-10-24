// 0xMD — the inside of an EPUB.
//
// An EPUB is a ZIP archive with a fixed shape:
//
//   mimetype                  "application/epub+zip"
//   META-INF/container.xml    points at the package document
//   OEBPS/content.opf         the package (the same kind of file 0xMD
//                             already reads as a .opf file)
//   OEBPS/text/…              the chapters
//
// This module reads that shape: it finds the package inside the archive
// and works out where a file of the package actually lives inside it.

import { parseXml, childNamed, childrenNamed, childElements, textOf } from '../opf/xml.js';

/** The file extensions that hold an EPUB book. */
export const EPUB_EXTENSIONS = ['.epub'];

/** Is this path an EPUB book? */
export function isEpubPath(filePath) {
  return /\.(epub)$/i.test(String(filePath ?? ''));
}

/**
 * Read META-INF/container.xml.
 *
 * @param {string} xml
 * @returns {{rootfile: string, rootfiles: {path: string, mediaType: string}[]}}
 */
export function parseContainer(xml) {
  const { root } = parseXml(xml ?? '');

  // <container><rootfiles><rootfile full-path="…" media-type="…"/></rootfiles></container>
  const container = childNamed(root, 'container') ?? root;
  const group = childNamed(container, 'rootfiles');
  const rootfiles = childrenNamed(group, 'rootfile').map((node) => ({
    path: node.attrs['full-path'] ?? '',
    mediaType: node.attrs['media-type'] ?? '',
  }));

  // The OPF package is the one that says it is one.
  const primary = rootfiles.find((file) => file.mediaType.includes('oebps-package')) ?? rootfiles[0];

  return {
    rootfile: primary?.path ?? '',
    rootfiles,
  };
}

/** The folder part of a path inside an archive ("OEBPS/content.opf" → "OEBPS"). */
export function dirname(path) {
  const value = String(path ?? '');
  const slash = value.lastIndexOf('/');
  return slash === -1 ? '' : value.slice(0, slash);
}

/** Percent-decode a href, leaving it alone when it cannot be decoded. */
export function decodeHref(href) {
  try {
    return decodeURIComponent(String(href ?? ''));
  } catch {
    return String(href ?? '');
  }
}

/**
 * Work out where a file of the package lives inside the archive.
 *
 * The hrefs in a package are relative to the folder the package itself
 * sits in, so "text/chapter-01.xhtml" in "OEBPS/content.opf" means
 * "OEBPS/text/chapter-01.xhtml".
 *
 * @param {string} base the folder of the package inside the archive
 * @param {string} href the reference from the package
 * @returns {string} the path inside the archive
 */
export function resolveArchivePath(base, href) {
  const parts = String(base ?? '').split('/').concat(decodeHref(href).split('/'));
  const out = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }

  return out.join('/');
}

/**
 * The titles of the chapters, taken from the navigation document.
 *
 * A book usually carries a "nav" document — its table of contents — and the
 * titles in it are much better than the file names.
 *
 * @param {ZipArchive} archive
 * @param {string} navPath where the navigation document lives in the archive
 * @returns {Map<string, string>} the path of a chapter → its title
 */
export function readNavTitles(archive, navPath) {
  const titles = new Map();

  const xml = archive.readText(navPath);
  if (!xml) return titles;

  const { root } = parseXml(xml);
  const base = dirname(navPath);

  const walk = (node) => {
    for (const child of childElements(node)) {
      if (child.local === 'a') {
        const href = child.attrs.href ?? '';
        const text = textOf(child);
        if (href && text) titles.set(resolveArchivePath(base, href), text);
      }
      walk(child);
    }
  };
  walk(root);

  return titles;
}

/**
 * The shape of an EPUB: where its package is, and what the package says.
 *
 * @param {ZipArchive} archive
 * @returns {{rootfile: string, package: object, chapters: object[]}}
 */
export function readEpubStructure(archive, parseOpf) {
  const mimetype = archive.readText('mimetype');
  const containerXml = archive.readText('META-INF/container.xml');

  if (!containerXml) {
    const error = new Error('This file is not an EPUB — it has no META-INF/container.xml.');
    error.code = 'EPUB_NO_CONTAINER';
    throw error;
  }

  const { rootfile, rootfiles } = parseContainer(containerXml);
  if (!rootfile) {
    const error = new Error('This EPUB has no package document — container.xml points nowhere.');
    error.code = 'EPUB_NO_PACKAGE';
    throw error;
  }

  const opfXml = archive.readText(rootfile);
  if (!opfXml) {
    const error = new Error(`The package of this EPUB is missing (${rootfile}).`);
    error.code = 'EPUB_NO_PACKAGE';
    throw error;
  }

  const model = parseOpf(opfXml);
  const base = dirname(rootfile);

  // The navigation document holds the real titles of the chapters.
  const nav = model.manifest.find((item) => item.properties.includes('nav'));
  const titles = nav ? readNavTitles(archive, resolveArchivePath(base, nav.href)) : new Map();

  const chapters = model.spine.items.map((item, index) => {
    const path = resolveArchivePath(base, item.href);
    return {
      index,
      idref: item.idref,
      title: titles.get(path) || item.title,
      href: item.href,
      mediaType: item.mediaType,
      linear: item.linear,
      path,
    };
  });

  return {
    mimetype: (mimetype ?? '').trim(),
    rootfile,
    rootfiles,
    base,
    package: model,
    chapters,
  };
}
