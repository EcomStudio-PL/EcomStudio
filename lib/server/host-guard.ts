import "server-only";
import { lookup } from "node:dns/promises";

/**
 * DOES THIS HOST RESOLVE SOMEWHERE A PROVIDER KEY MUST NEVER GO?
 *
 * `validateProviderBaseUrl` refuses IP literals and local names by SYNTAX; a
 * public-looking name can still point at a private, loopback, link-local or
 * cloud-metadata address. The stored key is sent to that host on every call,
 * so the name is resolved when the admin saves it and refused when ANY of its
 * addresses is internal. (A name that cannot be resolved right now is not
 * refused here — every call to it would fail anyway. DNS rebinding after the
 * save is not covered by a save-time check; the admin-only setting is the
 * remaining guard.)
 */
export async function resolvesInternally(host: string): Promise<boolean> {
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  return addrs.some((a) => internalAddress(a.address));
}

export function internalAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.includes(":")) {
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true; // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? internalAddress(mapped[1]) : false;
  }
  const p = v.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
