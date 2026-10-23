// 0xMD — find & replace inside the document.

import { TextSelection } from 'prosemirror-state';

export function createFind({ view, panel, input, replaceInput, status, onClose }) {
  let matches = [];
  let index = -1;

  const readOnly = () => view.state.doc.content.size <= 2;

  function collect() {
    const needle = input.value;
    matches = [];
    if (!needle) return;

    const doc = view.state.doc;
    const text = doc.textBetween(0, doc.content.size, '\n', '\n');
    let from = 0;
    let guard = 0;
    while (guard++ < 20000) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      matches.push(at);
      from = at + Math.max(1, needle.length);
    }
  }

  /** Translate a plain-text offset into a ProseMirror document position. */
  function offsetToPos(offset) {
    const doc = view.state.doc;
    let remaining = offset;
    let pos = 0;
    doc.descendants((node, nodePos) => {
      if (remaining < 0) return false;
      const size = node.textContent.length;
      if (node.isText) {
        if (remaining <= size) {
          pos = nodePos + remaining;
          remaining = -1;
          return false;
        }
        remaining -= size;
      }
      return true;
    });
    return Math.min(pos, doc.content.size);
  }

  function updateStatus(message) {
    status.textContent = message;
  }

  function goto(matchIndex) {
    if (!matches.length) {
      updateStatus(input.value ? 'No results' : '');
      return;
    }
    index = ((matchIndex % matches.length) + matches.length) % matches.length;
    const start = offsetToPos(matches[index]);
    const end = start + input.value.length;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)).scrollIntoView(),
    );
    updateStatus(`${index + 1} of ${matches.length}`);
  }

  function findNext(backwards = false) {
    collect();
    if (!matches.length) {
      updateStatus(input.value ? 'No results' : '');
      return;
    }
    const current = view.state.selection.from;
    let target = -1;
    if (!backwards) {
      for (let i = 0; i < matches.length; i++) {
        if (offsetToPos(matches[i]) > current) { target = i; break; }
      }
      if (target < 0) target = 0;
    } else {
      for (let i = matches.length - 1; i >= 0; i--) {
        if (offsetToPos(matches[i]) < current) { target = i; break; }
      }
      if (target < 0) target = matches.length - 1;
    }
    goto(target);
  }

  function replaceCurrent() {
    if (index < 0 || !matches.length) return;
    const start = offsetToPos(matches[index]);
    const end = start + input.value.length;
    const tr = view.state.tr.insertText(replaceInput.value, start, end);
    view.dispatch(tr.scrollIntoView());
    collect();
    goto(index);
  }

  function replaceAll() {
    if (!input.value) return;
    collect();
    if (!matches.length) return;

    // Replace from the end so earlier offsets stay valid.
    let tr = view.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      const start = offsetToPos(matches[i]);
      const end = start + input.value.length;
      tr = tr.insertText(replaceInput.value, start, end);
    }
    view.dispatch(tr.scrollIntoView());
    collect();
    updateStatus(`Replaced ${matches.length} occurrence(s)`);
  }

  input.addEventListener('input', () => {
    collect();
    updateStatus(matches.length ? `${matches.length} result(s)` : '');
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      findNext(event.shiftKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  });

  panel.addEventListener('click', (event) => {
    const action = event.target.closest('[data-find-action]')?.dataset.findAction;
    if (!action) return;
    event.preventDefault();
    if (action === 'next') findNext(false);
    else if (action === 'previous') findNext(true);
    else if (action === 'replace') replaceCurrent();
    else if (action === 'replace-all') replaceAll();
    else if (action === 'close') onClose?.();
  });

  return {
    open() {
      panel.hidden = false;
      const selected = view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, ' ');
      if (selected && !selected.includes('\n')) input.value = selected;
      input.focus();
      input.select();
      collect();
      updateStatus(matches.length ? `${matches.length} result(s)` : '');
    },
    close() {
      panel.hidden = true;
      view.focus();
    },
    get isOpen() {
      return !panel.hidden;
    },
  };
}
