// 0xMD — hidden markdown markers.
//
// Only the *result* of the markdown is rendered; the syntax (the "#", the
// "-", the ``` fence) appears when the cursor is inside that block.
// 0xMD does the same with ProseMirror widget decorations.

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Build the decoration set that reveals the markdown syntax of the block
 * the cursor currently sits in.
 */
export function markerDecorations(doc, selection, mode = 'active') {
  if (mode === 'none') return DecorationSet.empty;

  const decorations = [];

  const reveal = (node, pos) => {
    const markup = node.attrs?.markup;
    if (!markup) return;

    // While a bullet item is being edited the native bullet is replaced by
    // the raw markdown marker.
    if (node.type.name === 'list_item' && markup) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'md-active-list-item' }));
    }

    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const span = document.createElement('span');
          span.className = `md-marker md-marker-${node.type.name}`;
          span.textContent = markup;
          span.contentEditable = 'false';
          return span;
        },
        { side: -1, key: `md-marker-${pos}` },
      ),
    );
  };

  if (mode === 'active') {
    // Only the block around the cursor shows its syntax — and that block is
    // an ancestor of the cursor. Walking the ancestors costs nothing, while
    // walking the whole document on every keystroke costs a lot.
    const $pos = doc.resolve(selection.from);
    for (let depth = $pos.depth; depth > 0; depth--) {
      reveal($pos.node(depth), $pos.before(depth));
    }
    // A cursor in the gap between two blocks belongs to neither of them —
    // but the syntax of both neighbours used to show there, so it still does.
    if ($pos.depth === 0) {
      if ($pos.nodeBefore) reveal($pos.nodeBefore, $pos.pos - $pos.nodeBefore.nodeSize);
      if ($pos.nodeAfter) reveal($pos.nodeAfter, $pos.pos);
    }
  } else {
    doc.descendants((node, pos) => {
      if (!node.isBlock) return true;
      reveal(node, pos);
      return true;
    });
  }

  return DecorationSet.create(doc, decorations);
}

export function markerPlugin(options = {}) {
  let mode = options.showMarkdownSyntax || 'active';

  return new Plugin({
    key: new PluginKey('0xmd-markers'),

    props: {
      decorations(state) {
        return markerDecorations(state.doc, state.selection, mode);
      },
    },

    // Lets the user switch between "only the active block" / "all" / "none".
    setMode(next) {
      mode = next;
    },

    getMode() {
      return mode;
    },
  });
}
