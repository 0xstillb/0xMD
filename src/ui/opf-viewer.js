// 0xMD — the EPUB package viewer.
//
// A .opf file is not a document 0xMD can edit — it is the index of an EPUB.
// So it gets its own surface: the metadata of the book, the files it
// contains and the order they are read in, laid out as tables.
//
// The viewer is read-only. It never writes to the file; the one thing it
// offers is a Markdown summary of what it found.

/** A short element helper. */
function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The name a file is shown under. */
function fileLabel(href) {
  const name = String(href ?? '').split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
  return name || href || '';
}

/**
 * Render an EPUB package document.
 *
 * @param {HTMLElement} container
 * @param {object} options
 * @param {object|null} options.model the parsed package
 * @param {Error|null} options.error why the file could not be read
 * @param {string} options.raw the raw XML, shown on request
 * @param {(href: string) => void} options.onReveal called with an href
 * @param {(item: object) => void} options.onOpenChapter called with a chapter of a book
 * @param {() => void} options.onSaveMarkdown called by "Save as Markdown…"
 * @returns {{sections: {id: string, title: string}[]}}
 */
export function renderOpf(container, { model, error = null, raw = '', onReveal, onOpenChapter, onSaveMarkdown } = {}) {
  container.innerHTML = '';

  const view = h('div', 'opf-view');
  const sections = [];

  if (error || !model) {
    const box = h('div', 'opf-error');
    box.append(h('div', 'opf-error-title', 'This file could not be read as an EPUB package.'));
    box.append(h('p', 'opf-error-text', error?.message || 'Unknown error.'));
    if (raw) {
      const pre = h('pre', 'opf-raw', raw);
      pre.hidden = false;
      box.append(pre);
    }
    view.append(box);
    container.append(view);
    return { sections };
  }

  const { metadata, manifest, spine, guide } = model;

  /* ---- header ------------------------------------------------------ */

  const header = h('header', 'opf-head');

  const kicker = h('div', 'opf-kicker');
  kicker.append(h('span', 'opf-kicker-label', 'EPUB package'));
  if (model.version) kicker.append(h('span', 'opf-kicker-version', `EPUB ${model.version}`));
  header.append(kicker);

  header.append(h('h1', 'opf-title', metadata.title || 'Untitled package'));
  if (metadata.subtitle) header.append(h('div', 'opf-subtitle', metadata.subtitle));

  const bylineParts = [
    metadata.creators.map((person) => person.name).filter(Boolean).join(', '),
    metadata.publisher,
    metadata.date,
  ].filter(Boolean);
  if (bylineParts.length) header.append(h('div', 'opf-byline', bylineParts.join(' · ')));

  const chips = h('div', 'opf-chips');
  if (metadata.language) chips.append(h('span', 'opf-chip', metadata.language));
  chips.append(h('span', 'opf-chip', `${manifest.length} file${manifest.length === 1 ? '' : 's'}`));
  chips.append(h('span', 'opf-chip', `${spine.items.length} in reading order`));
  header.append(chips);

  const actions = h('div', 'opf-actions');
  const rawButton = h('button', 'opf-button', 'View XML');
  rawButton.type = 'button';
  actions.append(rawButton);

  const markdownButton = h('button', 'opf-button', 'Save as Markdown…');
  markdownButton.type = 'button';
  markdownButton.addEventListener('click', () => onSaveMarkdown?.());
  actions.append(markdownButton);
  header.append(actions);

  view.append(header);

  /* ---- metadata ---------------------------------------------------- */

  const metaSection = h('section', 'opf-section');
  metaSection.id = 'opf-section-metadata';
  metaSection.append(h('h2', 'opf-section-title', 'Metadata'));
  sections.push({ id: metaSection.id, title: 'Metadata' });

  const list = h('dl', 'opf-metadata');
  const rows = [
    ['Title', metadata.title],
    ['Subtitle', metadata.subtitle],
    ['Author', metadata.creators.map((person) => (person.role ? `${person.name} (${person.role})` : person.name)).join(', ')],
    ['Contributor', metadata.contributors.map((person) => (person.role ? `${person.name} (${person.role})` : person.name)).join(', ')],
    ['Language', metadata.language],
    ['Publisher', metadata.publisher],
    ['Date', metadata.date],
    ['Description', metadata.description],
    ['Rights', metadata.rights],
    ['Subject', metadata.subjects.join(', ')],
    ...metadata.identifiers.map((identifier) => [identifier.scheme ? `Identifier (${identifier.scheme})` : 'Identifier', identifier.value]),
    ['Cover', metadata.cover?.href || ''],
    ['Package version', model.version],
    ['Unique identifier', model.uniqueIdentifier],
  ].filter(([, value]) => String(value ?? '').trim());

  if (rows.length) {
    for (const [label, value] of rows) {
      const row = h('div', 'opf-meta-row');
      row.append(h('dt', 'opf-meta-label', label));
      row.append(h('dd', 'opf-meta-value', String(value)));
      list.append(row);
    }
  } else {
    list.append(h('div', 'opf-meta-empty', 'This package carries no metadata.'));
  }
  metaSection.append(list);

  if (metadata.metas.length) {
    const extras = h('div', 'opf-meta-extra');
    for (const entry of metadata.metas) {
      const key = entry.name || entry.property;
      if (!key) continue;
      const item = h('div', 'opf-meta-extra-item');
      item.append(h('span', 'opf-meta-extra-key', key));
      item.append(h('span', 'opf-meta-extra-value', entry.value));
      extras.append(item);
    }
    metaSection.append(extras);
  }

  view.append(metaSection);

  /* ---- manifest ---------------------------------------------------- */

  const manifestSection = h('section', 'opf-section');
  manifestSection.id = 'opf-section-manifest';
  const manifestTitle = h('h2', 'opf-section-title', 'Manifest');
  manifestTitle.append(h('span', 'opf-section-count', `${manifest.length}`));
  manifestSection.append(manifestTitle);
  sections.push({ id: manifestSection.id, title: 'Manifest' });

  if (manifest.length) {
    const table = h('table', 'opf-table');
    const head = h('thead');
    const headRow = h('tr');
    for (const label of ['ID', 'File', 'Media type', 'Properties']) headRow.append(h('th', null, label));
    head.append(headRow);
    table.append(head);

    const body = h('tbody');
    for (const item of manifest) {
      const row = h('tr');
      row.append(h('td', 'opf-cell-id', item.id));

      const fileCell = h('td', 'opf-cell-file');
      if (onReveal) {
        const link = h('button', 'opf-link', fileLabel(item.href));
        link.type = 'button';
        link.title = item.href ? `${item.href} — click to show the file` : '';
        link.addEventListener('click', () => onReveal(item.href));
        fileCell.append(link);
      } else {
        // The file of a book lives inside the archive — there is nothing
        // on disk to show.
        fileCell.append(h('span', 'opf-file', fileLabel(item.href)));
      }
      row.append(fileCell);

      row.append(h('td', 'opf-cell-type', item.mediaType));
      row.append(h('td', 'opf-cell-props', item.properties.join(' ')));
      body.append(row);
    }
    table.append(body);
    manifestSection.append(table);
  } else {
    manifestSection.append(h('div', 'opf-empty', 'The manifest is empty.'));
  }

  view.append(manifestSection);

  /* ---- reading order ----------------------------------------------- */

  const spineSection = h('section', 'opf-section');
  spineSection.id = 'opf-section-spine';
  const spineTitle = h('h2', 'opf-section-title', 'Reading order');
  spineTitle.append(h('span', 'opf-section-count', `${spine.items.length}`));
  spineSection.append(spineTitle);
  sections.push({ id: spineSection.id, title: 'Reading order' });

  if (spine.items.length) {
    const list2 = h('ol', 'opf-spine');
    spine.items.forEach((item) => {
      const entry = h('li', 'opf-spine-item');
      const main = h('div', 'opf-spine-main');
      main.append(h('span', 'opf-spine-title', item.title || item.idref));

      // A chapter of a book is opened; a file of a package is shown.
      const file = h('button', 'opf-link opf-link-inline', fileLabel(item.href));
      file.type = 'button';
      if (item.path && onOpenChapter) {
        file.title = `Open the chapter “${item.title || item.path}”`;
        file.addEventListener('click', () => onOpenChapter(item));
      } else {
        file.title = item.href ? `${item.href} — click to show the file` : '';
        file.addEventListener('click', () => onReveal?.(item.href));
      }
      main.append(file);
      entry.append(main);

      const tags = h('div', 'opf-spine-tags');
      if (item.mediaType) tags.append(h('span', 'opf-tag', item.mediaType));
      if (item.linear === 'no') tags.append(h('span', 'opf-tag opf-tag-warn', 'non-linear'));
      for (const property of item.properties) tags.append(h('span', 'opf-tag', property));
      if (tags.childElementCount) entry.append(tags);

      list2.append(entry);
    });
    spineSection.append(list2);
  } else {
    spineSection.append(h('div', 'opf-empty', 'The spine is empty.'));
  }

  view.append(spineSection);

  /* ---- guide ------------------------------------------------------- */

  if (guide.length) {
    const guideSection = h('section', 'opf-section');
    guideSection.id = 'opf-section-guide';
    const guideTitle = h('h2', 'opf-section-title', 'Guide');
    guideTitle.append(h('span', 'opf-section-count', `${guide.length}`));
    guideSection.append(guideTitle);
    sections.push({ id: guideSection.id, title: 'Guide' });

    const table = h('table', 'opf-table');
    const head = h('thead');
    const headRow = h('tr');
    for (const label of ['Type', 'Title', 'File']) headRow.append(h('th', null, label));
    head.append(headRow);
    table.append(head);

    const body = h('tbody');
    for (const reference of guide) {
      const row = h('tr');
      row.append(h('td', 'opf-cell-id', reference.type));
      const titleCell = h('td');
      titleCell.append(h('span', null, reference.title));
      row.append(titleCell);
      const fileCell = h('td', 'opf-cell-file');
      if (onReveal) {
        const link = h('button', 'opf-link', fileLabel(reference.href));
        link.type = 'button';
        link.title = reference.href ? `${reference.href} — click to show the file` : '';
        link.addEventListener('click', () => onReveal(reference.href));
        fileCell.append(link);
      } else {
        fileCell.append(h('span', 'opf-file', fileLabel(reference.href)));
      }
      row.append(fileCell);
      body.append(row);
    }
    table.append(body);
    guideSection.append(table);

    view.append(guideSection);
  }

  /* ---- the raw XML -------------------------------------------------- */

  const rawBlock = h('pre', 'opf-raw', raw);
  rawBlock.hidden = true;
  view.append(rawBlock);

  rawButton.addEventListener('click', () => {
    rawBlock.hidden = !rawBlock.hidden;
    rawButton.textContent = rawBlock.hidden ? 'View XML' : 'Hide XML';
    if (!rawBlock.hidden) rawBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  container.append(view);
  return { sections };
}
