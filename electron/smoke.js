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
