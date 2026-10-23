// 0xMD — keyboard map.
//
// The shortcuts used by the Paragraph / Format menus.

import { toggleMark, setBlockType, wrapIn, lift, chainCommands, exitCode, selectAll } from 'prosemirror-commands';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { undoInputRule } from 'prosemirror-inputrules';

import { isInCodeBlock } from './helpers.js';

export function buildKeymap({ schema, options = {} }) {
  const keys = {};

  // ---- inline marks -----------------------------------------------------
  keys['Mod-b'] = toggleMark(schema.marks.strong);
  keys['Mod-i'] = toggleMark(schema.marks.em);
  keys['Mod-Shift-x'] = toggleMark(schema.marks.strikethrough);
  keys['Mod-Shift-h'] = toggleMark(schema.marks.highlight);
  keys['Mod-Shift-c'] = toggleMark(schema.marks.code);
  keys['Mod-Shift-u'] = toggleMark(schema.marks.underline);
  keys['Mod-Shift-,'] = toggleMark(schema.marks.subscript);
  keys['Mod-Shift-.'] = toggleMark(schema.marks.superscript);

  // ---- block types ------------------------------------------------------
  for (let level = 1; level <= 6; level++) {
    keys[`Mod-Alt-${level}`] = setBlockType(schema.nodes.heading, { level });
  }
  keys['Mod-Alt-0'] = setBlockType(schema.nodes.paragraph);

  keys['Mod-Shift-8'] = wrapInList(schema.nodes.bullet_list);
  keys['Mod-Shift-7'] = wrapInList(schema.nodes.ordered_list);
  keys['Mod-Shift-9'] = wrapInList(schema.nodes.bullet_list, { task: true });
  keys['Mod-Shift-q'] = wrapIn(schema.nodes.blockquote);

  // ---- lists ------------------------------------------------------------
  keys.Enter = chainCommands(
    (state, dispatch) => {
      // Enter inside a list item continues the list.
      return splitListItem(schema.nodes.list_item)(state, dispatch);
    },
    (state, dispatch) => {
      // Enter on an empty code block leaves the block.
      if (isInCodeBlock(state)) return exitCode(state, dispatch);
      return false;
    },
  );

  keys.Tab = chainCommands(
    (state, dispatch) => sinkListItem(schema.nodes.list_item)(state, dispatch),
    (state, dispatch) => {
      if (state.selection.$from.parent.type === schema.nodes.code_block) {
        if (dispatch) {
          dispatch(state.tr.insertText('    '));
        }
        return true;
      }
      return false;
    },
  );

  keys['Shift-Tab'] = chainCommands(
    (state, dispatch) => liftListItem(schema.nodes.list_item)(state, dispatch),
    (state, dispatch) => {
      if (state.selection.$from.parent.type === schema.nodes.code_block) {
        if (dispatch) {
          const { from } = state.selection;
          const lineStart = state.doc.textBetween(from, from, '\n', '\n').length;
          const target = Math.max(0, from - 4);
          dispatch(state.tr.delete(target, from).scrollIntoView());
        }
        return true;
      }
      return false;
    },
  );

  keys['Backspace'] = chainCommands(
    (state, dispatch) => {
      // Backspace at the start of an empty list item removes the list.
      const { $from, empty } = state.selection;
      if (!empty) return false;
      if ($from.parent.type !== schema.nodes.list_item) return false;
      if ($from.parentOffset !== 0) return false;
      if (dispatch) {
        dispatch(liftListItem(schema.nodes.list_item)(state));
      }
      return true;
    },
    undoInputRule,
  );

  keys['Mod-Shift-\\'] = (state, dispatch) => {
    // Toggle source-code mode is handled by the shell, not the editor.
    return false;
  };

  keys['Mod-a'] = selectAll;

  return keys;
}
