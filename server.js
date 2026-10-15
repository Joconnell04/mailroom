#!/usr/bin/env node
'use strict';
/*
 * Mailroom: a local, single-user Gmail client for personal accounts,
 * built around the now / later / noise triage labels.
 *
 * Zero dependencies. Node 18+.  Run:  node server.js   (or  node server.js --demo)
 * Binds to 127.0.0.1 only. Tokens live in ~/.config/mailroom (chmod 600).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { expandSearch } = require('./search');
const { htmlToMarkdown, decodeEntities } = require('./render');

const PORT = Number(process.env.MAILROOM_PORT) || 4747;
const HOST = '127.0.0.1';
// Demo mode serves fake mail from demo.js and never touches Google.
const DEMO = (process.env.MAILROOM_DEMO === '1' || process.argv.includes('--demo')) && fs.existsSync(path.join(__dirname, 'demo.js'));
// Logins and config always live outside the app folder, so replacing the app never signs you out.
const DATA = DEMO
  ? path.join(os.tmpdir(), 'mailroom-demo')
  : process.env.MAILROOM_HOME || path.join(os.homedir(), '.config', 'mailroom');
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth/callback`;
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PAGE_SIZE = 30;
const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.modify';
const SCOPE_SHEETS = 'https://www.googleapis.com/auth/spreadsheets';
const TRIAGE = ['now', 'later', 'noise'];
const SYSTEM_FLAGS = ['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'TRASH', 'SENT', 'SPAM', 'DRAFT'];
const MODIFIABLE = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'TRASH']);
// Your accounts, rules sheet and log sheets live in ~/.config/mailroom/config.json (see README).
const DEFAULT_ACCOUNTS = [];
const DEFAULT_RULE_SHEETS = {};
const ID_RE = /^[0-9a-f]{6,24}$/i;
const demo = DEMO ? require('./demo') : null;
const STARTED = Date.now();

/* ------------------------------------------------------------------ storage */

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const CONFIG_FILE = path.join(DATA, 'config.json');
const TOKENS_FILE = path.join(DATA, 'tokens.json');

/* One-time migration: older builds kept config and logins in <app>/.data. Merge any we find. */
if (!DEMO) {
  const candidates = [path.join(__dirname, '.data')];
  const load = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  let cfg = load(CONFIG_FILE) || {};
  let tok = load(TOKENS_FILE) || {};
  let changed = false;
  for (const d of candidates) {
    const c = load(path.join(d, 'config.json'));
    if (c && !cfg.clientId && c.clientId) { cfg = { ...c, ...cfg }; changed = true; }
    const t = load(path.join(d, 'tokens.json'));
    for (const [email, v] of Object.entries(t || {})) {
      if (v?.refresh_token && !tok[email]?.refresh_token) { tok[email] = v; changed = true; }
    }
  }
  if (changed) {
    for (const [file, value] of [[CONFIG_FILE, cfg], [TOKENS_FILE, tok]]) {
      fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
    }
    console.log('Moved Mailroom logins/config into', DATA);
  }
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

let config = readJSON(CONFIG_FILE, {});
let tokens = DEMO ? Object.fromEntries(demo.ACCOUNTS.map(e => [e, { demo: true, scope: `${SCOPE_GMAIL} ${SCOPE_SHEETS}` }])) : readJSON(TOKENS_FILE, {});
const saveTokens = () => { if (!DEMO) writeJSON(TOKENS_FILE, tokens); };
const saveConfig = () => writeJSON(CONFIG_FILE, config);
const ruleSheets = () => ({ ...DEFAULT_RULE_SHEETS, ...(config.ruleSheets || {}) });

/* ------------------------------------------------------------------ helpers */

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64url = buf => Buffer.from(buf).toString('base64url');
const enc = encodeURIComponent;

function makeSemaphore(n) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < n) { active++; return; }
      await new Promise(r => queue.push(r)); // slot is handed over by release()
    },
    release() {
      const next = queue.shift();
      if (next) next(); else active--;
    },
  };
}
const semaphores = {};

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

function errInfo(e) {
  return { status: e.status || 500, message: e.message || String(e), reauth: !!e.reauth };
}

/* ------------------------------------------------------------------ auth */

const refreshing = {};

async function accessToken(email) {
  const t = tokens[email];
  if (!t) throw new HttpError(404, `${email} is not connected`);
  if (t.demo) return 'demo';
  if (t.access_token && t.expiry > Date.now() + 60_000) return t.access_token;
  if (refreshing[email]) return refreshing[email];
  refreshing[email] = (async () => {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret,
        refresh_token: t.refresh_token, grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (j.error === 'invalid_grant') { t.needsReauth = true; saveTokens(); }
      throw new HttpError(401, `${email} needs to sign in again (${j.error_description || j.error || res.status})`, { reauth: true, account: email });
    }
    t.access_token = j.access_token;
    t.expiry = Date.now() + (j.expires_in || 3600) * 1000;
    if (j.scope) t.scope = j.scope;
    delete t.needsReauth;
    saveTokens();
    return t.access_token;
  })().finally(() => { delete refreshing[email]; });
  return refreshing[email];
}

/** Call a Google API as `email`. `p` is a path under GMAIL or a full https URL. */
async function gapi(email, method, p, { query, body } = {}) {
  if (DEMO) return demo.handle(email, method, p, query || {}, body);
  const url = new URL(p.startsWith('https://') ? p : GMAIL + p);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === '' || v === false) continue;
    for (const x of [].concat(v)) url.searchParams.append(k, String(x));
  }
  const sem = (semaphores[email] ||= makeSemaphore(6));
  await sem.acquire();
  try {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken(email);
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (attempt < 3) { await sleep(400 * (attempt + 1)); continue; }
        throw new HttpError(502, `Could not reach Google: ${e.message}`);
      }
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (res.ok) return data;
      const reason = data.error?.errors?.[0]?.reason || data.error?.status || '';
      if (res.status === 401 && attempt === 0) { tokens[email].expiry = 0; continue; }
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rate|quota/i.test(reason));
      if (retryable && attempt < 5) { await sleep(2 ** attempt * 300 + Math.random() * 300); continue; }
      const extra = { reason };
      if (res.status === 401) Object.assign(extra, { reauth: true, account: email });
      throw new HttpError(res.status, data.error?.message || text || `Google returned ${res.status}`, extra);
    }
  } finally {
    sem.release();
  }
}

