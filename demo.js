'use strict';
/*
 * Fake Gmail for `node server.js --demo`. Every account, sender and message here is made up.
 * It answers the handful of Gmail API calls server.js makes, keeps changes in memory,
 * and never talks to Google.
 */
const ACCOUNTS = ['you@example.com', 'side.project@example.com', 'old.inbox@example.net'];

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const b64 = s => Buffer.from(s, 'utf8').toString('base64url');

let seq = 0x1a2b3c;
const nextId = () => (seq += 0x1f3).toString(16).padStart(12, '0');
let history = 1000;

// [account index, bucket, from, subject, snippet, hours ago, unread, reason, source, confidence, html?]
const SEED = [
  [0, 'now', 'Dana Whitfield <dana@whitfield-studio.example>', 'Can you send the revised bracket drawings by Friday?', 'Hey, quick one. The client moved the review up, so I need the PDF and the STEP file by Friday noon if you can.', 1.2, true, 'a real person writing directly, asking for a reply by a date', 'api', 0.93],
  [0, 'now', 'Northline Bank <alerts@northline-bank.example>', 'Your rent payment of $1,850.00 is scheduled', 'Your scheduled payment to Maple Court Apartments will go out on the 1st.', 3, true, 'rent, any amount', 'api', 0.96],
  [1, 'now', 'Google <no-reply@accounts.google.com>', 'Security alert: new sign-in on Mac', 'We noticed a new sign-in to your Google Account on a Mac device.', 5, false, 'rule: Google account security', 'rule', 1],
  [0, 'now', 'Priya Natarajan <priya.n@example.org>', 'Re: Saturday makerspace session', 'Works for me. I will bring the spare nozzles and the 0.2 build plate.', 20, false, 'a real person replying in an active thread', 'api', 0.88],
  [2, 'now', 'Acme Cloud <billing@acme-cloud.example>', 'Payment failed: your API credits are about to run out', 'We could not charge the card on file. Your workspace has 4% of its monthly credits left.', 26, true, 'billing failure for a service your code depends on', 'api', 0.91],
  [0, 'later', 'Filament Weekly <newsletter@filamentweekly.example>', 'Six ways to stop stringing on PETG', 'This week: retraction tuning, drying times, and a reader build that uses 40 magnets.', 2, true, 'newsletter you read sometimes', 'sender', 1],
  [0, 'later', 'Brightpath Utilities <billing@brightpath.example>', 'Your October statement is ready', 'Amount due: $64.12. Autopay is on, so there is nothing you need to do.', 9, false, 'monthly statement', 'cache', 0.86],
  [1, 'later', 'Parcel Hub <updates@parcelhub.example>', 'Terms of service update', 'We are updating our terms. The changes take effect in 30 days.', 30, false, 'terms-of-service change notice', 'api', 0.84],
  [0, 'later', 'Jordan Ames <jordan@ames-design.example>', 'Intro: a 3D scanning tool you might like', 'Hi, I lead sales at a small scanning startup and saw your post about photogrammetry.', 33, true, 'a sales rep pitching, not corresponding', 'api', 0.8],
  [2, 'later', 'Settlement Administrator <claims@settlement-admin.example>', 'Notice of proposed class action settlement', 'You may be eligible for a payment from a proposed settlement. Read this notice carefully.', 50, false, 'legal notice', 'api', 0.9],
  [0, 'later', 'Coffee Co <receipts@coffeeco.example>', 'Your receipt from Coffee Co', 'Thanks for stopping by. Oat latte, $5.25.', 52, false, 'small receipt', 'rule', 1],
  [0, 'noise', 'Gridline Social <notification@gridline.example>', 'Sam and 4 others liked your post', 'See what people are saying about your print timelapse.', 0.5, true, 'social notification', 'rule', 1],
  [0, 'noise', 'ShopMart <deals@shopmart.example>', 'Last chance: 40% off ends tonight', 'Your cart misses you. Free shipping on orders over $35.', 4, true, 'retention marketing wearing a deadline', 'sender', 1],
  [1, 'noise', 'StreamBox <hello@streambox.example>', 'Your trial ends in 3 days', 'Keep watching without interruption. Pick a plan today.', 7, true, 'vendor renewal, not a real deadline', 'api', 0.92],
  [2, 'noise', 'Marketplace <messages@marketplace.example>', 'You have a new message about "Standing desk"', 'Someone sent you a message. Reply in the app.', 11, false, 'platform message notification', 'rule', 1],
  [0, 'noise', 'Widgets Inc <onboarding@widgets.example>', 'Day 3: get more out of Widgets', 'Tip: connect your calendar to unlock smart scheduling.', 28, false, 'onboarding drip', 'cache', 0.95],
  [1, 'noise', 'ShopMart <orders@shopmart.example>', 'Your order has shipped', 'Arriving Thursday. Track your package.', 45, false, 'order and delivery mail', 'rule', 1],
];

