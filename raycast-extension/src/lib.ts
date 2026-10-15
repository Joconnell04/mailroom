import { environment, getPreferenceValues } from "@raycast/api";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

type Prefs = { mailroomDir?: string; port?: string; markReadOnOpen?: boolean };

export const TRIAGE = ["now", "later", "noise"] as const;
export type Triage = (typeof TRIAGE)[number];
export type View = "now" | "later" | "noise" | "inbox";

export type Person = { name: string; email: string; unread: boolean };
export type Thread = {
  account: string;
  id: string;
  subject: string;
  snippet: string;
  date: number;
  people: Person[];
  origin: { name: string; email: string };
  count: number;
  flags: string[];
  labels: string[];
  attachment: boolean;
};
export type Message = {
  id: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  date: number;
  unread: boolean;
  html: string | null;
  text: string | null;
  markdown: string | null;
  unsubscribe: string | null;
  attachments: { name: string; size: number; mime: string; url: string }[];
};
export type ThreadDetail = Thread & { messages: Message[]; gmailUrl: string };
export type Account = { email: string; short: string; color: number; status: string };
export type Counts = Record<string, Record<string, { total: number; unread: number }> & { error?: unknown }>;

export function prefs() {
  const p = getPreferenceValues<Prefs>();
  const raw = (p.mailroomDir || "~/mailroom").trim();
  const dir = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  const port = Number(p.port) || 4747;
  return { dir, port, base: `http://127.0.0.1:${port}`, markReadOnOpen: p.markReadOnOpen !== false };
}

const HEADERS = { "X-Mailroom": "1" };

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(`${prefs().base}/health`, { signal: AbortSignal.timeout(800) });
    const j = (await r.json()) as { ok?: boolean; demo?: boolean };
    return !!j.ok && !j.demo;
  } catch {
    return false;
  }
}

function findNode(): string {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".homebrew/bin/node"),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    path.join(home, ".volta/bin/node"),
    path.join(home, ".local/bin/node"),
  ];
  try {
    const nvm = path.join(home, ".nvm/versions/node");
    for (const v of fs.readdirSync(nvm).sort().reverse()) candidates.push(path.join(nvm, v, "bin/node"));
  } catch {
    /* no nvm */
  }
  return candidates.find((c) => fs.existsSync(c)) || process.execPath;
}

/** Make sure the Mailroom server is up, starting it in the background if needed. */
export async function ensureServer(): Promise<void> {
  if (await healthy()) return;
  const { dir, port } = prefs();
  const server = path.join(dir, "server.js");
  if (!fs.existsSync(server)) {
    throw new Error(`Can't find ${server}. Set the Mailroom Folder in this extension's preferences.`);
  }
  const logDir = path.join(os.homedir(), ".config", "mailroom");
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, "server.log"), "a");
  spawn(findNode(), [server], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, MAILROOM_PORT: String(port) },
  }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await healthy()) return;
  }
  throw new Error("Mailroom didn't start. Check ~/.config/mailroom/server.log");
}

