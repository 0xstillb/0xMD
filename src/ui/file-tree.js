// 0xMD — file tree (the sidebar "Files" panel).

export function renderFileTree(container, tree, { onOpen, onOpenFolder, activePath } = {}) {
  container.innerHTML = '';

  if (!tree || !tree.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No folder opened.';
    const button = document.createElement('button');
    button.className = 'sidebar-empty-action';
    button.textContent = 'Open a folder…';
    button.addEventListener('click', () => onOpenFolder?.());
    empty.append(button);
    container.append(empty);
    return;
  }

  const build = (nodes, depth) => {
    const list = document.createElement('ul');
    list.className = 'file-tree-list';
    list.style.setProperty('--depth', String(depth));

    for (const node of nodes) {
      const item = document.createElement('li');
      item.className = 'file-tree-item';

      if (node.type === 'dir') {
        const toggle = document.createElement('button');
        toggle.className = 'file-tree-dir';
        toggle.type = 'button';
        toggle.innerHTML = '<span class="file-tree-caret">▸</span><span class="file-tree-name"></span>';
        toggle.querySelector('.file-tree-name').textContent = node.name;
        toggle.addEventListener('click', () => {
          const collapsed = item.classList.toggle('is-collapsed');
          toggle.querySelector('.file-tree-caret').textContent = collapsed ? '▸' : '▾';
        });

        const children = document.createElement('div');
        children.className = 'file-tree-children';
        children.append(build(node.children, depth + 1));

        item.append(toggle, children);
      } else {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'file-tree-file';
        link.textContent = node.name;
        link.dataset.path = node.path;
        if (node.path === activePath) link.classList.add('is-active');
        link.addEventListener('click', () => onOpen?.(node.path));
        item.append(link);
      }

      list.append(item);
    }
    return list;
  };

  container.append(build(tree, 0));
}
