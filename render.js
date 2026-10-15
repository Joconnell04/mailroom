'use strict';
/*
 * Email HTML -> Markdown for the Raycast reader. Zero dependencies.
 *
 * Emails are built for browsers: layout tables, hidden preheaders padded with invisible characters,
 * dark-mode twin images, tracking pixels, buttons made of styled links. A regex pass shows all of
 * that literally. This parses the HTML into a tree and renders only what a mail client would show:
 *   - hidden elements are skipped (display:none, max-height:0 + overflow:hidden, font-size:0 text, class rules in <style>)
 *   - invisible filler characters are removed
 *   - content images are kept; tracking pixels, spacers and tiny icons are dropped
 *   - table rows of short cells become one line ("Total · $34.55"); layout tables become stacked blocks
 *   - styled links become buttons on their own line, large text becomes a heading, tiny text becomes italic
 *   - quoted replies render as blockquotes, or collapse to one line when earlier messages are already shown
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', zwnj: '‌', zwj: '‍',
  lrm: '‎', rlm: '‏', ensp: ' ', emsp: ' ', thinsp: ' ', hairsp: ' ', numsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°',
  times: '×', divide: '÷', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', rarr: '→', larr: '←', uarr: '↑', darr: '↓',
  harr: '↔', check: '✓', star: '☆', starf: '★', hearts: '♥', sect: '§', para: '¶', plusmn: '±', frac12: '½', frac14: '¼',
  frac34: '¾', sup2: '²', sup3: '³', iexcl: '¡', iquest: '¿', dagger: '†', Dagger: '‡', prime: '′', Prime: '″', minus: '−',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', ouml: 'ö', uuml: 'ü', oacute: 'ó',
  uacute: 'ú', iacute: 'í', ntilde: 'ñ', ccedil: 'ç', szlig: 'ß', Eacute: 'É', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', aring: 'å',
  oslash: 'ø', aelig: 'æ',
};

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return n ? String.fromCodePoint(n) : ''; } catch { return m; }
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/* ------------------------------------------------------------------ parsing */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'noscript', 'template']);
const TABLE_PARTS = new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup']);
const CLOSES_P = new Set(['p', 'div', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'section', 'header', 'footer', 'center']);

