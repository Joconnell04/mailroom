import {
  Action as RAction,
  ActionPanel,
  Color,
  Detail,
  Icon,
  Image,
  Keyboard,
  List,
  open,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCachedPromise, useCachedState, usePromise } from "@raycast/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Account,
  Action,
  api,
  applyDiff,
  Change,
  Counts,
  diffFor,
  DONE_TEXT,
  ensureServer,
  extendRange,
  fullDate,
  inverse,
  localizeImages,
  messageHeader,
  modifyMany,
  openInMailroom,
  plainToMarkdown,
  prefs,
  senders,
  shortDate,
  Thread,
  ThreadDetail,
  TRIAGE,
  Triage,
  Undo,
  UNDO_WINDOW,
  View,
} from "./lib";

const VIEWS: { id: View; title: string; icon: Icon }[] = [
  { id: "now", title: "Now", icon: Icon.Bolt },
  { id: "later", title: "Later", icon: Icon.Clock },
  { id: "noise", title: "Noise", icon: Icon.BellDisabled },
  { id: "inbox", title: "Inbox", icon: Icon.Tray },
];
const ACCOUNT_COLORS = ["#7aa7f7", "#6dc58c", "#e8a34a", "#c58af9", "#f28b82", "#78d9ec"];
const TRIAGE_COLORS: Record<string, Color> = { now: Color.Red, later: Color.Blue, noise: Color.SecondaryText };
const UNDO_KEY: Keyboard.Shortcut = { modifiers: ["cmd", "shift"], key: "t" };
const NEXT_BUCKET: Keyboard.Shortcut = { modifiers: ["cmd", "shift"], key: "]" };
const PREV_BUCKET: Keyboard.Shortcut = { modifiers: ["cmd", "shift"], key: "[" };

const short = (email: string) => email.split("@")[0];
const keyOf = (t: { account: string; id: string }) => `${t.account}:${t.id}`;

function inView(t: Thread, view: View): boolean {
  return view === "inbox" ? t.flags.includes("INBOX") : t.flags.includes(view);
}

type Handler = (ts: Thread[], action: Action, opts?: { silent?: boolean }) => Promise<void>;

/* ------------------------------------------------------------------ shared actions */

/**
 * Fix a misroute for good: add a sender rule to the triage script's shared rules sheet (it reads that sheet on every
 * run, so nothing in the Google project changes), then move these conversations there too.
 */
async function alwaysRoute(ts: Thread[], label: Triage, onAction: Handler) {
  const bySender = new Map(ts.filter((t) => t.origin?.email).map((t) => [t.origin.email.toLowerCase(), t]));
  if (!bySender.size) return;
  const toast = await showToast({ style: Toast.Style.Animated, title: "Saving rule…" });
  try {
    for (const [email, t] of bySender) await api("/api/rule", { account: t.account, match: email, type: "exact", label });
  } catch (e) {
    toast.style = Toast.Style.Failure;
    toast.title = "Couldn't save rule";
    toast.message = (e as Error).message;
    return;
  }
  await onAction(ts, label, { silent: true });
  const first = [...bySender.values()][0];
  toast.style = Toast.Style.Success;
  toast.title = `${bySender.size > 1 ? `${bySender.size} senders` : first.origin.name || first.origin.email} → ${label[0].toUpperCase()}${label.slice(1)} from now on`;
}