const pendingAuth = new Map();

function authStart(res, url) {
  if (!config.clientId || !config.clientSecret) return redirect(res, '/#/setup');
  for (const [k, v] of pendingAuth) if (Date.now() - v.at > 15 * 60_000) pendingAuth.delete(k);
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const hint = (url.searchParams.get('hint') || '').trim();
  const ret = url.searchParams.get('return') === 'inbox' ? 'inbox' : 'setup';
  pendingAuth.set(state, { verifier, at: Date.now(), ret });
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: [SCOPE_GMAIL, SCOPE_SHEETS].join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(hint ? { login_hint: hint } : {}),
  }).toString();
  redirect(res, u.toString());
}

async function authCallback(res, url) {
  const state = url.searchParams.get('state');
  const pending = pendingAuth.get(state);
  pendingAuth.delete(state);
  if (url.searchParams.get('error')) return notice(res, 'Sign-in cancelled', `Google said: ${url.searchParams.get('error')}.`);
  if (!pending) return notice(res, 'That sign-in link expired', 'Start again from Mailroom.');
  const tr = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '', client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', code_verifier: pending.verifier,
    }),
  });
  const j = await tr.json().catch(() => ({}));
  if (!tr.ok) return notice(res, 'Google rejected the sign-in', j.error_description || j.error || `HTTP ${tr.status}`);
  const granted = (j.scope || '').split(' ');
  if (!granted.includes(SCOPE_GMAIL)) {
    return notice(res, 'Gmail access was not granted', 'On the Google permissions screen, tick the box that lets Mailroom read and change your email, then try again.');
  }
  if (!j.refresh_token) return notice(res, 'No refresh token', 'Remove Mailroom from myaccount.google.com/permissions and connect again.');
  const prof = await fetch(GMAIL + 'profile', { headers: { Authorization: `Bearer ${j.access_token}` } }).then(r => r.json());
  const email = String(prof.emailAddress || '').toLowerCase();
  if (!email) return notice(res, 'Could not read the account address', JSON.stringify(prof).slice(0, 300));
  tokens[email] = {
    refresh_token: j.refresh_token, access_token: j.access_token,
    expiry: Date.now() + (j.expires_in || 3600) * 1000, scope: j.scope, added: tokens[email]?.added || Date.now(),
  };
  saveTokens();
  delete accts[email];
  for (const k of metaCache.keys()) if (k.startsWith(`${email}:`)) metaCache.delete(k);
  redirect(res, pending.ret === 'inbox' ? '/#/inbox' : '/#/setup');
}

/* ------------------------------------------------------------------ accounts & labels */

const accts = {};

function accountOrder() {
  const order = [...(config.accounts || []), ...DEFAULT_ACCOUNTS];
  const rank = e => { const i = order.indexOf(e); return i < 0 ? 999 + (tokens[e]?.added || 0) / 1e13 : i; };
  return Object.keys(tokens).sort((a, b) => rank(a) - rank(b));
}
function getAcct(email) {
  if (!tokens[email]) throw new HttpError(404, `${email} is not connected`);
  return (accts[email] ||= { email });
}
function selectAccounts(account) {
  if (account && account !== 'all') return [getAcct(account)];
  return accountOrder().map(getAcct);
}

async function loadLabels(acct, force = false) {
  if (!force && acct.labelsAt && Date.now() - acct.labelsAt < 10 * 60_000) return acct;
  // Requests arriving together share one fetch instead of each loading labels.
  if (!acct.labelsLoading) acct.labelsLoading = fetchLabels(acct).finally(() => { acct.labelsLoading = null; });
  return acct.labelsLoading;
}

async function fetchLabels(acct) {
  const { labels = [] } = await gapi(acct.email, 'GET', 'labels');
  acct.labelsById = {};
  acct.userLabelIds = new Set();
  for (const l of labels) {
    acct.labelsById[l.id] = l.name;
    if (l.type === 'user') acct.userLabelIds.add(l.id);
  }
  const overrides = config.labels || {};
  const user = labels.filter(l => l.type === 'user');
  acct.triage = {};
  acct.triageName = {};
  for (const key of TRIAGE) {
    const want = String(overrides[acct.email]?.[key] || overrides[key] || '').toLowerCase();
    let hit = want ? user.find(l => l.name.toLowerCase() === want) : null;
    if (!hit) hit = user.find(l => l.name.toLowerCase() === key) || user.find(l => l.name.toLowerCase().endsWith('/' + key));
    acct.triage[key] = hit ? hit.id : null;
    acct.triageName[key] = hit ? hit.name : null;
  }
  // Cached thread summaries stay valid until label names or the triage mapping really change,
  // so the 10-minute label refresh no longer turns every list cold.
  acct.labelsVersion = crypto.createHash('sha1')
    .update(JSON.stringify([labels.map(l => [l.id, l.name, l.type]).sort(), acct.triage])).digest('hex').slice(0, 12);
  acct.labelsAt = Date.now();
  return acct;
}

function flagsFor(acct, ids) {
  const set = new Set(ids);
  const flags = SYSTEM_FLAGS.filter(f => set.has(f));
  for (const k of TRIAGE) if (acct.triage?.[k] && set.has(acct.triage[k])) flags.push(k);
  return flags;
}
function userLabels(acct, ids) {
  const tri = new Set(Object.values(acct.triage || {}));
  return ids.filter(id => acct.userLabelIds?.has(id) && !tri.has(id)).map(id => acct.labelsById[id]).sort();
}