function parseAttrs(s) {
  const a = {};
  const re = /([^\s=\/"'>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let m;
  while ((m = re.exec(s))) {
    let v = m[2] ?? '';
    if (v[0] === '"' || v[0] === "'") v = v.slice(1, -1);
    a[m[1].toLowerCase()] = decodeEntities(v);
  }
  return a;
}

function closeUpTo(stack, names, stops) {
  for (let k = stack.length - 1; k > 0; k--) {
    const t = stack[k].tag;
    if (names.includes(t)) { stack.length = k; return; }
    if (stops.includes(t)) return;
  }
}

/** A forgiving HTML parser: good enough for email, never throws. Returns { tag: '#root', children }. */
function parse(html) {
  const src = String(html || '');
  const lower = src.toLowerCase();
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const n = src.length;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const text = s => { if (s) top().children.push({ text: s }); };
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { // comments, including Outlook-only <!--[if mso]> blocks
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') { const end = src.indexOf('>', lt); i = end < 0 ? n : end + 1; continue; }
    const m = /^<\/?([a-zA-Z][\w:-]*)/.exec(src.slice(lt, lt + 80));
    if (!m) { text('<'); i = lt + 1; continue; }
    let j = lt + m[0].length;
    let q = null;
    for (; j < n; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    const tagSrc = src.slice(lt, j + 1);
    i = j + 1;
    const name = m[1].toLowerCase();
    if (tagSrc[1] === '/') {
      // Like a browser: a closing tag can't reach out of a table cell or table (a stray </td> is ignored).
      const walls = name === 'table' ? [] : TABLE_PARTS.has(name) ? ['table'] : ['td', 'th', 'table'];
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name) { stack.length = k; break; }
        if (walls.includes(stack[k].tag)) break;
      }
      continue;
    }
    if (name === 'li') closeUpTo(stack, ['li'], ['ul', 'ol']);
    else if (name === 'td' || name === 'th') closeUpTo(stack, ['td', 'th'], ['tr', 'table']);
    else if (name === 'tr') closeUpTo(stack, ['tr'], ['table', 'tbody', 'thead', 'tfoot']);
    else if (name === 'dt' || name === 'dd') closeUpTo(stack, ['dt', 'dd'], ['dl']);
    if (CLOSES_P.has(name)) closeUpTo(stack, ['p'], ['div', 'td', 'th', 'li', 'table', 'blockquote', 'body']);
    const selfClosing = tagSrc.endsWith('/>');
    const el = { tag: name, attrs: parseAttrs(tagSrc.slice(m[0].length, selfClosing ? -2 : -1)), children: [] };
    top().children.push(el);
    if (RAW.has(name)) {
      const end = lower.indexOf(`</${name}`, i);
      const stop = end < 0 ? n : end;
      el.children.push({ text: src.slice(i, stop), raw: true });
      const gt = src.indexOf('>', stop);
      i = end < 0 ? n : gt < 0 ? n : gt + 1;
      continue;
    }
    if (!VOID.has(name) && !selfClosing) stack.push(el);
  }
  return root;
}

/* ------------------------------------------------------------------ styles */

function styleOf(el) {
  if (el._style) return el._style;
  const st = {};
  for (const decl of String(el.attrs?.style || '').split(';')) {
    const k = decl.indexOf(':');
    if (k > 0) st[decl.slice(0, k).trim().toLowerCase()] = decl.slice(k + 1).trim().toLowerCase().replace(/\s*!important$/, '');
  }
  el._style = st;
  return st;
}

const ZERO = /^0(\.0+)?(px|pt|em|rem|%)?$/;

/** Class names that <style> blocks hide outside media queries (e.g. .preheader { display:none }). */
function hiddenClasses(root) {
  const out = new Set();
  const walk = node => {
    for (const c of node.children || []) {
      if (c.tag === 'style') {
        const css = (c.children[0]?.text || '').replace(/\/\*[\s\S]*?\*\//g, '');
        // drop @media / @supports blocks: those are dark mode and mobile variants, not the default view
        let flat = '';
        let depth = 0;
        let atDepth = -1;
        for (let k = 0; k < css.length; k++) {
          const ch = css[k];
          if (ch === '@' && depth === 0) atDepth = 0;
          if (ch === ';' && depth === 0 && atDepth === 0) { atDepth = -1; continue; } // @import ...;
          if (ch === '{') { depth++; if (atDepth >= 0 && depth === 1) atDepth = 1; }
          if (atDepth < 0) flat += ch;
          if (ch === '}') { depth--; if (depth === 0 && atDepth >= 0) atDepth = -1; }
        }
        for (const rule of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const decl = rule[2].toLowerCase().replace(/\s+/g, '');
          const hides = /display:none/.test(decl) || /visibility:hidden/.test(decl) || (/max-height:0/.test(decl) && /overflow:hidden/.test(decl));
          if (!hides) continue;
          for (const sel of rule[1].split(',')) {
            const m = sel.trim().match(/^[a-z0-9]*\.([\w-]+)$/i);
            if (m) out.add(m[1]);
          }
        }
      } else walk(c);
    }
  };
  walk(root);
  return out;
}

function isHidden(el, hidden) {
  const a = el.attrs || {};
  if ('hidden' in a) return true;
  const st = styleOf(el);
  if (/\bnone\b/.test(st.display || '')) return true;
  if (st.visibility === 'hidden') return true;
  if (st.opacity !== undefined && parseFloat(st.opacity) === 0) return true;
  const clipped = /hidden/.test(st.overflow || '');
  if (clipped && (ZERO.test(st['max-height'] || '') || ZERO.test(st.height || '') || ZERO.test(st['max-width'] || ''))) return true;
  if ((ZERO.test(st.width || '') || a.width === '0') && (ZERO.test(st.height || '') || a.height === '0')) return true;
  if (hidden.size && a.class) for (const c of a.class.split(/\s+/)) if (hidden.has(c)) return true;
  return false;
}

/** px value of a CSS length, or null. */
function px(v) {
  const m = /^(\d+(?:\.\d+)?)(px|pt)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return m[2] === 'pt' ? parseFloat(m[1]) * 4 / 3 : parseFloat(m[1]);
}

/* ------------------------------------------------------------------ rendering */

const PARA = '\u0001';
const LINE = '\u0002';
const INVISIBLE = /[͏​-‏‪-‮⁠-⁤﻿­᠎ㅤᅟᅠ឴឵⠀]/g;
const SPACES = /[  -   　\t\r\n\f ]+/g;
const SKIP = new Set(['head', 'style', 'script', 'title', 'meta', 'link', 'noscript', 'template', 'select', 'option', 'input', 'textarea', 'object', 'embed', 'iframe', 'svg', 'map', 'area']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'center', 'address', 'figure', 'figcaption', 'form', 'fieldset', 'dl', 'dt', 'dd', 'body', 'html', 'table', 'tbody', 'thead', 'tfoot', 'caption']);
const TRACKER = /(pixel|spacer|blank|transparent|shim|1x1|beacon|clear)[^\/]*\.(gif|png)$|\/(open|track|pixel|beacon)(\/|$)/i;
const QUOTE_CLASS = /\b(gmail_quote|gmail_quote_container|yahoo_quoted|moz-cite-prefix|protonmail_quote)\b/;

/** Make a URL safe inside Markdown ( ... ): encodeURIComponent leaves parentheses alone. */
const mdUrl = u => u.replace(/[()\s<>]/g, ch => ({ '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' })[ch] || encodeURIComponent(ch));

function escapeText(s) {
  return s
    .replace(/([\\`*_\[\]<>])/g, '\\$1')
    .replace(/(^|\s)(#{1,6})(?=\s)/g, '$1\\$2')
    .replace(/^([-+])(\s)/, '\\$1$2');
}

const oneLine = s => !/[\u0001\u0002\n]/.test(s.trim());
const plain = s => s.replace(/[\u0001\u0002]/g, ' ').replace(/\s+/g, ' ').trim();

/** Resolve sentinels into Markdown text. */
function finish(s) {
  return s
    .replace(/[ \t]*\u0002[ \t]*/g, LINE)
    .replace(/\u0002{2,}/g, PARA)
    .replace(/\s*\u0001[\s\u0001\u0002]*/g, '\n\n')
    .replace(/\u0002/g, '  \n')
    .split('\n').map(l => l.replace(/^( +)(.*)$/, (m, sp, rest) => (/^([-*+>]|\d+\.) /.test(rest) ? m : rest)).replace(/[ \t]+$/, m => (m === '  ' ? m : ''))).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function rawText(node) {
  if (node.text !== undefined) return decodeEntities(node.text);
  if (node.tag === 'br') return '\n';
  return (node.children || []).map(rawText).join('');
}

function makeRenderer(root, opts) {
  const hidden = hiddenClasses(root);

  function children(el, ctx) {
    return (el.children || []).map(c => node(c, ctx)).join('');
  }

  function node(n, ctx) {
    if (n.text !== undefined) {
      if (n.raw) return '';
      if (ctx.fontSize === 0) return '';
      const t = decodeEntities(n.text).replace(INVISIBLE, '').replace(SPACES, ' ');
      return t ? escapeText(t) : '';
    }
    const tag = n.tag;
    if (SKIP.has(tag) || isHidden(n, hidden)) return '';
    const st = styleOf(n);
    const size = st['font-size'] !== undefined ? px(st['font-size']) ?? ctx.fontSize : ctx.fontSize;
    const c = { ...ctx, fontSize: size };
    if (st['font-weight'] && /bold|[6-9]00/.test(st['font-weight'])) c.bold = true;

    switch (tag) {
      case 'br': return LINE;
      case 'hr': return `${PARA}---${PARA}`;
      case 'img': return image(n, ctx);
      case 'a': return link(n, c);
      case 'b': case 'strong': return wrap(children(n, { ...c, bold: true }), '**', ctx.bold);
      case 'i': case 'em': case 'cite': return wrap(children(n, c), '*', false);
      case 's': case 'strike': case 'del': return wrap(children(n, c), '~~', false);
      case 'code': case 'kbd': case 'tt': return ctx.pre ? rawText(n) : wrap(plain(rawText(n)).replace(/`/g, "'"), '`', false);
      case 'pre': {
        const body = rawText(n).replace(INVISIBLE, '').replace(/\n+$/, '');
        return body.trim() ? `${PARA}\`\`\`\n${body.replace(/```/g, "'''")}\n\`\`\`${PARA}` : '';
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const text = plain(children(n, { ...c, bold: true })).replace(/\*\*/g, '');
        return text ? `${PARA}${'#'.repeat(Math.min(4, Number(tag[1]) + 1))} ${text}${PARA}` : '';
      }
      case 'ul': case 'ol': return list(n, c, tag === 'ol');
      case 'li': return `${PARA}- ${finish(children(n, c))}${PARA}`;
      case 'blockquote': return quote(n, c);
      case 'table': case 'tbody': case 'thead': case 'tfoot': return `${PARA}${children(n, c)}${PARA}`;
      case 'tr': return row(n, c);
      case 'td': case 'th': return `${PARA}${children(n, c)}${PARA}`;
      case 'mailroom-quoted': return quote(n, c);
    }
    if (QUOTE_CLASS.test(n.attrs.class || '') || n.attrs.id === 'divRplyFwdMsg' || n.attrs.id === 'appendonsend') return quote(n, c);

    let inner = children(n, c);
    if (c.bold && !ctx.bold && (!BLOCK.has(tag) || oneLine(inner))) inner = wrap(inner, '**', false);
    if (!BLOCK.has(tag)) return inner;
    return block(inner, size, ctx);
  }

  /** A block of text: big type becomes a heading, tiny type becomes italic fine print. */
  function block(inner, size, ctx) {
    const text = inner.trim();
    if (!text) return '';
    if (oneLine(text) && size && size !== ctx.fontSize) {
      const words = plain(text).replace(/\*\*/g, '');
      if (size >= 20 && words.length <= 90 && !/\]\(/.test(text)) return `${PARA}### ${words}${PARA}`;
    }
    if (size && size <= 11 && !/\*/.test(text) && oneLine(text)) return `${PARA}*${text}*${PARA}`;
    return `${PARA}${inner}${PARA}`;
  }

  function wrap(inner, mark, already) {
    if (already) return inner;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    if (!m[2] || /[\u0001\u0002]/.test(m[2])) return inner;
    return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
  }

  function list(n, ctx, ordered) {
    let k = 0;
    const items = (n.children || []).filter(ch => ch.tag === 'li' && !isHidden(ch, hidden)).map(li => {
      const body = finish(children(li, ctx)).replace(/\n\n(?=([-*+]|\d+\.) )/g, '\n');
      if (!body) return '';
      const bullet = ordered ? `${++k}.` : '-';
      return `${bullet} ${body.replace(/\n/g, `\n${' '.repeat(bullet.length + 1)}`)}`;
    }).filter(Boolean);
    // stray non-li content inside the list
    const rest = (n.children || []).filter(ch => ch.tag !== 'li').map(ch => node(ch, ctx)).join('');
    return `${PARA}${items.join('\n')}${PARA}${rest}`;
  }

  function quote(n, ctx) {
    const body = finish(children(n, ctx));
    if (!body) return '';
    if (opts.collapseQuotes && !/forwarded message|begin forwarded/i.test(body)) return `${PARA}*Quoted text hidden*${PARA}`;
    return `${PARA}${body.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n')}${PARA}`;
  }

  /** Short cells in a row read as one line; cells holding layout (nested blocks) stack. */
  function row(n, ctx) {
    const cells = (n.children || []).filter(ch => (ch.tag === 'td' || ch.tag === 'th') && !isHidden(ch, hidden));
    const rendered = cells.map(td => {
      const st = styleOf(td);
      const size = st['font-size'] !== undefined ? px(st['font-size']) ?? ctx.fontSize : ctx.fontSize;
      const bold = ctx.bold || td.tag === 'th' || /bold|[6-9]00/.test(st['font-weight'] || '');
      return { td, size, text: children(td, { ...ctx, fontSize: size, bold }) };
    }).filter(x => x.text.trim());
    const rest = (n.children || []).filter(ch => ch.tag !== 'td' && ch.tag !== 'th').map(ch => node(ch, ctx)).join('');
    // a cell counts as short when it ends up as one line, even if the email wrapped it in divs or a nested table
    const lines = rendered.map(x => finish(x.text));
    if (rendered.length > 1 && lines.every(l => l && !l.includes('\n') && !/^#/.test(l) && plain(l).length <= 120)) {
      return `${PARA}${lines.join(' · ')}${PARA}${rest}`;
    }
    return rendered.map(x => block(x.text, x.size, ctx)).join('') + rest;
  }

  function image(n, ctx) {
    const a = n.attrs;
    const src = (a.src || '').trim();
    if (!src || !/^(https?:\/\/|\/api\/attachment\?)/i.test(src)) return '';
    const st = styleOf(n);
    const w = px(a.width) ?? px(st.width);
    const h = px(a.height) ?? px(st.height);
    if ((w !== null && w <= 3) || (h !== null && h <= 3) || TRACKER.test(src.split('?')[0])) return '';
    const alt = plain(decodeEntities(a.alt || a.title || '')).replace(/[\[\]]/g, '');
    if (w !== null && h !== null && Math.max(w, h) <= 32) return ctx.inLink && alt ? escapeText(alt) : ''; // icons
    const md = `![${alt}](${mdUrl(src)})`;
    return ctx.inLink ? md : `${PARA}${md}${PARA}`; // pictures get their own line
  }

  function link(n, ctx) {
    const href = (n.attrs.href || '').trim();
    const inner = children(n, { ...ctx, inLink: true });
    if (!/^(https?:|mailto:)/i.test(href)) return inner;
    const url = mdUrl(href);
    const text = inner.trim();
    if (!text) return '';
    if (!oneLine(text)) return inner; // a link wrapping a whole card: keep the content, drop the link
    const st = styleOf(n);
    const bg = st['background-color'] || st.background || '';
    const button = /\b(button|btn|cta)\b/i.test(n.attrs.class || '') ||
      (bg && !/transparent|none|#fff\b|#ffffff|white|inherit/.test(bg)) || (st.border && st.padding && !/none|^0/.test(st.border));
    const label = text.replace(/^\*\*|\*\*$/g, '');
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(label)) return `${PARA}[${label}](${url})${PARA}`; // linked picture
    if (plain(label).replace(/\\/g, '') === href) return `<${href}>`;
    const md = `[${label.replace(/\\?\]/g, '\\]')}](${url})`;
    return button ? `${PARA}**${md}**${PARA}` : md;
  }

  return el => finish(node(el, { fontSize: null, bold: false }));
}

