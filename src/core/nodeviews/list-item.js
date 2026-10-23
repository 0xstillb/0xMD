// 0xMD — list item node view.
//
// Renders a real checkbox for task list items so they can be toggled with
// the mouse.

export function listItemView(node, view, getPos) {
  const isTask = !!node.attrs?.task;

  const dom = document.createElement('li');
  dom.className = 'md-list-item';

  let checkbox = null;
  // Plain items keep their content directly inside the <li> so the native
  // bullet / number still renders; task items get a checkbox in front.
  let contentDOM = dom;

  if (isTask) {
    dom.classList.add('md-task-item');

    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'md-task-checkbox';
    checkbox.checked = !!node.attrs.checked;
    checkbox.contentEditable = 'false';

    checkbox.addEventListener('mousedown', (event) => event.preventDefault());
    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'md-list-item-content';

    dom.append(checkbox, wrapper);
    contentDOM = wrapper;
  }

  function toggle() {
    const pos = getPos();
    if (pos == null) return;
    const current = view.state.doc.nodeAt(pos);
    if (!current) return;
    const next = current.type.create(
      { ...current.attrs, checked: !current.attrs.checked },
      current.content,
      current.marks,
    );
    view.dispatch(view.state.tr.replaceWith(pos, pos + current.nodeSize, next));
  }

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      const updatedTask = !!updatedNode.attrs?.task;
      if (updatedTask !== isTask) return false; // structure changed, force a rebuild
      if (checkbox) checkbox.checked = !!updatedNode.attrs.checked;
      return true;
    },
    ignoreMutation(mutation) {
      // The checkbox is outside the content DOM, ignore mutations there.
      return !contentDOM.contains(mutation.target);
    },
    stopEvent(event) {
      return event.target === checkbox;
    },
  };
}
