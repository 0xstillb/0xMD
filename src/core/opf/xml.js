// 0xMD — a very small XML reader.
//
// An EPUB package document (.opf) is plain XML: elements, attributes, text
// and the occasional CDATA block. That subset is small enough to read here
// instead of pulling in a parser — and because the module is pure JavaScript
// it runs unchanged in the renderer and in the main process, so both can
// share the same model.
//
// The reader never throws on malformed input: it collects the problems in
// `errors` and returns whatever it managed to read, so a broken file still
// opens (as an error report) instead of taking the app down.

/** The named entities that appear in practice; numeric ones are handled too. */
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
};

function codePoint(code, fallback) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/**
 * Replace the XML entities in a string.
 * Unknown entities are left alone — that is what the XML spec asks for.
 */
export function decodeEntities(text) {
  return String(text ?? '').replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
        return codePoint(code, match);
      }
      const named = NAMED_ENTITIES[body];
      return named === undefined ? match : named;
    },
  );
}

/** Build an element node. */
function makeNode(name, attrs = {}) {
  const colon = name.indexOf(':');
  return {
    name,
    prefix: colon === -1 ? '' : name.slice(0, colon),
    local: colon === -1 ? name : name.slice(colon + 1),
    attrs,
    children: [],
    text: '',
  };
}

/**
 * Read an opening tag that starts at `start`.
 * @returns {{name: string, attrs: object, selfClosing: boolean, end: number}|null}
 */
function readTag(text, start) {
  let i = start + 1;
  const nameMatch = /^[^\s/>]+/.exec(text.slice(i));
  if (!nameMatch) return null;
  const name = nameMatch[0];
  i += name.length;

  const attrs = {};
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === '>') return { name, attrs, selfClosing: false, end: i + 1 };
    if (text[i] === '/' && text[i + 1] === '>') return { name, attrs, selfClosing: true, end: i + 2 };

    const attrMatch = /^[^\s=/>]+/.exec(text.slice(i));
    if (!attrMatch) {
      i++;
      continue;
    }
    const attrName = attrMatch[0];
    i += attrName.length;
    while (i < text.length && /\s/.test(text[i])) i++;

    if (text[i] !== '=') {
      // A bare attribute is allowed in HTML, not in XML — keep it empty.
      attrs[attrName] = '';
      continue;
    }
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;

    const quote = text[i];
    if (quote === '"' || quote === "'") {
      const end = text.indexOf(quote, i + 1);
      attrs[attrName] = decodeEntities(end === -1 ? text.slice(i + 1) : text.slice(i + 1, end));
      i = end === -1 ? text.length : end + 1;
    } else {
      const valueMatch = /^[^\s>]*/.exec(text.slice(i));
      const value = valueMatch ? valueMatch[0] : '';
      attrs[attrName] = decodeEntities(value);
      i += value.length;
    }
  }
  return { name, attrs, selfClosing: false, end: text.length };
}

/**
 * Read an XML document into a tree.
 *
 * @param {string} source
 * @returns {{root: object, errors: string[]}}
 */
export function parseXml(source) {
  const text = String(source ?? '');
  const root = makeNode('#document');
  const stack = [root];
  const errors = [];
  let index = 0;

  const top = () => stack[stack.length - 1];
  const pushText = (value) => {
    top().text += value;
  };

  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt === -1) {
      pushText(decodeEntities(text.slice(index)));
      break;
    }
    if (lt > index) pushText(decodeEntities(text.slice(index, lt)));

    // Comments, CDATA, the XML declaration and doctypes carry no content.
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      pushText(text.slice(lt + 9, end === -1 ? text.length : end));
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      // <!DOCTYPE …> — including an internal subset in square brackets.
      let end = lt + 2;
      let depth = 0;
      while (end < text.length) {
        const ch = text[end];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
        end++;
      }
      index = end + 1;
      continue;
    }

    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt);
      const name = text.slice(lt + 2, end === -1 ? text.length : end).trim();
      // Close the matching element; a stray end tag is simply ignored.
      let depth = stack.length - 1;
      while (depth > 0 && stack[depth].name !== name) depth--;
      if (depth > 0) {
        // Closing an ancestor leaves its children unclosed — say so.
        if (depth < stack.length - 1) {
          errors.push(`Unclosed element <${stack[stack.length - 1].name}>`);
        }
        stack.length = depth;
      } else {
        errors.push(`Unexpected end tag </${name}>`);
      }
      index = end === -1 ? text.length : end + 1;
      continue;
    }

    const tag = readTag(text, lt);
    if (!tag) {
      // A "<" that starts nothing is ordinary text.
      pushText('<');
      index = lt + 1;
      continue;
    }

    const node = makeNode(tag.name, tag.attrs);
    top().children.push(node);
    if (!tag.selfClosing) stack.push(node);
    index = tag.end;
  }

  if (stack.length > 1) {
    errors.push(`Unclosed element <${stack[stack.length - 1].name}>`);
  }

  return { root, errors };
}

/** The direct child elements of a node. */
export function childElements(node) {
  return node?.children ?? [];
}

/** The direct child elements whose local name matches. */
export function childrenNamed(node, local) {
  return childElements(node).filter((child) => child.local === local);
}

/** The first direct child element whose local name matches. */
export function childNamed(node, local) {
  return childElements(node).find((child) => child.local === local) ?? null;
}

/** The text of a node, without the surrounding whitespace. */
export function textOf(node) {
  return String(node?.text ?? '').trim();
}
