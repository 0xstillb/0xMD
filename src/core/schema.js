// 0xMD — ProseMirror schema.
//
// The node model: every node carries an attribute map, and blocks nest
// through their `content`.
//
// The vocabulary, in two columns:
//
//   blocks                          inline
//   --------------------------------------------------------------
//   paragraph heading blockquote    text
//   code_block math_block mermaid   strong em code
//   table table_row table_cell      strikethrough highlight
//   bullet_list ordered_list        underline subscript superscript
//   list_item                       link image
//   html_block front_matter         footnote_ref math_inline
//   alert footnote_block            hard_break
//   horizontal_rule

import { Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

const blockAttrs = {
  // The literal markdown marker for this block, e.g. "### " for a heading.
  // Kept so the UI can reveal the source when the block is active — the
  // trick that hides the syntax until you click into it.
  markup: { default: '' },
};

const nodes = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },

  heading: {
    attrs: { level: { default: 1 }, ...blockAttrs, markupClose: { default: '' } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  code_block: {
    attrs: { params: { default: '' }, ...blockAttrs },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: (node) => ['pre', ['code', { class: node.attrs.params ? `language-${node.attrs.params}` : null }, 0]],
  },

  // Math and Mermaid are first-class blocks; they get their own
  // node views so they can render (KaTeX / Mermaid) and be edited as source.
  math_block: {
    attrs: { ...blockAttrs },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'div[data-0xmd-math-block]', preserveWhitespace: 'full' }],
    toDOM: () => ['div', { 'data-0xmd-math-block': '1' }, 0],
  },

  mermaid: {
    attrs: { ...blockAttrs },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'div[data-0xmd-mermaid]', preserveWhitespace: 'full' }],
    toDOM: () => ['div', { 'data-0xmd-mermaid': '1' }, 0],
  },

  // YAML front matter — hidden in the document view, shown in source mode.
  front_matter: {
    attrs: { ...blockAttrs },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    isolating: true,
    parseDOM: [{ tag: 'pre[data-0xmd-front-matter]', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', { 'data-0xmd-front-matter': '1' }, 0],
  },

  // Raw HTML block: kept verbatim, sanitised on render.
  html_block: {
    attrs: { ...blockAttrs },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    isolating: true,
    parseDOM: [{ tag: 'div[data-0xmd-html-block]', preserveWhitespace: 'full' }],
    toDOM: () => ['div', { 'data-0xmd-html-block': '1' }, 0],
  },

  // GitHub-style callouts: > [!NOTE]
  alert: {
    attrs: { kind: { default: 'note' } },
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'div[data-0xmd-alert]', attrs: { kind: 'note' } }],
    toDOM: (node) => ['div', { 'data-0xmd-alert': node.attrs.kind, class: `md-alert md-alert-${node.attrs.kind}` }, 0],
  },

  // Footnote definitions collected from the document and rendered at the
  // bottom.
  footnote_block: {
    attrs: { ...blockAttrs },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    isolating: true,
    parseDOM: [{ tag: 'div[data-0xmd-footnotes]', preserveWhitespace: 'full' }],
    toDOM: () => ['div', { 'data-0xmd-footnotes': '1' }, 0],
  },

  ordered_list: {
    attrs: { order: { default: 1 }, ...blockAttrs },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ order: dom.hasAttribute('start') ? +dom.getAttribute('start') : 1 }) }],
    toDOM: (node) => (node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0]),
  },

  bullet_list: {
    attrs: { ...blockAttrs },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },

  list_item: {
    attrs: { ...blockAttrs, checked: { default: null }, task: { default: false } },
    content: 'block+',
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
  },

  image: {
    attrs: {
      src: {},
      alt: { default: null },
      title: { default: null },
      markup: { default: '' },
    },
    inline: true,
    group: 'inline',
    draggable: true,
    parseDOM: [{ tag: 'img[src]', getAttrs: (dom) => ({ src: dom.getAttribute('src'), title: dom.getAttribute('title'), alt: dom.getAttribute('alt') }) }],
    toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }],
  },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  // Inline math is an atom node so it can be rendered by KaTeX and edited
  // as raw LaTeX on click.
  math_inline: {
    attrs: { latex: { default: '' } },
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    parseDOM: [{ tag: 'span[data-0xmd-math]' }],
    toDOM: (node) => ['span', { 'data-0xmd-math': node.attrs.latex, class: 'md-math-inline' }, node.attrs.latex],
  },

  // Footnote reference — a superscript number that jumps to the footnote
  // section at the bottom of the document.
  footnote_ref: {
    attrs: { label: { default: '' }, id: { default: '0' }, key: { default: '' } },
    inline: true,
    group: 'inline',
    atom: true,
    selectable: false,
    parseDOM: [{ tag: 'sup[data-footnote-ref]' }],
    toDOM: (node) => ['sup', { 'data-footnote-ref': node.attrs.id, class: 'md-footnote-ref' }, node.attrs.label],
  },

  text: { group: 'inline' },
};

const marks = {
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: dom.getAttribute('href'), title: dom.getAttribute('title') }) }],
    toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title }, 0],
  },

  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },

  strong: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (node) => node.style.fontWeight !== 'normal' && null }, { style: 'font-weight=bold' }, { style: 'font-weight=700' }],
    toDOM: () => ['strong', 0],
  },

  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },

  strikethrough: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },

  highlight: {
    parseDOM: [{ tag: 'mark' }],
    toDOM: () => ['mark', 0],
  },

  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },

  subscript: {
    excludes: 'superscript',
    parseDOM: [{ tag: 'sub' }],
    toDOM: () => ['sub', 0],
  },

  superscript: {
    excludes: 'subscript',
    parseDOM: [{ tag: 'sup' }],
    toDOM: () => ['sup', 0],
  },
};

export const schema = new Schema({ nodes: { ...nodes, ...tableNodes({ tableGroup: 'block', cellContent: 'inline*', cellAttributes: {} }) }, marks });
export default schema;
