'use strict';
/*
 * Turns what people type into a Gmail query. Gmail already matches whole words in the subject, body,
 * sender name and address. This adds the two things it can't do:
 *   - partial names and addresses: "pri" or "acme" also match known senders whose name or address starts with it
 *   - dates in plain English: "yesterday", "last week", "sept 3", "9/3", "since march", "between jun 1 and jun 15"
 * Anything Gmail already understands (from:, "quoted phrases", -negation, after:2026/01/01) passes through untouched.
 */

const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const UNITS = { day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month', year: 'year', years: 'year' };
const STOP = new Set(['and', 'or', 'the', 'to', 'from', 'of', 'for', 'in', 'on', 'at', 'a', 'an', 'is', 'it', 'my', 'me', 're', 'fw', 'fwd', 'with']);
const MAX_SENDERS = 12; // more matches than this means the word is too generic to be a name

/* ------------------------------------------------------------------ dates */

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Start of the day/week (Monday)/month/year containing `d`, moved `k` units. */
function unitStart(unit, d, k = 0) {
  if (unit === 'day') return addDays(startOfDay(d), k);
  if (unit === 'week') return addDays(startOfDay(d), -((d.getDay() + 6) % 7) + 7 * k);
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth() + k, 1);
  return new Date(d.getFullYear() + k, 0, 1);
}

function shift(d, unit, n) {
  if (unit === 'day') return addDays(d, n);
  if (unit === 'week') return addDays(d, 7 * n);
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  return new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
}

const num = w => (w && /^\d{1,3}$/.test(w) ? Number(w) : NUMBERS[w] || 0);
const dayOf = w => (w && /^\d{1,2}$/.test(w) && +w >= 1 && +w <= 31 ? +w : 0);
const yearOf = w => (w && /^(19|20)\d\d$/.test(w) ? +w : 0);
const monthOf = w => (w in MONTHS ? MONTHS[w] : -1);

/** A day with no year given means its most recent occurrence (today counts). */
function pastDay(month, day, today) {
  const d = new Date(today.getFullYear(), month, day);
  return d > today ? new Date(today.getFullYear() - 1, month, day) : d;
}

const span = (start, end, len, ambiguous = false) => ({ start, end, len, ambiguous });

/**
 * Read a date at w[i]. Returns { start, end (exclusive, or null for open-ended), len (words used), ambiguous }.
 * `ambiguous` marks a bare month or weekday ("march", "friday"): it's searched as a word OR a date.
 * `prefixed` means a word like "in", "since" came first, so those count as dates outright and a bare year is allowed.
 */
function parseDate(w, i, now, prefixed = false) {
  const [t0, t1, t2] = [w[i], w[i + 1], w[i + 2]];
  if (!t0) return null;
  const today = startOfDay(now);
  if (t0 === 'today') return span(today, addDays(today, 1), 1);
  if (t0 === 'yesterday') return span(addDays(today, -1), today, 1);

  if ((t0 === 'this' || t0 === 'last') && ['week', 'month', 'year'].includes(t1)) {
    const k = t0 === 'last' ? -1 : 0;
    return span(unitStart(t1, today, k), unitStart(t1, today, k + 1), 2);
  }
  if ((t0 === 'last' || t0 === 'past') && num(t1) && UNITS[t2]) return span(shift(today, UNITS[t2], -num(t1)), null, 3);
  if (num(t0) && UNITS[t1] && t2 === 'ago') {
    const d = shift(today, UNITS[t1], -num(t0));
    return span(unitStart(UNITS[t1], d), unitStart(UNITS[t1], d, 1), 3);
  }

  const wd = WEEKDAYS.indexOf(t0);
  if (wd >= 0) {
    const d = addDays(today, -((today.getDay() - wd + 7) % 7));
    return span(d, addDays(d, 1), 1, !prefixed);
  }
  if ((t0 === 'last' || t0 === 'this') && WEEKDAYS.includes(t1)) {
    const back = (today.getDay() - WEEKDAYS.indexOf(t1) + 7) % 7;
    const d = t0 === 'last' ? addDays(today, -(back || 7)) : addDays(unitStart('week', today), (WEEKDAYS.indexOf(t1) + 6) % 7);
    return span(d, addDays(d, 1), 2);
  }

  let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t0); // US order: 9/3, 9/3/25, 9/3/2025
  if (m && +m[1] >= 1 && +m[1] <= 12 && dayOf(m[2])) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0;
    const d = y ? new Date(y, +m[1] - 1, +m[2]) : pastDay(+m[1] - 1, +m[2], today);
    return span(d, addDays(d, 1), 1);
  }
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t0);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return span(d, addDays(d, 1), 1);
  }

  const mo = monthOf(t0);
  if (mo >= 0) {
    if (dayOf(t1)) { // sept 3, sept 3 2025
      const d = yearOf(t2) ? new Date(yearOf(t2), mo, dayOf(t1)) : pastDay(mo, dayOf(t1), today);
      return span(d, addDays(d, 1), yearOf(t2) ? 3 : 2);
    }
    if (yearOf(t1)) return span(new Date(yearOf(t1), mo, 1), new Date(yearOf(t1), mo + 1, 1), 2);
    const y = mo > today.getMonth() ? today.getFullYear() - 1 : today.getFullYear();
    return span(new Date(y, mo, 1), new Date(y, mo + 1, 1), 1, !prefixed);
  }
  if (dayOf(t0) && monthOf(t1) >= 0) { // 3 sept, 3 sept 2025
    const d = yearOf(t2) ? new Date(yearOf(t2), monthOf(t1), dayOf(t0)) : pastDay(monthOf(t1), dayOf(t0), today);
    return span(d, addDays(d, 1), yearOf(t2) ? 3 : 2);
  }
  if (prefixed && yearOf(t0)) return span(new Date(yearOf(t0), 0, 1), new Date(yearOf(t0) + 1, 0, 1), 1);
  return null;
}

