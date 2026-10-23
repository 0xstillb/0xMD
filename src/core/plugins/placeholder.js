// 0xMD — placeholder text for an empty document.

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const placeholderKey = new PluginKey('0xmd-placeholder');

export function placeholderPlugin(text = 'Start writing…') {
  return new Plugin({
    key: placeholderKey,

    props: {
      decorations(state) {
        const { doc } = state;
        const empty = doc.childCount === 1 && doc.firstChild.type.name === 'paragraph' && doc.firstChild.content.size === 0;
        if (!empty) return null;

        const decoration = Decoration.node(0, doc.firstChild.nodeSize, {
          class: 'md-placeholder-active',
          'data-placeholder': text,
        });
        return DecorationSet.create(doc, [decoration]);
      },
    },
  });
}