/* ------------------------------------------------------------------ message parsing */

function hdr(part, name) {
  const n = name.toLowerCase();
  const h = (part?.headers || []).find(x => x.name.toLowerCase() === n);
  return h ? h.value : '';
}
function parseAddress(s) {
  s = String(s || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim().replace(/\\"/g, '"'), email: m[2].trim() };
  return { name: '', email: s.replace(/[<>]/g, '') };
}
function parseAddressList(s) {
  const out = [];
  let cur = '', quoted = false, angle = false;
  for (const ch of String(s || '')) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<') angle = true;
    else if (ch === '>') angle = false;
    if (ch === ',' && !quoted && !angle) { if (cur.trim()) out.push(parseAddress(cur)); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(parseAddress(cur));
  return out;
}
function charsetOf(part) {
  const m = hdr(part, 'Content-Type').match(/charset\s*=\s*"?([^";\s]+)/i);
  return m ? m[1].toLowerCase() : 'utf-8';
}
function decodeBody(data, charset) {
  const buf = Buffer.from(data, 'base64url');
  try { return new TextDecoder(charset, { fatal: false }).decode(buf); } catch { return buf.toString('utf8'); }
}

function walkPart(part, out) {
  if (!part) return;
  const mime = (part.mimeType || '').toLowerCase();
  const disp = hdr(part, 'Content-Disposition');
  const cid = hdr(part, 'Content-ID').replace(/^\s*<|>\s*$/g, '').trim();
  const isAttachment = !!part.filename || /^\s*attachment/i.test(disp);
  if (mime.startsWith('multipart/')) { (part.parts || []).forEach(p => walkPart(p, out)); return; }
  if (!isAttachment && mime === 'text/html' && part.body?.data) { out.html.push(decodeBody(part.body.data, charsetOf(part))); return; }
  if (!isAttachment && mime === 'text/plain' && part.body?.data) { out.text.push(decodeBody(part.body.data, charsetOf(part))); return; }
  if (part.body?.attachmentId || part.body?.data) {
    out.attachments.push({
      filename: part.filename || (cid ? `${cid.split('@')[0]}` : 'attachment'),
      mimeType: mime || 'application/octet-stream',
      size: part.body.size || 0,
      attachmentId: part.body.attachmentId || null,
      partId: part.partId ?? '',
      cid: cid || null,
    });
  }
  (part.parts || []).forEach(p => walkPart(p, out));
}

function cleanHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\/?script\b[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    .replace(/<\/?(iframe|frame|frameset|object|embed|applet|form)\b[^>]*>/gi, '');
}

function unsubscribeUrl(value) {
  const m = String(value || '').match(/<(https?:\/\/[^>]+)>/i);
  return m ? m[1] : null;
}

function summarize(acct, t) {
  const all = t.messages || [];
  const msgs = all.filter(m => !(m.labelIds || []).includes('DRAFT'));
  const shown = msgs.length ? msgs : all;
  const ids = new Set();
  all.forEach(m => (m.labelIds || []).forEach(l => ids.add(l)));
  const first = all[0] || {};
  const last = shown[shown.length - 1] || first;
  const me = acct.email.toLowerCase();
  const people = [];
  const seen = new Map();
  let origin = null;
  for (const m of shown) {
    const f = parseAddress(hdr(m.payload, 'From'));
    const isMe = f.email.toLowerCase() === me;
    if (!isMe && !origin) origin = f;
    const k = isMe ? 'me' : f.email.toLowerCase();
    const unread = (m.labelIds || []).includes('UNREAD');
    if (seen.has(k)) { if (unread) seen.get(k).unread = true; continue; }
    const p = { name: isMe ? 'me' : (f.name || f.email.split('@')[0]), email: f.email, unread };
    seen.set(k, p);
    people.push(p);
  }
  return {
    account: acct.email,
    id: t.id,
    subject: hdr(first.payload, 'Subject') || '(no subject)',
    snippet: decodeEntities(last.snippet || ''),
    date: Number(last.internalDate) || 0,
    people,
    origin: origin || parseAddress(hdr(first.payload, 'From')),
    count: shown.length,
    to: parseAddressList(hdr(last.payload, 'To')).map(a => a.name || a.email),
    flags: flagsFor(acct, [...ids]),
    labels: userLabels(acct, [...ids]),
    attachment: all.some(m => /multipart\/mixed/i.test(hdr(m.payload, 'Content-Type'))),
  };
}

/* ------------------------------------------------------------------ threads */

const metaCache = new Map();
const META_HEADERS = ['From', 'To', 'Subject', 'Date', 'Content-Type'];

/**
 * Fetch many threads' metadata in one HTTP round trip via Gmail's batch endpoint.
 * Returns Map id -> thread JSON; anything that fails in the batch is simply missing,
 * and the caller falls back to one-by-one fetches (which retry on rate limits).
 */
async function batchThreadMeta(email, ids) {
  const out = new Map();
  if (DEMO || !ids.length) return out;
  const qs = new URLSearchParams({ format: 'metadata' });
  for (const h of META_HEADERS) qs.append('metadataHeaders', h);
  for (let i = 0; i < ids.length; i += 24) {
    if (i) await new Promise(r => setTimeout(r, 1000)); // 24 x 10 quota units per second stays under the 250/s limit
    const chunk = ids.slice(i, i + 24);
    const boundary = `mailroom_${crypto.randomBytes(8).toString('hex')}`;
    const body = chunk.map((id, k) => `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <t${k}>\r\n\r\nGET /gmail/v1/users/me/threads/${id}?${qs}\r\n\r\n`).join('') + `--${boundary}--\r\n`;
    try {
      const token = await accessToken(email);
      const res = await fetch('https://gmail.googleapis.com/batch/gmail/v1', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/mixed; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const rb = (res.headers.get('content-type') || '').match(/boundary=("?)([^";]+)\1/i)?.[2];
      if (!rb) continue;
      const text = await res.text();
      for (const part of text.split(`--${rb}`)) {
        const status = part.match(/HTTP\/1\.1 (\d{3})/);
        if (!status || status[1] !== '200') continue;
        const j = part.indexOf('{');
        if (j < 0) continue;
        try {
          const t = JSON.parse(part.slice(j, part.lastIndexOf('}') + 1));
          if (t.id) out.set(t.id, t);
        } catch { /* skip malformed part */ }
      }
    } catch { /* fall back to singles */ }
  }
  return out;
}

async function summariesFor(acct, list) {
  const need = list.filter(t => {
    const hit = metaCache.get(`${acct.email}:${t.id}`);
    return !(hit && hit.historyId === t.historyId && hit.labelsVersion === acct.labelsVersion);
  }).map(t => t.id);
  const fetched = await batchThreadMeta(acct.email, need);
  for (const [id, full] of fetched) cacheSummary(acct, id, full);
  const out = await mapLimit(list, 6, t => threadSummary(acct, t).catch(() => null));
  const failed = list.map((t, k) => (out[k] ? -1 : k)).filter(k => k >= 0);
  if (failed.length) { // usually Gmail's per-second quota: wait, then try the few that failed
    await new Promise(r => setTimeout(r, 1200));
    await mapLimit(failed, 2, async k => { out[k] = await threadSummary(acct, list[k]).catch(() => null); });
  }
  // Still failing: show the last summary we had (labels may be a minute old) rather than silently dropping the row.
  return out.map((sum, k) => sum || metaCache.get(`${acct.email}:${list[k].id}`)?.summary || null);
}

function cacheSummary(acct, id, full) {
  const key = `${acct.email}:${id}`;
  const summary = summarize(acct, full);
  metaCache.delete(key);
  metaCache.set(key, { historyId: full.historyId, labelsVersion: acct.labelsVersion, summary });
  if (metaCache.size > 6000) metaCache.delete(metaCache.keys().next().value);
  return summary;
}

async function threadSummary(acct, t) {
  const key = `${acct.email}:${t.id}`;
  const hit = metaCache.get(key);
  if (hit && hit.historyId === t.historyId && hit.labelsVersion === acct.labelsVersion) return hit.summary;
  const full = await gapi(acct.email, 'GET', `threads/${t.id}`, { query: { format: 'metadata', metadataHeaders: META_HEADERS } });
  return cacheSummary(acct, t.id, full);
}

const VIEWS = ['inbox', 'now', 'later', 'noise', 'starred', 'sent', 'all', 'trash', 'search'];

/** Senders of every thread summarized so far (address -> name), so search can match "pri" to Priya. */
function knownSenders(acct) {
  const out = new Map();
  const prefix = `${acct.email}:`;
  const me = acct.email.toLowerCase();
  for (const [key, { summary }] of metaCache) {
    if (!key.startsWith(prefix) || !summary) continue;
    for (const p of [summary.origin, ...(summary.people || [])]) {
      const email = String(p?.email || '').toLowerCase();
      if (email && email !== me && !out.has(email)) out.set(email, p.name === 'me' ? '' : p.name || '');
    }
  }
  return out;
}

function viewParams(acct, view, q, unread) {
  const p = { maxResults: PAGE_SIZE };
  let labelIds = [];
  const query = [];
  switch (view) {
    case 'inbox': labelIds = ['INBOX']; break;
    case 'now': case 'later': case 'noise':
      if (!acct.triage[view]) return null;
      labelIds = [acct.triage[view]]; break;
    case 'starred': labelIds = ['STARRED']; break;
    case 'sent': labelIds = ['SENT']; break;
    case 'trash': labelIds = ['TRASH']; p.includeSpamTrash = true; break;
    case 'all': break;
    case 'search': if (!q) return null; query.push(expandSearch(q, knownSenders(acct))); break;
    default: throw new HttpError(400, `Unknown view "${view}"`);
  }
  if (unread) query.push('is:unread');
  if (labelIds.length) p.labelIds = labelIds;
  if (query.length) p.q = query.join(' ');
  return p;
}

async function listThreads({ view, q, account, unread, cursor }) {
  if (!VIEWS.includes(view)) throw new HttpError(400, `Unknown view "${view}"`);
  const targets = selectAccounts(account);
  let cur = null;
  if (cursor) {
    try { cur = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'Bad cursor'); }
  }
  const results = await Promise.all(targets.map(async acct => {
    try {
      if (cur && !cur[acct.email]) return { acct, threads: [] };
      await loadLabels(acct);
      const params = viewParams(acct, view, q, unread);
      if (!params) return { acct, threads: [], missing: TRIAGE.includes(view) };
      if (cur) params.pageToken = cur[acct.email];
      const r = await gapi(acct.email, 'GET', 'threads', { query: params });
      const threads = await summariesFor(acct, r.threads || []);
      const missed = threads.filter(x => !x).length;
      let rows = threads.filter(Boolean);
      // Now wins: the triage script labels your own replies "later" (its self-sent gate), so a live conversation can
      // carry both labels. Show it only in Now rather than letting it drift into Later or Noise.
      if (view === 'later' || view === 'noise') rows = rows.filter(t => !t.flags.includes('now'));
      return { acct, threads: rows, next: r.nextPageToken || null, partial: missed > 0 };
    } catch (e) {
      return { acct, threads: [], error: errInfo(e) };
    }
  }));
  const next = {};
  for (const r of results) if (r.next) next[r.acct.email] = r.next;
  return {
    pageSize: PAGE_SIZE,
    threads: results.flatMap(r => r.threads).sort((a, b) => b.date - a.date),
    cursor: Object.keys(next).length ? b64url(JSON.stringify(next)) : null,
    more: Object.keys(next),
    errors: results.filter(r => r.error).map(r => ({ account: r.acct.email, ...r.error })),
    missing: results.filter(r => r.missing).map(r => r.acct.email),
    partial: results.filter(r => r.partial).map(r => r.acct.email), // some rows couldn't load: don't treat them as gone
  };
}

