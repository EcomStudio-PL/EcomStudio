import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { dispatchToken } from "@/lib/server/server-token";
import { isAcceptableSourceUrl } from "@/lib/grovnews-research";
import { TYPE_PREFERENCE, type ImportableType, type ProbeOption, type ProbeSummary } from "@/lib/grovnews-import";
import { SafeFetchError, robotsAllows, safeFetch, type FetchedDocument, type FetchOptions } from "./fetch";
import { discoverFeeds, extractListing, pageSignals, parseFeed, type ParsedFeed } from "./feed";

/**
 * TESTING A SOURCE — what a URL really is, and whether GrovNews may read it.
 *
 * Used by the import preview (before anything is saved), by "Testuj" on one
 * source and by "Sprawdź wszystkie źródła". It reads through the same guarded
 * fetcher as the daily job — https only, every redirect re-checked, every
 * resolved address public, capped and timed — and it asks robots.txt BEFORE
 * it reads anything else from the site.
 *
 * WHAT IT NEVER DOES: log in, send a cookie, solve a challenge, retry around a
 * 401/403/429, or guess its way through a site. A site that wants a login, a
 * payment, a human or a different robot is UNSUPPORTED and stays that way
 * until a person decides. The only addresses it tries besides the given one
 * are the feeds the page itself announces (`<link rel="alternate">`) and, for
 * a WordPress site, the `/feed/` address WordPress always publishes.
 *
 * WHAT IT RETURNS is a verdict, the address the URL ends at, the type it
 * really serves, and every (url, type) it verified — each SIGNED with a key
 * derived from the server's own token, so the import can refuse any row the
 * server did not read itself.
 */

export type Fetcher = (url: string, opts: FetchOptions) => Promise<FetchedDocument>;

export type ProbeDeps = {
  fetch?: Fetcher;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Absolute time (ms) after which no new request is started. */
  deadline?: number;
};

const ACCEPT_ANY = "application/rss+xml, application/atom+xml;q=0.95, application/feed+json;q=0.9, application/xml;q=0.8, text/xml;q=0.8, text/html;q=0.7, */*;q=0.1";
const ACCEPT_FEED = "application/rss+xml, application/atom+xml, application/feed+json;q=0.9, application/xml;q=0.8, text/xml;q=0.8, */*;q=0.1";

const KIND_TYPE: Record<ParsedFeed["kind"], ImportableType | null> = {
  rss: "RSS", rdf: "RSS", atom: "ATOM", json: "PUBLIC_FEED", page: null, api: null,
};

/** Answers that mean "not for you" — never worked around. */
const ACCESS_STATUSES = new Set([401, 402, 403, 407, 451]);
/** Answers worth one more try, a little later. */
const TRANSIENT = new Set(["timeout", "network"]);

/** A fetch failure as the code the health rule (0125 §2.1) understands. */
export function failureCode(e: unknown): string {
  if (e instanceof SafeFetchError) return e.status ? `${e.code}_${e.status}` : e.code;
  return "network";
}

/** Worth one more try right away: a timeout, a dropped connection, a 5xx.
 *  A 429 is not — the site asked us to wait (RETRY on a later pass). */
function isTransient(e: unknown): boolean {
  if (!(e instanceof SafeFetchError)) return true;
  if (TRANSIENT.has(e.code)) return true;
  return e.code === "http_status" && (e.status ?? 0) >= 500;
}

function verdictOf(e: unknown): ProbeSummary["verdict"] {
  if (e instanceof SafeFetchError && e.code === "http_status" && ACCESS_STATUSES.has(e.status ?? 0)) return "UNSUPPORTED";
  if (e instanceof SafeFetchError && e.code === "robots") return "UNSUPPORTED";
  if (e instanceof SafeFetchError && (e.code === "robots_unreachable" || (e.code === "http_status" && e.status === 429))) return "RETRY";
  return isTransient(e) ? "RETRY" : "FAILED";
}

/* ── signatures ────────────────────────────────────────────────────────────── */

function signingKey(): Buffer | null {
  const token = dispatchToken();
  return token ? createHash("sha256").update(`grovnews-probe:${token}`).digest() : null;
}

