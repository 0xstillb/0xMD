// 0xMD — Mermaid diagram node view.
//
// Mermaid is heavy (~3 MB), so it is only imported once a document actually
// contains a diagram.

let mermaidPromise = null;
let diagramCounter = 0;

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      const dark = document.documentElement.dataset.mermaidTheme === 'dark';
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        // Never let the OS colour scheme flip the palette behind our back.
        darkMode: false,
        securityLevel: 'strict',
        fontFamily: 'inherit',
        // SVG text labels instead of foreignObject — they never get clipped.
        flowchart: { htmlLabels: false },
        themeVariables: {
          fontSize: '14px',
          primaryColor: '#eef2f7',
          primaryTextColor: '#24292f',
          primaryBorderColor: '#9fb0c4',
          lineColor: '#57606a',
          secondaryColor: '#f6f8fa',
          tertiaryColor: '#ffffff',
          background: '#ffffff',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/**
 * Mermaid paints its SVG with inline styles, which no stylesheet can
 * override. So the colours are set on the elements directly, using the
 * values the active theme defines.
 */
function paintDiagram(svg) {
  const styles = getComputedStyle(document.documentElement);
  const value = (name, fallback) => (styles.getPropertyValue(name) || fallback).trim();

  const nodeFill = value('--code-bg', '#f8f8f8');
  const nodeStroke = value('--border', '#dfe2e5');
  const textColor = value('--text', '#333333');
  const lineColor = value('--muted', '#777777');

  svg.querySelectorAll('.node rect, .node polygon, .node circle, .node ellipse').forEach((el) => {
    el.style.setProperty('fill', nodeFill);
    el.style.setProperty('stroke', nodeStroke);
  });

  svg.querySelectorAll('text, .nodeLabel, .label, .edgeLabel').forEach((el) => {
    el.style.setProperty('fill', textColor);
  });

  svg.querySelectorAll('.flowchart-link, .edgePath path, .edge-thickness-normal, path.flowchart-link').forEach((el) => {
    el.style.setProperty('stroke', lineColor);
    el.style.setProperty('stroke-width', '1.5px');
  });

  svg.querySelectorAll('marker path, marker polygon').forEach((el) => {
    el.style.setProperty('fill', lineColor);
    el.style.setProperty('stroke', lineColor);
  });
}

export function mermaidView(node, view, getPos) {
  const dom = document.createElement('div');
  dom.className = 'md-mermaid-block md-rawblock';

  const header = document.createElement('div');
  header.className = 'md-rawblock-control md-rawblock-before';
  header.textContent = '```mermaid';

  const output = document.createElement('div');
  output.className = 'md-mermaid-output';

  const editor = document.createElement('textarea');
  editor.className = 'md-mermaid-editor';
  editor.spellcheck = false;
  editor.hidden = true;

  const errorBox = document.createElement('div');
  errorBox.className = 'md-mermaid-error';
  errorBox.hidden = true;

  dom.append(header, output, errorBox, editor);

  // The diagram is painted with the active theme's colours, so it has to be
  // repainted whenever the theme changes.
  const onThemeChange = () => {
    const svg = output.querySelector('svg');
    if (svg) paintDiagram(svg);
  };
  window.addEventListener('0xmd:themechange', onThemeChange);

  let source = node.textContent;
  let editing = false;
  let renderToken = 0;

  const paint = async () => {
    const token = ++renderToken;
    errorBox.hidden = true;
    output.innerHTML = '';
    if (!source.trim()) return;

    try {
      const mermaid = await loadMermaid();
      if (token !== renderToken) return;
      // The id must start with a letter: Mermaid turns it into an id-scoped CSS
      // selector (`#id .node rect { … }`), and a CSS id may not start with a
      // digit — an invalid selector would void Mermaid's whole stylesheet.
      const id = `oxmd-mermaid-${++diagramCounter}`;
      // mermaid.render() wants a detached element it can measure.
      const { svg } = await mermaid.render(id, source);
      if (token !== renderToken) return;
      output.innerHTML = svg;
      const painted = output.querySelector('svg');
      if (painted) paintDiagram(painted);
    } catch (err) {
      if (token !== renderToken) return;
      errorBox.hidden = false;
      errorBox.textContent = String(err?.message || err);
      output.innerHTML = `<pre class="md-mermaid-source"><code>${escapeHtml(source)}</code></pre>`;
    }
  };

  const setEditing = (next) => {
    editing = next;
    editor.hidden = !next;
    output.hidden = next;
    errorBox.hidden = next || errorBox.textContent === '';
    if (next) {
      editor.value = source;
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    } else {
      commit();
    }
  };

  const commit = () => {
    const next = editor.value;
    if (next === source) return;
    source = next;
    paint();
    const pos = getPos();
    if (pos == null) return;
    const tr = view.state.tr.replaceWith(
      pos + 1,
      pos + 1 + nodeView.node.content.size,
      view.state.schema.text(next),
    );
    view.dispatch(tr);
  };

  editor.addEventListener('blur', () => setEditing(false));
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      setEditing(false);
    }
  });

  output.addEventListener('click', () => setEditing(true));

  paint();

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      const nextSource = updatedNode.textContent;
      if (nextSource === source) return true;
      source = nextSource;
      if (!editing) paint();
      else editor.value = source;
      return true;
    },
    destroy() {
      window.removeEventListener('0xmd:themechange', onThemeChange);
    },
    selectNode() {
      dom.classList.add('md-selected');
    },
    deselectNode() {
      dom.classList.remove('md-selected');
    },
    ignoreMutation() {
      return true;
    },
    stopEvent(event) {
      return event.target === editor;
    },
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