const WELCOME_HTML = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">
<p>Hey,</p>
<p>Quick one. The client moved the design review up a week, so I need the revised bracket drawings by <b>Friday noon</b> if you can manage it.</p>
<ul><li>PDF of the drawing set</li><li>STEP file for the wall mount</li><li>A photo of the test print, if you have one</li></ul>
<p>If Friday is tight, tell me today and I will push back on them.</p>
<p>Thanks,<br>Dana</p></div>`;

const store = {}; // email -> { labels, threads: Map id -> thread }

function labelsFor() {
  const sys = ['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'TRASH', 'SENT', 'SPAM', 'DRAFT', 'CATEGORY_UPDATES']
    .map(id => ({ id, name: id, type: 'system' }));
  return [...sys,
    { id: 'Label_now', name: 'now', type: 'user' },
    { id: 'Label_later', name: 'later', type: 'user' },
    { id: 'Label_noise', name: 'noise', type: 'user' },
    { id: 'Label_print', name: 'Printing', type: 'user' },
  ];
}

function makeMessage(threadId, email, from, subject, snippet, at, labelIds, html) {
  const body = html || `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${snippet}</div>`;
  return {
    id: nextId(), threadId, labelIds, snippet, internalDate: String(at), historyId: String(history),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: from }, { name: 'To', value: email }, { name: 'Subject', value: subject },
        { name: 'Date', value: new Date(at).toUTCString() }, { name: 'Content-Type', value: 'multipart/alternative' },
      ],
      parts: [
        { partId: '0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], body: { size: snippet.length, data: b64(snippet) } },
        { partId: '1', mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: { size: body.length, data: b64(body) } },
      ],
    },
  };
}

function seed() {
  const now = Date.now();
  ACCOUNTS.forEach(e => { store[e] = { labels: labelsFor(), threads: new Map() }; });
  SEED.forEach(([a, bucket, from, subject, snippet, hoursAgo, unread, reason, source, confidence], k) => {
    const email = ACCOUNTS[a];
    const id = nextId();
    const labels = [`Label_${bucket}`, 'CATEGORY_UPDATES'];
    if (bucket === 'now') labels.push('INBOX', 'IMPORTANT');
    if (unread) labels.push('UNREAD');
    if (k === 3) labels.push('Label_print', 'STARRED');
    const msg = makeMessage(id, email, from, subject, snippet, now - hoursAgo * HOUR, labels, k === 0 ? WELCOME_HTML : null);
    const thread = { id, historyId: String(history), messages: [msg], why: { label: bucket, reason, source, confidence, at: new Date(now - hoursAgo * HOUR + 4 * 60_000).toISOString().replace('T', ' ').slice(0, 16) } };
    if (k === 3) { // a short back-and-forth
      const first = makeMessage(id, email, `Me <${email}>`, 'Saturday makerspace session', 'Are you around Saturday morning? I want to try the new enclosure on the big printer.', now - hoursAgo * HOUR - DAY, ['SENT']);
      first.payload.headers[0].value = email;
      thread.messages.unshift(first);
    }
    store[email].threads.set(id, thread);
  });
  // A few plain inbox threads with no triage label yet (the script has not seen them).
  for (const [a, from, subject, snippet, h] of [
    [0, 'Calendar <calendar@example.com>', 'Reminder: dentist at 9:30am tomorrow', 'This is a reminder for your appointment.', 0.2],
    [1, 'Riley Chen <riley@example.org>', 'Photos from the trip', 'Uploaded the album. The one from the ridge came out great.', 0.8],
  ]) {
    const email = ACCOUNTS[a];
    const id = nextId();
    const msg = makeMessage(id, email, from, subject, snippet, now - h * HOUR, ['INBOX', 'UNREAD']);
    store[email].threads.set(id, { id, historyId: String(history), messages: [msg], why: {} });
  }
}
seed();

const has = (t, label) => t.messages.some(m => m.labelIds.includes(label));
const threadLabels = t => new Set(t.messages.flatMap(m => m.labelIds));

function matchesQuery(t, q) {
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  const text = t.messages.map(m => [m.snippet, ...m.payload.headers.map(h => h.value)].join(' ')).join(' ').toLowerCase();
  return terms.every(term => {
    if (term === 'is:unread') return has(t, 'UNREAD');
    if (/^(older_than|newer_than):(\d+)d$/.test(term)) {
      const [, op, n] = term.match(/^(\w+):(\d+)d$/);
      const last = Math.max(...t.messages.map(m => Number(m.internalDate)));
      return op === 'older_than' ? last < Date.now() - n * DAY : last >= Date.now() - n * DAY;
    }
    const word = term.replace(/^[a-z]+:/, '').replace(/["()]/g, '').toLowerCase();
    return !word || text.includes(word);
  });
}

function listThreads(acct, query) {
  const want = [].concat(query.labelIds || []);
  const out = [...acct.threads.values()]
    .filter(t => (query.includeSpamTrash || !has(t, 'TRASH')) || want.includes('TRASH'))
    .filter(t => want.every(l => has(t, l)))
    .filter(t => matchesQuery(t, query.q))
    .sort((a, b) => Number(b.messages.at(-1).internalDate) - Number(a.messages.at(-1).internalDate));
  return out;
}

function modifyThread(t, add = [], remove = []) {
  history++;
  t.historyId = String(history);
  for (const m of t.messages) {
    m.labelIds = m.labelIds.filter(l => !remove.includes(l));
    for (const l of add) if (!m.labelIds.includes(l)) m.labelIds.push(l);
  }
}

async function handle(email, method, p, query, body) {
  const acct = store[email];
  if (!acct) throw Object.assign(new Error(`${email} is not connected`), { status: 404 });
  if (p.startsWith('https://sheets.googleapis.com/')) {
    return method === 'GET' ? { values: [['match', 'type', 'label', 'note']] } : {};
  }
  let m;
  if (p === 'profile') return { emailAddress: email };
  if (p === 'labels') return { labels: acct.labels };
  if ((m = p.match(/^labels\/(.+)$/))) {
    const id = decodeURIComponent(m[1]);
    const ts = [...acct.threads.values()].filter(t => has(t, id) && !has(t, 'TRASH'));
    return { id, threadsTotal: ts.length, threadsUnread: ts.filter(t => has(t, 'UNREAD')).length };
  }
  if (p === 'threads') {
    const ts = listThreads(acct, query).slice(0, Number(query.maxResults) || 30);
    return { threads: ts.map(t => ({ id: t.id, historyId: t.historyId, snippet: t.messages.at(-1).snippet })) };
  }
  if ((m = p.match(/^threads\/([0-9a-f]+)(?:\/(modify|trash|untrash))?$/))) {
    const t = acct.threads.get(m[1]);
    if (!t) throw Object.assign(new Error('Not found'), { status: 404 });
    if (m[2] === 'modify') modifyThread(t, body.addLabelIds, body.removeLabelIds);
    else if (m[2] === 'trash') modifyThread(t, ['TRASH'], ['INBOX']);
    else if (m[2] === 'untrash') modifyThread(t, [], ['TRASH']);
    const { why, ...thread } = t;
    return JSON.parse(JSON.stringify(thread));
  }
  if (p === 'messages') {
    const ts = listThreads(acct, { ...query, maxResults: 1e9 });
    const want = [].concat(query.labelIds || []);
    return { messages: ts.flatMap(t => t.messages.filter(x => want.every(l => x.labelIds.includes(l))).map(x => ({ id: x.id, threadId: t.id }))) };
  }
  if (p === 'messages/batchModify') {
    const ids = new Set(body.ids || []);
    for (const t of acct.threads.values()) {
      if (!t.messages.some(x => ids.has(x.id))) continue;
      history++;
      t.historyId = String(history);
      for (const x of t.messages) {
        if (!ids.has(x.id)) continue;
        x.labelIds = x.labelIds.filter(l => !(body.removeLabelIds || []).includes(l));
        for (const l of body.addLabelIds || []) if (!x.labelIds.includes(l)) x.labelIds.push(l);
      }
    }
    return {};
  }
  if ((m = p.match(/^messages\/([0-9a-f]+)$/))) {
    for (const t of acct.threads.values()) for (const x of t.messages) if (x.id === m[1]) return x;
  }
  throw Object.assign(new Error(`Demo mode does not support ${method} ${p}`), { status: 400 });
}

function why(email, id) {
  const t = store[email]?.threads.get(id);
  return t?.why && t.why.label ? { ...t.why } : {};
}

module.exports = { ACCOUNTS, handle, why };