/** An unambiguous encoding: no field can pass for another. */
const payload = (o: Omit<ProbeOption, "sig">) => JSON.stringify(["grovnews-probe-option", o.type, o.url, o.entries, o.checkedAt]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A verified option, signed; unsigned ("") when this deployment has no
 *  server key — the import then refuses it. */
export function signOption(o: Omit<ProbeOption, "sig">): ProbeOption {
  const key = signingKey();
  return { ...o, sig: key ? createHmac("sha256", key).update(payload(o)).digest("hex") : "" };
}

/** Valid only if the server signed exactly this and it is recent. */
export function verifyOption(o: ProbeOption, now: number = Date.now(), maxAgeMs = 6 * 3600_000): boolean {
  const key = signingKey();
  if (!key || typeof o?.sig !== "string" || !/^[0-9a-f]{64}$/.test(o.sig)) return false;
  if (typeof o.checkedAt !== "string" || !ISO_INSTANT.test(o.checkedAt)) return false;
  const at = Date.parse(o.checkedAt);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > maxAgeMs) return false;
  if (!Number.isInteger(o.entries) || o.entries < 1 || o.entries > 100_000) return false;
  const expected = createHmac("sha256", key).update(payload(o)).digest();
  const given = Buffer.from(o.sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* ── one probe ─────────────────────────────────────────────────────────────── */

type Ctx = { fetch: Fetcher; now: () => number; sleep: (ms: number) => Promise<void>; deadline: number };

async function fetchOnce(ctx: Ctx, url: string, opts: FetchOptions): Promise<FetchedDocument> {
  try {
    return await ctx.fetch(url, opts);
  } catch (e) {
    // One more try for a timeout, a dropped connection, a 5xx or a 429 —
    // after a pause, and only if there is time. Never for a refusal.
    if (!isTransient(e) || ctx.now() + 1_500 + (opts.timeoutMs ?? 12_000) > ctx.deadline) throw e;
    await ctx.sleep(1_500);
    return ctx.fetch(url, opts);
  }
}

type Robots = { body: string | null } | { error: unknown };

async function robotsFor(ctx: Ctx, origin: string): Promise<Robots> {
  try {
    const doc = await fetchOnce(ctx, `${origin}/robots.txt`, { accept: "text/plain", maxBytes: 256_000, timeoutMs: 6_000 });
    return { body: doc.body };
  } catch (e) {
    // No robots.txt (4xx) allows everything; a refusal (429) or anything else
    // is "we cannot know" — and when in doubt, the answer is no.
    if (e instanceof SafeFetchError && e.code === "http_status" && (e.status ?? 0) >= 400 && (e.status ?? 0) < 500 && e.status !== 429) {
      return { body: null };
    }
    return { error: e };
  }
}

/** The newest dated entry of a read (ISO), or null. */
export function newestEntryAt(entries: readonly { publishedAt: string | null }[]): string | null {
  let best = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    const t = e.publishedAt ? Date.parse(e.publishedAt) : Number.NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

const allowedBy = (robots: string | null, url: URL) => robots === null || robotsAllows(robots, `${url.pathname}${url.search}`);

function base(checkedAt: string, patch: Partial<ProbeSummary>): ProbeSummary {
  return {
    verdict: "FAILED", code: null, httpStatus: null, resolvedUrl: null, detectedType: null, feedUrl: null,
    options: [], recommended: null, sample: [], checkedAt, ...patch,
  };
}

function rank(options: ProbeOption[], originalUrl: string): ProbeOption[] {
  return [...options].sort((a, b) =>
    TYPE_PREFERENCE.indexOf(a.type) - TYPE_PREFERENCE.indexOf(b.type)
    || Number(b.url === originalUrl) - Number(a.url === originalUrl));
}

/**
 * Read one URL and say what it is. Never throws: every outcome, including a
 * refusal by the SSRF guard, is a verdict.
 */
export async function probeSource(rawUrl: string, deps: ProbeDeps = {}): Promise<ProbeSummary> {
  const ctx: Ctx = {
    fetch: deps.fetch ?? safeFetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    deadline: deps.deadline ?? Number.POSITIVE_INFINITY,
  };
  const checkedAt = new Date(ctx.now()).toISOString();
  const url = String(rawUrl ?? "").trim();
  if (!isAcceptableSourceUrl(url)) {
    let valid = true;
    try { new URL(url); } catch { valid = false; }
    return base(checkedAt, { verdict: "FAILED", code: valid ? "forbidden_host" : "invalid_url" });
  }
  const target = new URL(url);

  // 1. robots.txt first — before a single byte of the page is read.
  const robots = await robotsFor(ctx, target.origin);
  if ("error" in robots) {
    const v = verdictOf(robots.error);
    return base(checkedAt, { verdict: v === "RETRY" ? "RETRY" : "FAILED", code: v === "RETRY" ? "robots_unreachable" : failureCode(robots.error) });
  }
  // Each address is judged once per probe (a hostile robots.txt costs CPU
  // per check, and retries and candidates revisit the same addresses).
  const judged = new Map<string, boolean>();
  const allowed = (body: string | null, u: URL): boolean => {
    const key = `${u.origin}${u.pathname}${u.search}`;
    let ok = judged.get(key);
    if (ok === undefined) { ok = allowedBy(body, u); judged.set(key, ok); }
    return ok;
  };
  if (!allowed(robots.body, target)) return base(checkedAt, { verdict: "UNSUPPORTED", code: "robots" });
  // Every address read after this — a redirect's included — is asked against
  // its own site's robots.txt (each read once).
  const robotsByOrigin = new Map<string, Robots>([[target.origin, robots]]);
  const gate = async (u: URL) => {
    let r = robotsByOrigin.get(u.origin);
    if (!r) { r = await robotsFor(ctx, u.origin); robotsByOrigin.set(u.origin, r); }
    if ("error" in r) throw new SafeFetchError("robots_unreachable");
    if (!allowed(r.body, u)) throw new SafeFetchError("robots");
  };

  // 2. The URL itself.
  let doc: FetchedDocument;
  try {
    doc = await fetchOnce(ctx, url, { accept: ACCEPT_ANY, maxBytes: 2_000_000, timeoutMs: 12_000, beforeHop: gate });
  } catch (e) {
    return base(checkedAt, {
      verdict: verdictOf(e), code: failureCode(e),
      httpStatus: e instanceof SafeFetchError && e.status ? e.status : null,
    });
  }
  const resolvedUrl = doc.url.startsWith("https://") ? doc.url : null;
  const urls = resolvedUrl && resolvedUrl !== url ? [url, resolvedUrl] : [url];
  const now = ctx.now();

  // 3a. It is a feed.
  const feed = parseFeed(doc.body, doc.url, now);
  if (feed) {
    const detected = KIND_TYPE[feed.kind];
    const entries = feed.entries.length;
    const sample = feed.entries.slice(0, 5).map((e) => e.title);
    if (!detected || entries === 0) {
      return base(checkedAt, { verdict: "EMPTY", code: "empty", httpStatus: doc.status, resolvedUrl, detectedType: detected, sample });
    }
    // Any feed type reads any feed format (the parser detects it); the
    // precise one is recommended.
    const types: ImportableType[] = [detected, ...(["RSS", "ATOM", "PUBLIC_FEED"] as const).filter((t) => t !== detected)];
    const options = rank(urls.flatMap((u) => types.map((type) => signOption({ type, url: u, entries, checkedAt }))), url);
    return base(checkedAt, {
      verdict: "OK", httpStatus: doc.status, resolvedUrl, detectedType: detected, feedUrl: null, options,
      recommended: { type: detected, url }, sample, lastItemAt: newestEntryAt(feed.entries),
    });
  }

  // 3b. It is a page. Robots allowed it (step 1).
  const listing = extractListing(doc.body, doc.url);
  const signals = pageSignals(doc.body);
  const options: ProbeOption[] = [];
  if (listing.entries.length > 0) {
    for (const u of urls) options.push(signOption({ type: "WEB_PAGE", url: u, entries: listing.entries.length, checkedAt }));
  }

  // 4. A feed the page announces — or, for WordPress, the /feed/ it always
  //    has. At most two candidates; each is checked against robots too.
  const announced = discoverFeeds(doc.body, doc.url).map((f) => f.url);
  const candidates = announced.length > 0 ? announced.slice(0, 2)
    : signals.wordpress ? [new URL("feed/", doc.url.endsWith("/") ? doc.url : `${doc.url}/`).toString()] : [];
  let feedUrl: string | null = null;
  let feedSample: string[] = [];
  let feedNewest: string | null = null;
  for (const candidate of candidates) {
    if (feedUrl || ctx.now() + 12_000 > ctx.deadline || !isAcceptableSourceUrl(candidate)) continue;
    try {
      await gate(new URL(candidate));
    } catch {
      continue;
    }
    try {
      const fdoc = await fetchOnce(ctx, candidate, { accept: ACCEPT_FEED, maxBytes: 2_000_000, timeoutMs: 10_000, beforeHop: gate });
      const parsed = parseFeed(fdoc.body, fdoc.url, ctx.now());
      const type = parsed ? KIND_TYPE[parsed.kind] : null;
      if (parsed && type && parsed.entries.length > 0) {
        feedUrl = candidate;
        feedSample = parsed.entries.slice(0, 5).map((e) => e.title);
        feedNewest = newestEntryAt(parsed.entries);
        options.push(signOption({ type, url: candidate, entries: parsed.entries.length, checkedAt }));
        if (type !== "PUBLIC_FEED") options.push(signOption({ type: "PUBLIC_FEED", url: candidate, entries: parsed.entries.length, checkedAt }));
      }
    } catch {
      // An announced feed that does not answer is simply not offered.
    }
  }

  const ranked = rank(options, url);
  if (ranked.length === 0) {
    // Nothing readable. A challenge or a login form where the content should
    // be is a door we do not open; otherwise the page is just empty to us.
    const code = signals.botProtection ? "bot_protection" : signals.loginWall ? "requires_access" : "empty";
    return base(checkedAt, {
      verdict: code === "empty" ? "EMPTY" : "UNSUPPORTED", code, httpStatus: doc.status, resolvedUrl, detectedType: "WEB_PAGE",
    });
  }
  return base(checkedAt, {
    verdict: "OK", httpStatus: doc.status, resolvedUrl, detectedType: "WEB_PAGE", feedUrl, options: ranked,
    recommended: { type: ranked[0].type, url: ranked[0].url },
    sample: feedSample.length ? feedSample : listing.entries.slice(0, 5).map((e) => e.title),
    lastItemAt: feedNewest,
  });
}

/* ── many probes ───────────────────────────────────────────────────────────── */

/**
 * Probe a list politely: at most `concurrency` at once, never two at the same
 * host at the same time, and no new probe once the deadline is near. What was
 * not reached is returned as `pending` for the next call — a list of eighty
 * sources is never eighty simultaneous requests, and never one request that
 * outlives its function.
 */
export async function probeMany<T extends { key: string; url: string }>(
  items: readonly T[], opts: { concurrency?: number; deadline: number; perProbeMs?: number } & ProbeDeps,
): Promise<{ results: Map<string, ProbeSummary>; pending: string[] }> {
  const now = opts.now ?? Date.now;
  const perProbe = opts.perProbeMs ?? 45_000;
  const results = new Map<string, ProbeSummary>();
  const queue = [...items];
  const busyHosts = new Set<string>();
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

  const worker = async () => {
    for (;;) {
      if (now() + perProbe > opts.deadline) return;
      const i = queue.findIndex((it) => !busyHosts.has(hostOf(it.url)));
      if (i < 0) {
        if (queue.length === 0 || busyHosts.size === 0) return;
        await (opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(200);
        continue;
      }
      const [item] = queue.splice(i, 1);
      const host = hostOf(item.url);
      busyHosts.add(host);
      try {
        results.set(item.key, await probeSource(item.url, { ...opts, deadline: now() + perProbe }));
      } finally {
        busyHosts.delete(host);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, 6, items.length)) }, worker));
  return { results, pending: queue.map((it) => it.key) };
}

/* ── a saved source's health, from a probe ─────────────────────────────────── */

/**
 * What a probe means for a SAVED source (its own url and type), in the shape
 * `grovnews_source_checked` records. A feed type reads any feed; a page is
 * read as a page. A URL that works only as something else is a failure of
 * THIS configuration (`unrecognized_format`) — the screen offers the better
 * type, the admin changes it.
 */
export function healthFromProbe(probe: ProbeSummary, source: { url: string; type: string }): {
  ok: boolean; error: string | null; http: number | null; detected_type: string | null; resolved_url: string | null; entries: number | null;
} {
  const common = { http: probe.httpStatus, detected_type: probe.detectedType, resolved_url: probe.resolvedUrl };
  if (probe.verdict === "OK") {
    const match = probe.options.find((o) => o.type === source.type && o.url === source.url);
    return match ? { ok: true, error: null, ...common, entries: match.entries }
      : { ok: false, error: "unrecognized_format", ...common, entries: null };
  }
  if (probe.verdict === "EMPTY") return { ok: true, error: null, ...common, entries: 0 };
  return { ok: false, error: probe.code ?? "error", ...common, entries: null };
}