/** `t` is the focused conversation; `targets` is what the triage actions change (the selection, or just `t`). */
function ThreadActions({
  t,
  targets,
  onAction,
  onUndo,
  extra,
}: {
  t: Thread;
  targets: Thread[];
  onAction: Handler;
  onUndo: () => void;
  extra?: React.ReactNode;
}) {
  const n = targets.length > 1 ? ` (${targets.length})` : "";
  const anyUnread = targets.some((x) => x.flags.includes("UNREAD"));
  const gmail = `https://mail.google.com/mail/?authuser=${encodeURIComponent(t.account)}#all/${t.id}`;
  const shortcut = (key: Keyboard.KeyEquivalent, mods: Keyboard.KeyModifier[] = ["cmd"]) => ({ modifiers: mods, key });
  return (
    <>
      <ActionPanel.Section>
        <RAction title={`Done${n}`} icon={Icon.CheckCircle} shortcut={shortcut("e")} onAction={() => onAction(targets, "done")} />
        <RAction
          title={`${anyUnread ? "Mark as Read" : "Mark as Unread"}${n}`}
          icon={anyUnread ? Icon.Envelope : Icon.Dot}
          shortcut={shortcut("u", ["cmd", "shift"])}
          onAction={() => onAction(targets, anyUnread ? "read" : "unread")}
        />
        {TRIAGE.filter((x) => !targets.every((y) => y.flags.includes(x))).map((x) => (
          <RAction
            key={x}
            title={`Move to ${x[0].toUpperCase()}${x.slice(1)}${n}`}
            icon={x === "now" ? Icon.Bolt : x === "later" ? Icon.Clock : Icon.BellDisabled}
            shortcut={shortcut(String(TRIAGE.indexOf(x) + 1) as Keyboard.KeyEquivalent, ["cmd", "shift"])}
            onAction={() => onAction(targets, x)}
          />
        ))}
        <RAction title="Undo" icon={Icon.Undo} shortcut={UNDO_KEY} onAction={onUndo} />
        <ActionPanel.Submenu title="Always Route" icon={Icon.Wand} shortcut={shortcut("r", ["cmd", "shift"])}>
          {TRIAGE.map((x) => (
            <RAction
              key={x}
              title={`Always ${x[0].toUpperCase()}${x.slice(1)}`}
              icon={x === "now" ? Icon.Bolt : x === "later" ? Icon.Clock : Icon.BellDisabled}
              onAction={() => alwaysRoute(targets, x, onAction)}
            />
          ))}
        </ActionPanel.Submenu>
      </ActionPanel.Section>
      <ActionPanel.Section>
        <RAction.OpenInBrowser title="Open in Gmail" url={gmail} shortcut={shortcut("o")} />
        <RAction
          title="Open in Mailroom"
          icon={Icon.AppWindow}
          onAction={() => openInMailroom(`#/all/${encodeURIComponent(t.account)}/${t.id}`)}
        />
        <RAction.CopyToClipboard title="Copy Subject" content={t.subject} shortcut={shortcut("c", ["cmd", "shift"])} />
      </ActionPanel.Section>
      {extra}
    </>
  );
}

/* ------------------------------------------------------------------ thread detail */

