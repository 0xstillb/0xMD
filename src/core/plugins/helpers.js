// 0xMD — small helpers shared by the plugins.

import { findWrapping } from 'prosemirror-transform';

/** True when the selection sits inside a code block or a code-ish node. */
export function isInCodeBlock(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.spec.code) return true;
  }
  return false;
}

/**
 * Wrap the selection in a node type if the schema allows it.
 * Returns a command, or false when the wrap is not possible.
 */
export function wrapInIfPossible(nodeType, attrs = null) {
  return (state, dispatch) => {
    const wrapping = findWrapping(state.selection.$from, nodeType, attrs);
    if (!wrapping) return false;
    if (dispatch) dispatch(state.tr.wrap(wrapping).scrollIntoView());
    return true;
  };
}

/** Is the selection inside a node of the given type? */
export function isInNode(state, nodeName) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === nodeName) return true;
  }
  return false;
}