/** Stable URL for a message part. Gmail issues a new attachment id on every fetch, so the part id is the key. */
function attachmentUrl(email, messageId, a) {
  const q = new URLSearchParams({ account: email, message: messageId, part: a.partId, name: a.filename, mime: a.mimeType });
  return `/api/attachment?${q}`;
}

function gmailUrl(email, id) {
  return `https://mail.google.com/mail/?authuser=${enc(email)}#all/${id}`;
}

async function getThread(email, id, { markdownOnly = false } = {}) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Bad thread id');
  const acct = await loadLabels(getAcct(email));
  const t = await gapi(email, 'GET', `threads/${id}`, { query: { format: 'full' } });
  const summary = summarize(acct, t);
  const messages = (t.messages || []).map((m, index) => {
    const parts = { html: [], text: [], attachments: [] };
    walkPart(m.payload, parts);
    let html = parts.html.join('<hr>');
    const usedCids = new Set();
    if (html) {
      for (const a of parts.attachments) {
        if (!a.cid) continue;
        const needle = `cid:${a.cid}`;
        if (html.includes(needle)) { html = html.split(needle).join(attachmentUrl(email, m.id, a)); usedCids.add(a.cid); }
      }
      html = cleanHtml(html);
    }
    const labelIds = m.labelIds || [];
    return {
      id: m.id,
      from: parseAddress(hdr(m.payload, 'From')),
      to: parseAddressList(hdr(m.payload, 'To')),
      cc: parseAddressList(hdr(m.payload, 'Cc')),
      date: Number(m.internalDate) || 0,
      unread: labelIds.includes('UNREAD'),
      draft: labelIds.includes('DRAFT'),
      snippet: decodeEntities(m.snippet || ''),
      html: html || null,
      text: html ? null : parts.text.join('\n\n'),
      // Quoted history repeats the messages above it, so it collapses in every message but the first,
      // whose quote may be an email that isn't in this thread.
      markdown: html ? htmlToMarkdown(html, { collapseQuotes: index > 0 }) : null,
      unsubscribe: unsubscribeUrl(hdr(m.payload, 'List-Unsubscribe')),
      attachments: parts.attachments
        .filter(a => !(a.cid && usedCids.has(a.cid)))
        .map(a => ({ name: a.filename, size: a.size, mime: a.mimeType, url: attachmentUrl(email, m.id, a) })),
    };
  });
  if (markdownOnly) for (const m of messages) if (m.markdown !== null) m.html = null;
  return { ...summary, messages, gmailUrl: gmailUrl(email, id) };
}