/* ------------------------------------------------------------------ reply history */

// Outlook and most non-Gmail clients mark quoted history with a header block, not a quote element:
// "From: … Sent: … To: … Subject: …" (or "-----Original Message-----"), followed by the old messages as siblings.
const REPLY_HEADER = /^(?:-{3,}\s*Original Message\s*-{3,}|(?:From|De|Von|Van|Da):\s*\S[\s\S]{0,400}?\b(?:Sent|Date|Envoyé|Gesendet|Verzonden|Inviato):\s*\S[\s\S]{0,400}?\b(?:To|Subject|À|An|Aan|Objet|Betreff):)/i;

function textOf(node, max = 800) {
  let out = '';
  const walk = n => {
    if (out.length >= max) return;
    if (n.text !== undefined) { if (!n.raw) out += decodeEntities(n.text); return; }
    if (SKIP.has(n.tag)) return;
    (n.children || []).forEach(walk);
  };
  walk(node);
  return out.replace(INVISIBLE, '').replace(SPACES, ' ').trim();
}

/**
 * Cut Outlook-style reply history off the tree. Returns the removed nodes in document order, or null when there's
 * no such history or nothing new was written above it (a bare forward keeps its content).
 */
function splitReplyHistory(root) {
  let path = null;
  const find = (n, trail) => {
    if (path || n.text !== undefined || SKIP.has(n.tag)) return;
    if (n.tag === 'blockquote' || QUOTE_CLASS.test(n.attrs?.class || '')) return; // already a quote
    if (n !== root && (n.attrs.id === 'divRplyFwdMsg' || (['div', 'p', 'span', 'font'].includes(n.tag) && REPLY_HEADER.test(textOf(n, 900))))) {
      path = [...trail, n];
      return;
    }
    for (const c of n.children || []) find(c, [...trail, n]);
  };
  find(root, []);
  if (!path) return null;
  // Outlook web puts an <hr> or empty #appendonsend right before the header: cut from there.
  const removed = [];
  for (let k = path.length - 1; k > 0; k--) {
    const parent = path[k - 1];
    let at = parent.children.indexOf(path[k]);
    if (k === path.length - 1) {
      while (at > 0 && (parent.children[at - 1].tag === 'hr' || parent.children[at - 1].attrs?.id === 'appendonsend' || (parent.children[at - 1].text !== undefined && !parent.children[at - 1].text.replace(INVISIBLE, '').trim()))) at--;
      removed.unshift(...parent.children.splice(at));
    } else {
      removed.push(...parent.children.splice(at + 1));
    }
  }
  if (!textOf(root, 40)) { // nothing written above the history: it's a forward, keep it all
    root.children.push(...removed);
    return null;
  }
  return removed;
}

/**
 * @param {string} html
 * @param {{ collapseQuotes?: boolean }} opts  collapseQuotes: replace quoted replies with one line, for messages whose
 *   earlier messages are already shown above in the same thread
 */
function htmlToMarkdown(html, opts = {}) {
  const root = parse(html);
  const history = splitReplyHistory(root);
  if (history) root.children.push({ tag: 'mailroom-quoted', attrs: {}, children: history });
  const md = makeRenderer(root, opts)(root);
  // lines that are only separators or leftover punctuation from layout
  return md.split('\n').filter(l => !/^[\s·|•\-–—_*]*$/.test(l) || /^(---|)$/.test(l.trim())).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^(---\n\n)+|(\n\n---)+$/g, '').trim();
}

module.exports = { htmlToMarkdown, decodeEntities, ENTITIES, parse };
