import "server-only";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import { isAcceptableSourceUrl } from "@/lib/grovnews-research";

/**
 * THE ONLY WAY GROVNEWS READS THE INTERNET.
 *
 * An admin types a URL and the server downloads it every morning: that is a
 * request forgery waiting to happen unless the server refuses to be pointed
 * inward. This module is that refusal, applied where it cannot be dodged:
 *
 *   · https only, port 443, no credentials, no IP literals, no .local names
 *     (checked when the source is saved AND here);
 *   · EVERY address a name resolves to must be public — checked inside the
 *     socket's own `lookup`, i.e. at CONNECT time, so a name that resolves to
 *     a public address for the check and a private one for the connection
 *     (DNS rebinding) cannot slip between the two;
 *   · redirects are followed by hand, at most three, and each hop is checked
 *     from scratch;
 *   · one deadline for the whole exchange, and a byte cap enforced on the
 *     DECOMPRESSED stream, so neither a slow server nor a gzip bomb can hold
 *     the job.
 *
 * It never sends a cookie, never an Authorization header, and identifies
 * itself honestly. It does not solve CAPTCHAs, log in, or retry around a
 * refusal: a 401/403/429 is an answer, not an obstacle.
 */

export const USER_AGENT = "GrovBaseNewsBot/1.0 (+https://grovbase.com)";

export type FetchErrorCode =
  | "invalid_url" | "forbidden_host" | "private_address" | "dns" | "timeout" | "too_large"
  | "http_status" | "too_many_redirects" | "network" | "robots";

export class SafeFetchError extends Error {
  constructor(public readonly code: FetchErrorCode, public readonly status?: number) {
    super(status ? `${code}:${status}` : code);
    this.name = "SafeFetchError";
  }
}

export type FetchedDocument = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

export type FetchOptions = {
  accept: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

/* ── which addresses are the public internet ───────────────────────────────── */

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: readonly [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function publicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address into its eight 16-bit groups. */
function v6Groups(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0];
  // A trailing dotted quad (::ffff:1.2.3.4) becomes two groups.
  const quad = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (quad) {
    if (isIP(quad[1]) !== 4) return null;
    const n = v4ToInt(quad[1]);
    addr = addr.slice(0, -quad[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function publicV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  const embeddedV4 = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  if (g.every((x) => x === 0)) return false;                                   // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false;         // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return publicV4(embeddedV4(g[6], g[7])); // ::ffff:v4
  if (g.slice(0, 6).every((x) => x === 0)) return false;                       // ::v4 (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return publicV4(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return publicV4(embeddedV4(g[1], g[2]));               // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return false;                                 // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false;                                 // fe80::/10 link local
  if ((g[0] & 0xffc0) === 0xfec0) return false;                                 // fec0::/10 site local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false;                                 // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;                         // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false;  // discard-only
  return true;
}

/** Is this address on the public internet? Anything unparseable is not. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return publicV4(ip);
  if (family === 6) return publicV6(ip);
  return false;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type Resolver = (hostname: string, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const systemResolver: Resolver = (hostname, cb) => dnsLookup(hostname, { all: true, verbatim: true }, cb);

/**
 * A `lookup` for the socket that refuses a name if ANY of its addresses is not
 * public — not just the one it would pick. A name with one public and one
 * private A record is somebody's rebinding setup, not a CDN.
 */
export function guardedLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    resolve(hostname, (err, addresses) => {
      if (err || !addresses?.length) {
        callback(Object.assign(new Error("dns"), { code: "GROVNEWS_DNS" }), "", 0);
        return;
      }
      if (!addresses.every((a) => isPublicAddress(a.address))) {
        callback(Object.assign(new Error("private_address"), { code: "GROVNEWS_PRIVATE" }), "", 0);
        return;
      }
      if (typeof options === "object" && options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/* ── the transport ─────────────────────────────────────────────────────────── */

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: Readable };
export type Transport = (url: URL, headers: Record<string, string>, signal: AbortSignal) => Promise<RawResponse>;

const httpsTransport: Transport = (url, headers, signal) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, {
    method: "GET", headers, signal, lookup: guardedLookup() as never, agent: false,
  }, (res: IncomingMessage) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }));
  req.on("error", reject);
  req.end();
});

function classify(e: unknown, signal: AbortSignal): SafeFetchError {
  if (e instanceof SafeFetchError) return e;
  if (signal.aborted) return new SafeFetchError("timeout");
  const code = (e as { code?: string })?.code;
  if (code === "GROVNEWS_PRIVATE") return new SafeFetchError("private_address");
  if (code === "GROVNEWS_DNS" || code === "ENOTFOUND" || code === "EAI_AGAIN") return new SafeFetchError("dns");
  return new SafeFetchError("network");
}

function header(h: RawResponse["headers"], name: string): string {
  const v = h[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Read at most `max` DECOMPRESSED bytes; more is an error, not a truncation. */
async function readCapped(res: RawResponse, max: number): Promise<Buffer> {
  const declared = Number(header(res.headers, "content-length"));
  if (Number.isFinite(declared) && declared > max) {
    res.body.destroy();
    throw new SafeFetchError("too_large");
  }
  const encoding = header(res.headers, "content-encoding").toLowerCase().trim();
  const stream: Readable = encoding === "gzip" || encoding === "x-gzip" ? res.body.pipe(createGunzip())
    : encoding === "deflate" ? res.body.pipe(createInflate())
    : encoding === "br" ? res.body.pipe(createBrotliDecompress())
    : res.body;
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buf.length;
      if (total > max) throw new SafeFetchError("too_large");
      chunks.push(buf);
    }
  } finally {
    res.body.destroy();
    if (stream !== res.body) stream.destroy();
  }
  return Buffer.concat(chunks);
}

/** Bytes → text in the charset the server (or the XML prolog) declares;
 *  UTF-8 when nothing is declared or the label is unknown. */
export function decodeBody(bytes: Buffer, contentType: string): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  const head = bytes.subarray(0, 512).toString("latin1");
  const fromProlog = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1]
    ?? /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromProlog, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label.toLowerCase(), { fatal: false }).decode(bytes).replace(/^﻿/, "");
    } catch {
      // Unknown label — try the next one.
    }
  }
  return bytes.toString("utf8");
}

