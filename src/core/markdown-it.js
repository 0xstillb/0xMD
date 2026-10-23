// 0xMD — markdown-it pipeline.
//
// markdown-it does the parsing; a handful of purpose-built rules make sure
// the whole document vocabulary survives the trip into ProseMirror:
//
//   $x$          → math_inline     (inline_math)
//   $$x$$        → math_block      (math_block)
//   ```mermaid   → mermaid         (diagram block)
//   ---...---    → front_matter    (meta_block)
//   > [!NOTE]    → alert           (alert_title / alert_text)

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';

/* ------------------------------------------------------------------ *
 * Front matter — only valid at the very top of the document.
 * ------------------------------------------------------------------ */

function frontMatterPlugin(md) {
  const rule = (state, startLine, endLine, silent) => {
    if (startLine !== 0) return false;

    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.slice(start, max).trim() !== '---') return false;

    let nextLine = startLine;
    const body = [];
    let closed = false;
    while (nextLine + 1 < endLine) {
      nextLine += 1;
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = state.src.slice(lineStart, lineMax);
      if (line.trim() === '---' || line.trim() === '...') { closed = true; break; }
      body.push(state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]));
    }
    if (!closed) return false;

    if (!silent) {
      const token = state.push('front_matter', 'front_matter', 0);
      token.block = true;
      token.content = body.join('\n');
      token.markup = '---';
      token.map = [startLine, nextLine + 1];
    }
    state.line = nextLine + 1;
    return true;
  };

  md.block.ruler.before('table', 'front_matter', rule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

/* ------------------------------------------------------------------ *
 * Math — inline $…$ and block $$…$$.
 * ------------------------------------------------------------------ */

function mathPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    const src = state.src;
    if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
    if (src.charCodeAt(start + 1) === 0x24) return false; // $$ is a block

    let pos = start + 1;
    let found = -1;
    while (pos < state.posMax) {
      const ch = src.charCodeAt(pos);
      if (ch === 0x24) {
        if (src.charCodeAt(pos - 1) === 0x5c) { pos += 1; continue; } // escaped \$
        found = pos;
        break;
      }
      if (ch === 0x0a) break;
      pos += 1;
    }
    if (found < 0) return false;

    const content = src.slice(start + 1, found);
    // No empty maths, no leading/trailing space (that is currency, not maths),
    // and no digit immediately after the closing dollar (also currency).
    if (!content.trim()) return false;
    if (/\s/.test(content[0]) || /\s/.test(content[content.length - 1])) return false;
    const after = src.charCodeAt(found + 1);
    if (after >= 0x30 && after <= 0x39) return false;

    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.markup = '$';
      token.content = content;
    }
    state.pos = found + 1;
    return true;
  });

  md.block.ruler.before('table', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.slice(start, max).trim() !== '$$') return false;

    const body = [];
    let nextLine = startLine;
    let closed = false;
    while (nextLine + 1 < endLine) {
      nextLine += 1;
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = state.src.slice(lineStart, lineMax);
      if (line.trim() === '$$') { closed = true; break; }
      body.push(state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]));
    }
    if (!closed) return false;

    if (!silent) {
      const token = state.push('math_block', 'math', 0);
      token.block = true;
      token.content = body.join('\n');
      token.markup = '$$';
      token.map = [startLine, nextLine + 1];
    }
    state.line = nextLine + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

/* ------------------------------------------------------------------ *
 * Mermaid fences — retag ```mermaid blocks so the schema gets a real node.
 * ------------------------------------------------------------------ */

function mermaidPlugin(md) {
  md.core.ruler.after('inline', '0xmd_mermaid', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'fence' && /^\s*mermaid\b/i.test(token.info)) {
        token.type = 'mermaid';
        token.meta = { markup: '```' + token.info.trim() };
      }
    }
  });
}

/* ------------------------------------------------------------------ *
 * GitHub alerts — "> [!NOTE]" becomes an alert node.
 * ------------------------------------------------------------------ */

const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'];

