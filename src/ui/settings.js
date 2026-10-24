// 0xMD — preferences modal.

const THEMES = [
  { id: 'github', name: 'GitHub' },
  { id: 'night', name: 'Night' },
  { id: 'newsprint', name: 'Newsprint' },
  { id: 'pixyll', name: 'Pixyll' },
];

const CODE_THEMES = ['github', 'github-dark', 'night-owl', 'dracula', 'nord'];

export function openSettings({ modal, body, settings, onSave, onClose, onAssocChanged }) {
  const draft = JSON.parse(JSON.stringify(settings));

  body.innerHTML = '';

  const section = (title) => {
    const wrap = document.createElement('section');
    wrap.className = 'settings-section';
    const heading = document.createElement('h3');
    heading.textContent = title;
    wrap.append(heading);
    body.append(wrap);
    return wrap;
  };

  const row = (parent, label, control, hint) => {
    const r = document.createElement('div');
    r.className = 'settings-row';
    const l = document.createElement('label');
    l.textContent = label;
    const c = document.createElement('div');
    c.className = 'settings-control';
    c.append(control);
    r.append(l, c);
    if (hint) {
      const h = document.createElement('p');
      h.className = 'settings-hint';
      h.textContent = hint;
      r.append(h);
    }
    parent.append(r);
    return control;
  };

  const select = (value, options) => {
    const el = document.createElement('select');
    options.forEach((option) => {
      const opt = document.createElement('option');
      opt.value = typeof option === 'string' ? option : option.id;
      opt.textContent = typeof option === 'string' ? option : option.name;
      if (opt.value === value) opt.selected = true;
      el.append(opt);
    });
    return el;
  };

  const checkbox = (value, onChange) => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = !!value;
    el.addEventListener('change', () => onChange?.(el.checked));
    return el;
  };

  const number = (value, min, max, step, onChange) => {
    const el = document.createElement('input');
    el.type = 'number';
    el.value = String(value);
    el.min = String(min);
    el.max = String(max);
    el.step = String(step);
    el.addEventListener('change', () => onChange?.(Number(el.value)));
    return el;
  };

  const text = (value, onChange) => {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = value ?? '';
    el.addEventListener('change', () => onChange?.(el.value));
    return el;
  };

  // ---- Appearance -------------------------------------------------------
  const appearance = section('Appearance');

  row(appearance, 'Theme', select(draft.theme, THEMES), 'The colour scheme of the document.').addEventListener('change', (event) => {
    draft.theme = event.target.value;
  });

  row(appearance, 'Code theme', select(draft.codeTheme, CODE_THEMES)).addEventListener('change', (event) => {
    draft.codeTheme = event.target.value;
  });

  row(appearance, 'Dark mode', checkbox(draft.themeDark, (checked) => { draft.themeDark = checked; })).addEventListener('change', (event) => {
    draft.themeDark = event.target.checked;
  });

  row(appearance, 'Font size', number(draft.fontSize, 10, 32, 1, (value) => { draft.fontSize = value; })).addEventListener('change', (event) => {
    draft.fontSize = Number(event.target.value);
  });

  row(appearance, 'Line height', number(draft.lineHeight, 1, 3, 0.05, (value) => { draft.lineHeight = value; })).addEventListener('change', (event) => {
    draft.lineHeight = Number(event.target.value);
  });

  row(appearance, 'Content width', number(draft.contentWidth, 0, 1600, 20, (value) => { draft.contentWidth = value; }), '0 = follow the theme (GitHub 860px, Night 914px, Newsprint 34em, Pixyll 914px)').addEventListener('change', (event) => {
    draft.contentWidth = Number(event.target.value);
  });

  row(appearance, 'Font family', text(draft.fontFamily, (value) => { draft.fontFamily = value; }), 'Leave empty to use the theme’s own typeface (Open Sans / PT Serif / Merriweather / Corbel)');

  // ---- Editor -----------------------------------------------------------
  const editor = section('Editor');

  row(editor, 'Show markdown syntax', select(draft.editor.showMarkdownSyntax, [
    { id: 'active', name: 'Only in the active block' },
    { id: 'all', name: 'Always' },
    { id: 'none', name: 'Never' },
  ])).addEventListener('change', (event) => {
    draft.editor.showMarkdownSyntax = event.target.value;
  });

  row(editor, 'Smart typography', checkbox(draft.typographer, (checked) => { draft.typographer = checked; })).addEventListener('change', (event) => {
    draft.typographer = event.target.checked;
  });

  row(editor, 'Spell check', checkbox(draft.spellcheck, (checked) => { draft.spellcheck = checked; })).addEventListener('change', (event) => {
    draft.spellcheck = event.target.checked;
  });

  // ---- Features ---------------------------------------------------------
  const features = section('Features');

  row(features, 'KaTeX maths', checkbox(draft.katexEnabled, (checked) => { draft.katexEnabled = checked; })).addEventListener('change', (event) => {
    draft.katexEnabled = event.target.checked;
  });

  row(features, 'Mermaid diagrams', checkbox(draft.mermaidEnabled, (checked) => { draft.mermaidEnabled = checked; })).addEventListener('change', (event) => {
    draft.mermaidEnabled = event.target.checked;
  });

  row(features, 'Show sidebar', checkbox(draft.showSidebar, (checked) => { draft.showSidebar = checked; })).addEventListener('change', (event) => {
    draft.showSidebar = event.target.checked;
  });

  // ---- file associations --------------------------------------------------
  const assoc = section('File associations');
  const assocNote = document.createElement('p');
  assocNote.className = 'settings-hint';
  assocNote.id = 'file-assoc-note';
  assocNote.textContent = 'Checking…';
  assoc.append(assocNote);

  const assocActions = document.createElement('div');
  assocActions.className = 'settings-actions';

  const assocButton = document.createElement('button');
  assocButton.type = 'button';
  assocButton.className = 'settings-link-button';
  assocButton.id = 'file-assoc-button';
  assocButton.textContent = 'Register 0xMD for .md and .opf files';
  assocButton.addEventListener('click', async () => {
    assocButton.disabled = true;
    assocButton.textContent = 'Working…';
    try {
      if (assocButton.dataset.mode === 'unregister') {
        await window.api.unregisterFileAssoc();
      } else {
        await window.api.registerFileAssoc();
      }
      await onAssocChanged?.();
    } finally {
      assocButton.disabled = false;
    }
  });

  assocActions.append(assocButton);
  assoc.append(assocActions);

  // ---- MCP --------------------------------------------------------------
  const mcp = section('MCP');
  const mcpNote = document.createElement('p');
  mcpNote.className = 'settings-hint';
  mcpNote.textContent = '0xMD exposes a local MCP server so AI agents can read and edit the open document. It listens on 127.0.0.1 only.';
  mcp.append(mcpNote);

  row(mcp, 'Enable MCP server', checkbox(draft.mcpEnabled, (checked) => { draft.mcpEnabled = checked; })).addEventListener('change', (event) => {
    draft.mcpEnabled = event.target.checked;
  });

  row(mcp, 'Port', number(draft.mcpPort, 1024, 65535, 1, (value) => { draft.mcpPort = value; }), 'The port the MCP server listens on. Changing it restarts the server.').addEventListener('change', (event) => {
    draft.mcpPort = Number(event.target.value);
  });

  const mcpActions = document.createElement('div');
  mcpActions.className = 'settings-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'settings-link-button';
  copyButton.textContent = 'Copy client configuration';
  copyButton.addEventListener('click', async () => {
    const { config } = await window.api.mcpClientConfig();
    try {
      await navigator.clipboard.writeText(config);
      copyButton.textContent = 'Copied — paste it into your MCP client';
      setTimeout(() => { copyButton.textContent = 'Copy client configuration'; }, 2200);
    } catch {
      copyButton.textContent = 'Copy failed';
    }
  });

  mcpActions.append(copyButton);
  mcp.append(mcpActions);

  modal.hidden = false;

  const save = () => {
    onSave?.(draft);
    close();
  };
  const close = () => {
    modal.hidden = true;
    onClose?.();
  };

  const saveButton = document.getElementById('settings-save');
  const closeButton = document.getElementById('settings-close');

  const onSaveClick = () => save();
  const onCloseClick = () => close();
  const onKeyDown = (event) => {
    if (event.key === 'Escape') close();
  };

  saveButton.addEventListener('click', onSaveClick);
  closeButton.addEventListener('click', onCloseClick);
  document.addEventListener('keydown', onKeyDown);

  return () => {
    saveButton.removeEventListener('click', onSaveClick);
    closeButton.removeEventListener('click', onCloseClick);
    document.removeEventListener('keydown', onKeyDown);
  };
}
