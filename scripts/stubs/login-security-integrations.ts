/**
 * THE INTEGRATIONS MODULE, WITH THE SMTP READ UNDER TEST CONTROL —
 * AND THE SERVER SECRET LEFT ALONE.
 *
 * Aliased in place of lib/server/integrations for
 * scripts/login-security-key-tests.ts. Only `readIntegrationSecrets` is
 * substituted, because reaching the real one means Supabase Vault and a live
 * `secret_read_many`. Everything else is RE-EXPORTED FROM THE REAL MODULES,
 * and `serverSecret` in particular must be the genuine article: it is the
 * function whose absence from login-security caused the 2026-09-20 lockout, so
 * a stub of it would test nothing.
 */
export { dispatchToken, serverSecret, serverTokenAvailable } from "@/lib/server/server-token";

/** Only used for console output in the code under test; the real scrubber
 *  lives in the real module and has its own tests (scripts/comm-tests.ts). */
export function safeError(err: unknown): string {
  return String((err as { message?: string })?.message ?? err ?? "").slice(0, 200);
}

export type MailConfig = {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_encryption: string;
  smtp_same_as_imap: boolean;
  email: string;
  from_name: string;
};

type Read = {
  enabled: boolean;
  config: MailConfig;
  secrets: Record<string, string>;
  state?: string;
};

const CONFIGURED: Read = {
  enabled: true,
  config: {
    smtp_host: "smtp.example.test",
    smtp_port: 587,
    smtp_user: "contact@grovbase.test",
    smtp_encryption: "starttls",
    smtp_same_as_imap: false,
    email: "contact@grovbase.test",
    from_name: "GrovBase",
  },
  secrets: { smtp_password: "not-a-real-password-test-fixture" },
};

let current: Read | "throws" = CONFIGURED;

/** SMTP configured and reachable — the normal deployment. */
export function __smtpConfigured(): void {
  current = CONFIGURED;
}

/** The mailbox is not set up: host/user/password missing. */
export function __smtpNotConfigured(): void {
  current = {
    enabled: false,
    config: { ...CONFIGURED.config, smtp_host: "", smtp_user: "", email: "" },
    secrets: {},
  };
}

/** Vault itself is unreachable — the read throws rather than returning blanks. */
export function __vaultUnavailable(): void {
  current = "throws";
}

export async function readIntegrationSecrets<C>(
  _supabase: unknown,
  _type: string,
): Promise<{ enabled: boolean; config: C; secrets: Record<string, string> }> {
  if (current === "throws") throw new Error("vault unreachable");
  return {
    enabled: current.enabled,
    config: current.config as unknown as C,
    secrets: current.secrets,
  };
}
