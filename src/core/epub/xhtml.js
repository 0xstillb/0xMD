// 0xMD — XHTML → Markdown.
//
// The chapters of an EPUB are XHTML documents. 0xMD is a Markdown editor,
// so a chapter is converted before it is shown: the structure (headings,
// paragraphs, lists, quotes, tables, code, images) becomes Markdown, and
// the editor does the rest.
//
// The conversion is deliberately plain — it reads the document, it does
// not try to be a layout engine. The stylesheet of the book is left
// behind on purpose: the theme of 0xMD owns the page.

/** The characters that would otherwise be read as Markdown. */
const MARKDOWN_CHARS = /([\\`*_[\]~|])/g;

/** A marker for a line break, kept until the whitespace is collapsed. */
const BREAK = '\u0000';

/** Parse the chapter, whether it is well-formed XHTML or only HTML. */
function parseDocument(html) {
  const parser = new DOMParser();

  const xml = parser.parseFromString(html, 'application/xhtml+xml');
  if (!xml.querySelector('parsererror')) return xml;

  return parser.parseFromString(html, 'text/html');
}

/** Collapse the whitespace of a text run, keeping the line breaks. */
function normalize(text) {
  return String(text ?? '')
    .replace(/[ \t\r\n\f\v]+/g, ' ')
    .replace(/\s*\u0000\s*/g, '  \n')
    .trim();
}

/** Escape the characters that would be read as Markdown. */
function escapeText(text) {
  return String(text ?? '').replace(MARKDOWN_CHARS, '\\$1');
}

/** Escape what would start a block if it stood at the beginning of a line. */
function escapeLineStarts(text) {
  return String(text ?? '')
    .replace(/^(\s*)([#>+=-])/gm, '$1\\$2')
    .replace(/^(\s*)(\d+)\./gm, '$1$2\\.');
}

/** The inline text of a node, as Markdown. */
function inline(node) {
  let text = '';

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += escapeText(child.textContent);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toUpperCase();
    switch (tag) {
      case 'EM':
      case 'I':
      case 'CITE':
      case 'DFN': {
        const inner = inline(child);
        if (inner) text += `*${inner}*`;
        break;
      }
      case 'STRONG':
      case 'B': {
        const inner = inline(child);
        if (inner) text += `**${inner}**`;
        break;
      }
      case 'CODE':
      case 'KBD':
      case 'SAMP':
      case 'VAR': {
        const code = child.textContent.replace(/\s+/g, ' ').trim();
        if (code) text += `\`${code}\``;
        break;
      }
      case 'A': {
        const inner = inline(child);
        const href = child.getAttribute('href') || '';
        text += href ? `[${inner || href}](${href})` : inner;
        break;
      }
      case 'IMG': {
        const alt = child.getAttribute('alt') || '';
        const src = child.getAttribute('src') || '';
        text += src ? `![${alt}](${src})` : alt;
        break;
      }
      case 'BR':
        text += BREAK;
        break;
      case 'SUP':
        text += `^${inline(child)}^`;
        break;
      case 'SUB':
        text += `~${inline(child)}~`;
        break;
      case 'STRIKE':
      case 'S':
      case 'DEL':
        text += `~~${inline(child)}~~`;
        break;
      case 'WBR':
        break;
      default:
        text += inline(child);
        break;
    }
  }

  return normalize(text);
}

/** A list, as Markdown. */
function listItems(list) {
  const ordered = list.tagName.toUpperCase() === 'OL';
  let number = Number(list.getAttribute('start') || 1) || 1;

  const blocks = [];
  for (const item of list.children) {
    if (item.tagName.toUpperCase() !== 'LI') continue;

    // The text of the item, and the lists nested inside it.
    const own = [];
    const nested = [];
    for (const child of item.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes(child.tagName.toUpperCase())) {
        nested.push(child);
      } else {
        own.push(child);
      }
    }

    const text = inline({ childNodes: own });
    const marker = ordered ? `${number++}. ` : '- ';
    const indent = ' '.repeat(marker.length);

    const lines = text ? text.split('\n') : [''];
    const block = [marker + lines[0], ...lines.slice(1).map((line) => indent + line)];

    for (const sub of nested) {
      for (const line of listItems(sub).split('\n')) block.push(indent + line);
    }

    blocks.push(block.join('\n'));
  }

  return blocks.join('\n\n');
}

/** A table, as Markdown. */
function tableToMarkdown(table) {
  const rows = [];

  for (const row of table.querySelectorAll('tr')) {
    const cells = [];
    for (const cell of row.children) {
      if (!['TD', 'TH'].includes(cell.tagName.toUpperCase())) continue;
      cells.push(inline(cell).replace(/\|/g, '\\|').replace(/\n/g, ' '));
    }
    if (cells.length) rows.push(cells);
  }

  if (!rows.length) return '';

  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row) => [...row, ...Array(width - row.length).fill('')];

  const lines = [
    `| ${pad(rows[0]).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${pad(row).join(' | ')} |`),
  ];

  return lines.join('\n');
}

/** The language of a code block, taken from its class. */
function codeLanguage(pre) {
  const className = pre.getAttribute('class') || '';
  const match = /language-([\w+-]+)/.exec(className);
  return match ? match[1] : '';
}

/** The blocks of a node, as Markdown. */
function blocks(node) {
  const out = [];

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = normalize(child.textContent);
      if (text) out.push(escapeLineStarts(text));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toUpperCase();

    if (/^H[1-6]$/.test(tag)) {
      const text = inline(child);
      if (text) out.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
      continue;
    }

    switch (tag) {
      case 'P': {
        const text = inline(child);
        if (text) out.push(escapeLineStarts(text));
        break;
      }
      case 'PRE': {
        const code = child.textContent.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
        if (code.trim()) out.push(`\`\`\`${codeLanguage(child)}\n${code}\n\`\`\``);
        break;
      }
      case 'HR':
        out.push('---');
        break;
      case 'BLOCKQUOTE':
      case 'ASIDE': {
        const inner = blocks(child).join('\n\n');
        if (inner) {
          out.push(inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n'));
        }
        break;
      }
      case 'UL':
      case 'OL': {
        const list = listItems(child);
        if (list) out.push(list);
        break;
      }
      case 'TABLE': {
        const table = tableToMarkdown(child);
        if (table) out.push(table);
        break;
      }
      case 'FIGCAPTION': {
        const text = inline(child);
        if (text) out.push(`_${text}_`);
        break;
      }
      case 'IMG': {
        const alt = child.getAttribute('alt') || '';
        const src = child.getAttribute('src') || '';
        if (src) out.push(`![${alt}](${src})`);
        break;
      }
      case 'SCRIPT':
      case 'STYLE':
      case 'LINK':
      case 'META':
      case 'HEAD':
        break;
      default:
        // A container: whatever it holds is read.
        out.push(...blocks(child));
        break;
    }
  }

  return out;
}

/**
 * Turn a chapter of an EPUB into Markdown.
 *
 * @param {string} html the XHTML of the chapter
 * @returns {string}
 */
export function xhtmlToMarkdown(html) {
  const document = parseDocument(html ?? '');
  const root = document.body || document.documentElement;
  if (!root) return '';

  const text = blocks(root).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return text ? `${text}\n` : '';
}

export default xhtmlToMarkdown;
