// 0xMD — the editor.
//
// ProseMirror view plus the plugin stack. The shape of the document is the
// shape of the editor: there is no separate preview pane, just a single
// live surface.

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
import { inputRules, textblockTypeInputRule, wrappingInputRule, smartQuotes, ellipsis, emDash } from 'prosemirror-inputrules';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { tableEditing, columnResizing, goToNextCell } from 'prosemirror-tables';

import { schema } from './schema.js';
import { buildKeymap } from './plugins/keymap.js';
import { buildInputRules } from './plugins/inputrules.js';
import { markerPlugin } from './plugins/markers.js';
import { liveStylesPlugin } from './plugins/live-styles.js';
import { placeholderPlugin } from './plugins/placeholder.js';
import { codeBlockView } from './nodeviews/code-block.js';
import { mathBlockView, mathInlineView } from './nodeviews/math.js';
import { mermaidView } from './nodeviews/mermaid.js';
import { listItemView } from './nodeviews/list-item.js';
import { footnoteBlockView } from './nodeviews/footnotes.js';
import { htmlBlockView } from './nodeviews/html-block.js';

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

export function createEditor({ mount, doc, onChange, onSelectionChange, onStateChange, options = {} }) {
  const state = EditorState.create({
    doc,
    schema,
    plugins: [
      buildInputRules({ schema, options }),
      // The raw markdown is always available — the equivalent of a
      // "source code" view, kept read-only.
      ...(options.sourceMode ? [] : []),
      keymap(buildKeymap({ schema, options })),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Shift-Mod-z': redo,
        Tab: goToNextCell(1),
        'Shift-Tab': goToNextCell(-1),
      }),
      keymap(baseKeymap),
      dropCursor({ color: 'var(--accent)', width: 2 }),
      gapCursor(),
      history(),
      tableEditing(),
      columnResizing(),
      placeholderPlugin(),
      markerPlugin(options),
      liveStylesPlugin(),
    ],
  });

  const view = new EditorView(mount, {
    state,
    attributes: {
      class: 'md-editor',
      spellcheck: 'true',
    },
    nodeViews: {
      code_block: codeBlockView,
      math_block: mathBlockView,
      math_inline: mathInlineView,
      mermaid: mermaidView,
      list_item: listItemView,
      footnote_block: footnoteBlockView,
      html_block: htmlBlockView,
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      if (tr.docChanged && onChange) onChange(next.doc, tr);
      if (tr.selectionSet || tr.docChanged) {
        if (onSelectionChange) onSelectionChange(next);
        if (onStateChange) onStateChange(next);
      }
    },
  });

  return view;
}

export { schema };
