// 0xMD — code block node view.
//
// Fenced code blocks are edited in a real code editor; 0xMD uses
// CodeMirror 6 for the same job.

import { EditorView, keymap, highlightActiveLine, drawSelection, lineNumbers, highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';

// The language modes are loaded when a block asks for one. A document
// without code should not pay for twelve parsers — and the editor starts
// in a fraction of the time.
const LANGUAGE_LOADERS = {
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  php: () => import('@codemirror/lang-php').then((m) => m.php()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
};

const LANGUAGE_ALIASES = {
  js: 'javascript', jsx: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'javascript', tsx: 'javascript', typescript: 'javascript',
  py: 'python', python: 'python', python3: 'python',
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html', vue: 'html', svg: 'html', xml: 'html',
  css: 'css', scss: 'css', less: 'css',
  json: 'json', json5: 'json',
  sql: 'sql',
  rs: 'rust', rust: 'rust',
  java: 'java',
  cpp: 'cpp', 'c++': 'cpp', c: 'cpp', h: 'cpp', hpp: 'cpp', cc: 'cpp',
  php: 'php',
  go: 'go', golang: 'go',
};

/** The language of a fence, or null when it is not one we know. */
function languageKey(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  return LANGUAGE_ALIASES[key] || LANGUAGE_ALIASES[key.split(/[\s:-]/)[0]] || null;
}

export function codeBlockView(node, view, getPos) {
  const dom = document.createElement('div');
  dom.className = 'md-code-block';

  const header = document.createElement('div');
  header.className = 'md-code-header';

  const langLabel = document.createElement('span');
  langLabel.className = 'md-code-lang';

  const controls = document.createElement('div');
  controls.className = 'md-code-controls';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'md-code-button';
  copyButton.textContent = 'Copy';
  copyButton.title = 'Copy code';
  copyButton.addEventListener('mousedown', (event) => event.preventDefault());
  copyButton.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(cm.state.doc.toString());
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 1200);
    } catch {
      copyButton.textContent = 'Failed';
      setTimeout(() => { copyButton.textContent = 'Copy'; }, 1200);
    }
  });

  controls.append(copyButton);
  header.append(langLabel, controls);

  const cmHost = document.createElement('div');
  cmHost.className = 'md-code-editor';

  dom.append(header, cmHost);

  const languageCompartment = new Compartment();
  let params = node.attrs.params || '';
  let languageToken = 0;
  let destroyed = false;

  /**
   * Give the block its language. The mode is fetched in the background —
   * the block is usable before it arrives.
   */
  async function setLanguage(name) {
    const token = ++languageToken;
    const key = languageKey(name);

    if (!key) {
      cm.dispatch({ effects: languageCompartment.reconfigure([]) });
      return;
    }

    const loader = LANGUAGE_LOADERS[key];
    if (!loader) return;

    try {
      const language = await loader();
      // A newer language may have won the race while this one was loading.
      if (token !== languageToken || destroyed) return;
      cm.dispatch({ effects: languageCompartment.reconfigure(language) });
    } catch {
      /* the mode could not be loaded — the block stays uncoloured */
    }
  }

  const cm = new EditorView({
    state: EditorState.create({
      doc: node.textContent,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightSpecialChars(),
        rectangularSelection(),
        crosshairCursor(),
        lineNumbers(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        languageCompartment.of([]),
        EditorView.lineWrapping,
        EditorState.tabSize.of(4),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          syncToEditor(update.state.doc.toString());
        }),
      ],
    }),
    parent: cmHost,
  });

  langLabel.textContent = params || 'text';
  setLanguage(params);

  // Push editor changes into ProseMirror.
  let syncing = false;
  function syncToEditor(text) {
    if (syncing) return;
    const pos = getPos();
    if (pos == null) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.textContent === text) return;

    syncing = true;
    const tr = view.state.tr.replaceWith(
      pos + 1,
      pos + 1 + node.content.size,
      view.state.schema.text(text),
    );
    view.dispatch(tr);
    syncing = false;
  }

  return {
    dom,
    contentDOM: cm.dom,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      const nextParams = updatedNode.attrs.params || '';
      if (nextParams !== params) {
        params = nextParams;
        langLabel.textContent = nextParams || 'text';
        setLanguage(nextParams);
      }
      const nextText = updatedNode.textContent;
      const currentText = cm.state.doc.toString();
      if (nextText !== currentText && !cm.hasFocus) {
        syncing = true;
        cm.dispatch({ changes: { from: 0, to: currentText.length, insert: nextText } });
        syncing = false;
      }
      return true;
    },
    ignoreMutation() {
      // CodeMirror owns its own DOM; ProseMirror must not try to read it.
      return true;
    },
    stopEvent(event) {
      // Let CodeMirror handle everything that happens inside the editor.
      return cm.dom.contains(event.target) && event.target !== cm.dom;
    },
    destroy() {
      destroyed = true;
      cm.destroy();
    },
  };
}
