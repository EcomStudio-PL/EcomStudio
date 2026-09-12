import "server-only";
import { connect as netConnect } from "net";
import { connect as tlsConnect } from "tls";

/**
 * WHERE EXACTLY DOES THE MAILBOX FAIL.
 *
 * "Błąd połączenia IMAP. Sprawdź host, port lub dane logowania." names three
 * things and identifies none. The production outage was a wrong PORT — IMAP on
 * 587 — and that sentence sent the operator to re-check a password that had
 * been correct all along.
 *
 * So a test is four steps now, and each one answers a different question:
 *
 *   1. USTAWIENIA   — is this combination of port and encryption even possible?
 *                     Answered without touching the network.
 *   2. POŁĄCZENIE   — does a TCP socket open to that host on that port?
 *                     A failure here is DNS, a firewall, or a wrong port. It is
 *                     never the password.
 *   3. SZYFROWANIE  — does the TLS handshake complete (for an implicit-TLS
 *                     port)? A failure here is the classic mismatch: TLS
 *                     expected where the server speaks plaintext, or the
 *                     reverse. That is the 587-with-SSL bug, caught by name.
 *   4. LOGOWANIE    — do the credentials work? Only reached when the first
 *                     three passed, so a failure here really is the password.
 *
 * NOTHING FROM A DRIVER REACHES A SCREEN. Every step reports a STABLE CODE from
 * the vocabulary below; the UI translates it. Host and port are echoed back
 * because the admin typed them, and a credential never is — not in a result,
 * not in a log line, not in a thrown error.
 */

export type StepStatus = "ok" | "failed" | "skipped";

export type ProbeStep = {
  /** Stable id — the UI's translation key suffix, never shown raw. */
  id: "settings" | "connect" | "tls" | "auth" | "mailbox";
  status: StepStatus;
  /** A stable code when it failed. Never a driver message. */
  code?: string;
  /** Milliseconds the step took. Useful, and not a secret. */
  ms?: number;
};

export type ProbeResult = { ok: boolean; steps: ProbeStep[] };

/**
 * A driver's message, reduced to one of a handful of causes.
 *
 * The raw text is DISCARDED rather than truncated. A mail server's error can
 * quote the command that failed, and an AUTH command carries the credential.
 * Nothing that came off a wire is worth the risk of echoing it, so the pattern
 * is matched and the text is dropped.
 */
export function classifyProbe(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (/enotfound|eai_again|getaddrinfo|dns/.test(m)) return "dns";
  if (/econnrefused/.test(m)) return "refused";
  if (/etimedout|timeout|timed out|ehostunreach|enetunreach/.test(m)) return "timeout";
  if (/econnreset|epipe|socket hang up/.test(m)) return "reset";
  if (/wrong version number|packet length too long|record layer|ssl3?_get|eproto/.test(m)) return "tls_mismatch";
  if (/self.signed|unable to verify|cert|depth_zero|altnames/.test(m)) return "tls_cert";
  if (/auth|credential|login|invalid user|password|5\.7\.\d|\b53[045]\b|\bno\b.*authenticat/.test(m)) return "auth";
  return "generic";
}

const CONNECT_MS = 8000;

/**
 * Step 2 and 3 in one: open the socket, and complete the TLS handshake when
 * the port is an implicit-TLS one. Returns which step failed, so a plaintext
 * port that refuses a handshake is reported as ENCRYPTION rather than as a
 * dead host.
 */
export async function probeSocket(
  host: string, port: number, implicitTls: boolean,
): Promise<{ connect: ProbeStep; tls: ProbeStep }> {
  const startedAt = Date.now();

  const openPlain = () => new Promise<void>((resolve, reject) => {
    const socket = netConnect({ host, port });
    const done = (err?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(CONNECT_MS, () => done(new Error("ETIMEDOUT")));
    socket.once("connect", () => done());
    socket.once("error", done);
  });

  const openTls = () => new Promise<void>((resolve, reject) => {
    // servername is set so SNI works — a shared-hosting mail server serves the
    // wrong certificate without it, which would read as a certificate fault
    // when the configuration is fine.
    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false });
    const done = (err?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(CONNECT_MS, () => done(new Error("ETIMEDOUT")));
    socket.once("secureConnect", () => done());
    socket.once("error", done);
  });

  try {
    await openPlain();
  } catch (e) {
    return {
      connect: { id: "connect", status: "failed", code: classifyProbe(e), ms: Date.now() - startedAt },
      tls: { id: "tls", status: "skipped" },
    };
  }
  const connect: ProbeStep = { id: "connect", status: "ok", ms: Date.now() - startedAt };

  if (!implicitTls) {
    // STARTTLS upgrades an already-open plaintext socket and only the protocol
    // driver can drive that exchange. Claiming to have verified it here would
    // be inventing a result, so this step is honestly reported as not run and
    // the login step covers it.
    return { connect, tls: { id: "tls", status: "skipped" } };
  }

  const tlsStart = Date.now();
  try {
    await openTls();
    return { connect, tls: { id: "tls", status: "ok", ms: Date.now() - tlsStart } };
  } catch (e) {
    return { connect, tls: { id: "tls", status: "failed", code: classifyProbe(e), ms: Date.now() - tlsStart } };
  }
}
