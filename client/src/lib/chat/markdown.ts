/**
 * Lightweight Markdown → HTML renderer for chat bubbles.
 *
 * Handles: headings, bold, italic, inline code, bullet/numbered lists,
 * horizontal rules, line breaks, and paragraphs.
 *
 * No external dependencies. Output is sanitized (no raw script tags).
 */

// ── Sanitize ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Inline formatting ───────────────────────────────────────────────────────

function renderInline(line: string): string {
  let out = escapeHtml(line);

  // Bold: **text** or __text__
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (but not inside words with underscores)
  out = out.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '<em>$1</em>');
  out = out.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '<em>$1</em>');

  // Inline code: `text`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Em dash: -- or ---  (but not <hr> which we handle at block level)
  // Actually these are fine as-is since the AI uses real em dashes (—)

  return out;
}

// ── Block-level parsing ─────────────────────────────────────────────────────

export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line → skip (paragraph break handled by grouping)
    if (trimmed === '') {
      i++;
      continue;
    }

    // Fenced code block: ```...```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        if (lines[i].trim().startsWith('```')) {
          i++;
          break;
        }
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      blocks.push(`<pre class="md-pre"><code class="md-code-block">${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // Horizontal rule: --- or *** or ___
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push('<hr class="md-hr"/>');
      i++;
      continue;
    }

    // Heading: # H1, ## H2, ### H3, etc.
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      // Map # → h3, ## → h4, ### → h5 (we don't want h1/h2 inside a chat bubble)
      const tag = `h${Math.min(level + 2, 6)}`;
      blocks.push(`<${tag} class="md-h">${renderInline(headingMatch[2])}</${tag}>`);
      i++;
      continue;
    }

    // Unordered list: - item or * item
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const li = lines[i].trim();
        const m = li.match(/^[-*]\s+(.*)/);
        if (!m) break;
        items.push(`<li>${renderInline(m[1])}</li>`);
        i++;
      }
      blocks.push(`<ul class="md-ul">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list: 1. item
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const li = lines[i].trim();
        const m = li.match(/^\d+\.\s+(.*)/);
        if (!m) break;
        items.push(`<li>${renderInline(m[1])}</li>`);
        i++;
      }
      blocks.push(`<ol class="md-ol">${items.join('')}</ol>`);
      continue;
    }

    // Regular paragraph: collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const pl = lines[i].trim();
      if (pl === '') break;
      if (/^[-*_]{3,}$/.test(pl)) break;
      if (/^#{1,4}\s+/.test(pl)) break;
      if (/^[-*]\s+/.test(pl)) break;
      if (/^\d+\.\s+/.test(pl)) break;
      paraLines.push(renderInline(pl));
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(`<p class="md-p">${paraLines.join('<br/>')}</p>`);
    }
  }

  return blocks.join('');
}
