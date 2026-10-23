// 0xMD — footnote block node view.
//
// The node holds the *raw* footnote definitions so they can be written back
// to the file untouched. Here they are rendered the way a reader expects:
// a numbered list at the bottom of the document.

import { markdownIt } from '../markdown-it.js';

const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]?([\s\S]*?)(?=\n{2,}\[\^|\s*$)/gm;

function parseDefinitions(text) {
  const entries = [];
  DEFINITION.lastIndex = 0;
  let match;
  while ((match = DEFINITION.exec(text)) !== null) {
    entries.push({ label: match[1], body: match[2].trim() });
  }
  return entries;
}

export function footnoteBlockView(node) {
  const dom = document.createElement('div');
  dom.className = 'md-footnotes';
  dom.contentEditable = 'false';

  const entries = parseDefinitions(node.textContent);

  if (!entries.length) {
    dom.textContent = node.textContent;
    return { dom, ignoreMutation: () => true };
  }

  const list = document.createElement('ol');
  list.className = 'md-footnotes-list';

  entries.forEach((entry, index) => {
    const item = document.createElement('li');
    item.className = 'md-footnote-item';

    const body = document.createElement('span');
    body.className = 'md-footnote-body';
    body.innerHTML = markdownIt.renderInline(entry.body);

    const back = document.createElement('a');
    back.className = 'md-footnote-back';
    back.href = '#';
    back.title = 'Jump back to the reference';
    back.textContent = '↩';
    back.addEventListener('mousedown', (event) => event.preventDefault());
    back.addEventListener('click', (event) => {
      event.preventDefault();
      const ref = document.querySelector(`sup[data-footnote-ref="${index}"]`);
      if (ref) {
        ref.scrollIntoView({ block: 'center', behavior: 'smooth' });
        ref.classList.add('md-footnote-flash');
        setTimeout(() => ref.classList.remove('md-footnote-flash'), 900);
      }
    });

    item.append(body, back);
    list.append(item);
  });

  dom.append(list);

  return {
    dom,
    ignoreMutation: () => true,
    stopEvent: (event) => event.target?.classList?.contains('md-footnote-back'),
  };
}
