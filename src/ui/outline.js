// 0xMD — outline (the sidebar heading tree).
//
// The outline is generated from the document headings
// and highlights the heading you are currently looking at.

export function buildOutline(doc) {
  const headings = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    headings.push({
      level: node.attrs.level,
      text: node.textContent.trim() || '(untitled)',
      pos: pos + 1,
    });
    return false;
  });
  return headings;
}

export function renderOutline(container, headings, { filter = '', onSelect } = {}) {
  container.innerHTML = '';
  const needle = filter.trim().toLowerCase();

  const visible = needle
    ? headings.filter((h) => h.text.toLowerCase().includes(needle))
    : headings;

  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = needle ? 'No matching headings.' : 'This document has no headings.';
    container.append(empty);
    return;
  }

  // Skip levels that do not appear, so the tree is not padded with gaps.
  const levels = [...new Set(visible.map((h) => h.level))].sort((a, b) => a - b);
  const levelIndex = new Map(levels.map((level, index) => [level, index]));

  for (const heading of visible) {
    const item = document.createElement('a');
    item.className = `outline-item outline-level-${levelIndex.get(heading.level)}`;
    item.textContent = heading.text;
    item.href = '#';
    item.dataset.pos = String(heading.pos);
    item.addEventListener('click', (event) => {
      event.preventDefault();
      onSelect?.(heading);
    });
    container.append(item);
  }
}

/** Highlight the heading nearest above the current scroll position. */
export function highlightOutline(container, headings, scrollTop, offsets) {
  if (!headings.length) return;
  let active = null;
  for (let i = 0; i < headings.length; i++) {
    const offset = offsets.get(headings[i].pos);
    if (offset != null && offset <= scrollTop + 8) active = headings[i];
    else break;
  }

  container.querySelectorAll('.outline-item').forEach((el) => {
    el.classList.toggle('is-active', !!active && el.dataset.pos === String(active.pos));
  });

  const activeEl = container.querySelector('.outline-item.is-active');
  if (activeEl) {
    const box = activeEl.getBoundingClientRect();
    const parentBox = container.getBoundingClientRect();
    if (box.top < parentBox.top || box.bottom > parentBox.bottom) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }
}
