'use strict';
/* Mailroom client. Vanilla JS, no build step. */

/* ================================================================ basics */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtN = n => Number(n || 0).toLocaleString();
const plural = (n, word) => `${fmtN(n)} ${word}${n === 1 ? '' : 's'}`;

const TRIAGE = ['now', 'later', 'noise'];
const VIEWS = ['inbox', 'now', 'later', 'noise', 'starred', 'sent', 'all', 'trash', 'search'];
const VIEW_NAMES = { inbox: 'Inbox', now: 'Now', later: 'Later', noise: 'Noise', starred: 'Starred', sent: 'Sent', all: 'All mail', trash: 'Trash', search: 'Search' };
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'msn.com']);

const ICONS = {
  inbox: 'M19 3H4.99c-1.11 0-1.98.89-1.98 2L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z',
  now: 'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z',
  later: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  noise: 'M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01L18 14.68z',
  star: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  starFill: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  sent: 'M4.01 6.03l7.51 3.22-7.52-1 .01-2.22m7.5 8.72L4 17.97v-2.22l7.51-1M2.01 3L2 10l15 2-15 2 .01 7L23 12 2.01 3z',
  all: 'M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z',
  trash: 'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z',
  archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.81.97H5.44l.8-.97zM5 19V8h14v11H5zm8.45-9h-2.9v3H8l4 4 4-4h-2.55z',
  done: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  read: 'M21.99 8c0-.72-.37-1.35-.94-1.7L12 1 2.95 6.3C2.38 6.65 2 7.28 2 8v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2l-.01-10zM12 13L3.74 7.84 12 3l8.26 4.84L12 13z',
  unread: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
  refresh: 'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  label: 'M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16zM16 17H5V7h11l3.55 5L16 17z',
  labelOff: 'M3.25 2.75l17 17L19 21l-2-2H5c-1.1 0-2-.9-2-2V7c0-.55.23-1.05.59-1.41L2 4l1.25-1.25zM22 12l-4.37-6.16C17.27 5.33 16.67 5 16 5H8l11 11 3-4z',
  open: 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  moon: 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z',
  sun: 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  chevLeft: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  chevRight: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  contrast: 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm1-17.93c3.94.49 7 3.86 7 7.93s-3.06 7.44-7 7.93V4.07z',
  people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  rule: 'M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39c.51-.66.04-1.61-.79-1.61H5.04c-.83 0-1.3.95-.79 1.61z',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

/* ================================================================ prefs & state */

const prefs = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('mailroom.prefs') || '{}'); } catch { /* private mode */ }
  return { theme: 'system', darkBodies: false, afterDone: 'next', markReadOnOpen: true, remoteImages: true, account: 'all', ...saved };
})();
function savePrefs() {
  try { localStorage.setItem('mailroom.prefs', JSON.stringify(prefs)); } catch { /* ignore */ }
}

const S = {
  meta: null,
  counts: null,
  mode: 'list',          // list | thread | setup
  view: null,
  q: '',
  unread: false,
  threads: [],
  page: null,
  pageSize: 40,
  more: [],
  errors: [],
  missing: [],
  loadedAt: 0,
  loading: false,
  loadingMore: false,
  sel: new Set(),
  lastSel: -1,
  focus: -1,
  listScroll: 0,
  thread: null,          // { t, d, inList }
  navFromList: false,
  lastUndo: null,
  pending: new Map(),
  showImages: new Set(), // message ids where the user chose to load remote images
};

const key = t => `${t.account}:${t.id}`;
const has = (t, f) => t.flags.includes(f);
const triageOf = t => TRIAGE.find(x => has(t, x)) || null;
const acctIndex = email => Math.max(0, (S.meta?.accounts || []).findIndex(a => a.email === email));
const acctShort = email => (email || '').split('@')[0];
const multiAccount = () => prefs.account === 'all' && (S.meta?.accounts?.length || 0) > 1;
const isDark = () => document.documentElement.dataset.theme === 'dark'
  || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

/* ================================================================ api */

let busyCount = 0;
function busy(delta) {
  busyCount = Math.max(0, busyCount + delta);
  $('#progress').classList.toggle('on', busyCount > 0);
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'X-Mailroom': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the Mailroom server. Is it still running?");
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    Object.assign(err, { status: res.status, data });
    throw err;
  }
  return data;
}

/* ================================================================ dates */

function shortDate(ms) {
  const d = new Date(ms);
  const n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}
