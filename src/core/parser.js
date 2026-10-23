// 0xMD — markdown → ProseMirror document.
//
// Markdown text is parsed into the node model — the first half of the
// three-stage pipeline (parse → model → serialise).

import { MarkdownParser } from 'prosemirror-markdown';
import { Fragment } from 'prosemirror-model';
import { markdownIt } from './markdown-it.js';
import { schema } from './schema.js';

function mdTokenizer(state, tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'inline') state.tokens.push(...tok.children);
    else state.tokens.push(tok);
  }
}
/** The literal markdown marker for a heading, e.g. "### ". */
const headingMarkup = (level) => `${'#'.repeat(level)} `;
const headingMarkupClose = (level) => ` ${'#'.repeat(level)}`;

const parser = new MarkdownParser(schema, markdownIt, {
  // ---- block level ------------------------------------------------------
  paragraph: { block: 'paragraph' },
  heading: {
    block: 'heading',
    getAttrs: (tok) => {
      const level = +tok.tag.slice(1);
      return { level, markup: headingMarkup(level), markupClose: headingMarkupClose(level) };
    },
  },
  blockquote: { block: 'blockquote' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok) => ({ order: +tok.attrGet('start') || 1, markup: tok.markup || '.' }),
  },
  list_item: {
    block: 'list_item',
    getAttrs: (tok, tokens, i) => {
      // Bullet items reveal their raw "-" while editing; ordered items keep
      // the native number, so they get no raw marker.
      let ordered = false;
      for (let k = i - 1; k >= 0; k--) {
        if (tokens[k].type === 'ordered_list_open') { ordered = true; break; }
        if (tokens[k].type === 'bullet_list_open') { ordered = false; break; }
      }
      return {
        markup: ordered ? '' : (tok.markup || '-'),
        task: !!tok.meta?.task,
        checked: tok.meta?.checked === true,
      };
    },
  },
  fence: {
    block: 'code_block',
    getAttrs: (tok) => ({ params: (tok.info || '').trim(), markup: '```' }),
    noCloseToken: true,
  },
  code_block: { block: 'code_block', getAttrs: () => ({ params: '', markup: '```' }), noCloseToken: true },
  math_block: { block: 'math_block', getAttrs: () => ({ markup: '$$' }), noCloseToken: true },
  mermaid: { block: 'mermaid', getAttrs: (tok) => ({ markup: `\`\`\`${tok.meta?.markup?.slice(3) || 'mermaid'}` }), noCloseToken: true },
  front_matter: { block: 'front_matter', getAttrs: () => ({ markup: '---' }), noCloseToken: true },
  html_block: { block: 'html_block', getAttrs: () => ({ markup: '' }), noCloseToken: true },
  alert: {
    block: 'alert',
    getAttrs: (tok) => ({ kind: tok.meta?.kind || 'note' }),
  },
  hr: { node: 'horizontal_rule' },

  // ---- tables (prosemirror-tables) --------------------------------------
  // prosemirror-tables has no thead/tbody wrappers, so markdown-it's
  // thead/tbody tokens are dropped and rows attach straight to the table.
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },

  // ---- footnotes --------------------------------------------------------
  footnote_block: { block: 'footnote_block', getAttrs: () => ({ markup: '' }) },
  footnote_open: { ignore: true, noCloseToken: true },
  footnote_close: { ignore: true, noCloseToken: true },
  footnote_anchor: { ignore: true, noCloseToken: true },

  // ---- raw inline HTML --------------------------------------------------
  html_inline: { ignore: true, noCloseToken: true },

  // ---- inline marks -----------------------------------------------------
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strikethrough' },
  mark: { mark: 'highlight' },
  sub: { mark: 'subscript' },
  sup: { mark: 'superscript' },
  underline: { mark: 'underline' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
  math_inline: {
    node: 'math_inline',
    getAttrs: (tok) => ({ latex: tok.content }),
    noCloseToken: true,
  },
  footnote_ref: {
    node: 'footnote_ref',
    getAttrs: (tok) => ({
      label: tok.meta?.label ?? '',
      id: String(tok.meta?.id ?? -1),
      key: tok.meta?.key ?? tok.meta?.label ?? '',
    }),
    noCloseToken: true,
  },

  // ---- inline nodes -----------------------------------------------------
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: tok.children?.[0]?.content || null,
    }),
  },
  hardbreak: { node: 'hard_break' },
});

// `softbreak` needs to emit a literal newline rather than a space.
const originalText = parser.tokenHandlers.text;
parser.tokenHandlers.text = (state, tok) => state.addText(tok.content);
parser.tokenHandlers.softbreak = (state) => state.addText('\n');

/**
 * Parse markdown source into a ProseMirror document.
 * @param {string} source
 * @returns {import('prosemirror-model').Node}
 */
export function parseMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const env = {};
  const doc = parser.parse(text, env);

  // Footnote definitions are collected by the markdown-it plugin and kept as
  // raw markdown so that saving the document reproduces them verbatim.
  const footnotes = env.footnotes;
  if (footnotes?.defs?.size) {
    const raw = footnotes.order
      .filter((label) => footnotes.defs.has(label))
      .map((label) => `[^${label}]: ${footnotes.defs.get(label)}`)
      .join('\n\n');
    if (raw) {
      const block = schema.nodes.footnote_block.create(null, schema.text(raw));
      return doc.copy(doc.content.append(Fragment.from(block)));
    }
  }
  return doc;
}

export { parser };
export default parseMarkdown;
