// 0xMD — raw HTML block node view.
//
// The HTML is rendered inside the document, but the markup is sanitised
// first: a .md file must never be able to run scripts inside the editor.

import DOMPurify from 'dompurify';

export function htmlBlockView(node) {
  const dom = document.createElement('div');
  dom.className = 'md-html-block';
  dom.contentEditable = 'false';

  const html = DOMPurify.sanitize(node.textContent, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'align', 'style'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
  });

  dom.innerHTML = html;

  // A click on the block selects it instead of placing the caret inside.
  dom.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  return {
    dom,
    ignoreMutation: () => true,
  };
}