/* ------------------------------------------------------------------ changes */

function resolveLabels(acct, names = []) {
  return [].concat(names).map(n => {
    if (TRIAGE.includes(n)) {
      const id = acct.triage[n];
      if (!id) throw new HttpError(400, `There is no "${n}" label in ${acct.email}`);
      return id;
    }
    if (MODIFIABLE.has(n)) return n;
    throw new HttpError(400, `Unsupported label "${n}"`);
  });
}

async function modify(items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Nothing to change');
  if (items.length > 1000) throw new HttpError(400, 'Too many conversations at once; use the bulk actions');
  const byAcct = {};
  for (const it of items) {
    if (!ID_RE.test(String(it.id))) throw new HttpError(400, 'Bad thread id');
    (byAcct[it.account] ||= []).push(it);
  }
  const results = await Promise.all(Object.entries(byAcct).map(async ([email, list]) => {
    let acct;
    try { acct = await loadLabels(getAcct(email)); } catch (e) { return list.map(it => ({ account: email, id: it.id, ok: false, error: e.message })); }
    return mapLimit(list, 6, async it => {
      try {
        const add = resolveLabels(acct, it.add);
        const remove = resolveLabels(acct, it.remove);
        const addIds = add.filter(x => x !== 'TRASH');
        const removeIds = remove.filter(x => x !== 'TRASH');
        if (remove.includes('TRASH')) await gapi(email, 'POST', `threads/${it.id}/untrash`);
        if (addIds.length || removeIds.length) {
          await gapi(email, 'POST', `threads/${it.id}/modify`, { body: { addLabelIds: addIds, removeLabelIds: removeIds } });
        }
        if (add.includes('TRASH')) await gapi(email, 'POST', `threads/${it.id}/trash`);
        metaCache.delete(`${email}:${it.id}`);
        return { account: email, id: it.id, ok: true };
      } catch (e) {
        return { account: email, id: it.id, ok: false, error: e.message };
      }
    });
  }));
  clearCounts();
  return { results: results.flat() };
}

async function listAll(email, kind, labelIds, q) {
  const out = [];
  let pageToken;
  do {
    const r = await gapi(email, 'GET', kind, { query: { labelIds, q, maxResults: 500, pageToken } });
    for (const m of r[kind] || []) out.push(m);
    pageToken = r.nextPageToken;
    if (out.length > 150_000) throw new HttpError(400, 'Too many conversations for one bulk action; narrow it down in Gmail');
  } while (pageToken);
  return out;
}

async function batchModify(email, ids, addLabelIds, removeLabelIds) {
  for (let i = 0; i < ids.length; i += 1000) {
    await gapi(email, 'POST', 'messages/batchModify', { body: { ids: ids.slice(i, i + 1000), addLabelIds, removeLabelIds } });
  }
}

