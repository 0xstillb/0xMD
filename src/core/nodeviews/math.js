// 0xMD — maths node views.
//
// KaTeX renders to HTML + CSS rather than a large SVG blob, and it is
// far lighter than a full typesetting engine.

import { loadKatex } from '../renderers.js';

function renderKatex(target, latex, displayMode) {
  // The source is shown first; KaTeX arrives a moment later and takes over.
  target.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`;

  const token = String(Number(target.dataset.katexToken || 0) + 1);
  target.dataset.katexToken = token;

  loadKatex()
    .then((katex) => {
      // A newer formula may have won the race, or the block may be gone.
      if (!target.isConnected || target.dataset.katexToken !== token) return;
      try {
        katex.render(latex, target, {
          displayMode,
          throwOnError: false,
          strict: false,
          trust: false,
          output: 'html',
          macros: {
            '\\RR': '\\mathbb{R}',
            '\\NN': '\\mathbb{N}',
            '\\ZZ': '\\mathbb{Z}',
            '\\QQ': '\\mathbb{Q}',
            '\\CC': '\\mathbb{C}',
          },
        });
      } catch (err) {
        target.classList.add('md-math-error');
        target.textContent = latex;
        target.title = String(err?.message || err);
      }
    })
    .catch(() => {
      /* KaTeX could not be loaded — the source stays visible */
    });
}

/* ------------------------------------------------------------------ *
 * Block maths — renders the formula, click to edit the source.
 * ------------------------------------------------------------------ */

export function mathBlockView(node, view, getPos) {
  const dom = document.createElement('div');
  dom.className = 'md-math-block md-rawblock';

  const output = document.createElement('div');
  output.className = 'md-math-block-output';

  const editor = document.createElement('textarea');
  editor.className = 'md-math-block-editor';
  editor.spellcheck = false;
  editor.hidden = true;

  const toolbar = document.createElement('div');
  toolbar.className = 'md-rawblock-control md-rawblock-before';
  toolbar.textContent = '$$';

  dom.append(toolbar, output, editor);

  let latex = node.textContent;
  let editing = false;

  const paint = () => {
    renderKatex(output, latex, true);
  };
  paint();

  const setEditing = (next) => {
    editing = next;
    editor.hidden = !next;
    output.hidden = next;
    if (next) {
      editor.value = latex;
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    } else {
      commit();
    }
  };

  const commit = () => {
    const next = editor.value;
    if (next === latex) return;
    latex = next;
    paint();
    const pos = getPos();
    if (pos == null) return;
    const tr = view.state.tr.replaceWith(
      pos + 1,
      pos + 1 + nodeView.node.content.size,
      view.state.schema.text(next),
    );
    view.dispatch(tr);
  };

  editor.addEventListener('blur', () => setEditing(false));
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      setEditing(false);
    }
  });

  output.addEventListener('click', () => setEditing(true));
  dom.addEventListener('dblclick', (event) => {
    if (event.target === output) setEditing(true);
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      const nextLatex = updatedNode.textContent;
      if (nextLatex === latex) return true;
      latex = nextLatex;
      if (!editing) {
        paint();
      } else {
        editor.value = latex;
      }
      return true;
    },
    selectNode() {
      dom.classList.add('md-selected');
    },
    deselectNode() {
      dom.classList.remove('md-selected');
    },
    ignoreMutation() {
      return true;
    },
    stopEvent(event) {
      return event.target === editor;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Inline maths — same idea, rendered inline.
 *
 * Inline node views get a different signature than block node views:
 * they receive the node itself, not a nodeView wrapper.
 * ------------------------------------------------------------------ */

export function mathInlineView(node, view, getPos) {
  const dom = document.createElement('span');
  dom.className = 'md-math-inline';
  dom.contentEditable = 'false';

  const editor = document.createElement('span');
  editor.className = 'md-math-inline-editor';
  editor.contentEditable = 'false';
  editor.spellcheck = false;
  editor.hidden = true;

  let latex = node.attrs.latex;
  let editing = false;

  const paint = () => renderKatex(dom, latex, false);

  const setEditing = (next) => {
    editing = next;
    editor.hidden = !next;
    dom.hidden = next;
    if (next) {
      editor.textContent = latex;
      requestAnimationFrame(() => {
        editor.contentEditable = 'true';
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    } else {
      commit();
    }
  };

  const commit = () => {
    const next = editor.textContent.replace(/\u00a0/g, ' ').trim();
    latex = next;
    paint();
    const pos = getPos();
    if (pos == null) return;
    const tr = view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, latex: next });
    view.dispatch(tr);
  };

  editor.addEventListener('blur', () => setEditing(false));
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
    event.stopPropagation();
  });

  dom.addEventListener('click', () => setEditing(true));

  const wrapper = document.createElement('span');
  wrapper.className = 'md-math-inline-wrapper';
  wrapper.append(dom, editor);
  paint();

  return {
    dom: wrapper,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      const nextLatex = updatedNode.attrs.latex;
      if (nextLatex === latex) return true;
      latex = nextLatex;
      if (!editing) paint();
      else editor.textContent = latex;
      return true;
    },
    ignoreMutation() {
      return true;
    },
    stopEvent(event) {
      return event.target === editor;
    },
  };
}