function ThreadView({
  thread,
  view,
  onAction,
  onUndo,
  onCycle,
}: {
  thread: Thread;
  view: View;
  onAction: Handler;
  onUndo: () => Promise<Change[] | null>;
  onCycle: (dir: 1 | -1) => void;
}) {
  const { pop } = useNavigation();
  const [t, setT] = useState(thread);
  const markedRead = useRef(false);
  // Cached per conversation: shows instantly on reopen, then refreshes in the background. Markdown only (no HTML).
  const { data, isLoading, error } = useCachedPromise(
    async (account: string, id: string) =>
      api<ThreadDetail>(`/api/thread?account=${encodeURIComponent(account)}&id=${encodeURIComponent(id)}&format=md`),
    [thread.account, thread.id],
  );

  useEffect(() => {
    if (!data || markedRead.current || !prefs().markReadOnOpen || !t.flags.includes("UNREAD")) return;
    markedRead.current = true;
    act(t, "read", true);
  }, [data]);

  async function act(target: Thread, action: Action, silent = false) {
    const d = diffFor(action, target);
    await onAction([target], action, { silent });
    const after = d ? applyDiff(target, d) : target;
    setT(after); // keep this screen's actions in sync with the new labels
    if (!silent && !inView(after, view)) pop();
  }

  async function undo() {
    const undone = await onUndo();
    const mine = undone?.find((c) => c.account === t.account && c.id === t.id);
    if (mine) setT((cur) => applyDiff(cur, mine));
  }

  const markdown = useMemo(() => {
    if (error) return `# ${thread.subject}\n\n${error.message}`;
    if (!data) return `# ${thread.subject}\n\nLoading…`;
    // Newest message first, so the latest reply is what you see on open.
    const parts = [...data.messages]
      .reverse()
      .filter((m) => !(m.markdown === null && m.text === null && !m.html))
      .map((m) => {
        const body = m.markdown ?? plainToMarkdown(m.text || "");
        const atts = m.attachments.length
          ? `\n\n📎 ${m.attachments.map((a) => `[${a.name}](${prefs().base}${a.url}&download=1)`).join("  ·  ")}`
          : "";
        return `${messageHeader(m, thread.account)}\n\n${body}${atts}`;
      });
    return `# ${data.subject}\n\n${parts.join("\n\n---\n\n")}`;
  }, [data, error]);
  const { data: withImages } = usePromise(localizeImages, [markdown]);

  const tri = TRIAGE.find((x) => t.flags.includes(x));
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={thread.subject}
      markdown={withImages ?? markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="From" text={thread.origin?.name || thread.origin?.email} />
          <Detail.Metadata.Label title="Account" text={short(thread.account)} />
          {tri && (
            <Detail.Metadata.TagList title="Triage">
              <Detail.Metadata.TagList.Item text={tri} color={TRIAGE_COLORS[tri]} />
            </Detail.Metadata.TagList>
          )}
          <Detail.Metadata.Label title="Messages" text={String(data?.messages.length ?? thread.count)} />
          <Detail.Metadata.Label title="Latest" text={fullDate(thread.date)} />
          {data?.messages.some((m) => m.unsubscribe) && (
            <Detail.Metadata.Link
              title="Unsubscribe"
              target={data.messages.find((m) => m.unsubscribe)!.unsubscribe!}
              text="Unsubscribe link"
            />
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ThreadActions
            t={t}
            targets={[t]}
            onAction={(ts, a) => act(ts[0], a)}
            onUndo={undo}
            extra={
              <ActionPanel.Section title="View">
                <RAction title="Next Bucket" icon={Icon.ChevronDown} shortcut={NEXT_BUCKET} onAction={() => { pop(); onCycle(1); }} />
                <RAction title="Previous Bucket" icon={Icon.ChevronUp} shortcut={PREV_BUCKET} onAction={() => { pop(); onCycle(-1); }} />
              </ActionPanel.Section>
            }
          />
        </ActionPanel>
      }
    />
  );
}

/* ------------------------------------------------------------------ list */

export default function Command() {
  const [view, setView] = useCachedState<View>("view", "now");
  const [account, setAccount] = useCachedState<string>("account", "all");
  const [searchText, setSearchText] = useState(""); // what's in the box
  const [search, setSearch] = useState(""); // what's been searched, 250 ms behind
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchText), 250);
    return () => clearTimeout(h);
  }, [searchText]);

  // Multi-select: `picked` holds conversation keys; Shift+Arrow extends a range from `anchor`.
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<{ key: string; base: Set<string> } | null>(null);
  const shiftTarget = useRef<string | null>(null);

  // Kept in a ref too: the thread screen holds the handlers from when it was pushed.
  const [lastUndo, setLastUndo] = useCachedState<Undo | null>("undo", null);
  const undoRef = useRef<Undo | null>(lastUndo);
  const saveUndo = (u: Undo | null) => {
    undoRef.current = u;
    setLastUndo(u);
  };

  const { data: meta } = useCachedPromise(async () => {
    await ensureServer();
    return api<{ accounts: Account[]; publishUrl?: string | null }>("/api/accounts");
  });
  const accounts = meta?.accounts ?? [];

  const { data: counts, revalidate: refreshCounts } = useCachedPromise(async () => {
    await ensureServer();
    return api<{ accounts: Counts }>("/api/counts");
  });

  const warned = useRef(new Set<string>());
  // Accounts whose Google sign-in expired, from the latest first-page fetch. Shown as rows at the top of the list.
  const [signedOut, setSignedOut] = useState<string[]>([]);
  // Changes made in the last minute, replayed onto list responses: a fetch that started before a change can
  // arrive after it, and would otherwise put an archived row back with its old labels.
  const pending = useRef(new Map<string, Change & { at: number }>());
  const remember = (cs: Change[]) => cs.forEach((c) => pending.current.set(keyOf(c), { ...c, at: Date.now() }));
  const {
    data: threads,
    isLoading,
    pagination,
    mutate,
    revalidate,
  } = useCachedPromise(
    (v: View, acct: string, q: string) =>
      async ({ cursor }: { page: number; cursor?: string }) => {
        await ensureServer();
        const params = new URLSearchParams({ view: q ? "search" : v, account: acct });
        if (q) params.set("q", q);
        if (cursor) params.set("cursor", cursor);
        const r = await api<{ threads: Thread[]; cursor: string | null; errors: { account: string; message: string; reauth: boolean }[] }>(
          `/api/threads?${params}`,
        );
        if (!cursor) setSignedOut((r.errors || []).filter((e) => e.reauth).map((e) => e.account));
        for (const e of r.errors || []) {
          if (e.reauth || warned.current.has(e.account)) continue; // signed-out accounts get a row instead
          warned.current.add(e.account);
          showToast({ style: Toast.Style.Failure, title: `${short(e.account)}: ${e.message}` });
        }
        const now = Date.now();
        const rows = r.threads
          .map((t) => {
            const p = pending.current.get(keyOf(t));
            return p && now - p.at < 60_000 ? applyDiff(t, p) : t;
          })
          .filter((t) => !!q || inView(t, v));
        return { data: rows, hasMore: !!r.cursor, cursor: r.cursor ?? undefined };
      },
    [view, account, search.trim()],
    {
      keepPreviousData: true,
      onError: (e) => {
        showToast({ style: Toast.Style.Failure, title: "Mailroom", message: e.message });
      },
    },
  );

  const clearPicked = () => {
    setPicked(new Set());
    anchor.current = null;
  };
  // A new bucket, account or search starts at the top with nothing selected.
  const lastIndex = useRef(0);
  useEffect(() => {
    clearPicked();
    setSelectedId(undefined);
    lastIndex.current = 0;
  }, [view, account, search]);

  const unreadFor = (v: View) => {
    if (!counts) return 0;
    const emails = account === "all" ? Object.keys(counts.accounts) : [account];
    return emails.reduce((n, e) => n + (counts.accounts[e]?.[v]?.unread ?? 0), 0);
  };

  async function onAction(ts: Thread[], action: Action, { silent = false } = {}) {
    const changes = ts.flatMap((t) => {
      const d = diffFor(action, t);
      return d ? [{ t, d }] : [];
    });
    if (!changes.length) return;
    const n = changes.length;
    const label = `${DONE_TEXT[action]}${n > 1 ? ` (${n})` : ""}`;
    const toast = silent ? null : await showToast({ style: Toast.Style.Animated, title: `${label}…` });
    const byKey = new Map(changes.map((c) => [keyOf(c.t), c]));
    try {
      const { ok, error } = await mutate(
        modifyMany(changes.map(({ t, d }) => ({ account: t.account, id: t.id, ...d }))),
        {
          optimisticUpdate(data) {
            if (!data) return data;
            return data.flatMap((x) => {
              const c = byKey.get(keyOf(x));
              if (!c) return [x];
              const after = applyDiff(x, c.d);
              return search.trim() || inView(after, view) ? [after] : [];
            });
          },
          shouldRevalidateAfter: false,
        },
      );
      remember(ok);
      if (ok.length) saveUndo({ label, items: ok.map(inverse), at: Date.now() });
      if (ts.length > 1) clearPicked();
      if (error) {
        revalidate();
        const failed = `${n - ok.length} of ${n} couldn't be changed`;
        if (toast) {
          toast.style = Toast.Style.Failure;
          toast.title = failed;
          toast.message = error;
        } else {
          showToast({ style: Toast.Style.Failure, title: failed, message: error });
        }
      } else if (toast) {
        toast.style = Toast.Style.Success;
        toast.title = label;
        toast.primaryAction = { title: "Undo", shortcut: UNDO_KEY, onAction: () => void undo() };
      }
      refreshCounts();
    } catch (e) {
      if (toast) {
        toast.style = Toast.Style.Failure;
        toast.title = "Couldn't change that conversation";
        toast.message = (e as Error).message;
      } else {
        showToast({ style: Toast.Style.Failure, title: (e as Error).message });
      }
      revalidate();
    }
  }

  /** Reverse the last change (including a mark-as-read on open). Returns the edits it applied. */
  async function undo(): Promise<Change[] | null> {
    const u = undoRef.current;
    if (!u || !u.at || Date.now() - u.at > UNDO_WINDOW) {
      await showToast({ style: Toast.Style.Failure, title: "Nothing to undo" });
      return null;
    }
    saveUndo(null);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Undoing…" });
    try {
      const { ok, error } = await modifyMany(u.items);
      remember(ok);
      toast.style = error ? Toast.Style.Failure : Toast.Style.Success;
      toast.title = error ? `Undo failed for ${u.items.length - ok.length}` : `Undid ${u.label.toLowerCase()}`;
      if (error) toast.message = error;
      return ok;
    } catch (e) {
      saveUndo(u);
      toast.style = Toast.Style.Failure;
      toast.title = "Couldn't undo";
      toast.message = (e as Error).message;
      return null;
    } finally {
      revalidate();
      refreshCounts();
    }
  }

  function extend(dir: 1 | -1) {
    const keys = (threads ?? []).map(keyOf);
    if (!keys.length) return;
    const base = anchor.current?.base ?? picked;
    const r = extendRange(keys, selectedId, anchor.current?.key ?? null, base, dir);
    anchor.current = { key: r.anchor, base };
    shiftTarget.current = r.target;
    setPicked(r.picked);
    setSelectedId(r.target);
    if (dir === 1 && keys.indexOf(r.target) >= keys.length - 2 && pagination?.hasMore) pagination.onLoadMore();
  }

  const accountOrder = ["all", ...accounts.map((a) => a.email)];
  const cycle = (dir: number) => {
    const i = Math.max(0, accountOrder.indexOf(account));
    setAccount(accountOrder[(i + dir + accountOrder.length) % accountOrder.length]);
  };
  // Reads the ref, not the render's value, so quick repeated presses keep stepping instead of repeating one step.
  const viewRef = useRef(view);
  viewRef.current = view;
  const cycleView = (dir: number) => {
    const i = Math.max(0, VIEWS.findIndex((v) => v.id === viewRef.current));
    const next = VIEWS[(i + dir + VIEWS.length) % VIEWS.length].id;
    viewRef.current = next;
    setView(next);
    if (searchText) setSearchText(""); // searching ignores buckets, so switching bucket leaves the search
  };
  const colorFor = (email: string) =>
    ACCOUNT_COLORS[(accounts.find((a) => a.email === email)?.color ?? accounts.findIndex((a) => a.email === email)) % 6] ||
    ACCOUNT_COLORS[0];

  const viewTitle = VIEWS.find((v) => v.id === view)?.title ?? "Now";
  const scope = account === "all" ? "All accounts" : short(account);
  const pickedThreads = (threads ?? []).filter((t) => picked.has(keyOf(t)));
  const signInIds = signedOut.map((e) => `signin:${e}`);
  const keys = [...signInIds, ...(threads ?? []).map(keyOf)];
  const selIndex = selectedId ? keys.indexOf(selectedId) : -1;
  if (selIndex >= 0) lastIndex.current = selIndex;
  const selectedItem = selIndex >= 0 ? selectedId : keys[Math.min(lastIndex.current, keys.length - 1)];
  // Sign-in happens in the normal browser, where Google is already signed in; Mailroom's callback finishes it.
  const reconnect = (email: string) => open(`${prefs().base}/auth/start?hint=${encodeURIComponent(email)}&return=inbox`);
  const undoSection = (
    <ActionPanel.Section>
      <RAction title="Undo" icon={Icon.Undo} shortcut={UNDO_KEY} onAction={() => void undo()} />
    </ActionPanel.Section>
  );

  const selectActions = (
    <ActionPanel.Section title="Select">
      <RAction title="Select Down" icon={Icon.ArrowDown} shortcut={{ modifiers: ["shift"], key: "arrowDown" }} onAction={() => extend(1)} />
      <RAction title="Select Up" icon={Icon.ArrowUp} shortcut={{ modifiers: ["shift"], key: "arrowUp" }} onAction={() => extend(-1)} />
      {picked.size > 0 && (
        <RAction title="Clear Selection" icon={Icon.XMarkCircle} shortcut={{ modifiers: ["cmd", "shift"], key: "x" }} onAction={clearPicked} />
      )}
    </ActionPanel.Section>
  );

  const listActions = (
    <ActionPanel.Section title="View">
      <RAction title="Next Bucket" icon={Icon.ChevronDown} shortcut={NEXT_BUCKET} onAction={() => cycleView(1)} />
      <RAction title="Previous Bucket" icon={Icon.ChevronUp} shortcut={PREV_BUCKET} onAction={() => cycleView(-1)} />
      <RAction title="Refresh" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={() => { revalidate(); refreshCounts(); }} />
      <RAction title="Next Account" icon={Icon.ArrowRight} shortcut={{ modifiers: ["cmd", "opt"], key: "arrowRight" }} onAction={() => cycle(1)} />
      <RAction title="Previous Account" icon={Icon.ArrowLeft} shortcut={{ modifiers: ["cmd", "opt"], key: "arrowLeft" }} onAction={() => cycle(-1)} />
      <ActionPanel.Submenu title="Show Account" icon={Icon.PersonCircle}>
        {accountOrder.map((e) => (
          <RAction
            key={e}
            title={e === "all" ? "All Accounts" : short(e)}
            icon={e === account ? Icon.CheckCircle : e === "all" ? Icon.TwoPeople : { source: Icon.CircleFilled, tintColor: colorFor(e) }}
            onAction={() => setAccount(e)}
          />
        ))}
      </ActionPanel.Submenu>
      <RAction title="Open Mailroom" icon={Icon.AppWindow} onAction={() => openInMailroom(`#/${view}`)} />
    </ActionPanel.Section>
  );

  const signInRows = signedOut.map((email) => (
    <List.Item
      key={`signin:${email}`}
      id={`signin:${email}`}
      icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }}
      title={`${short(email)} signed out`}
      accessories={[{ text: "Reconnect" }]}
      actions={
        <ActionPanel>
          <RAction title="Reconnect" icon={Icon.Key} onAction={() => reconnect(email)} />
          {signedOut.length > 1 && meta?.publishUrl && (
            <RAction.OpenInBrowser title="Publish Google App" icon={Icon.Globe} url={meta.publishUrl} />
          )}
          {listActions}
          {undoSection}
        </ActionPanel>
      }
    />
  ));

  return (
    <List
      isLoading={isLoading}
      pagination={pagination}
      filtering={false}
      selectedItemId={selectedItem}
      // List-level actions: shortcuts keep working with no row selected (empty bucket, still loading)
      actions={
        <ActionPanel>
          {listActions}
          {undoSection}
        </ActionPanel>
      }
      onSelectionChange={(id) => {
        setSelectedId(id ?? undefined);
        if (id !== shiftTarget.current) anchor.current = null; // plain arrows end the range but keep the selection
      }}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={`Search name, email, topic, or date · ${scope}`}
      navigationTitle={`${picked.size ? `${picked.size} selected · ` : ""}${search.trim() ? "Search" : viewTitle} · ${scope}`}
      searchBarAccessory={
        <List.Dropdown tooltip="Bucket" value={view} onChange={(v) => setView(v as View)}>
          {VIEWS.map((v) => {
            const n = unreadFor(v.id);
            return <List.Dropdown.Item key={v.id} value={v.id} title={n ? `${v.title}  ${n}` : v.title} icon={v.icon} />;
          })}
        </List.Dropdown>
      }
    >
      {signInRows}
      {(threads?.length ?? 0) === 0 && !signedOut.length ? (
        <List.EmptyView
          icon={search.trim() ? Icon.MagnifyingGlass : Icon.CheckCircle}
          title={isLoading ? "Loading…" : search.trim() ? "No results" : `Nothing in ${viewTitle}`}
          description={scope}
          actions={
            <ActionPanel>
              {listActions}
              {undoSection}
            </ActionPanel>
          }
        />
      ) : (
        (threads ?? []).map((t) => {
          const k = keyOf(t);
          const unread = t.flags.includes("UNREAD");
          const isPicked = picked.has(k);
          const tri = TRIAGE.find((x) => t.flags.includes(x));
          const accessories: List.Item.Accessory[] = [];
          if (tri && (search.trim() || view === "inbox") && tri !== view) accessories.push({ tag: { value: tri, color: TRIAGE_COLORS[tri] } });
          if (t.flags.includes("STARRED")) accessories.push({ icon: { source: Icon.Star, tintColor: Color.Yellow } });
          if (t.attachment) accessories.push({ icon: Icon.Paperclip, tooltip: "Attachment" });
          if (account === "all") accessories.push({ tag: { value: short(t.account), color: colorFor(t.account) } });
          accessories.push({ text: { value: shortDate(t.date), color: unread ? Color.PrimaryText : Color.SecondaryText }, tooltip: fullDate(t.date) });
          // Blue dot = unread, nothing = read (blank keeps titles aligned), check = selected.
          const icon: Image.ImageLike = isPicked
            ? { source: Icon.CheckCircle, tintColor: unread ? Color.Blue : Color.SecondaryText }
            : unread
              ? { source: Icon.CircleFilled, tintColor: Color.Blue }
              : "blank.png";
          // With a selection, triage actions apply to all of it; otherwise to this row.
          const targets = picked.size ? pickedThreads : [t];
          return (
            <List.Item
              key={k}
              id={k}
              icon={{ value: icon, tooltip: `${isPicked ? "Selected · " : ""}${unread ? "Unread" : "Read"}` }}
              title={t.subject}
              subtitle={`${senders(t)}${t.count > 1 ? ` (${t.count})` : ""}`}
              accessories={accessories}
              keywords={[t.snippet]}
              actions={
                <ActionPanel>
                  <RAction.Push
                    title="Read"
                    icon={Icon.Eye}
                    target={<ThreadView thread={t} view={view} onAction={onAction} onUndo={undo} onCycle={cycleView} />}
                  />
                  <ThreadActions
                    t={t}
                    targets={targets}
                    onAction={onAction}
                    onUndo={() => void undo()}
                    extra={
                      <>
                        {selectActions}
                        {listActions}
                      </>
                    }
                  />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