const undoStore = new Map();

/** Apply an action to every conversation in a view (not just the loaded page). */
async function bulk({ view, account, action, olderThanDays, preview }) {
  const days = olderThanDays == null ? null : Number(olderThanDays);
  if (days != null && !(Number.isInteger(days) && days >= 1 && days <= 3650)) throw new HttpError(400, 'olderThanDays must be 1 to 3650');
  if (!['read', 'clear', 'done'].includes(action)) throw new HttpError(400, 'Unknown bulk action');
  if (action !== 'read' && !TRIAGE.includes(view)) throw new HttpError(400, 'Clear and done only apply to Now, Later and Noise');
  if (view !== 'inbox' && !TRIAGE.includes(view)) throw new HttpError(400, 'Bulk actions work on Inbox, Now, Later and Noise');
  const targets = selectAccounts(account);
  const ops = [];
  let threads = 0;
  const errors = [];
  await Promise.all(targets.map(async acct => {
    try {
      await loadLabels(acct);
      const base = view === 'inbox' ? 'INBOX' : acct.triage[view];
      if (!base) return;
      // Labels live on messages, and a thread's newer replies may lack the triage label while still
      // sitting in the inbox or unread. So work out the thread set first, then collect every message
      // in those threads that needs changing. Each step records exactly what it changed, for undo.
      const threadIds = new Set((await listAll(acct.email, 'threads', [base], days ? `older_than:${days}d` : undefined)).map(t => t.id));
      if (days) {
        // older_than matches a thread if ANY message is old; keep threads with recent replies out.
        for (const t of await listAll(acct.email, 'threads', [base], `newer_than:${days}d`)) threadIds.delete(t.id);
      }
      if (preview) { threads += threadIds.size; return; }
      if (!threadIds.size) return;
      const inThreads = async label => (await listAll(acct.email, 'messages', [label]))
        .filter(m => threadIds.has(m.threadId)).map(m => m.id);
      const steps = [];
      if (action === 'read') steps.push(['UNREAD', await inThreads('UNREAD')]);
      if (action === 'done') steps.push(['INBOX', await inThreads('INBOX')]);
      if (action !== 'read') steps.push([base, await inThreads(base)]);
      for (const [removeId, ids] of steps) {
        if (!ids.length) continue;
        await batchModify(acct.email, ids, [], [removeId]);
        ops.push({ email: acct.email, ids, add: [removeId] });
      }
      threads += threadIds.size;
    } catch (e) {
      errors.push({ account: acct.email, ...errInfo(e) });
    }
  }));
  if (preview) return { ok: true, preview: true, threads, errors };
  for (const [k, v] of undoStore) if (v.expires < Date.now()) undoStore.delete(k);
  const token = ops.length ? b64url(crypto.randomBytes(12)) : null;
  if (token) undoStore.set(token, { expires: Date.now() + 15 * 60_000, ops });
  clearCounts();
  if (errors.length && !ops.length) throw new HttpError(errors[0].status, errors[0].message, errors[0]);
  return { ok: true, undo: token, threads, errors };
}

async function undo(token) {
  const entry = undoStore.get(token);
  if (!entry) throw new HttpError(410, 'That undo has expired');
  undoStore.delete(token);
  for (const op of entry.ops.slice().reverse()) await batchModify(op.email, op.ids, op.add, []);
  clearCounts();
  return { ok: true };
}

/* ------------------------------------------------------------------ counts */

const countsCache = new Map();
let countsGen = 0;
function clearCounts() { countsCache.clear(); countsGen++; }

async function counts() {
  const out = {};
  await Promise.all(accountOrder().map(async email => {
    try {
      const acct = await loadLabels(getAcct(email));
      const want = { inbox: 'INBOX', starred: 'STARRED', ...acct.triage };
      const c = {};
      await Promise.all(Object.entries(want).map(async ([k, id]) => {
        if (!id) return;
        const key = `${email}:${id}`;
        let hit = countsCache.get(key);
        if (!hit || Date.now() - hit.at > 30_000) {
          const gen = countsGen;
          const l = await gapi(email, 'GET', `labels/${enc(id)}`);
          hit = { at: Date.now(), total: l.threadsTotal || 0, unread: l.threadsUnread || 0 };
          if (gen === countsGen) countsCache.set(key, hit);
        }
        c[k] = { total: hit.total, unread: hit.unread };
      }));
      out[email] = c;
    } catch (e) {
      out[email] = { error: errInfo(e) };
    }
  }));
  return { accounts: out };
}

/* ------------------------------------------------------------------ triage sheet: rules + reasons */

function hasSheets(email) {
  return (tokens[email]?.scope || '').split(' ').includes(SCOPE_SHEETS);
}

async function addRule({ account, match, type, label }) {
  if (!['exact', 'domain', 'contains'].includes(type)) throw new HttpError(400, 'type must be exact, domain or contains');
  if (!TRIAGE.includes(label)) throw new HttpError(400, 'label must be now, later or noise');
  match = String(match || '').trim().toLowerCase();
  if (!match || match.length > 200) throw new HttpError(400, 'Bad match value');
  // The triage script reads rules from one shared rules sheet (its RULES_SHEET_ID script property),
  // not from each account's log sheet, so rules go there. Any connected account that can edit it may write.
  const sheet = config.rulesSheet || process.env.MAILROOM_RULES_SHEET;
  if (!sheet) throw new HttpError(400, 'Set "rulesSheet" in config.json to the triage rules sheet id');
  const writers = [account, ...accountOrder().filter(e => e !== account)].filter(e => tokens[e] && hasSheets(e));
  if (!writers.length) throw new HttpError(403, `Reconnect ${account} and allow Google Sheets access to add rules`);
  let lastError;
  for (const who of writers) {
    try { return await writeRule(who, sheet, match, type, label); } catch (e) {
      lastError = e;
      if (e.status !== 403 && e.status !== 404) throw e; // no access from this account: try the next
    }
  }
  throw lastError;
}