export async function api<T>(p: string, body?: unknown): Promise<T> {
  const res = await fetch(prefs().base + p, {
    method: body ? "POST" : "GET",
    headers: body ? { ...HEADERS, "Content-Type": "application/json" } : HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(String(data.error || `Mailroom returned ${res.status}`));
  return data as T;
}

/* ------------------------------------------------------------------ label changes */

export type Action = "done" | "read" | "unread" | Triage;

const has = (t: Thread, f: string) => t.flags.includes(f);

/** Same label diffs as the Mailroom web app. Returns null when nothing would change. */
export function diffFor(action: Action, t: Thread): { add: string[]; remove: string[] } | null {
  const tri = TRIAGE.filter((x) => has(t, x));
  const d = (add: string[], remove: string[]) => (add.length || remove.length ? { add, remove } : null);
  switch (action) {
    case "read":
      return has(t, "UNREAD") ? d([], ["UNREAD"]) : null;
    case "unread":
      return has(t, "UNREAD") ? null : d(["UNREAD"], []);
    case "done":
      return d([], [...tri, ...(has(t, "INBOX") ? ["INBOX"] : [])]);
    default: {
      const add: string[] = has(t, action) ? [] : [action];
      const remove: string[] = tri.filter((x) => x !== action);
      if (action === "now") {
        if (!has(t, "INBOX")) add.push("INBOX");
        if (!has(t, "IMPORTANT")) add.push("IMPORTANT");
      } else {
        if (has(t, "INBOX")) remove.push("INBOX");
        if (has(t, "IMPORTANT")) remove.push("IMPORTANT");
      }
      return d(add, remove);
    }
  }
}

export function applyDiff(t: Thread, d: { add: string[]; remove: string[] }): Thread {
  const f = new Set(t.flags);
  d.remove.forEach((x) => f.delete(x));
  d.add.forEach((x) => f.add(x));
  return { ...t, flags: [...f] };
}

export type Change = { account: string; id: string; add: string[]; remove: string[] };
/** The last change, stored as the label edits that reverse it. */
export type Undo = { label: string; items: Change[]; at: number };
export const UNDO_WINDOW = 15 * 60_000;

/** Send label changes in one request. Returns the changes Gmail accepted and the first error, if any. */
export async function modifyMany(items: Change[]): Promise<{ ok: Change[]; error: string | null }> {
  if (!items.length) return { ok: [], error: null };
  const r = await api<{ results: { account: string; id: string; ok: boolean; error?: string }[] }>("/api/modify", {
    items,
  });
  const bad = new Set(r.results.filter((x) => !x.ok).map((x) => `${x.account}:${x.id}`));
  const error = r.results.find((x) => !x.ok)?.error || (bad.size ? "Gmail refused the change" : null);
  return { ok: items.filter((i) => !bad.has(`${i.account}:${i.id}`)), error };
}

export const inverse = (c: Change): Change => ({ account: c.account, id: c.id, add: c.remove, remove: c.add });

/**
 * Shift+Arrow selection, Finder style: the range runs from the anchor (where Shift selection started)
 * to the new cursor, on top of whatever was selected before. Moving back toward the anchor shrinks it.
 */
export function extendRange(keys: string[], current: string | undefined, anchor: string | null, base: Set<string>, dir: 1 | -1) {
  const cur = Math.max(0, current ? keys.indexOf(current) : 0);
  const next = Math.min(keys.length - 1, Math.max(0, cur + dir));
  const a = anchor && keys.includes(anchor) ? keys.indexOf(anchor) : cur;
  const [lo, hi] = a < next ? [a, next] : [next, a];
  return { picked: new Set([...base, ...keys.slice(lo, hi + 1)]), anchor: keys[a], target: keys[next] };
}

export const DONE_TEXT: Record<Action, string> = {
  done: "Done",
  read: "Marked read",
  unread: "Marked unread",
  now: "Moved to Now",
  later: "Moved to Later",
  noise: "Moved to Noise",
};

/* ------------------------------------------------------------------ display */

export function shortDate(ms: number): string {
  const d = new Date(ms);
  const n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
}

export function fullDate(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function senders(t: Thread): string {
  const ps = t.people || [];
  if (!ps.length) return t.origin?.name || t.origin?.email || "(no sender)";
  if (ps.length === 1) return ps[0].name;
  const first = (n: string) => (n === "me" ? n : n.split(/\s+/)[0].replace(/,$/, ""));
  return ps.map((p) => first(p.name)).join(", ");
}

const escMd = (s: string) => s.replace(/([\\`*_[\]<>])/g, "\\$1");

/** A bare URL from plain text, minus trailing punctuation that belongs to the sentence. */
function linkify(url: string): string {
  let u = url;
  let tail = "";
  for (;;) {
    const last = u.slice(-1);
    const unbalanced = last === ")" && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length;
    if (!/[.,;:!?'"\]]/.test(last) && !unbalanced) break;
    tail = last + tail;
    u = u.slice(0, -1);
  }
  return `<${u}>${escMd(tail)}`;
}

/** Plain-text email: keeps line breaks, shows "> " lines as quotes, makes URLs clickable. */
export function plainToMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const q = /^((?:>\s?)+)(.*)$/.exec(line);
      const body = (q ? q[2] : line)
        .split(/(https?:\/\/[^\s<>]+)/g)
        .map((part, i) => (i % 2 ? linkify(part) : escMd(part)))
        .join("")
        .replace(/^([#+-]|\d+\.)(\s)/, "\\$1$2");
      return q ? `${"> ".repeat((q[1].match(/>/g) || []).length)}${body}` : body;
    })
    .join("  \n");
}

/** Sender and date line for one message. Addresses go in code spans: Raycast links bare addresses even when escaped. */
export function messageHeader(m: Message, account: string): string {
  const addr = (e: string) => "`" + e.replace(/`/g, "") + "`";
  const me = account.toLowerCase();
  const names = (list: { name: string; email: string }[]) =>
    list.map((a) => (a.email.toLowerCase() === me ? "me" : a.name ? escMd(a.name) : addr(a.email))).join(", ");
  const who = m.from.name ? `**${escMd(m.from.name)}** · ${addr(m.from.email)}` : addr(m.from.email);
  const to = names(m.to);
  const cc = names(m.cc);
  return `${who}  \n*${fullDate(m.date)}*${to ? ` · to ${to}` : ""}${cc ? ` · cc ${cc}` : ""}`;
}

/**
 * Pictures Raycast can't load by itself (inline pictures attached to the email, served by Mailroom, and plain
 * http) are saved under the extension's support folder and shown from there. Files unused for 30 days are removed.
 */
export async function localizeImages(md: string): Promise<string> {
  const re = /!\[([^\]]*)\]\(((?:\/api\/attachment\?|http:\/\/)[^)\s]+)\)/g;
  const urls = [...new Set([...md.matchAll(re)].map((m) => m[2]))];
  if (!urls.length) return md;
  const dir = path.join(environment.supportPath, "images");
  fs.mkdirSync(dir, { recursive: true });
  const have = new Map(fs.readdirSync(dir).map((f) => [f.split(".")[0], path.join(dir, f)]));
  const local = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      const hash = crypto.createHash("sha1").update(u).digest("hex");
      let file = have.get(hash);
      try {
        if (!file) {
          const res = await fetch(u.startsWith("/") ? prefs().base + u : u, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) return;
          const type = res.headers.get("content-type") || "";
          const ext = /png/.test(type) ? ".png" : /gif/.test(type) ? ".gif" : /webp/.test(type) ? ".webp" : ".jpg";
          file = path.join(dir, hash + ext);
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        } else fs.utimesSync(file, new Date(), new Date());
        local.set(u, `file://${encodeURI(file)}`);
      } catch {
        /* leave the original URL */
      }
    }),
  );
  const cutoff = Date.now() - 30 * 86400_000;
  for (const f of have.values()) {
    try {
      if (fs.statSync(f).mtimeMs < cutoff) fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  return md.replace(re, (m, alt, u) => (local.has(u) ? `![${alt}](${local.get(u)})` : m));
}

/** Open a Mailroom URL in a Chrome app window (like the Open Mailroom command), else the default browser. */
export async function openInMailroom(hash = "#/now"): Promise<void> {
  const url = `${prefs().base}/${hash}`;
  const chrome = "/Applications/Google Chrome.app";
  if (fs.existsSync(chrome)) {
    spawn("open", ["-na", "Google Chrome", "--args", `--app=${url}`], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}