const secs = d => Math.floor(d.getTime() / 1000);
const range = (after, before) => [after && `after:${secs(after)}`, before && `before:${secs(before)}`].filter(Boolean).join(' ');

/* ------------------------------------------------------------------ senders */

/** Addresses in `senders` (Map email -> display name) whose name, address or domain starts with `word`. */
function senderMatches(word, senders) {
  const w = word.toLowerCase();
  if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) return [];
  const hits = [];
  for (const [email, name] of senders) {
    const [local = '', domain = ''] = email.split('@');
    const parts = [email, domain, ...local.split(/[._+-]/), ...String(name || '').toLowerCase().split(/[\s,.'"()]+/)];
    if (parts.some(p => p && p.startsWith(w))) hits.push(email);
  }
  return hits.length > MAX_SENDERS ? [] : hits;
}

const anyOf = parts => (parts.length > 1 ? `{${parts.join(' ')}}` : parts[0]);

/* ------------------------------------------------------------------ query */

const PASSTHROUGH = /[:"(){}\[\]]|^-|^OR$|^AND$|^AROUND$/;

/**
 * @param {string} q        what the user typed
 * @param {Map<string,string>} senders  known sender addresses -> display names, for this account
 * @param {Date} now
 */
function expandSearch(q, senders = new Map(), now = new Date()) {
  const raw = String(q || '').match(/"[^"]*"?|\S+/g) || [];
  const w = raw.map(t => (PASSTHROUGH.test(t) ? '\u0000' : t.toLowerCase().replace(/,$/, '').replace(/^(\d{1,2})(st|nd|rd|th)$/, '$1')));
  const out = [];
  for (let i = 0; i < raw.length;) {
    if (w[i] === '\u0000') { out.push(raw[i]); i++; continue; }
    const p = w[i];

    // between X and Y, from X to Y
    if (p === 'between' || p === 'from') {
      const a = parseDate(w, i + 1, now, true);
      const joiner = a && w[i + 1 + a.len];
      const b = a && (joiner === 'and' || joiner === 'to' || joiner === '-') && parseDate(w, i + 2 + a.len, now, true);
      if (b) { out.push(range(a.start, b.end || b.start)); i += 2 + a.len + b.len; continue; }
    }
    // in/on/during X, since X, after X, before X
    if (['in', 'on', 'during', 'since', 'after', 'before'].includes(p)) {
      const d = parseDate(w, i + 1, now, true);
      if (d) {
        if (p === 'since') out.push(range(d.start, null));
        else if (p === 'after') out.push(range(d.end || d.start, null));
        else if (p === 'before') out.push(range(null, d.start));
        else out.push(range(d.start, d.end));
        i += 1 + d.len;
        continue;
      }
    }
    // "from yesterday", "from last week": a clear date (not a bare month or weekday, which could be a name like Jan)
    if (p === 'from') {
      const d = parseDate(w, i + 1, now);
      if (d && !d.ambiguous) { out.push(range(d.start, d.end)); i += 1 + d.len; continue; }
    }
    // from NAME / to NAME: the person, not the word
    if ((p === 'from' || p === 'to') && w[i + 1] && w[i + 1] !== '\u0000') {
      const who = raw[i + 1];
      out.push(anyOf([`${p}:${who}`, ...senderMatches(who, senders).map(e => `${p}:${e}`)]));
      i += 2;
      continue;
    }

    const d = parseDate(w, i, now);
    if (d) {
      const dates = range(d.start, d.end);
      if (!d.ambiguous) out.push(dates);
      else out.push(anyOf([raw[i], ...senderMatches(raw[i], senders).map(e => `from:${e}`), `(${dates})`]));
      i += d.len;
      continue;
    }

    out.push(anyOf([raw[i], ...senderMatches(raw[i], senders).map(e => `from:${e}`)]));
    i++;
  }
  return out.join(' ');
}

module.exports = { expandSearch, parseDate, senderMatches };