/** The fetch itself, with the transport injectable so the redirect, cap and
 *  error handling can be tested without a network. Production code calls
 *  `safeFetch`, which always uses the guarded HTTPS transport. */
export async function fetchWith(transport: Transport, rawUrl: string, opts: FetchOptions): Promise<FetchedDocument> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 12_000);
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isAcceptableSourceUrl(current)) {
      let valid = true;
      try { new URL(current); } catch { valid = false; }
      throw new SafeFetchError(valid ? "forbidden_host" : "invalid_url");
    }
    const url = new URL(current);
    let res: RawResponse;
    try {
      res = await transport(url, {
        "user-agent": USER_AGENT,
        accept: opts.accept,
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "pl,en;q=0.8,de;q=0.6",
      }, signal);
    } catch (e) {
      throw classify(e, signal);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = header(res.headers, "location");
      res.body.destroy();
      if (!location) throw new SafeFetchError("http_status", res.status);
      current = new URL(location, url).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      res.body.destroy();
      throw new SafeFetchError("http_status", res.status);
    }

    const contentType = header(res.headers, "content-type");
    let bytes: Buffer;
    try {
      bytes = await readCapped(res, maxBytes);
    } catch (e) {
      throw classify(e, signal);
    }
    return { url: url.toString(), status: res.status, contentType, body: decodeBody(bytes, contentType) };
  }
  throw new SafeFetchError("too_many_redirects");
}

export function safeFetch(url: string, opts: FetchOptions): Promise<FetchedDocument> {
  return fetchWith(httpsTransport, url, opts);
}

/* ── robots.txt — for WEB_PAGE sources only ────────────────────────────────── */

/**
 * May our user agent fetch `path`? The longest matching rule wins (RFC 9309),
 * Allow beats Disallow on a tie, `*` and `$` are honoured, and our own
 * user-agent group beats the `*` group.
 */
export function robotsAllows(robots: string, path: string, agent = "grovbasenewsbot"): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);

  let best: { allow: boolean; length: number } | null = null;
  // A hostile robots.txt is untrusted input: bounded rule count and length,
  // and a LINEAR matcher — a `*`-heavy rule turned into a RegExp backtracks
  // exponentially and would hold the daily job past its deadline.
  const target = path.slice(0, 1000);
  for (const rule of rules.slice(0, 200)) {
    if (rule.pattern.length > 500) continue;
    if (!globMatches(rule.pattern, target)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best ? best.allow : true;
}

/**
 * robots.txt pattern match: `*` is any run of characters, a trailing `$`
 * anchors the end, anything else matches literally as a PREFIX of the path.
 * Greedy two-pointer matching with a single backtrack point — linear-ish in
 * the path length whatever the pattern, never exponential.
 */
export function globMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const pat = (anchored ? pattern.slice(0, -1) : pattern).replace(/\*+/g, "*");
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < path.length) {
    if (p < pat.length && pat[p] === "*") {
      star = p++;
      mark = s;
    } else if (p < pat.length && pat[p] === path[s]) {
      p++;
      s++;
    } else if (p >= pat.length && !anchored) {
      return true; // the whole pattern matched a prefix
    } else if (star >= 0) {
      p = star + 1;
      s = ++mark;
    } else {
      return false;
    }
  }
  while (p < pat.length && pat[p] === "*") p++;
  return p >= pat.length;
}

/** Fetch a page only if the site's robots.txt allows it. A missing robots.txt
 *  (4xx) allows; an unreachable one (5xx, network) does not — when in doubt,
 *  the answer is no. */
export async function fetchPageRespectingRobots(url: string, opts: FetchOptions): Promise<FetchedDocument> {
  const target = new URL(url);
  let allowed = true;
  try {
    const robots = await safeFetch(`${target.origin}/robots.txt`, { accept: "text/plain", maxBytes: 256_000, timeoutMs: 6_000 });
    allowed = robotsAllows(robots.body, `${target.pathname}${target.search}`);
  } catch (e) {
    const status = e instanceof SafeFetchError ? e.status : undefined;
    allowed = typeof status === "number" && status >= 400 && status < 500;
  }
  if (!allowed) throw new SafeFetchError("robots");
  return safeFetch(url, opts);
}
