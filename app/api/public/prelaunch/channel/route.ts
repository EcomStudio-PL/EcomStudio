import { createClient } from "@/lib/supabase/server";
import { dispatchToken } from "@/lib/server/server-token";
import { SELLER_CHANNELS } from "@/lib/launch/fields";
import { rpcSetChannel } from "@/lib/server/prelaunch/rpc";
import { failure, guardRequest, reply } from "@/lib/server/prelaunch/http";
import { ANSWER_HANDLE_RE, sha256Hex } from "@/lib/server/prelaunch/handles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "GDZIE SPRZEDAJESZ?" — POST {answer, channel}, from the success card.
 *
 * `answer` is the handle the signup response gave THIS submission; its hash
 * finds the signup it may answer for (valid for two hours, first answer wins).
 * The reply is `200 {ok:true}` whether the handle was real, a decoy, expired or
 * already used (S7): a different answer for a decoy would turn the decoy back
 * into the oracle it exists to prevent. Only a malformed body is a 400.
 */
const MAX_BYTES = 512;

export async function POST(request: Request) {
  const guarded = await guardRequest(request, { route: "channel", limit: 20, windowMs: 10 * 60_000, maxBytes: MAX_BYTES });
  if (guarded instanceof Response) return guarded;
  const { answer, channel } = guarded.body;
  if (typeof answer !== "string" || !ANSWER_HANDLE_RE.test(answer)) return failure(400, "bad_request");
  if (typeof channel !== "string" || !(SELLER_CHANNELS as readonly string[]).includes(channel)) {
    return failure(400, "bad_request");
  }

  const token = dispatchToken();
  if (!token) return failure(500, "generic");
  const supabase = await createClient();
  const result = await rpcSetChannel(supabase, token, sha256Hex(answer), channel);
  if (result === null) return failure(500, "generic");
  return reply({ ok: true });
}
