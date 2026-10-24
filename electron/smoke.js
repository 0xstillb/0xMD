// 0xMD — automated smoke test.
//
// Runs inside the real renderer against the real DOM, so it proves the whole
// stack works: markdown → node model → ProseMirror → DOM.

export const SMOKE_SCRIPT = `(async () => {
  const checks = [];
  const errors = [];
  const check = (name, condition, detail) => {
    if (condition) checks.push(name);
    else errors.push(name + (detail ? ' :: ' + detail : ''));
  };

  try {
  const ready = await new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      if (window.__0xmdReady) return resolve(true);
      if (Date.now() - started > 20000) return resolve(false);
      setTimeout(poll, 100);
    };
    poll();
  });
  check('renderer booted', ready);
  if (!ready) return { ok: false, checks, errors };

  const api = window.__0xmd;
  check('internals exposed', !!api);

  const source = [
    '# Heading One',
    '',
    'Hello **bold** world with $x^2$ maths.',
    '',
    '- [x] finished',
    '- [ ] pending',
    '',
    '~~~js',
    'const a = 1;',
    '~~~',
    '',
    '$$',
    'a^2 + b^2',
    '$$',
    '',
    '> quoted',
    '',
    '| h | k |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '[link](https://example.com)',
  ].join('\\n');

  const doc = api.parseMarkdown(source);
  const view = api.state.view;
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
  await new Promise((resolve) => setTimeout(resolve, 900));

  const host = document.getElementById('editor-host');
  check('editor surface exists', !!host.querySelector('.ProseMirror'));
  check('heading rendered', (host.querySelector('h1')?.textContent || '').indexOf('Heading One') >= 0);
  check('bold mark rendered', !!host.querySelector('strong'));
  check('inline math rendered', !!host.querySelector('.md-math-inline .katex'));
  check('task checkboxes rendered', host.querySelectorAll('.md-task-checkbox').length === 2);
  check('code block editor rendered', !!host.querySelector('.md-code-block .cm-editor'));
  check('block math rendered', !!host.querySelector('.md-math-block .katex'));
  check('blockquote rendered', !!host.querySelector('blockquote'));
  check('table cells rendered', host.querySelectorAll('table td').length === 2);
  check('link rendered', !!host.querySelector('a[href="https://example.com"]'));

  const outline = api.state.outline;
  check('outline generated', outline.length >= 1 && outline[0].text === 'Heading One');

  const md = api.currentMarkdown();
  check('markdown keeps heading', md.indexOf('# Heading One') >= 0);
  check('markdown keeps task', md.indexOf('- [x] finished') >= 0);
  check('markdown keeps table', md.indexOf('| h | k |') >= 0);
  check('markdown keeps block math', md.indexOf('$$') >= 0);
  check('markdown keeps code fence', md.indexOf('~~~js') >= 0 || md.indexOf('const a = 1;') >= 0);
  check('markdown keeps link', md.indexOf('[link](https://example.com)') >= 0);

  const html = api.buildExportHtml();
  check('export html produced', html.indexOf('Heading One') >= 0);

  // ---- the theme system and the preferences dialog ---------------------
  const themes = ['github', 'night', 'newsprint', 'pixyll'];
  let themeOk = true;
  for (const theme of themes) {
    api.setTheme(theme);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const applied = document.documentElement.dataset.theme;
    if (applied !== theme) { themeOk = false; errors.push('theme ' + theme + ' not applied'); }
  }
  api.setTheme('github');
  check('all four themes apply', themeOk);

  api.openPreferences();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const modal = document.getElementById('settings-modal');
  const rows = document.querySelectorAll('#settings-body .settings-row').length;
  check('preferences dialog opens', modal && !modal.hidden);
  check('preferences has rows', rows >= 8, 'rows=' + rows);
  check('preferences lists the themes', document.querySelectorAll('#settings-body select option').length >= 4);
  document.getElementById('settings-close')?.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  check('preferences closes', modal.hidden);

  // ---- the sidebar handle must survive the sidebar being collapsed -----
  const toggle = document.getElementById('sidebar-toggle');
  const wasHidden = document.body.classList.contains('sidebar-hidden');
  toggle.click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const nowHidden = document.body.classList.contains('sidebar-hidden');
  check('sidebar toggles', nowHidden !== wasHidden);

  const handle = toggle.getBoundingClientRect();
  check('sidebar handle stays on screen', handle.left >= 0 && handle.right <= window.innerWidth && handle.width > 0,
    'rect=' + JSON.stringify({ left: handle.left, right: handle.right, width: handle.width }));

  toggle.click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  check('sidebar toggles back', document.body.classList.contains('sidebar-hidden') === wasHidden);

  // ---- the about dialog -------------------------------------------------
  await api.openAbout();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const about = document.getElementById('about-modal');
  check('about dialog opens', about && !about.hidden);
  check('about shows the licence', (document.getElementById('about-facts')?.textContent || '').includes('MIT'));
  check('about lists the dependencies', document.querySelectorAll('#about-deps li').length >= 6);
  document.getElementById('about-done')?.click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  check('about closes', about.hidden);

  // ---- the EPUB package viewer ------------------------------------------
  const opfSource = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">'
    + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + '<dc:identifier id="pub-id">urn:uuid:smoke</dc:identifier>'
    + '<dc:title>Smoke Book</dc:title>'
    + '<dc:creator id="c1">Ada Lovelace</dc:creator>'
    + '<meta refines="#c1" property="role">aut</meta>'
    + '<dc:language>en</dc:language>'
    + '<meta name="cover" content="cover-image"/>'
    + '</metadata>'
    + '<manifest>'
    + '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
    + '<item id="ch1" href="text/chapter-01.xhtml" media-type="application/xhtml+xml"/>'
    + '</manifest>'
    + '<spine><itemref idref="ch1"/></spine>'
    + '</package>';

  const model = api.parseOpf(opfSource);
  check('package parsed', !!model);
  check('package title read', model && model.metadata.title === 'Smoke Book');
  check('package author read', model && model.metadata.creators[0].name === 'Ada Lovelace');
  check('package author role read', model && model.metadata.creators[0].role === 'aut');
  check('package cover found', model && model.metadata.cover && model.metadata.cover.href === 'images/cover.jpg');
  check('package manifest read', model && model.manifest.length === 2);
  check('package spine read', model && model.spine.items.length === 1 && model.spine.items[0].href === 'text/chapter-01.xhtml');

  const opfHost = document.createElement('div');
  opfHost.className = 'opf-host';
  document.getElementById('editor-host').append(opfHost);
  const rendered = api.renderOpf(opfHost, { model, raw: opfSource });
  check('package viewer renders the title', (opfHost.querySelector('.opf-title')?.textContent || '').indexOf('Smoke Book') >= 0);
  check('package viewer lists the metadata', opfHost.querySelectorAll('.opf-meta-row').length >= 4);
  check('package viewer lists the manifest', opfHost.querySelectorAll('.opf-table tbody tr').length === 2);
  check('package viewer lists the reading order', opfHost.querySelectorAll('.opf-spine-item').length === 1);
  check('package viewer has sections', rendered.sections.length === 3);
  check('package summary is markdown', api.opfToMarkdown(model).indexOf('# Smoke Book') === 0);
  opfHost.remove();

  // ---- opening a package from disk --------------------------------------
  const info = await window.api.info();
  const separator = info.platform === 'win32' ? '\\\\' : '/';
  const opfPath = info.tempDir + separator + '0xmd-smoke.opf';
  await window.api.saveFile(opfPath, opfSource);
  await api.openDocument(opfPath);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const editorHost = document.getElementById('editor-host');
  check('opening a package shows the package surface', !!editorHost.querySelector('.opf-view'));
  check('opening a package hides the editor', editorHost.classList.contains('is-opf'));
  check('opening a package shows the title', (editorHost.querySelector('.opf-title')?.textContent || '').indexOf('Smoke Book') >= 0);
  check('opening a package fills the status bar', (document.getElementById('status-words').textContent || '').indexOf('EPUB') >= 0);
  check('opening a package fills the outline', api.state.outline.length === 3);
  check('opening a package is read-only', api.state.fileType === 'opf');

  // ---- and back to a Markdown document ----------------------------------
  const mdPath = info.tempDir + separator + '0xmd-smoke.md';
  await window.api.saveFile(mdPath, '# Smoke Doc\\n\\nHello.');
  await api.openDocument(mdPath);
  await new Promise((resolve) => setTimeout(resolve, 500));
  check('a Markdown file brings the editor back', !editorHost.classList.contains('is-opf'));
  check('a Markdown file removes the package surface', !editorHost.querySelector('.opf-view'));
  check('a Markdown file is editable again', api.state.fileType === 'markdown');

  // ---- an EPUB book ------------------------------------------------------
  const bookPath = info.appRoot + separator + 'demo' + separator + 'book.epub';
  let bookThere = true;
  try {
    await window.api.readFile(bookPath);
  } catch {
    bookThere = false;
  }

  if (bookThere) {
    await api.openDocument(bookPath);
    await new Promise((resolve) => setTimeout(resolve, 700));

    check('opening a book shows the package surface', !!editorHost.querySelector('.opf-view'));
    check('opening a book shows the title', (editorHost.querySelector('.opf-title')?.textContent || '').indexOf('Lighthouse') >= 0);
    check('opening a book lists the chapters', editorHost.querySelectorAll('.opf-spine-item').length === 4);
    check('opening a book fills the status bar', (document.getElementById('status-words').textContent || '').indexOf('EPUB') >= 0);
    check('opening a book is read-only', api.state.fileType === 'epub');

    // A chapter is opened from the reading order. The first entry is the
    // table of contents, the second one is a chapter of the book.
    const chapterLinks = editorHost.querySelectorAll('.opf-spine-item .opf-link-inline');
    check('the reading order offers a chapter', chapterLinks.length >= 2);
    const chapterButton = chapterLinks[1];
    if (chapterButton) {
      chapterButton.click();
      await new Promise((resolve) => setTimeout(resolve, 700));

      check('a chapter brings the editor back', !editorHost.classList.contains('is-opf'));
      check('a chapter shows a banner', !!editorHost.querySelector('.epub-banner'));
      check('a chapter is a document', api.state.fileType === 'epub-chapter');

      const text = api.currentMarkdown();
      check('a chapter has text', text.length > 40, 'length=' + text.length);
      check('a chapter has a heading', /(^|\\n)#{1,3} /.test(text), text.slice(0, 80));
      check('a chapter keeps its words', text.indexOf('ninety-one steps') >= 0, text.slice(0, 120));
      check('a chapter keeps its emphasis', text.indexOf('*never once*') >= 0, text.slice(0, 200));
      check('a chapter is in the outline', api.state.outline.length >= 1);

      // Back to the book.
      editorHost.querySelector('.epub-back')?.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      check('the back button returns to the book', api.state.fileType === 'epub' && !!editorHost.querySelector('.opf-view'));
    }
  }

  // ---- and back to a Markdown document, once more ------------------------
  await api.openDocument(mdPath);
  await new Promise((resolve) => setTimeout(resolve, 400));
  check('the editor comes back after a book', api.state.fileType === 'markdown');

  // ---- the MCP server can be switched off and on -------------------------
  const switchedOff = await api.configureMcp({ enabled: false });
  check('mcp can be switched off', switchedOff && switchedOff.running === false, JSON.stringify(switchedOff));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const switchedOn = await api.configureMcp({ enabled: true });
  check('mcp can be switched back on', switchedOn && switchedOn.running === true, JSON.stringify(switchedOn));

  return { ok: errors.length === 0, checks, errors };
  } catch (err) {
    return {
      ok: false,
      checks,
      errors: errors.concat(['exception: ' + (err && err.message ? err.message : String(err))]),
      stack: err && err.stack ? String(err.stack).split('\\n').slice(0, 8).join(' | ') : null,
    };
  }
})()`;
