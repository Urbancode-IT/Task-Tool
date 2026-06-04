// Minimal allow-list sanitizer for comment HTML produced by the rich editor.
// Permits basic formatting + mention chips + links; strips everything else
// (scripts, event handlers, style, etc.) to avoid stored XSS.
const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'DIV', 'P', 'SPAN', 'A',
  'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'SUB', 'SUP', 'FONT',
  'BLOCKQUOTE', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'INPUT',
]);

// Keep only a safe `color:` declaration from a style attribute.
function safeStyle(style) {
  const m = String(style || '').match(/color\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)/i);
  return m ? `color: ${m[1]}` : '';
}

export function sanitizeCommentHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild || doc.body;

  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 1 /* element */) {
        const tag = child.tagName;
        if (!ALLOWED_TAGS.has(tag)) {
          child.replaceWith(doc.createTextNode(child.textContent || ''));
          return;
        }
        Array.from(child.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          const keep =
            (tag === 'SPAN' && (name === 'class' || name === 'data-uid' || name === 'style')) ||
            (tag === 'A' && name === 'href') ||
            (tag === 'FONT' && name === 'color') ||
            (tag === 'IMG' && (name === 'src' || name === 'alt')) ||
            (tag === 'INPUT' && (name === 'type' || name === 'checked')) ||
            ((tag === 'TD' || tag === 'TH') && (name === 'colspan' || name === 'rowspan')) ||
            ((tag === 'UL' || tag === 'OL' || tag === 'LI' || tag === 'TABLE') && name === 'class') ||
            ((tag === 'P' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'LI') && name === 'style');
          if (!keep || name.startsWith('on')) child.removeAttribute(attr.name);
        });
        if (child.hasAttribute('style')) {
          const cleaned = safeStyle(child.getAttribute('style'));
          if (cleaned) child.setAttribute('style', cleaned);
          else child.removeAttribute('style');
        }
        if (tag === 'SPAN') {
          const cls = child.getAttribute('class') || '';
          if (cls && !cls.split(/\s+/).includes('tc-mention')) child.removeAttribute('class');
        }
        if ((tag === 'UL' || tag === 'TABLE') && child.getAttribute('class')) {
          const cls = child.getAttribute('class');
          if (!/^tc-(checklist|table)$/.test(cls)) child.removeAttribute('class');
        }
        if (tag === 'IMG') {
          const src = child.getAttribute('src') || '';
          if (!/^(https?:|data:image\/)/i.test(src)) child.remove();
        }
        if (tag === 'INPUT') {
          // Only read-only checkboxes are allowed in stored comments.
          if ((child.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
            child.remove();
          } else {
            child.setAttribute('type', 'checkbox');
            child.setAttribute('disabled', 'disabled');
          }
        }
        if (tag === 'A') {
          const href = child.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href)) child.removeAttribute('href');
          else {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          }
        }
        walk(child);
      } else if (child.nodeType !== 3 /* not text */) {
        child.remove();
      }
    });
  };

  walk(root);
  return root.innerHTML;
}

/** Extract mentioned user ids (data-uid on .tc-mention spans) from comment HTML. */
export function extractMentionIds(html) {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const ids = Array.from(doc.querySelectorAll('span.tc-mention[data-uid]'))
    .map((el) => el.getAttribute('data-uid'))
    .filter(Boolean);
  return [...new Set(ids)];
}
