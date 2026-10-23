// 0xMD — live style tracking.
//
// Keeps track of the marks and node type at the cursor so the UI can show
// which formatting is active.

import { Plugin, PluginKey } from 'prosemirror-state';

export const liveStylesKey = new PluginKey('0xmd-live-styles');

export function liveStylesPlugin() {
  return new Plugin({
    key: liveStylesKey,

    state: {
      init() {
        return { marks: [], type: 'paragraph', attrs: {}, text: '' };
      },

      apply(tr, prev, _oldState, newState) {
        if (!tr.docChanged && !tr.selectionSet) return prev;

        const { from, to, empty } = newState.selection;
        const $from = newState.selection.$from;
        const marks = [];

        if (empty) {
          const stored = newState.storedMarks || $from.marks();
          stored.forEach((mark) => marks.push({ type: mark.type.name, attrs: mark.attrs }));
        }

        return {
          marks,
          type: $from.parent.type.name,
          attrs: $from.parent.attrs,
          text: newState.doc.textBetween(from, to, ' ').slice(0, 200),
        };
      },
    },

    props: {
      // Re-render the decorations that depend on the active block.
      decorations(state) {
        return null;
      },
    },
  });
}

/** Read the current style state. */
export function getLiveStyles(state) {
  return liveStylesKey.getState(state) ?? { marks: [], type: 'paragraph', attrs: {}, text: '' };
}