function fullDate(ms) {
  return new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(ms) {
  const s = (ms - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return 'just now';
}
function threadDate(ms) {
  const d = new Date(ms);
  const base = d.toLocaleString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit' });
  return `${base} (${ago(ms)})`;
}
function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/* ================================================================ routing */

function listHash(view = S.view, q = S.q) {
  return view === 'search' ? `#/search/${encodeURIComponent(q)}` : `#/${view}`;
}
function threadHash(t) {
  return `${listHash()}/${encodeURIComponent(t.account)}/${t.id}`;
}
function parseHash() {
  const segs = location.hash.replace(/^#\/?/, '').split('/').map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const view = segs[0] || 'inbox';
  let q = '';
  let rest = segs.slice(1);
  if (view === 'search') { q = segs[1] || ''; rest = segs.slice(2); }
  const thread = rest.length >= 2 && rest[0] && rest[1] ? { account: rest[0], id: rest[1] } : null;
  return { view, q, thread };
}

function route() {
  if (!S.meta) return; // boot() routes once accounts are loaded
  const r = parseHash();
  closeMenu();
  if (r.view === 'setup') { S.mode = 'setup'; renderSidebar(); renderSetup(); return; }
  if (!S.meta.configured || !S.meta.accounts.length) { location.replace('#/setup'); return; }
  if (!VIEWS.includes(r.view) || (r.view === 'search' && !r.q)) { location.replace('#/inbox'); return; }
  const changed = r.view !== S.view || r.q !== S.q;
  S.view = r.view;
  S.q = r.q;
  $('#q').value = r.view === 'search' ? r.q : '';
  $('#clearSearch').hidden = r.view !== 'search';
  if (changed) resetList();
  renderSidebar();
  if (r.thread) {
    if (changed || !S.loadedAt) loadList();
    openThread(r.thread.account, r.thread.id);
  } else {
    S.navFromList = false;
    showList();
    if (changed || !S.loadedAt) loadList();
  }
}

function go(view) {
  S.navFromList = false;
  location.hash = listHash(view, '');
}

function resetList() {
  S.threads = [];
  S.page = null;
  S.more = [];
  S.sel.clear();
  S.focus = -1;
  S.lastSel = -1;
  S.loadedAt = 0;
  S.listScroll = 0;
}

/* ================================================================ loading */

let listReq = 0;
async function loadList({ more = false, quiet = false } = {}) {
  if (more && (!S.page || S.loadingMore)) return;
  const my = more ? listReq : ++listReq;
  const params = new URLSearchParams({ view: S.view, account: prefs.account });
  if (S.view === 'search') params.set('q', S.q);
  if (S.unread) params.set('unread', '1');
  if (more) params.set('cursor', S.page);
  if (more) S.loadingMore = true; else S.loading = !quiet;
  if (!quiet) busy(1);
  if (!more && !quiet && S.mode === 'list') renderRows();
  try {
    const r = await api(`/api/threads?${params}`);
    if (my !== listReq) return;
    S.pageSize = r.pageSize || 40;
    replayPending(r.threads);
    if (more) {
      // Older pages from another account can sort in above the cursor, so keep focus on the same thread, not the same row.
      const focusKey = S.threads[S.focus] ? key(S.threads[S.focus]) : null;
      const lastSelKey = S.threads[S.lastSel] ? key(S.threads[S.lastSel]) : null;
      const seen = new Set(S.threads.map(key));
      S.threads.push(...r.threads.filter(t => !seen.has(key(t))));
      S.threads.sort((a, b) => b.date - a.date);
      if (focusKey) S.focus = S.threads.findIndex(t => key(t) === focusKey);
      if (lastSelKey) S.lastSel = S.threads.findIndex(t => key(t) === lastSelKey);
      S.page = r.cursor;
      S.more = r.more;
    } else if (quiet && S.loadedAt) {
      mergeFresh(r);
    } else {
      S.threads = r.threads.filter(inView);
      S.page = r.cursor;
      S.more = r.more;
      S.focus = S.threads.length ? 0 : -1;
      S.sel.clear();
    }
    S.errors = r.errors || [];
    S.missing = r.missing || [];
    S.loadedAt = Date.now();
  } catch (e) {
    if (my === listReq) toast(e.message);
  } finally {
    if (more) S.loadingMore = false; else S.loading = false;
    if (!quiet) busy(-1);
    if (my === listReq && S.mode === 'list') renderListParts();
    if (my === listReq && S.mode === 'thread' && S.thread && !S.thread.inList) linkOpenThread();
  }
}

/** A thread opened by URL before the list loaded: attach it to its list row once the list arrives. */
function linkOpenThread() {
  const cur = S.thread.t;
  const idx = S.threads.findIndex(t => t.account === cur.account && t.id === cur.id);
  if (idx < 0) return;
  const row = S.threads[idx];
  row.flags = cur.flags;
  S.thread.t = row;
  S.thread.inList = true;
  S.focus = idx;
  renderThreadChrome();
}

/** Merge a fresh first page into the current list without losing scroll, focus or extra pages. */
function mergeFresh(r) {
  const focusKey = S.threads[S.focus] ? key(S.threads[S.focus]) : null;
  const fresh = new Map(r.threads.map(t => [key(t), t]));
  const byAcct = {};
  for (const t of r.threads) (byAcct[t.account] ||= []).push(t);
  const floor = {};
  for (const a of S.meta.accounts) {
    const list = byAcct[a.email] || [];
    floor[a.email] = r.more.includes(a.email) && list.length ? Math.min(...list.map(t => t.date)) : -Infinity;
  }
  const partial = new Set(r.partial || []);
  const kept = S.threads.filter(t => fresh.has(key(t)) || partial.has(t.account) || t.date < (floor[t.account] ?? -Infinity));
  const merged = kept.map(t => {
    const f = fresh.get(key(t));
    if (f) { fresh.delete(key(t)); return Object.assign(t, f); }
    return t;
  });
  S.threads = [...merged, ...fresh.values()].filter(inView).sort((a, b) => b.date - a.date);
  if (!S.page) { S.page = r.cursor; S.more = r.more; }
  const idx = focusKey ? S.threads.findIndex(t => key(t) === focusKey) : -1;
  S.focus = idx >= 0 ? idx : Math.min(S.focus, S.threads.length - 1);
  for (const k of [...S.sel]) if (!S.threads.some(t => key(t) === k)) S.sel.delete(k);
}

async function refreshCounts() {
  try {
    S.counts = await api('/api/counts');
    renderSidebar();
    if (S.mode === 'list') renderBucket();
  } catch { /* sidebar keeps old numbers */ }
}
let countsTimer;
function refreshCountsSoon() {
  clearTimeout(countsTimer);
  countsTimer = setTimeout(refreshCounts, 1200);
}
function viewCount(view) {
  const emails = prefs.account === 'all' ? S.meta.accounts.map(a => a.email) : [prefs.account];
  let total = 0, unread = 0, any = false;
  for (const e of emails) {
    const c = S.counts?.accounts?.[e]?.[view];
    if (c) { any = true; total += c.total; unread += c.unread; }
  }
  return any ? { total, unread } : null;
}

/* ================================================================ sidebar */

function renderSidebar() {
  const sb = $('#sidebar');
  const item = (view, label, ic, countMode) => {
    const c = countMode ? viewCount(view) : null;
    let count = '';
    if (c && countMode === 'unread' && c.unread) count = `<span class="count">${fmtN(c.unread)}</span>`;
    if (c && countMode === 'total' && c.total) count = `<span class="count${c.unread ? '' : ' soft'}">${fmtN(c.total)}</span>`;
    const active = S.mode !== 'setup' && S.view === view;
    return `<a class="nav-item${active ? ' active' : ''}" href="${listHash(view, '')}" data-view="${view}" title="${esc(label)}">${icon(ic)}<span class="label">${esc(label)}</span>${count}</a>`;
  };
  const accounts = S.meta?.accounts || [];
  const acctItems = accounts.length > 1 ? `
    <div class="nav-head">Accounts</div>
    <a class="nav-item${prefs.account === 'all' ? ' active' : ''}" data-account="all" title="All accounts">${icon('people')}<span class="label">All accounts</span></a>
    ${accounts.map(a => {
      const c = S.counts?.accounts?.[a.email]?.inbox;
      const bad = a.status !== 'ok' || S.counts?.accounts?.[a.email]?.error;
      return `<a class="nav-item${prefs.account === a.email ? ' active' : ''}" data-account="${esc(a.email)}" title="${esc(a.email)}">
        <span class="dot-box"><span class="acct-dot" style="--c:var(--acct-${a.color})"></span></span>
        <span class="label">${esc(a.short)}</span>
        ${bad ? '<span class="warn">sign in</span>' : c?.unread ? `<span class="count">${fmtN(c.unread)}</span>` : ''}
      </a>`;
    }).join('')}` : '';
  sb.innerHTML = `
    ${item('inbox', 'Inbox', 'inbox', 'unread')}
    ${item('now', 'Now', 'now', 'unread')}
    ${item('later', 'Later', 'later', 'unread')}
    ${item('noise', 'Noise', 'noise', 'unread')}
    <div class="nav-sep"></div>
    ${item('starred', 'Starred', 'star', 'unread')}
    ${item('sent', 'Sent', 'sent', null)}
    ${item('all', 'All mail', 'all', null)}
    ${item('trash', 'Trash', 'trash', null)}
    ${acctItems}`;
}

/* ================================================================ list view */

function showList() {
  const wasList = S.mode === 'list' && $('#list');
  S.mode = 'list';
  S.thread = null;
  if (!wasList) {
    $('#panel').innerHTML = '<div class="toolbar" id="tb"></div><div id="bucket"></div><div id="banners"></div><div class="list" id="list"></div>';
    $('#list').addEventListener('scroll', onListScroll, { passive: true });
  }
  renderListParts();
  $('#list').scrollTop = S.listScroll;
  const row = $('.row.cursor');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function renderListParts() {
  if (S.mode !== 'list' || !$('#list')) return;
  renderToolbar();
  renderBucket();
  renderBanners();
  renderRows();
}

function selectedThreads() {
  return S.threads.filter(t => S.sel.has(key(t)));
}

function doneTitle() {
  return TRIAGE.includes(S.view) ? 'Done: archive and clear label (e)' : 'Archive (e)';
}

function renderToolbar() {
  const tb = $('#tb');
  if (!tb) return;
  const n = S.sel.size;
  const total = S.threads.length;
  const ts = selectedThreads();
  const anyUnread = ts.some(t => has(t, 'UNREAD'));
  const anyTriage = ts.some(t => triageOf(t));
  let actions;
  if (!n) {
    actions = `<button class="icon-btn" data-act="refresh" title="Refresh (Shift+N)">${icon('refresh')}</button>
      <button class="icon-btn" data-act="listMenu" title="More">${icon('more')}</button>`;
  } else if (S.view === 'trash') {
    actions = `<button class="icon-btn" data-act="untrash" title="Move out of Trash">${icon('inbox')}</button>`;
  } else {
    actions = `<button class="icon-btn" data-act="done" title="${doneTitle()}">${icon('archive')}</button>
      <button class="icon-btn" data-act="trash" title="Delete (#)">${icon('trash')}</button>
      <button class="icon-btn" data-act="${anyUnread ? 'read' : 'unread'}" title="Mark as ${anyUnread ? 'read (Shift+I)' : 'unread (Shift+U)'}">${icon(anyUnread ? 'read' : 'unread')}</button>
      <span class="tb-sep"></span>
      <button class="icon-btn" data-act="moveMenu" title="Move to (l)">${icon('label')}</button>
      ${anyTriage ? `<button class="icon-btn" data-act="clear" title="Clear triage label (y)">${icon('labelOff')}</button>` : ''}`;
  }
  const range = total ? `1–${fmtN(total)}${S.page ? ' of many' : ''}` : '';
  tb.innerHTML = `
    <label class="hit" title="Select all loaded (* then a)"><input type="checkbox" class="cb" id="selAll" ${n && n === total ? 'checked' : ''} aria-label="Select all"></label>
    ${actions}
    <span class="spacer"></span>
    ${n ? `<span class="meta">${fmtN(n)} selected</span>` : ''}
    <button class="filter-chip${S.unread ? ' on' : ''}" data-act="unreadFilter" title="Show unread only">${S.unread ? icon('done') : ''}Unread</button>
    <span class="meta">${range}</span>`;
  const all = $('#selAll');
  all.indeterminate = n > 0 && n < total;
}

function renderBucket() {
  const el = $('#bucket');
  if (!el) return;
  if (!TRIAGE.includes(S.view)) { el.innerHTML = ''; return; }
  const c = viewCount(S.view);
  const scope = prefs.account === 'all' ? (S.meta.accounts.length > 1 ? `across ${S.meta.accounts.length} accounts` : '') : `in ${acctShort(prefs.account)}`;
  const sub = c ? `${plural(c.total, 'conversation')} · ${fmtN(c.unread)} unread ${scope}` : scope;
  const primary = S.view === 'now'
    ? `<button class="btn filled" data-act="bulkDone" ${c && !c.total ? 'disabled' : ''} title="Archive everything in Now and remove the label">${icon('done')}Done with all</button>`
    : `<button class="btn filled" data-act="bulkClear" ${c && !c.total ? 'disabled' : ''} title="Remove the ${S.view} label from everything">${icon('labelOff')}Clear all</button>`;
  const stale = S.view === 'now'
    ? `<button class="btn" data-act="clearStale" title="Archive and unlabel Now conversations with no activity in 7 days">${icon('later')}Clear older than 7 days</button>`
    : '';
  el.innerHTML = `<div class="bucketbar">
      <div class="title"><h2>${VIEW_NAMES[S.view]}</h2><span class="sub">${esc(sub)}</span></div>
      <span class="spacer"></span>
      ${stale}
      <button class="btn" data-act="bulkRead" ${c && !c.unread ? 'disabled' : ''}>${icon('read')}Mark all read</button>
      ${primary}
    </div>`;
}

function renderBanners() {
  const el = $('#banners');
  if (!el) return;
  const out = [];
  for (const e of S.errors) {
    out.push(e.reauth
      ? `<div class="banner">${esc(acctShort(e.account))} is signed out.<a class="btn" href="/auth/start?hint=${encodeURIComponent(e.account)}&return=inbox">Reconnect</a></div>`
      : `<div class="banner">${esc(acctShort(e.account))}: ${esc(e.message)}</div>`);
  }
  // Every account signing out at once is Google's 7-day limit for apps left in Testing.
  if (S.errors.filter(e => e.reauth).length > 1 && S.meta?.publishUrl) {
    out.push(`<div class="banner">Google signs Mailroom out every 7 days until its app is published.<a class="btn" href="${esc(S.meta.publishUrl)}" target="_blank" rel="noreferrer">Publish app</a></div>`);
  }
  if (TRIAGE.includes(S.view) && S.missing.length) {
    out.push(`<div class="banner">No "${S.view}" label found in ${S.missing.map(acctShort).map(esc).join(', ')}. Set the label name in Settings if yours is different.</div>`);
  }
  el.innerHTML = out.join('');
}

function firstName(name) {
  if (!name || name === 'me') return name;
  if (name.includes('@')) return name.split('@')[0];
  return name.split(/\s+/)[0];
}
function peopleHtml(t) {
  const ps = t.people || [];
  if (!ps.length) return esc(t.origin?.name || t.origin?.email || '(no sender)');
  const many = ps.length > 1;
  const shown = ps.length > 3 ? [ps[0], ...ps.slice(-2)] : ps;
  const html = shown.map(p => `<span class="n${p.unread ? ' u' : ''}">${esc(many ? firstName(p.name) : p.name)}</span>`)
    .join(ps.length > 3 ? ', ' : ', ');
  return (ps.length > 3 ? html.replace(', ', ' .. ') : html) + (t.count > 1 ? `<span class="count">${t.count}</span>` : '');
}

function chipsHtml(t) {
  const tri = triageOf(t);
  let out = '';
  if (tri && tri !== S.view) out += `<span class="chip ${tri}">${tri}</span>`;
  if (S.view === 'all' || S.view === 'search' || S.view === 'starred') {
    if (has(t, 'INBOX') && !tri) out += '<span class="chip">Inbox</span>';
  }
  for (const l of (t.labels || []).slice(0, 2)) out += `<span class="chip">${esc(l)}</span>`;
  return out;
}

function rowHtml(t, i) {
  const k = key(t);
  const unread = has(t, 'UNREAD');
  const starred = has(t, 'STARRED');
  const who = S.view === 'sent' ? `<span class="n">To: ${esc((t.to || []).join(', ') || '(no recipients)')}</span>` : peopleHtml(t);
  const dot = multiAccount() ? `<span class="acct-dot" style="--c:var(--acct-${acctIndex(t.account) % 6})" title="${esc(t.account)}"></span>` : '';
  const actions = S.view === 'trash'
    ? `<button class="icon-btn sm" data-act="untrash" title="Move out of Trash">${icon('inbox')}</button>`
    : `<button class="icon-btn sm" data-act="done" title="${doneTitle()}">${icon('archive')}</button>
       <button class="icon-btn sm" data-act="trash" title="Delete (#)">${icon('trash')}</button>
       <button class="icon-btn sm" data-act="${unread ? 'read' : 'unread'}" title="Mark as ${unread ? 'read' : 'unread'}">${icon(unread ? 'read' : 'unread')}</button>
       <button class="icon-btn sm" data-act="moveMenu" title="Move to (l)">${icon('label')}</button>`;
  return `<div class="row${unread ? ' unread' : ''}${S.sel.has(k) ? ' selected' : ''}${i === S.focus ? ' cursor' : ''}" data-i="${i}" role="row">
    <label class="hit" data-stop title="Select"><input type="checkbox" class="cb" data-sel ${S.sel.has(k) ? 'checked' : ''} aria-label="Select conversation"></label>
    <button class="hit star${starred ? ' on' : ''}" data-act="star" title="${starred ? 'Starred' : 'Not starred'} (s)" aria-pressed="${starred}">${icon(starred ? 'starFill' : 'star')}</button>
    <div class="who">${dot}<span class="names">${who}</span></div>
    <div class="line">${chipsHtml(t)}<span class="subject">${esc(t.subject)}</span><span class="snippet"> - ${esc(t.snippet)}</span></div>
    ${t.attachment ? `<span class="att-ic" title="Has attachment">${icon('attach')}</span>` : ''}
    <span class="date" title="${esc(fullDate(t.date))}">${esc(shortDate(t.date))}</span>
    <div class="actions">${actions}</div>
  </div>`;
}

function emptyHtml() {
  const scope = prefs.account === 'all' ? '' : ` in ${esc(acctShort(prefs.account))}`;
  const copy = {
    inbox: ['Inbox is empty', 'Nothing waiting' + scope + '.'],
    now: ['Nothing in Now', 'Nothing needs you right now' + scope + '.'],
    later: ['Later is empty', 'No receipts or notices waiting' + scope + '.'],
    noise: ['No noise', 'Nothing filed as noise' + scope + '.'],
    starred: ['No starred conversations', 'Press s on any conversation to star it.'],
    sent: ['Nothing sent', ''],
    all: ['No mail', ''],
    trash: ['Trash is empty', 'Deleted conversations stay here for 30 days.'],
    search: ['No results', `Nothing matched "${esc(S.q)}"${scope}. Gmail search operators like from: and has:attachment work here.`],
  }[S.view] || ['Nothing here', ''];
  const extra = S.unread ? '<p><button class="btn text" data-act="unreadFilter">Show read conversations too</button></p>' : '';
  return `<div class="empty"><strong>${copy[0]}</strong>${copy[1]}${extra}</div>`;
}

function skeletonHtml() {
  return `<div class="skeleton">${Array.from({ length: 12 }, (_, i) => `<div class="row"><span class="hit"></span><span class="hit"></span>
    <div class="who"><div class="bar" style="width:${90 + (i * 37) % 60}px"></div></div>
    <div class="line"><div class="bar" style="width:${40 + (i * 23) % 45}%"></div></div></div>`).join('')}</div>`;
}

function renderRows() {
  const list = $('#list');
  if (!list) return;
  if (!S.threads.length) {
    // Signed-out accounts aren't an empty bucket: the banners above say what to do.
    const signedOut = S.errors.length && S.errors.every(e => e.reauth);
    list.innerHTML = S.loading ? skeletonHtml() : signedOut ? '' : S.loadedAt ? emptyHtml() : skeletonHtml();
    return;
  }
  const more = S.page ? `<div class="load-more"><button class="btn" data-act="loadMore">${S.loadingMore ? 'Loading…' : 'Load older conversations'}</button></div>` : '';
  const top = list.scrollTop;
  list.innerHTML = S.threads.map(rowHtml).join('') + more;
  list.scrollTop = top;
}

function updateRow(i) {
  const list = $('#list');
  const old = list && list.querySelector(`.row[data-i="${i}"]`);
  if (!old || !S.threads[i]) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = rowHtml(S.threads[i], i);
  old.replaceWith(tmp.firstElementChild);
}

function setFocus(i, { scroll = true } = {}) {
  if (!S.threads.length) { S.focus = -1; return; }
  const next = Math.max(0, Math.min(S.threads.length - 1, i));
  $$('.row.cursor').forEach(r => r.classList.remove('cursor'));
  S.focus = next;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => prefetch(S.threads[next]), 250);
  const row = $(`.row[data-i="${next}"]`);
  if (row) { row.classList.add('cursor'); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
  if (next >= S.threads.length - 3 && S.page) loadList({ more: true });
}

function toggleSel(i, shift) {
  const t = S.threads[i];
  if (!t) return;
  const k = key(t);
  const on = !S.sel.has(k);
  if (shift && S.lastSel >= 0 && S.lastSel !== i) {
    const [a, b] = [Math.min(S.lastSel, i), Math.max(S.lastSel, i)];
    for (let j = a; j <= b; j++) { const kk = key(S.threads[j]); if (on) S.sel.add(kk); else S.sel.delete(kk); updateRow(j); }
  } else {
    if (on) S.sel.add(k); else S.sel.delete(k);
    updateRow(i);
  }
  S.lastSel = i;
  renderToolbar();
}

function selectAll(on) {
  S.sel = on ? new Set(S.threads.map(key)) : new Set();
  renderToolbar();
  renderRows();
}

function onListScroll(e) {
  const el = e.currentTarget;
  S.listScroll = el.scrollTop;
  if (S.page && !S.loadingMore && el.scrollTop + el.clientHeight > el.scrollHeight - 600) loadList({ more: true });
}

/* ================================================================ actions */

/** Label changes for an action on one thread, using symbolic names. Only real changes are listed. */
function diffFor(action, t) {
  const f = new Set(t.flags);
  const tri = TRIAGE.filter(x => f.has(x));
  const d = (add, remove, extra = {}) => (add.length || remove.length ? { add, remove, ...extra } : null);
  switch (action) {
    case 'read': return f.has('UNREAD') ? d([], ['UNREAD']) : null;
    case 'unread': return f.has('UNREAD') ? null : d(['UNREAD'], []);
    case 'star': return f.has('STARRED') ? null : d(['STARRED'], []);
    case 'unstar': return f.has('STARRED') ? d([], ['STARRED']) : null;
    case 'done': return d([], [...tri, ...(f.has('INBOX') ? ['INBOX'] : [])]);
    case 'inbox': return f.has('INBOX') ? null : d(['INBOX'], []);
    case 'clear': return d([], tri);
    case 'trash': return f.has('TRASH') ? null : d(['TRASH'], [], { restore: f.has('INBOX') ? ['INBOX'] : [] });
    case 'untrash': return f.has('TRASH') ? d(f.has('INBOX') ? [] : ['INBOX'], ['TRASH']) : null;
    case 'now': case 'later': case 'noise': {
      const add = f.has(action) ? [] : [action];
      const remove = tri.filter(x => x !== action);
      if (action === 'now') { if (!f.has('INBOX')) add.push('INBOX'); if (!f.has('IMPORTANT')) add.push('IMPORTANT'); }
      else { if (f.has('INBOX')) remove.push('INBOX'); if (f.has('IMPORTANT')) remove.push('IMPORTANT'); }
      return d(add, remove);
    }
    default: return null;
  }
}
function applyDiff(t, d) {
  const f = new Set(t.flags);
  d.remove.forEach(x => f.delete(x));
  d.add.forEach(x => f.add(x));
  t.flags = [...f];
  if (d.remove.includes('UNREAD')) (t.people || []).forEach(p => { p.unread = false; }); // sender names stop being bold
}

/*
 * Changes made here in the last minute. A list refresh that left before the change can arrive after it;
 * replaying these onto incoming rows keeps an archived row from reappearing with its old labels.
 */
function remember(t, d) { S.pending.set(key(t), { d, at: Date.now() }); }
function replayPending(list) {
  const now = Date.now();
  for (const [k, p] of S.pending) if (now - p.at > 60_000) S.pending.delete(k);
  if (!S.pending.size) return list;
  for (const t of list) { const p = S.pending.get(key(t)); if (p) applyDiff(t, p.d); }
  return list;
}
const inverse = d => ({ add: [...d.remove, ...(d.restore || [])], remove: d.add });

function inView(t) {
  if (has(t, 'TRASH') && S.view !== 'trash') return false;
  switch (S.view) {
    case 'inbox': return has(t, 'INBOX');
    case 'now': case 'later': case 'noise': return has(t, S.view);
    case 'starred': return has(t, 'STARRED');
    case 'trash': return has(t, 'TRASH');
    default: return true;
  }
}

function pruneList() {
  const cur = S.threads[S.focus];
  let keptBefore = 0;
  const next = [];
  S.threads.forEach((t, i) => {
    if (inView(t)) { next.push(t); if (i < S.focus) keptBefore++; }
  });
  S.threads = next;
  S.focus = cur && next.includes(cur) ? next.indexOf(cur) : Math.min(keptBefore, next.length - 1);
  for (const k of [...S.sel]) if (!next.some(t => key(t) === k)) S.sel.delete(k);
}

function restoreThreads(ops) {
  for (const o of ops) {
    o.t.flags = [...o.before];
    if (o.people) o.t.people = o.people.map(p => ({ ...p }));
    S.pending.delete(key(o.t));
    if (inView(o.t) && !S.threads.includes(o.t)) S.threads.push(o.t);
  }
  S.threads.sort((a, b) => b.date - a.date);
}

const DONE_TEXT = {
  read: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} marked as read.`,
  unread: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} marked as unread.`,
  done: n => TRIAGE.includes(S.view) ? `${n > 1 ? plural(n, 'conversation') : 'Conversation'} done.` : `${n > 1 ? plural(n, 'conversation') : 'Conversation'} archived.`,
  trash: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} moved to Trash.`,
  untrash: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} moved out of Trash.`,
  inbox: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} moved to Inbox.`,
  clear: n => `Triage label cleared from ${n > 1 ? plural(n, 'conversation') : 'the conversation'}.`,
  now: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} moved to Now.`,
  later: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} moved to Later.`,
  noise: n => `${n > 1 ? plural(n, 'conversation') : 'Conversation'} moved to Noise.`,
};

/** `auto` marks changes the user didn't ask for (mark read on open): they must not replace the undo for the last real action. */
async function perform(action, targets, { silent = false, auto = false } = {}) {
  const ops = [];
  for (const t of targets) {
    const d = diffFor(action, t);
    if (d) ops.push({ t, d, before: [...t.flags], people: (t.people || []).map(p => ({ ...p })) });
  }
  if (!ops.length) return;
  const openT = S.thread?.t;
  ops.forEach(o => { applyDiff(o.t, o.d); remember(o.t, o.d); });
  pruneList();
  afterLocalChange(action, openT);
  try {
    const res = await api('/api/modify', {
      method: 'POST',
      body: { items: ops.map(o => ({ account: o.t.account, id: o.t.id, add: o.d.add, remove: o.d.remove })) },
    });
    refreshCounts(); // after the server has the change, so the numbers include it
    const failed = new Set(res.results.filter(r => !r.ok).map(r => `${r.account}:${r.id}`));
    if (failed.size) {
      const bad = ops.filter(o => failed.has(key(o.t)));
      restoreThreads(bad);
      rerender();
      toast(`${plural(bad.length, 'conversation')} could not be changed: ${res.results.find(r => !r.ok).error}`);
      return;
    }
    const undoFn = () => undoOps(ops);
    if (!auto) S.lastUndo = undoFn;
    if (!silent) toast(DONE_TEXT[action]?.(ops.length) || 'Done.', { undo: undoFn });
  } catch (e) {
    restoreThreads(ops);
    rerender();
    toast(e.message);
  }
}

async function undoOps(ops) {
  restoreThreads(ops);
  ops.forEach(o => remember(o.t, inverse(o.d)));
  rerender();
  try {
    await api('/api/modify', { method: 'POST', body: { items: ops.map(o => ({ account: o.t.account, id: o.t.id, ...inverse(o.d) })) } });
    toast('Action undone.');
  } catch (e) {
    toast(e.message);
  }
  refreshCounts();
}

function rerender() {
  if (S.mode === 'list') renderListParts();
  else if (S.mode === 'thread') renderThreadChrome();
}

function afterLocalChange(action, openT) {
  if (S.mode === 'thread' && openT) {
    const gone = S.thread.inList && !S.threads.includes(openT);
    if (gone || action === 'unread') {
      const next = S.threads[S.focus];
      if (gone && prefs.afterDone === 'next' && next) { openThreadReplace(next); return; }
      back();
      return;
    }
    renderThreadChrome();
    return;
  }
  renderListParts();
}

function targetsFor(row) {
  if (row) { const t = S.threads[Number(row.dataset.i)]; return t ? [t] : []; }
  if (S.mode === 'thread' && S.thread) return [S.thread.t];
  const sel = selectedThreads();
  if (sel.length) return sel;
  return S.threads[S.focus] ? [S.threads[S.focus]] : [];
}

function act(action, row = null) {
  const ts = targetsFor(row);
  if (!ts.length) return;
  if (action === 'toggleStar') {
    const allStarred = ts.every(t => has(t, 'STARRED'));
    perform(allStarred ? 'unstar' : 'star', ts, { silent: true });
    return;
  }
  if (action === 'toggleRead') {
    perform(ts.some(t => has(t, 'UNREAD')) ? 'read' : 'unread', ts);
    return;
  }
  if (S.view === 'trash' && (action === 'done' || action === 'trash')) return perform('untrash', ts);
  perform(action, ts);
}

/* ---------------- bulk (whole bucket, server side) ---------------- */

async function bulk(action) {
  const view = S.view;
  const c = viewCount(view) || { total: S.threads.length, unread: S.threads.filter(t => has(t, 'UNREAD')).length };
  const n = action === 'read' ? c.unread : c.total;
  const scope = prefs.account === 'all' ? (S.meta.accounts.length > 1 ? ` across ${S.meta.accounts.length} accounts` : '') : ` in ${acctShort(prefs.account)}`;
  const name = VIEW_NAMES[view];
  const copy = {
    read: [`Mark ${plural(n, 'conversation')} as read?`, `Everything in ${name}${scope} gets marked read. Labels stay as they are.`, 'Mark all read'],
    clear: [`Clear ${name}?`, `Removes the ${view} label from ${plural(n, 'conversation')}${scope}. Nothing is deleted, and they stay in All mail.`, 'Clear all'],
    done: ['Done with everything in Now?', `Archives ${plural(n, 'conversation')}${scope} and removes the now label. Nothing is deleted.`, 'Done with all'],
  }[action];
  if (!(await confirmDialog(...copy))) return;
  busy(1);
  toast(`Working on ${plural(n, 'conversation')}…`, { sticky: true });
  try {
    const r = await api('/api/bulk', { method: 'POST', body: { view, account: prefs.account, action } });
    for (const t of S.threads) {
      const f = new Set(t.flags);
      if (action === 'read') f.delete('UNREAD');
      else { f.delete(view); if (action === 'done') f.delete('INBOX'); }
      t.flags = [...f];
    }
    pruneList();
    renderListParts();
    const verb = { read: 'Marked as read', clear: `Cleared ${name}`, done: 'Done with Now' }[action];
    const undoFn = r.undo ? () => bulkUndo(r.undo) : null;
    S.lastUndo = undoFn;
    const partial = r.errors?.length ? ` (${r.errors.map(e => acctShort(e.account)).join(', ')} failed)` : '';
    toast(`${verb}: ${plural(n, 'conversation')}.${partial}`, { undo: undoFn, ms: 12000 });
  } catch (e) {
    toast(e.message);
  } finally {
    busy(-1);
    refreshCounts();
  }
}

/** Archive + unlabel Now conversations whose latest message is older than `days`. Counts first, then asks. */
async function clearStale(days) {
  const scope = prefs.account === 'all' ? (S.meta.accounts.length > 1 ? ` across ${S.meta.accounts.length} accounts` : '') : ` in ${acctShort(prefs.account)}`;
  busy(1);
  let preview;
  try {
    preview = await api('/api/bulk', { method: 'POST', body: { view: 'now', account: prefs.account, action: 'done', olderThanDays: days, preview: true } });
  } catch (e) { toast(e.message); return; } finally { busy(-1); }
  const n = preview.threads || 0;
  if (!n) { toast(`Nothing in Now is older than ${days} days.`); return; }
  const ok = await confirmDialog(
    `Clear ${plural(n, 'old conversation')} from Now?`,
    `Archives and removes the now label from ${plural(n, 'conversation')}${scope} with no new messages in the last ${days} days. Nothing is deleted; they stay in All mail. You get an Undo for 15 minutes.`,
    `Clear ${fmtN(n)}`);
  if (!ok) return;
  busy(1);
  toast(`Clearing ${plural(n, 'conversation')}…`, { sticky: true });
  try {
    const r = await api('/api/bulk', { method: 'POST', body: { view: 'now', account: prefs.account, action: 'done', olderThanDays: days } });
    const undoFn = r.undo ? () => bulkUndo(r.undo) : null;
    S.lastUndo = undoFn;
    const partial = r.errors?.length ? ` (${r.errors.map(e => acctShort(e.account)).join(', ')} failed)` : '';
    toast(`Cleared ${plural(r.threads ?? n, 'old conversation')} from Now.${partial}`, { undo: undoFn, ms: 15000 });
    await loadList({ quiet: false });
  } catch (e) {
    toast(e.message);
  } finally {
    busy(-1);
    refreshCounts();
  }
}

async function bulkUndo(token) {
  busy(1);
  toast('Undoing…', { sticky: true });
  try {
    await api('/api/undo', { method: 'POST', body: { token } });
    toast('Undone.');
    await Promise.all([loadList({ quiet: true }), refreshCounts()]);
  } catch (e) {
    toast(e.message);
  } finally {
    busy(-1);
  }
}

/* ---------------- teaching the triage rules ---------------- */

async function teach(t, label, match, type) {
  try {
    const r = await api('/api/rule', { method: 'POST', body: { account: t.account, match, type, label } });
    await perform(label, [t], { silent: true });
    const who = type === 'domain' ? `anything from ${match}` : match;
    toast(`${r.updated ? 'Updated' : 'Added'} rule: ${who} goes to ${cap(label)} in ${acctShort(t.account)}.`, { ms: 7000 });
  } catch (e) {
    toast(e.message, { ms: 8000 });
  }
}

/* ================================================================ thread view */

let threadReq = 0;

function openThreadAt(i) {
  const t = S.threads[i];
  if (!t) return;
  S.focus = i;
  S.listScroll = $('#list')?.scrollTop || 0;
  S.navFromList = true;
  location.hash = threadHash(t);
}
function openThreadReplace(t) {
  history.replaceState(null, '', threadHash(t));
  route();
}
function back() {
  if (S.navFromList) { S.navFromList = false; history.back(); return; }
  history.replaceState(null, '', listHash());
  route();
}
function step(dir) {
  const idx = S.thread ? S.threads.indexOf(S.thread.t) : -1;
  const base = idx >= 0 ? idx : S.focus;
  const next = S.threads[base + dir];
  if (next) { S.focus = base + dir; openThreadReplace(next); }
  else if (dir > 0 && S.page) loadList({ more: true }).then(() => { const n = S.threads[base + 1]; if (n) { S.focus = base + 1; openThreadReplace(n); } });
}

/* Thread bodies are fetched ahead of time (hover, keyboard focus, next-in-line) so opening feels instant. */
const threadCache = new Map();
function threadCacheKey(t) { return `${t.account}:${t.id}:${t.count || 0}:${t.date || 0}`; }
function fetchThread(account, id, t) {
  const k = t ? threadCacheKey(t) : null;
  if (k && threadCache.has(k)) return threadCache.get(k);
  const p = api(`/api/thread?account=${encodeURIComponent(account)}&id=${encodeURIComponent(id)}`);
  if (k) {
    threadCache.set(k, p);
    p.catch(() => threadCache.delete(k));
    if (threadCache.size > 60) threadCache.delete(threadCache.keys().next().value);
  }
  return p;
}
function prefetch(t) { if (t) fetchThread(t.account, t.id, t).catch(() => {}); }
let hoverTimer;

async function openThread(account, id) {
  const my = ++threadReq;
  S.mode = 'thread';
  let t = S.threads.find(x => x.account === account && x.id === id);
  if (t) S.focus = S.threads.indexOf(t);
  S.thread = { t: t || { account, id, flags: [], subject: '', people: [], labels: [] }, d: null, inList: !!t };
  renderThreadShell();
  try {
    const d = { ...(await fetchThread(account, id, t)) };
    if (my !== threadReq) return;
    if (t) d.flags = t.flags; // the list row has the freshest label state
    const idx = t ? S.threads.indexOf(t) : -1;
    if (idx >= 0) { prefetch(S.threads[idx + 1]); prefetch(S.threads[idx - 1]); }
    const people = t && !has(t, 'UNREAD') ? (d.people || []).map(p => ({ ...p, unread: false })) : d.people;
    if (t) Object.assign(t, { flags: d.flags, labels: d.labels, subject: d.subject, people, count: d.count, snippet: d.snippet, date: d.date });
    else t = S.thread.t = Object.assign(S.thread.t, d);
    S.thread.d = d;
    renderThread();
    if (prefs.markReadOnOpen && has(t, 'UNREAD')) perform('read', [t], { silent: true, auto: true });
    loadWhy(t);
  } catch (e) {
    if (my !== threadReq) return;
    $('#threadBody').innerHTML = `<div class="loading-line">${esc(e.message)}</div>`;
  }
}

function threadToolbar() {
  const t = S.thread.t;
  const idx = S.threads.indexOf(t);
  const pos = idx >= 0 ? `${fmtN(idx + 1)} of ${fmtN(S.threads.length)}${S.page ? '+' : ''}` : '';
  const inTrash = has(t, 'TRASH');
  const gmail = S.thread.d?.gmailUrl;
  return `
    <button class="icon-btn" data-act="back" title="Back to ${esc(VIEW_NAMES[S.view])} (u)">${icon('back')}</button>
    ${inTrash
      ? `<button class="icon-btn" data-act="untrash" title="Move out of Trash">${icon('inbox')}</button>`
      : `<button class="icon-btn" data-act="done" title="${doneTitle()}">${icon('archive')}</button>
         <button class="icon-btn" data-act="trash" title="Delete (#)">${icon('trash')}</button>`}
    <button class="icon-btn" data-act="unread" title="Mark as unread (Shift+U)">${icon('unread')}</button>
    <span class="tb-sep"></span>
    <button class="icon-btn" data-act="moveMenu" title="Move to (l)">${icon('label')}</button>
    ${triageOf(t) ? `<button class="icon-btn" data-act="clear" title="Clear triage label (y)">${icon('labelOff')}</button>` : ''}
    <span class="tb-sep"></span>
    <button class="icon-btn${prefs.darkBodies ? ' on' : ''}" data-act="invert" title="Darken email bodies in dark mode" aria-pressed="${prefs.darkBodies}">${icon('contrast')}</button>
    ${gmail ? `<a class="icon-btn" href="${esc(gmail)}" target="_blank" rel="noopener noreferrer" title="Open in Gmail to reply or forward (r)">${icon('open')}</a>` : ''}
    <span class="spacer"></span>
    <span class="meta">${pos}</span>
    <button class="icon-btn" data-act="newer" title="Newer (k)" ${idx <= 0 ? 'disabled' : ''}>${icon('chevLeft')}</button>
    <button class="icon-btn" data-act="older" title="Older (j)" ${idx < 0 || (idx >= S.threads.length - 1 && !S.page) ? 'disabled' : ''}>${icon('chevRight')}</button>`;
}

function threadHeadHtml() {
  const t = S.thread.t;
  const tri = triageOf(t);
  const starred = has(t, 'STARRED');
  const a = S.meta.accounts.find(x => x.email === t.account);
  const chips = [
    tri ? `<span class="chip ${tri}">${tri}</span>` : '',
    ...(t.labels || []).map(l => `<span class="chip">${esc(l)}</span>`),
    a && S.meta.accounts.length > 1 ? `<span class="chip acct"><span class="acct-dot" style="--c:var(--acct-${a.color})"></span>${esc(a.short)}</span>` : '',
  ].join('');
  return `<h1>${esc(t.subject || '')}</h1><div class="chips">${chips}</div>
    <button class="icon-btn star${starred ? ' on' : ''}" data-act="toggleStar" title="${starred ? 'Starred' : 'Not starred'} (s)" style="${starred ? 'color:var(--star)' : ''}">${icon(starred ? 'starFill' : 'star')}</button>`;
}

function renderThreadShell() {
  $('#panel').innerHTML = `<div class="toolbar" id="tb">${threadToolbar()}</div>
    <div class="thread" id="threadScroll">
      <div class="thread-head" id="threadHead">${threadHeadHtml()}</div>
      <div class="why" id="why"></div>
      <div id="threadBody"><div class="loading-line">Loading…</div></div>
    </div>`;
}

function renderThreadChrome() {
  if (S.mode !== 'thread' || !S.thread) return;
  $('#tb').innerHTML = threadToolbar();
  $('#threadHead').innerHTML = threadHeadHtml();
}

function renderThread() {
  const { d } = S.thread;
  renderThreadChrome();
  const last = d.messages.length - 1;
  $('#threadBody').innerHTML = d.messages.map((m, i) => msgHtml(m, i, i === last || m.unread || d.messages.length === 1)).join('');
  $$('#threadBody .msg.open').forEach(el => mountBody(el));
  $('#threadScroll').scrollTop = 0;
  const firstOpen = $('#threadBody .msg.open');
  if (firstOpen && d.messages.length > 3) firstOpen.scrollIntoView({ block: 'start' });
}

function hue(s) {
  let h = 0;
  for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function recipients(m, account) {
  const names = [...m.to, ...m.cc].map(a => (a.email.toLowerCase() === account ? 'me' : (a.name || a.email)));
  if (!names.length) return 'to undisclosed recipients';
  return `to ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`;
}

function msgHtml(m, i, open) {
  const t = S.thread.t;
  const name = m.from.name || m.from.email;
  const initial = (name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?');
  const atts = m.attachments.length ? `<div class="attachments">${m.attachments.map(a =>
    `<a class="att" href="${esc(a.url)}&download=1" download="${esc(a.name)}" title="Download ${esc(a.name)}">${icon('attach')}<span class="name">${esc(a.name)}</span><span class="size">${fmtSize(a.size)}</span></a>`).join('')}</div>` : '';
  const mode = bodyMode(m.html);
  const imgBar = m.html && imagesBlocked(m) ? `<div class="img-bar">Remote images are off for this message. <button class="btn text" data-act="showImages">Show images</button></div>` : '';
  const body = m.html
    ? `${imgBar}<div class="paper${mode !== 'original' ? ' dark' : ''}"><iframe class="body-frame" title="Message body" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe></div>
       <button class="quote-toggle" data-act="frameQuotes" title="Show trimmed content" hidden>•••</button>`
    : `<div class="plain">${plainHtml(m.text, i > 0)}</div>`;
  return `<div class="msg ${open ? 'open' : 'collapsed'}" data-m="${i}">
    <div class="msg-head" data-act="toggleMsg">
      <div class="avatar" style="--h:${hue(m.from.email)}">${esc(initial)}</div>
      <div class="msg-who">
        <div class="l1"><span class="from-name">${esc(name)}</span>${m.from.name ? `<span class="from-email">&lt;${esc(m.from.email)}&gt;</span>` : ''}
          ${m.unsubscribe ? `<a class="unsub" href="${esc(m.unsubscribe)}" target="_blank" rel="noopener noreferrer" data-stop>Unsubscribe</a>` : ''}</div>
        <div class="l2 when-open">${esc(recipients(m, t.account))}</div>
        <div class="l2 when-closed">${esc(m.snippet)}</div>
      </div>
      <div class="msg-date" title="${esc(fullDate(m.date))}">${esc(threadDate(m.date))}</div>
    </div>
    <div class="msg-body">${body}${atts}</div>
  </div>`;
}

function linkify(escaped) {
  return escaped.replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'&]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

function plainHtml(text, trimmable) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  let cut = -1;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    const rest = lines.slice(i + 1);
    if ((/^On .+wrote:\s*$/.test(l) || (/^On .+/.test(l) && /wrote:\s*$/.test(lines[i + 1] || ''))) && rest.some(x => /^>/.test(x))) { cut = i; break; }
    if (/^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(l) && /Original/i.test(l)) { cut = i; break; }
    if (/^>/.test(l) && lines.slice(i).every(x => /^>/.test(x) || !x.trim())) { cut = i; break; }
  }
  const fmt = ls => ls.map(l => {
    const h = linkify(esc(l));
    return /^>/.test(l) ? `<span class="q">${h}</span>` : h;
  }).join('\n');
  if (trimmable && cut > 0) {
    return `${fmt(lines.slice(0, cut)).replace(/\s+$/, '')}\n<button class="quote-toggle" data-act="plainQuotes" title="Show trimmed content">•••</button><span class="quoted" hidden>\n${fmt(lines.slice(cut))}</span>`;
  }
  return fmt(lines);
}

const REMOTE_IMG = /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:|background\s*=\s*["']?https?:/i;
function imagesBlocked(m) {
  return !prefs.remoteImages && !S.showImages.has(m.id) && REMOTE_IMG.test(m.html || '');
}

/** Plain personal HTML (a Gmail reply, say) reads fine re-colored; designed newsletters need their own colors. */
function isSimpleHtml(html) {
  return !/<table|<img|bgcolor|background|<style|<font[^>]+color/i.test(html || '') && (html || '').length < 60_000;
}
function bodyMode(html) {
  if (!isDark()) return 'original';
  if (isSimpleHtml(html)) return 'adapt';
  return prefs.darkBodies ? 'invert' : 'original';
}

const QUOTE_SELECTORS = '.gmail_quote, blockquote[type="cite"], .yahoo_quoted, #divRplyFwdMsg, #appendonsend';

function frameDoc(html, mode, blockImages) {
  // A meta CSP inside srcdoc stacks on top of the page's own policy, so this reliably stops remote loads.
  const csp = blockImages ? `<meta http-equiv="Content-Security-Policy" content="img-src 'self' data:; media-src 'none'; font-src data:">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${csp}<meta name="referrer" content="no-referrer"><base target="_blank">
<style>
html{background:#fff;color:#222}
body{margin:0;padding:2px;font:14px/1.5 Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;overflow-wrap:break-word;word-wrap:break-word}
img:not([height]){max-width:100%;height:auto}
pre{white-space:pre-wrap}
a{color:#0b57d0}
blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}
.mr-trim .gmail_quote,.mr-trim blockquote[type=cite],.mr-trim .yahoo_quoted,.mr-trim #divRplyFwdMsg,.mr-trim #divRplyFwdMsg~*,.mr-trim #appendonsend,.mr-trim #appendonsend~*{display:none!important}
${mode === 'invert' ? 'html{filter:invert(.93) hue-rotate(180deg)}img,video,picture,svg,[style*="background-image"],[background]{filter:invert(1) hue-rotate(180deg)}' : ''}
${mode === 'adapt' ? ':root{color-scheme:dark}html{background:transparent;color:#e3e3e3}body *:not(a){color:inherit!important;background-color:transparent!important;border-color:#444!important}a,a *{color:#a8c7fa!important}' : ''}
</style></head><body>${html}</body></html>`;
}

function mountBody(msgEl) {
  const frame = msgEl.querySelector('iframe.body-frame');
  if (!frame || frame.dataset.mounted) return;
  const i = Number(msgEl.dataset.m);
  const m = S.thread.d.messages[i];
  frame.dataset.mounted = '1';
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    let last = 0;
    // body.scrollHeight tracks the content; documentElement.scrollHeight never drops below the frame's own height.
    const fit = () => {
      const b = doc.body;
      if (!b) return;
      const cs = doc.defaultView.getComputedStyle(b);
      const h = Math.min(40000, Math.ceil(b.scrollHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)) + 2);
      if (Math.abs(h - last) > 1) { last = h; frame.style.height = `${h}px`; }
    };
    frame._fit = fit;
    fit();
    try { new ResizeObserver(fit).observe(doc.body || doc.documentElement); } catch { /* old browser */ }
    doc.querySelectorAll('img').forEach(img => img.addEventListener('load', fit));
    setTimeout(fit, 300);
    if (i > 0 && doc.querySelector(QUOTE_SELECTORS)) {
      doc.documentElement.classList.add('mr-trim');
      fit();
      const btn = msgEl.querySelector('[data-act="frameQuotes"]');
      if (btn) btn.hidden = false;
    }
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('click', () => closeMenu());
  }, { once: true });
  const mode = bodyMode(m.html);
  if (mode === 'adapt') frame.style.colorScheme = 'dark';
  frame.srcdoc = frameDoc(m.html, mode, imagesBlocked(m));
}

async function loadWhy(t) {
  try {
    const w = await api(`/api/why?account=${encodeURIComponent(t.account)}&id=${encodeURIComponent(t.id)}`);
    if (S.thread?.t !== t || !w.label) return;
    const conf = typeof w.confidence === 'number' ? ` at ${Math.round(w.confidence * 100)}%` : '';
    const el = $('#why');
    if (el) el.innerHTML = `Triaged <b>${esc(w.label)}</b>${w.source ? ` by ${esc(w.source)}` : ''}${conf}${w.reason ? `: ${esc(w.reason)}` : ''}`;
  } catch { /* optional */ }
}

/* ================================================================ menus */

let menuCleanup = null;
function closeMenu() {
  const m = $('#menu');
  if (m) m.hidden = true;
  if (menuCleanup) { menuCleanup(); menuCleanup = null; }
}
function showMenu(anchor, items) {
  closeMenu();
  const m = $('#menu');
  m.innerHTML = items.map((it, i) => {
    if (it.sep) return '<div class="sep"></div>';
    if (it.hdr) return `<div class="hdr">${esc(it.hdr)}</div>`;
    return `<button role="menuitem" data-i="${i}" ${it.title ? `title="${esc(it.title)}"` : ''}>${it.icon ? icon(it.icon) : '<svg viewBox="0 0 24 24"></svg>'}<span class="t">${esc(it.label)}</span>${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : ''}</button>`;
  }).join('');
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  m.style.left = `${Math.max(8, left)}px`;
  m.style.top = `${top}px`;
  const onClick = e => {
    const b = e.target.closest('button[data-i]');
    if (b) { const it = items[Number(b.dataset.i)]; closeMenu(); it.run(); }
  };
  const onOutside = e => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  m.addEventListener('click', onClick);
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  const onScroll = () => closeMenu();
  window.addEventListener('resize', onScroll);
  menuCleanup = () => {
    m.removeEventListener('click', onClick);
    document.removeEventListener('mousedown', onOutside);
    window.removeEventListener('resize', onScroll);
  };
  m.querySelector('button')?.focus({ preventScroll: true });
}

function moveMenu(anchor, targets) {
  if (!targets.length) return;
  const one = targets.length === 1 ? targets[0] : null;
  const acct = one && S.meta.accounts.find(a => a.email === one.account);
  const sender = one?.origin?.email?.toLowerCase();
  const domain = sender?.split('@')[1];
  const mine = S.meta.accounts.some(a => a.email === sender);
  const items = [
    { hdr: 'Move to' },
    { label: 'Now', icon: 'now', kbd: '1', run: () => perform('now', targets) },
    { label: 'Later', icon: 'later', kbd: '2', run: () => perform('later', targets) },
    { label: 'Noise', icon: 'noise', kbd: '3', run: () => perform('noise', targets) },
  ];
  if (targets.some(t => triageOf(t))) items.push({ label: 'Clear triage label', icon: 'labelOff', kbd: 'y', run: () => perform('clear', targets) });
  if (targets.some(t => !has(t, 'INBOX'))) items.push({ label: 'Inbox', icon: 'inbox', run: () => perform('inbox', targets) });
  if (one && sender && !mine && acct?.rules) {
    items.push({ sep: true }, { hdr: `Rule for future mail in ${acct.short}` });
    for (const l of TRIAGE) items.push({ label: `${cap(l)}: ${sender}`, icon: 'rule', title: `Adds a rules-tab row: ${sender}, exact, ${l}`, run: () => teach(one, l, sender, 'exact') });
    if (domain && !FREEMAIL.has(domain)) {
      items.push({ label: `Noise: anything from ${domain}`, icon: 'rule', title: `Adds a rules-tab row: ${domain}, domain, noise`, run: () => teach(one, 'noise', domain, 'domain') });
      items.push({ label: `Later: anything from ${domain}`, icon: 'rule', title: `Adds a rules-tab row: ${domain}, domain, later`, run: () => teach(one, 'later', domain, 'domain') });
    }
  }
  showMenu(anchor, items);
}

function listMenu(anchor) {
  const c = viewCount(S.view);
  const items = [
    { label: 'Select all loaded', icon: 'done', kbd: '* a', run: () => selectAll(true) },
    { label: 'Select unread', icon: 'unread', kbd: '* u', run: () => { S.sel = new Set(S.threads.filter(t => has(t, 'UNREAD')).map(key)); renderListParts(); } },
  ];
  if (S.view === 'inbox' || TRIAGE.includes(S.view)) {
    items.push({ sep: true }, { label: `Mark all in ${VIEW_NAMES[S.view]} as read`, icon: 'read', run: () => bulk('read'), title: c ? plural(c.unread, 'unread conversation') : '' });
  }
  items.push({ sep: true }, { label: 'Keyboard shortcuts', icon: 'settings', kbd: '?', run: showHelp });
  showMenu(anchor, items);
}

/* ================================================================ toast & dialogs */

let toastTimer;
function toast(msg, { undo = null, sticky = false, ms } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span class="msg-text">${esc(msg)}</span>${undo ? '<button data-undo>Undo</button>' : ''}<button class="x" aria-label="Dismiss">${icon('close')}</button>`;
  el.hidden = false;
  el.querySelector('[data-undo]')?.addEventListener('click', () => { hideToast(); S.lastUndo = null; undo(); });
  el.querySelector('.x').addEventListener('click', hideToast);
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(hideToast, ms || (undo ? 8000 : 5000));
}
function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

let modalClose = null;
function openModal(html, { wide = false, onClose } = {}) {
  closeModal();
  const root = $('#modal');
  root.innerHTML = `<div class="scrim"><div class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  const scrim = root.firstElementChild;
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) closeModal(); });
  modalClose = () => { root.innerHTML = ''; modalClose = null; onClose?.(); };
  return scrim.firstElementChild;
}
function closeModal() { if (modalClose) modalClose(); }
const modalOpen = () => !!modalClose;

function confirmDialog(title, body, ok) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    const d = openModal(`<h3>${esc(title)}</h3><p>${esc(body)}</p>
      <div class="actions"><button class="btn text" data-no>Cancel</button><button class="btn filled" data-yes>${esc(ok)}</button></div>`, { onClose: () => finish(false) });
    d.querySelector('[data-no]').onclick = () => closeModal();
    d.querySelector('[data-yes]').onclick = () => { finish(true); closeModal(); };
    d.querySelector('[data-yes]').focus();
  });
}

function showHelp() {
  const k = [
    ['j / k', 'Older / newer'], ['⌘] / ⌘[', 'Next / previous conversation'],
    ['⌘⌥→ / ⌘⌥←', 'Next / previous account'], ['o or Enter', 'Open'],
    ['u or Esc', 'Back to list'], ['x', 'Select'],
    ['e', 'Done (archive + clear label)'], ['#', 'Delete'],
    ['Shift+I', 'Mark read'], ['Shift+U', 'Mark unread'],
    ['1 / 2 / 3', 'Move to Now / Later / Noise'], ['y', 'Clear triage label'],
    ['l', 'Move menu'], ['s', 'Star'],
    ['z', 'Undo'], ['r', 'Open in Gmail to reply'],
    ['/', 'Search'], ['Shift+N', 'Refresh'],
    ['* a / * n', 'Select all / none'], ['g i', 'Go to Inbox'],
    ['g n / g l / g z', 'Now / Later / Noise'], ['g s / g t / g a', 'Starred / Sent / All'],
  ];
  const d = openModal(`<h3>Keyboard shortcuts</h3><div class="keys">${k.map(([a, b]) => `<kbd>${esc(a)}</kbd><span>${esc(b)}</span>`).join('')}</div>
    <div class="actions"><button class="btn text" data-close>Close</button></div>`, { wide: true });
  d.querySelector('[data-close]').onclick = closeModal;
}

function settingsHtml() {
  const accts = S.meta.accounts.map(a => {
    const found = a.labels ? TRIAGE.map(k => a.labels[k]).filter(Boolean) : [];
    const lost = a.labels ? TRIAGE.filter(k => !a.labels[k]) : [];
    const labels = a.labels ? `Labels: ${found.join(', ') || 'none'}${lost.length ? ` · missing ${lost.join(', ')}` : ''}` : '';
    const missing = a.labels && TRIAGE.some(k => !a.labels[k]);
    const detail = a.status === 'reauth' ? '<span class="detail bad">Needs you to sign in again</span>'
      : a.status === 'error' ? `<span class="detail bad">${esc(a.error)}</span>`
      : `<span class="detail${missing ? ' bad' : ''}">${esc(labels)}${a.rules ? ' · rules tab linked' : ' · rules tab off'}</span>`;
    return `<div class="acct-row"><span class="acct-dot" style="--c:var(--acct-${a.color})"></span>
      <div class="info"><div class="email">${esc(a.email)}</div>${detail}</div>
      ${S.meta.demo ? '' : `<a class="btn text" href="/auth/start?hint=${encodeURIComponent(a.email)}&return=inbox">Reconnect</a>
      <button class="btn text danger" data-remove="${esc(a.email)}">Remove</button>`}</div>`;
  }).join('');
  const seg = (name, options) => `<div class="seg" data-pref="${name}">${options.map(([v, l]) => `<button data-v="${v}" class="${String(prefs[name]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return `<h3>Settings</h3>
    <h4>Accounts</h4>${accts}
    ${S.meta.demo ? '<p class="hint" style="margin-top:12px">Demo mode: nothing here touches your real mail.</p>' : `<p style="margin-top:12px"><a class="btn" href="/auth/start?return=inbox">Connect another account</a> <a class="btn text" href="#/setup">OAuth client setup</a></p>`}
    <h4>Preferences</h4>
    <div class="pref"><div><div class="l">Theme</div></div>${seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
    <div class="pref"><div><div class="l">Email bodies in dark mode</div><div class="d">Darken inverts newsletter colors. Original keeps them on white.</div></div>${seg('darkBodies', [[false, 'Original'], [true, 'Darken']])}</div>
    <div class="pref"><div><div class="l">After Done or Delete in a conversation</div></div>${seg('afterDone', [['next', 'Next one'], ['list', 'Back to list']])}</div>
    <div class="pref"><div><div class="l">Mark as read when opened</div></div>${seg('markReadOnOpen', [[true, 'On'], [false, 'Off']])}</div>
    <div class="pref"><div><div class="l">Load remote images</div><div class="d">Gmail proxies images; Mailroom loads them straight from the sender, which tells them you opened it. Off blocks them until you click Show images.</div></div>${seg('remoteImages', [[true, 'On'], [false, 'Off']])}</div>
    <p class="hint" style="margin-top:16px">Tokens and config live in <code>${esc(S.meta.dataDir)}</code>. Label names can be overridden there with a <code>labels</code> key.</p>
    <div class="actions"><button class="btn text" data-close>Close</button></div>`;
}

function showSettings() {
  const d = openModal(settingsHtml(), { wide: true });
  d.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    const segBtn = e.target.closest('.seg button');
    if (segBtn) {
      const name = segBtn.parentElement.dataset.pref;
      const raw = segBtn.dataset.v;
      prefs[name] = raw === 'true' ? true : raw === 'false' ? false : raw;
      savePrefs();
      if (name === 'theme') applyTheme();
      if (['darkBodies', 'theme', 'remoteImages'].includes(name) && S.mode === 'thread' && S.thread?.d) renderThread();
      $$('button', segBtn.parentElement).forEach(b => b.classList.toggle('on', b === segBtn));
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const email = rm.dataset.remove;
      closeModal();
      if (!(await confirmDialog(`Remove ${email}?`, 'Mailroom forgets this account and revokes its access. Your mail is untouched.', 'Remove'))) return;
      try {
        await api('/api/accounts/remove', { method: 'POST', body: { email } });
        S.meta = await api('/api/accounts');
        if (prefs.account === email) { prefs.account = 'all'; savePrefs(); }
        resetList();
        route();
        refreshCounts();
      } catch (err) { toast(err.message); }
    }
  });
}

/* ================================================================ setup */

function renderSetup() {
  const m = S.meta;
  const connected = new Set(m.accounts.map(a => a.email));
  const emails = [...m.accounts.map(a => a.email), ...m.suggested];
  const connectList = emails.map(e => `<div class="connect-item"><span class="email">${esc(e)}</span>
      ${connected.has(e)
        ? `<span class="ok">${icon('done')}Connected</span>`
        : `<a class="btn filled" href="/auth/start?hint=${encodeURIComponent(e)}">Connect</a>`}</div>`).join('');
  $('#panel').innerHTML = `<div class="setup"><div class="setup-card">
    <h1>Set up Mailroom</h1>
    <p class="lede">Mailroom talks to Gmail straight from this Mac. It needs its own Google OAuth client, which you create once. About five minutes.</p>
    <ol class="steps">
      <li><b>Create a Google Cloud project</b> at <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com/projectcreate</a>. Use one of your personal accounts. Any name works.</li>
      <li><b>Turn on the Gmail API and the Google Sheets API</b> for that project: <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener">Gmail API</a>, <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener">Sheets API</a>. Sheets is what lets Mailroom add rows to your triage rules tab.</li>
      <li><b>Set up the consent screen</b> in <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a>: app name <code>Mailroom</code>, audience <b>External</b>, your email as the contact. Then open <b>Audience</b> and click <b>Publish app</b>. If you leave it in Testing, Google signs you out every 7 days.</li>
      <li><b>Create a client</b> under <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener">Clients</a>: Create client, type <b>Desktop app</b>. Copy the client ID and secret below, or download the JSON and paste the whole thing into the first box.</li>
    </ol>
    <form id="setupForm" autocomplete="off">
      <label class="field"><span>Client ID</span><input name="clientId" placeholder="1234-abc.apps.googleusercontent.com" ${m.configured && !m.demo ? 'placeholder="Saved. Paste a new one to replace it."' : ''}></label>
      <label class="field"><span>Client secret</span><input name="clientSecret" type="password" placeholder="GOCSPX-…"></label>
      <div class="error-text" id="setupErr" hidden></div>
      <button class="btn filled" type="submit">${m.configured ? 'Replace client' : 'Save'}</button>
      ${m.configured ? '<span class="hint" style="margin-left:12px">A client is already saved.</span>' : ''}
    </form>
    <div class="section" ${m.configured ? '' : 'hidden'}>
      <h2>Connect your accounts</h2>
      <p class="lede" style="margin-bottom:0">Google will say the app isn't verified. It's your own app, so click <b>Advanced</b>, then <b>Go to Mailroom</b>, and tick both permission boxes.</p>
      <div class="connect-list">${connectList}</div>
      <p><a class="btn" href="/auth/start">Connect a different account</a>
      ${m.accounts.length ? '<a class="btn filled" href="#/inbox" style="margin-left:8px">Open Mailroom</a>' : ''}</p>
    </div>
  </div></div>`;
  $('#setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const err = $('#setupErr');
    err.hidden = true;
    try {
      await api('/api/setup', { method: 'POST', body: { clientId: fd.get('clientId'), clientSecret: fd.get('clientSecret') } });
      S.meta = await api('/api/accounts');
      renderSetup();
      toast('Client saved. Now connect your accounts.');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

/* ================================================================ keyboard */

let gPending = false;
let starPending = false;
let prefixTimer;

function setAccount(email, { announce = false } = {}) {
  prefs.account = email;
  savePrefs();
  resetList();
  renderSidebar();
  if (S.mode !== 'list') history.replaceState(null, '', listHash());
  showList();
  loadList();
  refreshCounts();
  if (announce) toast(email === 'all' ? 'Showing all accounts' : `Showing ${acctShort(email)}`, { ms: 1500 });
}

function cycleAccount(dir) {
  const order = ['all', ...S.meta.accounts.map(a => a.email)];
  if (order.length < 3) return;
  const i = Math.max(0, order.indexOf(prefs.account));
  setAccount(order[(i + dir + order.length) % order.length], { announce: true });
}

/** Cmd+[ / Cmd+] move between conversations; Cmd+Option+Left/Right cycle accounts. */
function onMetaKey(e, tag) {
  if (!e.metaKey || e.ctrlKey || e.shiftKey) return false;
  if (!S.meta || S.mode === 'setup' || modalOpen()) return false;
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  if (!e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
    e.preventDefault();
    closeMenu();
    const dir = e.code === 'BracketRight' ? 1 : -1;
    if (S.mode === 'thread') step(dir);
    else setFocus(S.focus < 0 ? 0 : S.focus + dir);
    return true;
  }
  if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    closeMenu();
    cycleAccount(e.key === 'ArrowRight' ? 1 : -1);
    return true;
  }
  return false;
}

function onKey(e) {
  if (e.defaultPrevented) return;
  const el = e.target;
  const tag = (el.tagName || '').toLowerCase();
  if (onMetaKey(e, tag)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) {
    if (e.key === 'Escape') el.blur();
    return;
  }
  if (modalOpen()) { if (e.key === 'Escape') closeModal(); return; }
  if (!$('#menu').hidden) { if (e.key === 'Escape') { closeMenu(); e.preventDefault(); } return; }
  if (S.mode === 'setup') return;
  const k = e.key;
  if ((tag === 'button' || tag === 'a') && (k === 'Enter' || k === ' ')) return;
  const inThread = S.mode === 'thread';

  if (gPending || starPending) {
    const wasG = gPending;
    gPending = starPending = false;
    clearTimeout(prefixTimer);
    if (wasG) {
      const map = { i: 'inbox', n: 'now', l: 'later', z: 'noise', s: 'starred', t: 'sent', a: 'all' };
      if (map[k]) { e.preventDefault(); go(map[k]); }
    } else if (!inThread) {
      if (k === 'a') selectAll(true);
      if (k === 'n') selectAll(false);
      if (k === 'u') { S.sel = new Set(S.threads.filter(t => has(t, 'UNREAD')).map(key)); renderListParts(); }
      if (k === 'r') { S.sel = new Set(S.threads.filter(t => !has(t, 'UNREAD')).map(key)); renderListParts(); }
      e.preventDefault();
    }
    return;
  }

  const handled = () => e.preventDefault();
  switch (k) {
    case 'g': gPending = true; prefixTimer = setTimeout(() => { gPending = false; }, 1500); return handled();
    case '*': starPending = true; prefixTimer = setTimeout(() => { starPending = false; }, 1500); return handled();
    case 'j': inThread ? step(1) : setFocus(S.focus + 1); return handled();
    case 'k': inThread ? step(-1) : setFocus(S.focus - 1); return handled();
    case 'o': case 'Enter': if (!inThread && S.focus >= 0) { openThreadAt(S.focus); return handled(); } return;
    case 'u': case 'Escape':
      if (inThread) { back(); return handled(); }
      if (S.sel.size) { selectAll(false); return handled(); }
      return;
    case 'x': if (!inThread && S.focus >= 0) { toggleSel(S.focus, false); return handled(); } return;
    case 'e': act('done'); return handled();
    case '#': case 'Delete': act('trash'); return handled();
    case 'I': act('read'); return handled();
    case 'U': act('unread'); return handled();
    case 's': act('toggleStar'); return handled();
    case '1': act('now'); return handled();
    case '2': act('later'); return handled();
    case '3': act('noise'); return handled();
    case 'y': act('clear'); return handled();
    case 'l': {
      const btn = $('#tb [data-act="moveMenu"]') || $(`.row[data-i="${S.focus}"] [data-act="moveMenu"]`);
      const ts = targetsFor(null);
      if (btn && ts.length) moveMenu(btn, ts);
      else if (ts.length) moveMenu($('#tb') || document.body, ts);
      return handled();
    }
    case 'z': if (S.lastUndo) { const u = S.lastUndo; S.lastUndo = null; hideToast(); u(); } return handled();
    case 'r': {
      const url = S.thread?.d?.gmailUrl;
      if (inThread && url) window.open(url, '_blank', 'noopener');
      return handled();
    }
    case '/': $('#q').focus(); $('#q').select(); return handled();
    case 'N': loadList(); refreshCounts(); return handled();
    case '?': showHelp(); return handled();
    default:
  }
}

/* ================================================================ events */

function onPanelClick(e) {
  const panel = $('#panel');
  if (!panel.contains(e.target)) return;
  const row = e.target.closest('.row');
  if (e.target.matches('input[data-sel]')) {
    e.stopPropagation();
    e.preventDefault();
    toggleSel(Number(row.dataset.i), e.shiftKey);
    return;
  }
  if (e.target.closest('[data-stop]')) return;
  if (e.target.id === 'selAll') { selectAll(e.target.checked); return; }
  const actEl = e.target.closest('[data-act]');
  if (actEl) {
    e.preventDefault();
    e.stopPropagation();
    handleAct(actEl.dataset.act, row, actEl);
    return;
  }
  if (row && !row.closest('.skeleton')) openThreadAt(Number(row.dataset.i));
}

function handleAct(name, row, el) {
  switch (name) {
    case 'refresh': loadList(); refreshCounts(); break;
    case 'unreadFilter': S.unread = !S.unread; resetList(); showList(); loadList(); break;
    case 'star': act('toggleStar', row); break;
    case 'toggleStar': act('toggleStar'); break;
    case 'done': case 'trash': case 'read': case 'unread': case 'clear': case 'untrash': case 'inbox': case 'now': case 'later': case 'noise':
      act(name, row); break;
    case 'moveMenu': moveMenu(el, targetsFor(row)); break;
    case 'listMenu': listMenu(el); break;
    case 'bulkRead': bulk('read'); break;
    case 'bulkClear': bulk('clear'); break;
    case 'bulkDone': bulk('done'); break;
    case 'clearStale': clearStale(7); break;
    case 'loadMore': loadList({ more: true }); break;
    case 'back': back(); break;
    case 'older': step(1); break;
    case 'newer': step(-1); break;
    case 'invert':
      prefs.darkBodies = !prefs.darkBodies;
      savePrefs();
      if (!isDark() && prefs.darkBodies) toast('Darkened bodies only apply in dark mode.');
      renderThread();
      break;
    case 'toggleMsg': {
      const msg = el.closest('.msg');
      const open = msg.classList.contains('open');
      msg.classList.toggle('open', !open);
      msg.classList.toggle('collapsed', open);
      if (!open) mountBody(msg);
      break;
    }
    case 'frameQuotes': {
      const frame = el.closest('.msg').querySelector('iframe');
      const doc = frame?.contentDocument;
      if (doc) {
        doc.documentElement.classList.toggle('mr-trim');
        frame._fit?.();
      }
      break;
    }
    case 'showImages': {
      const msgEl = el.closest('.msg');
      const m = S.thread.d.messages[Number(msgEl.dataset.m)];
      S.showImages.add(m.id);
      const tmp = document.createElement('div');
      tmp.innerHTML = msgHtml(m, Number(msgEl.dataset.m), true);
      const fresh = tmp.firstElementChild;
      msgEl.replaceWith(fresh);
      mountBody(fresh);
      break;
    }
    case 'plainQuotes': {
      const q = el.nextElementSibling;
      if (q) q.hidden = !q.hidden;
      break;
    }
    default:
  }
}

function applyTheme() {
  const root = document.documentElement;
  if (prefs.theme === 'light' || prefs.theme === 'dark') root.dataset.theme = prefs.theme;
  else delete root.dataset.theme;
  root.classList.toggle('theme-dark', isDark());
  $('#themeBtn').innerHTML = icon(isDark() ? 'sun' : 'moon');
  $('#themeBtn').title = isDark() ? 'Switch to light mode' : 'Switch to dark mode';
}

function wire() {
  $('#searchBtn').innerHTML = icon('search');
  $('#clearSearch').innerHTML = icon('close');
  $('#settingsBtn').innerHTML = icon('settings');
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme();
    if (S.mode === 'thread' && S.thread?.d) renderThread();
  });
  $('#themeBtn').addEventListener('click', () => {
    prefs.theme = isDark() ? 'light' : 'dark';
    savePrefs();
    applyTheme();
    if (S.mode === 'thread' && S.thread?.d) renderThread();
  });
  $('#settingsBtn').addEventListener('click', () => { if (S.meta) showSettings(); });
  $('#searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('#q').value.trim();
    $('#q').blur();
    S.navFromList = false;
    location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/inbox';
  });
  $('#clearSearch').addEventListener('click', () => { $('#q').value = ''; go('inbox'); });
  $('#panel').addEventListener('click', onPanelClick);
  $('#panel').addEventListener('mouseover', e => {
    const row = e.target.closest('.row[data-i]');
    if (!row || S.mode !== 'list') return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => prefetch(S.threads[Number(row.dataset.i)]), 200);
  });
  $('#sidebar').addEventListener('click', e => {
    const a = e.target.closest('[data-account]');
    if (a) {
      e.preventDefault();
      const email = a.dataset.account;
      setAccount(prefs.account === email ? 'all' : email);
      return;
    }
    const v = e.target.closest('[data-view]');
    if (v && v.dataset.view === S.view && S.mode === 'list') { e.preventDefault(); loadList(); refreshCounts(); }
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - S.loadedAt > 30_000) tick();
  });
  setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 60_000);
}

/* When the server restarts on new code, reload the page so the UI updates too. */
let serverStarted = null;
async function checkVersion() {
  try {
    const h = await fetch('/health', { cache: 'no-store' }).then(r => r.json());
    if (serverStarted && h.started && h.started !== serverStarted) {
      if (!modalOpen()) { location.reload(); return; }
    }
    serverStarted = serverStarted || h.started;
  } catch { /* server restarting; try again next time */ }
}
setInterval(() => { if (document.visibilityState === 'visible') checkVersion(); }, 5000);
checkVersion();

function tick() {
  if (!S.meta?.accounts?.length || S.mode === 'setup') return;
  refreshCounts();
  if (S.mode === 'list' && !S.sel.size && $('#menu').hidden && !modalOpen()) loadList({ quiet: true });
}

async function boot() {
  wire();
  try {
    S.meta = await api('/api/accounts');
  } catch (e) {
    $('#panel').innerHTML = `<div class="empty"><strong>Mailroom can't start</strong>${esc(e.message)}</div>`;
    return;
  }
  $('#demoChip').hidden = !S.meta.demo;
  if (prefs.account !== 'all' && !S.meta.accounts.some(a => a.email === prefs.account)) { prefs.account = 'all'; savePrefs(); }
  if ((!S.meta.configured || !S.meta.accounts.length) && !location.hash.startsWith('#/setup')) history.replaceState(null, '', '#/setup');
  route();
  refreshCounts();
}

boot();
