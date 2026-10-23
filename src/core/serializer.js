// 0xMD — ProseMirror document → markdown.
//
// The node model is serialised back into markdown text so the file on disk
// stays the source of truth — the second half of the three-stage pipeline.

import { MarkdownSerializer } from 'prosemirror-markdown';

/**
 * A link is only written as an autolink when the visible text is exactly the
 * href — otherwise the label has to be preserved.
 */
function isPlainURL(link, parent, index) {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href || '')) return false;
  const content = parent.child(index);
  if (!content || !content.isText || content.text !== link.attrs.href) return false;
  return content.marks[content.marks.length - 1] === link;
}

const serializer = new MarkdownSerializer(
  {
    doc(state, node) {
      state.renderContent(node);
    },

    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },

    heading(state, node) {
      state.write(`${'#'.repeat(node.attrs.level)} `);
      state.renderInline(node, false);
      state.closeBlock(node);
    },

    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node));
    },

    horizontal_rule(state, node) {
      state.write(node.attrs.markup || '---');
      state.closeBlock(node);
    },

    code_block(state, node) {
      // The fence must be longer than any backtick run inside the block.
      const runs = node.textContent.match(/`{3,}/gm);
      const fence = runs ? `${runs.sort().slice(-1)[0]}` : '```';
      state.write(`${fence}${node.attrs.params || ''}\n`);
      state.text(node.textContent, false);
      state.write('\n');
      state.write(fence);
      state.closeBlock(node);
    },

    math_block(state, node) {
      state.write('$$\n');
      state.text(node.textContent, false);
      state.write('\n$$');
      state.closeBlock(node);
    },

    mermaid(state, node) {
      state.write('```mermaid\n');
      state.text(node.textContent, false);
      state.write('\n```');
      state.closeBlock(node);
    },

    front_matter(state, node) {
      state.write('---\n');
      state.text(node.textContent, false);
      state.write('\n---');
      state.closeBlock(node);
    },

    html_block(state, node) {
      state.text(node.textContent, false);
      state.closeBlock(node);
    },

    footnote_block(state, node) {
      state.renderContent(node);
    },

    alert(state, node) {
      state.wrapBlock('> ', null, node, () => {
        state.write(`[!${node.attrs.kind.toUpperCase()}]\n`);
        state.renderContent(node);
      });
    },

    bullet_list(state, node) {
      state.renderList(node, '  ', (i) => {
        const item = node.child(i);
        return item.attrs.task ? `- [${item.attrs.checked ? 'x' : ' '}] ` : '- ';
      });
    },

    ordered_list(state, node) {
      const start = node.attrs.order ?? 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = state.repeat(' ', maxW + 2);
      state.renderList(node, space, (i) => {
        const nStr = String(start + i);
        const item = node.child(i);
        const prefix = `${state.repeat(' ', maxW - nStr.length)}${nStr}.`;
        return item.attrs.task ? `${prefix} [${item.attrs.checked ? 'x' : ' '}] ` : `${prefix} `;
      });
    },

    list_item(state, node) {
      state.renderContent(node);
    },

    image(state, node) {
      state.write(`![${state.esc(node.attrs.alt || '')}](${node.attrs.src.replace(/[()]/g, '\\$&')}${node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : ''})`);
    },

    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write('\\\n');
          return;
        }
      }
    },

    math_inline(state, node) {
      state.write(`$${node.attrs.latex}$`);
    },

    footnote_ref(state, node) {
      state.write(`[^${node.attrs.key || node.attrs.label}]`);
    },

    // ---- GFM tables -----------------------------------------------------
    table(state, node) {
      const rows = [];
      node.forEach((row) => {
        const cells = [];
        row.forEach((cell) => cells.push(cell));
        rows.push(cells);
      });
      if (!rows.length) return;

      const width = Math.max(...rows.map((r) => r.length));
      const pad = (row) => {
        const cells = row.slice();
        while (cells.length < width) cells.push(null);
        return cells;
      };

      const writeRow = (row) => {
        state.write('|');
        for (const cell of pad(row)) {
          state.write(' ');
          if (cell) state.renderInline(cell);
          state.write(' |');
        }
        state.ensureNewLine();
      };

      writeRow(rows[0]);
      state.write(`| ${Array(width).fill('---').join(' | ')} |\n`);
      for (const row of rows.slice(1)) writeRow(row);
      state.closeBlock(node);
    },

    table_head() { /* rendered by the table serializer */ },
    table_body() { /* rendered by the table serializer */ },
    table_row() { /* rendered by the table serializer */ },
    table_header() { /* rendered by the table serializer */ },
    table_cell() { /* rendered by the table serializer */ },
    text(state, node) {
      state.text(node.text, !state.inAutolink);
    },
  },
  {
    em: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    strong: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    code: { open: '`', close: '`', escape: false },
    strikethrough: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    highlight: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '<u>', close: '</u>' },
    subscript: { open: '~', close: '~' },
    superscript: { open: '^', close: '^' },
    link: {
      open(state, mark, parent, index) {
        state.inAutolink = isPlainURL(mark, parent, index);
        return state.inAutolink ? '<' : '[';
      },
      close(state, mark) {
        const { inAutolink } = state;
        state.inAutolink = undefined;
        return inAutolink
          ? '>'
          : `](${(mark.attrs.href || '').replace(/[()"]/g, '\\$&')}${mark.attrs.title ? ` "${mark.attrs.title.replace(/"/g, '\\"')}"` : ''})`;
      },
      mixable: true,
    },
  },
  {
    // `^` and `$` would otherwise be re-parsed as superscript / maths.
    escapeExtraCharacters: /[\^$]/,
  },
);

/**
 * Serialise a ProseMirror document back into markdown text.
 * @param {import('prosemirror-model').Node} doc
 * @returns {string}
 */
export function serializeMarkdown(doc) {
  return serializer.serialize(doc, { tightLists: true });
}

export { serializer };
export default serializeMarkdown;
