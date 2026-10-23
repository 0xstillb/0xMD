// 0xMD — code block node view.
//
// Fenced code blocks are edited in a real code editor; 0xMD uses
// CodeMirror 6 for the same job.

import { EditorView, keymap, highlightActiveLine, drawSelection, lineNumbers, highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { rust } from '@codemirror/lang-rust';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { go } from '@codemirror/lang-go';

const LANGUAGES = {
  js: javascript, jsx: javascript, javascript: javascript, mjs: javascript, cjs: javascript,
  ts: javascript, tsx: javascript, typescript: javascript,
  py: python, python: python, python3: python,
  md: markdown, markdown: markdown,
  html: html, htm: html, vue: html, svg: html, xml: html,
  css: css, scss: css, less: css,
  json: json, json5: json,
  sql: sql,
  rs: rust, rust: rust,
  java: java,
  cpp: cpp, 'c++': cpp, c: cpp, h: cpp, hpp: cpp, cc: cpp,
  php: php,
  go: go, golang: go,
};

function languageFor(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  const factory = LANGUAGES[key] || LANGUAGES[key.split(/[\s:-]/)[0]];
  // CodeMirror wants the extension itself, not the factory.
  return factory ? factory() : null;
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
  const params = node.attrs.params || '';

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

  const lang = languageFor(params);
  if (lang) {
    cm.dispatch({ effects: languageCompartment.reconfigure(lang) });
  }
  langLabel.textContent = params || 'text';

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
        langLabel.textContent = nextParams || 'text';
        const nextLang = languageFor(nextParams);
        cm.dispatch({ effects: languageCompartment.reconfigure(nextLang ? nextLang : []) });
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
      cm.destroy();
    },
  };
}
