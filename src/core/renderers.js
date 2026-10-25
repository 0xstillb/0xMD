// 0xMD — the heavy renderers, fetched when they are first needed.
//
// KaTeX (the maths) and highlight.js (the colouring of exported code)
// weigh more than the editor itself. A document without maths that is
// never exported should not pay for them, so both are loaded on demand —
// and the maths appear a moment after the source, which is a fair trade
// for a faster start.

let katexPromise = null;
let highlighterPromise = null;

/** KaTeX, for the maths. */
export function loadKatex() {
  if (!katexPromise) {
    katexPromise = import('katex').then((module) => module.default ?? module);
  }
  return katexPromise;
}

/** highlight.js, for the exported HTML. */
export function loadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('highlight.js/lib/common').then((module) => module.default ?? module);
  }
  return highlighterPromise;
}

/** Both of them — an export needs them together. */
export function loadRenderers() {
  return Promise.all([loadKatex(), loadHighlighter()]);
}
