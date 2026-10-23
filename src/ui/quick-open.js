// 0xMD — quick open (Ctrl+P), the file switcher.

export function createQuickOpen({ root, input, list, sources, onOpen }) {
  let entries = [];

  function flatten(nodes, prefix = '') {
    const out = [];
    for (const node of nodes || []) {
      if (node.type === 'dir') out.push(...flatten(node.children, `${prefix}${node.name}/`));
      else out.push({ path: node.path, name: node.name, label: `${prefix}${node.name}` });
    }
    return out;
  }

  function refresh() {
    entries = [];
    for (const source of sources()) {
      if (source.kind === 'tree') {
        entries.push(...flatten(source.tree));
      } else if (source.kind === 'recent') {
        for (const path of source.paths || []) {
          const parts = String(path).split(/[\\/]/);
          entries.push({ path, name: parts[parts.length - 1], label: parts.slice(-2).join('/') });
        }
      }
    }
  }

  function render() {
    const needle = input.value.trim().toLowerCase();
    const filtered = needle
      ? entries.filter((e) => e.label.toLowerCase().includes(needle))
      : entries;

    list.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('li');
      empty.className = 'quick-open-empty';
      empty.textContent = 'No matching file.';
      list.append(empty);
      return;
    }

    filtered.slice(0, 60).forEach((entry, index) => {
      const item = document.createElement('li');
      item.className = `quick-open-item${index === 0 ? ' is-active' : ''}`;
      item.textContent = entry.label;
      item.addEventListener('click', () => choose(entry));
      list.append(item);
    });
  }

  function choose(entry) {
    close();
    onOpen?.(entry.path);
  }

  function close() {
    root.hidden = true;
    input.value = '';
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    const items = [...list.querySelectorAll('.quick-open-item')];
    const activeIndex = items.findIndex((el) => el.classList.contains('is-active'));

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.max(0, Math.min(items.length - 1, activeIndex + delta));
      items.forEach((el, i) => el.classList.toggle('is-active', i === next));
      items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries.filter((e) => {
        const needle = input.value.trim().toLowerCase();
        return needle ? e.label.toLowerCase().includes(needle) : true;
      })[activeIndex >= 0 ? activeIndex : 0];
      if (entry) choose(entry);
    }
  });

  root.addEventListener('mousedown', (event) => {
    if (event.target === root) close();
  });

  return {
    open() {
      refresh();
      root.hidden = false;
      render();
      input.focus();
    },
    close,
    get isOpen() {
      return !root.hidden;
    },
  };
}