function alertPlugin(md) {
  md.core.ruler.after('inline', '0xmd_alert', (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;

      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      if (!paragraphOpen || paragraphOpen.type !== 'paragraph_open') continue;
      if (!inline || inline.type !== 'inline') continue;

      const match = /^\[!([A-Za-z]+)\]\s*/.exec(inline.content);
      if (!match) continue;
      const kind = match[1].toLowerCase();
      if (!ALERT_KINDS.includes(kind)) continue;

      // Strip the marker from the inline source *and* from the already
      // tokenized first child so both stay in sync.
      inline.content = inline.content.slice(match[0].length);
      const first = inline.children?.[0];
      if (first && first.type === 'text') first.content = first.content.slice(match[0].length);

      // Find the matching blockquote_close and retag the pair.
      let depth = 0;
      let closeIndex = -1;
      for (let k = i; k < tokens.length; k++) {
        if (tokens[k].type === 'blockquote_open') depth += 1;
        else if (tokens[k].type === 'blockquote_close') {
          depth -= 1;
          if (depth === 0) { closeIndex = k; break; }
        }
      }
      if (closeIndex < 0) continue;

      tokens[i].type = 'alert_open';
      tokens[i].tag = 'div';
      tokens[i].meta = { kind };
      tokens[closeIndex].type = 'alert_close';
      tokens[closeIndex].tag = 'div';
      i = closeIndex;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Footnotes — `[^label]` references plus `[^label]: body` definitions.
 *
 * Written by hand rather than pulled from markdown-it-footnote so that the
 * *raw* definition text survives into the node model; the definitions are
 * re-emitted verbatim when the document is saved.
 * ------------------------------------------------------------------ */

function footnotePlugin(md) {
  md.block.ruler.before('reference', 'footnote_def', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(start, max);
    const match = /^(\s*)\[\^([^\]\s]+)\]:[ \t]?(.*)$/.exec(line);
    if (!match) return false;

    const label = match[2];
    const body = [match[3]];
    let nextLine = startLine + 1;

    while (nextLine < endLine) {
      const lStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lMax = state.eMarks[nextLine];
      const l = state.src.slice(lStart, lMax);
      if (!l.trim()) {
        // A blank line only continues the definition when an indented
        // paragraph follows it.
        let j = nextLine + 1;
        while (j < endLine && !state.src.slice(state.bMarks[j], state.eMarks[j]).trim()) j += 1;
        if (j < endLine && state.sCount[j] >= 4) {
          body.push('');
          nextLine = j;
          continue;
        }
        break;
      }
      if (state.sCount[nextLine] >= 4) {
        body.push(state.src.slice(state.bMarks[nextLine] + 4, state.eMarks[nextLine]));
        nextLine += 1;
        continue;
      }
      break;
    }

    if (!silent) {
      const env = (state.env.footnotes = state.env.footnotes || { defs: new Map(), order: [] });
      if (!env.defs.has(label)) env.order.push(label);
      env.defs.set(label, body.join('\n'));
    }
    state.line = nextLine;
    return true;
  }, { alt: ['reference'] });

  md.inline.ruler.after('image', 'footnote_ref', (state, silent) => {
    const max = state.posMax;
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;
    if (state.src.charCodeAt(start + 1) !== 0x5e /* ^ */) return false;

    let pos = start + 2;
    while (pos < max) {
      const code = state.src.charCodeAt(pos);
      if (code === 0x5d /* ] */) break;
      if (code === 0x5c /* \ */) { pos += 2; continue; }
      pos += 1;
    }
    if (pos >= max) return false;

    const label = state.src.slice(start + 2, pos);
    if (!label.length || /\s/.test(label)) return false;

    if (!silent) {
      const env = (state.env.footnotes = state.env.footnotes || { defs: new Map(), order: [] });
      let id = env.order.indexOf(label);
      let display;
      if (id < 0) {
        // A reference without a definition still renders, using its own label.
        id = -1;
        display = label;
      } else {
        display = String(id + 1);
      }
      const token = state.push('footnote_ref', '', 0);
      token.meta = { id, label: display, key: label };
    }
    state.pos = pos + 1;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Task lists — `- [ ] item` / `- [x] item`.
 * ------------------------------------------------------------------ */

function taskListPlugin(md) {
  md.core.ruler.after('inline', '0xmd_tasklist', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'list_item_open') continue;
      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      if (!paragraphOpen || paragraphOpen.type !== 'paragraph_open') continue;
      if (!inline || inline.type !== 'inline') continue;

      const match = /^\[([ xX])\]\s+/.exec(inline.content);
      if (!match) continue;

      inline.content = inline.content.slice(match[0].length);
      const first = inline.children?.[0];
      if (first && first.type === 'text') first.content = first.content.slice(match[0].length);

      tokens[i].meta = { ...(tokens[i].meta || {}), task: true, checked: match[1].toLowerCase() === 'x' };
    }
  });
}

/* ------------------------------------------------------------------ *
 * Instance
 * ------------------------------------------------------------------ */

export function createMarkdownIt() {
  const md = new MarkdownIt({
    html: true,          // raw HTML is allowed in documents
    linkify: true,
    typographer: true,
    breaks: false,
  });

  md.use(frontMatterPlugin);
  md.use(mathPlugin);
  md.use(mermaidPlugin);
  md.use(alertPlugin);
  md.use(footnotePlugin);
  md.use(taskListPlugin);
  md.use(sub);
  md.use(sup);
  md.use(mark);

  // Fenced code that is not mermaid still renders through the default rule.
  const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules);
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.type === 'mermaid') {
      return `<pre class="md-mermaid-source"><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
    }

    // Syntax highlighting for the exported HTML.
    const info = (token.info || '').trim().split(/\s+/)[0];
    const language = info && hljs.getLanguage(info) ? info : '';
    if (language) {
      const highlighted = hljs.highlight(token.content, { language, ignoreIllegals: true }).value;
      return `<pre class="md-code-block"><code class="hljs language-${language}">${highlighted}</code></pre>`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  // Maths: the editor renders maths with KaTeX, but the exported HTML is
  // produced by markdown-it, so the same engine is used here.
  md.renderer.rules.math_inline = (tokens, idx) => {
    const target = document.createElement('span');
    target.className = 'md-math-inline';
    try {
      katex.render(tokens[idx].content, target, { displayMode: false, throwOnError: false, output: 'html' });
    } catch {
      target.textContent = `$${tokens[idx].content}$`;
    }
    return target.outerHTML;
  };

  md.renderer.rules.math_block = (tokens, idx) => {
    const target = document.createElement('div');
    target.className = 'md-math-block';
    try {
      katex.render(tokens[idx].content, target, { displayMode: true, throwOnError: false, output: 'html' });
    } catch {
      target.textContent = `$$${tokens[idx].content}$$`;
    }
    return target.outerHTML;
  };

  return md;
}

export const markdownIt = createMarkdownIt();
export default markdownIt;
