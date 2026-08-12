import "server-only";

/**
 * Transactional email via Resend's REST API. Honest no-op when
 * RESEND_API_KEY is not configured — callers treat email as best-effort
 * and never block business logic on it.
 */
export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<{ sent: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "EcomStudio <noreply@ecomstudio.app>";
  if (!key) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
      signal: AbortSignal.timeout(10_000),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}