async function writeRule(account, sheet, match, type, label) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/`;
  const range = enc('rules!A:D');
  const r = await gapi(account, 'GET', base + range);
  const rows = r.values || [];
  const note = `added from Mailroom ${new Date().toISOString().slice(0, 10)}`;
  const idx = rows.findIndex((row, i) => i > 0
    && String(row[0] || '').trim().toLowerCase() === match
    && String(row[1] || '').trim().toLowerCase() === type);
  if (idx >= 0) {
    await gapi(account, 'PUT', base + enc(`rules!A${idx + 1}:D${idx + 1}`), {
      query: { valueInputOption: 'RAW' }, body: { values: [[match, type, label, note]] },
    });
    return { ok: true, updated: idx + 1 };
  }
  await gapi(account, 'POST', `${base}${range}:append`, {
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, body: { values: [[match, type, label, note]] },
  });
  return { ok: true, added: true };
}

const whyCache = new Map();

async function why(email, id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Bad thread id');
  getAcct(email);
  const key = `${email}:${id}`;
  const cached = whyCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.result;
  let result = {};
  if (DEMO) {
    result = demo.why(email, id);
  } else {
    const sheet = ruleSheets()[email];
    if (!sheet || !hasSheets(email)) return {};
    try {
      const tq = `select A,F,G,H,I where C='${id}' order by A desc limit 1`;
      const url = `https://docs.google.com/spreadsheets/d/${sheet}/gviz/tq?tqx=out:json&gid=0&tq=${enc(tq)}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(email)}` }, signal: AbortSignal.timeout(6000) });
      const text = await r.text();
      const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
      const row = m ? JSON.parse(m[1]).table?.rows?.[0]?.c : null;
      if (row) {
        const v = i => row[i]?.f ?? row[i]?.v ?? null;
        result = { at: v(0), label: v(1), reason: v(2), source: v(3), confidence: row[4]?.v ?? null };
      }
    } catch { result = {}; }
  }
  if (result && Object.keys(result).length) { // a miss may just mean the script hasn't logged it yet
    whyCache.delete(key);
    whyCache.set(key, { at: Date.now(), result });
    if (whyCache.size > 2000) whyCache.delete(whyCache.keys().next().value);
  }
  return result;
}

/* ------------------------------------------------------------------ attachments */

const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf']);

async function attachment(res, url) {
  const email = url.searchParams.get('account');
  const messageId = url.searchParams.get('message') || '';
  const attId = url.searchParams.get('id');
  const partId = url.searchParams.get('part');
  if (!ID_RE.test(messageId)) throw new HttpError(400, 'Bad message id');
  getAcct(email);
  let data;
  if (attId) {
    if (!/^[\w-]+$/.test(attId)) throw new HttpError(400, 'Bad attachment id');
    data = (await gapi(email, 'GET', `messages/${messageId}/attachments/${attId}`)).data;
  } else {
    const m = await gapi(email, 'GET', `messages/${messageId}`, { query: { format: 'full' } });
    const find = p => (p.partId === partId ? p : (p.parts || []).map(find).find(Boolean));
    const body = find(m.payload || {})?.body || {};
    data = body.data || (body.attachmentId ? (await gapi(email, 'GET', `messages/${messageId}/attachments/${body.attachmentId}`)).data : null);
  }
  if (!data) throw new HttpError(404, 'Attachment not found');
  const buf = Buffer.from(data, 'base64url');
  const mime = String(url.searchParams.get('mime') || 'application/octet-stream').toLowerCase();
  const name = String(url.searchParams.get('name') || 'attachment').replace(/[\r\n"]/g, '');
  const inline = INLINE_SAFE.has(mime) && url.searchParams.get('download') !== '1';
  res.writeHead(200, {
    'Content-Type': inline ? mime : 'application/octet-stream',
    'Content-Length': buf.length,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${enc(name)}`,
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable', // a message part never changes
  });
  res.end(buf);
}

/* ------------------------------------------------------------------ setup */

async function accountsInfo() {
  const list = await Promise.all(accountOrder().map(async (email, i) => {
    const t = tokens[email];
    let labels = null;
    let error = null;
    if (!t.needsReauth) {
      try { labels = (await loadLabels(getAcct(email))).triageName; } catch (e) { error = errInfo(e); }
    }
    return {
      email, short: email.split('@')[0], color: i % 6,
      status: t.needsReauth || error?.reauth ? 'reauth' : error ? 'error' : 'ok',
      error: error?.message || null, labels,
      rules: !!ruleSheets()[email] && hasSheets(email),
    };
  }));
  return {
    demo: DEMO,
    configured: DEMO || !!(config.clientId && config.clientSecret),
    redirectUri: REDIRECT_URI,
    dataDir: DATA.replace(os.homedir(), '~'),
    accounts: list,
    suggested: [...(config.accounts || []), ...DEFAULT_ACCOUNTS].filter(e => !tokens[e]),
    // Google's page for publishing the OAuth app; while it's in Testing, sign-ins expire after 7 days.
    publishUrl: config.clientId ? `https://console.cloud.google.com/auth/audience?project=${config.clientId.split('-')[0]}` : null,
  };
}

function saveSetup(body) {
  let { clientId = '', clientSecret = '' } = body || {};
  clientId = String(clientId).trim();
  clientSecret = String(clientSecret).trim();
  if (clientId.startsWith('{')) {
    try {
      const j = JSON.parse(clientId);
      const c = j.installed || j.web || j;
      clientId = c.client_id || '';
      clientSecret = c.client_secret || clientSecret;
    } catch { throw new HttpError(400, 'That JSON did not parse'); }
  }
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new HttpError(400, 'The client ID should end in .apps.googleusercontent.com');
  if (!clientSecret) throw new HttpError(400, 'The client secret is missing');
  config = { ...config, clientId, clientSecret };
  saveConfig();
  return { ok: true };
}

async function removeAccount(email) {
  const t = tokens[email];
  if (!t) return { ok: true };
  if (!DEMO && t.refresh_token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${enc(t.refresh_token)}`, { method: 'POST' }).catch(() => {});
  }
  delete tokens[email];
  delete accts[email];
  saveTokens();
  return { ok: true };
}

/* ------------------------------------------------------------------ http */

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https: http:",
  "img-src * data: blob:",
  "font-src * data:",
  "media-src * data:",
  "frame-src 'self' about:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}
function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}
function notice(res, title, message) {
  const e = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${e(title)}</title><style>body{font:15px/1.5 -apple-system,Roboto,sans-serif;max-width:520px;margin:15vh auto;padding:0 24px;color:#1f1f1f;background:#f6f8fc}@media(prefers-color-scheme:dark){body{background:#141414;color:#e3e3e3}a{color:#a8c7fa}}h1{font-weight:400;font-size:22px}</style><h1>${e(title)}</h1><p>${e(message)}</p><p><a href="/#/setup">Back to Mailroom</a></p>`);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Bad JSON'); }
}

/** Blocks DNS-rebinding and cross-site requests; the UI always sends X-Mailroom. */
function guard(req, url) {
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return 'Unexpected Host header';
  if (!url.pathname.startsWith('/api/')) return null;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'Cross-site request blocked';
  if (url.pathname !== '/api/attachment' && req.headers['x-mailroom'] !== '1') return 'Missing X-Mailroom header';
  if (req.method !== 'GET' && req.headers.origin) {
    try { if (!HOSTS.has(new URL(req.headers.origin).host)) return 'Bad origin'; } catch { return 'Bad origin'; }
  }
  return null;
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + p);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    const type = STATIC_TYPES[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_CSP, 'X-Frame-Options': 'DENY' } : {}),
    });
    res.end(buf);
  });
}

