// 0xMD — markdown input rules.
//
// Typing markdown syntax turns into structure.

import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule, smartQuotes, ellipsis, emDash } from 'prosemirror-inputrules';

/**
 * Turn `**bold**` into a bold mark. prosemirror-inputrules ships
 * textblock rules but no mark rule, so this is our own.
 */
function markInputRule(regexp, markType, getAttrs) {
  return new InputRule(regexp, (state, match, start, end) => {
    const attrs = getAttrs instanceof Function ? getAttrs(match) : getAttrs;
    const tr = state.tr;
    const matchedStr = match[0];
    const textStart = start + matchedStr.indexOf(match[1]);
    const textEnd = textStart + match[1].length;

    if (textEnd < textStart) return null;
    if (state.doc.textBetween(textStart, textEnd) !== match[1]) return null;

    // Strip the delimiters, then apply the mark to what is left.
    if (textEnd < state.doc.content.size) tr.delete(textEnd, textEnd + 1);
    if (textStart > 0) tr.delete(textStart - 1, textStart);

    const markStart = tr.mapping.map(textStart, -1);
    tr.addMark(markStart, markStart + match[1].length, markType.create(attrs));
    return tr;
  });
}

export function buildInputRules({ schema, options = {} }) {
  const rules = [];

  // ---- headings --------------------------------------------------------
  rules.push(
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
      level: match[1].length,
      markup: `${match[1]} `,
    })),
  );

  // ---- blockquote ------------------------------------------------------
  rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));

  // ---- lists -----------------------------------------------------------
  rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));

  rules.push(
    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.ordered_list,
      (match) => ({ order: +match[1] }),
      (match, node) => node.childCount + node.attrs.order === +match[1],
    ),
  );

  // A task marker typed inside a list item turns the item into a checkbox.
  rules.push(
    new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
      const $from = state.selection.$from;
      if ($from.parent.type !== schema.nodes.list_item) return null;

      const checked = match[1].toLowerCase() === 'x';
      const listItemPos = $from.before($from.depth);
      const node = state.doc.nodeAt(listItemPos);
      if (!node) return null;

      const tr = state.tr.delete(start, end);
      tr.setNodeMarkup(listItemPos, null, { ...node.attrs, task: true, checked });
      return tr;
    }),
  );

  // ---- code / math / mermaid blocks ------------------------------------
  rules.push(
    new InputRule(/^```([a-zA-Z0-9_+-]*)\s$/, (state, match, start, end) => {
      const info = match[1] || '';
      const isMermaid = /^mermaid$/i.test(info);
      const nodeType = isMermaid ? schema.nodes.mermaid : schema.nodes.code_block;
      const attrs = isMermaid
        ? { markup: '```mermaid' }
        : { params: info, markup: '```' };

      const tr = state.tr.delete(start, end);
      const { $from } = state.selection;
      const block = nodeType.create(attrs, schema.text(''));
      tr.replaceWith($from.before(), $from.after(), block);
      return tr;
    }),
  );

  rules.push(
    new InputRule(/^\$\$\s$/, (state, match, start, end) => {
      const tr = state.tr.delete(start, end);
      const { $from } = state.selection;
      const block = schema.nodes.math_block.create({ markup: '$$' }, schema.text(''));
      tr.replaceWith($from.before(), $from.after(), block);
      return tr;
    }),
  );

  // ---- inline marks ----------------------------------------------------
  rules.push(markInputRule(/(?:\*\*)([^*]+)(?:\*\*)$/, schema.marks.strong));
  rules.push(markInputRule(/(?:^|[^*])\*([^*]+)\*$/, schema.marks.em));
  rules.push(markInputRule(/(?:~~)([^~]+)(?:~~)$/, schema.marks.strikethrough));
  rules.push(markInputRule(/(?:==)([^=]+)(?:==)$/, schema.marks.highlight));
  rules.push(markInputRule(/(?:`)([^`]+)(?:`)$/, schema.marks.code));

  // Inline maths is an atom node, so it needs its own rule.
  rules.push(
    new InputRule(/(?:\$)([^$\n]+)(?:\$)$/, (state, match, start, end) => {
      const tr = state.tr.delete(start, end);
      tr.insert(tr.selection.from, schema.nodes.math_inline.create({ latex: match[1] }));
      return tr;
    }),
  );

  // ---- smart typography -------------------------------------------------
  if (options.smartTyping !== false) {
    rules.push(smartQuotes);
    rules.push(ellipsis);
    rules.push(emDash);
  }

  return inputRules({ rules });
}