const routes = {
  'GET /health': async () => ({ ok: true, demo: DEMO, dir: __dirname, started: STARTED }),
  'GET /api/accounts': () => accountsInfo(),
  'POST /api/setup': (req, url, body) => saveSetup(body),
  'POST /api/accounts/remove': (req, url, body) => removeAccount(String(body.email || '')),
  'GET /api/threads': (req, url) => listThreads({
    view: url.searchParams.get('view') || 'inbox',
    q: (url.searchParams.get('q') || '').trim(),
    account: url.searchParams.get('account') || 'all',
    unread: url.searchParams.get('unread') === '1',
    cursor: url.searchParams.get('cursor'),
  }),
  'GET /api/thread': (req, url) => getThread(url.searchParams.get('account'), url.searchParams.get('id') || '', { markdownOnly: url.searchParams.get('format') === 'md' }),
  'GET /api/counts': () => counts(),
  'GET /api/why': (req, url) => why(url.searchParams.get('account'), url.searchParams.get('id') || ''),
  'POST /api/modify': (req, url, body) => modify(body.items),
  'POST /api/bulk': (req, url, body) => bulk(body),
  'POST /api/undo': (req, url, body) => undo(String(body.token || '')),
  'POST /api/rule': (req, url, body) => addRule(body),
};

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${HOST}:${PORT}`); } catch { return send(res, 400, 'Bad URL'); }
  const blocked = guard(req, url);
  if (blocked) return send(res, 403, { error: blocked });
  try {
    if (req.method === 'GET' && url.pathname === '/auth/start') return authStart(res, url);
    if (req.method === 'GET' && url.pathname === '/oauth/callback') return await authCallback(res, url);
    if (req.method === 'GET' && url.pathname === '/api/attachment') return await attachment(res, url);
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) {
      const body = req.method === 'POST' ? await readBody(req) : null;
      return send(res, 200, await route(req, url, body || {}));
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error(new Date().toISOString(), req.method, url.pathname, e);
    if (res.headersSent) return res.end();
    return send(res, status, { error: e.message || 'Something went wrong', reauth: !!e.reauth, account: e.account || null });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Mailroom may already be running: http://127.0.0.1:${PORT}`);
    process.exit(1);
  }
  throw e;
});

/* Self-restart when server.js changes (an update landed), so updates never need a manual restart.
 * The page notices the new start time on /health and reloads itself. */
if (!DEMO && !process.env.MAILROOM_NO_WATCH) {
  let lastMtime = fs.statSync(__filename).mtimeMs;
  fs.watchFile(__filename, { interval: 1500 }, st => {
    if (st.mtimeMs === lastMtime) return;
    lastMtime = st.mtimeMs;
    try { new Function(fs.readFileSync(__filename, 'utf8').replace(/^#!.*\n/, '')); } catch (e) {
      console.error('Update has a syntax error, not restarting:', e.message);
      return;
    }
    console.log('server.js changed, restarting');
    server.close();
    for (const s of sockets) s.destroy();
    const { spawn } = require('child_process');
    const out = fs.openSync(path.join(DATA, 'server.log'), 'a');
    setTimeout(() => {
      spawn(process.execPath, [__filename], { detached: true, stdio: ['ignore', out, out], env: process.env }).unref();
      process.exit(0);
    }, 300);
  });
}
const sockets = new Set();
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

server.listen(PORT, HOST, () => {
  console.log(`Mailroom${DEMO ? ' (demo data)' : ''} running at http://127.0.0.1:${PORT}`);
  if (!DEMO) console.log(`Config and tokens: ${DATA}`);
});

module.exports = { htmlToMarkdown, batchThreadMeta, summarize, walkPart, parseAddress, parseAddressList, decodeEntities, cleanHtml };
