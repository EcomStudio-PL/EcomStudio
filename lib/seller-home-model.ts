import {
  CHANNEL_DEFAULT_TOOL, DEFAULT_UPLOAD_TOOL, HANDOFF_ROUTES, SURVEY_CHANNEL, UPLOAD_TOOLS, isSellerChannel,
  type MediaSrc, type SellerChannel, type UploadToolKey,
} from "./seller-home-config";

/**
 * THE SIGNED-IN START (/home) — the decisions, pure.
 *
 * No I/O and no React: lib/server/seller-home.ts gathers the facts (what is
 * available, what it costs, what the wallet holds), and everything below
 * turns them into what the page shows. Kept pure so scripts/seller-home-tests
 * can drive every branch without a database or a browser.
 */

/**
 * How an item stands for THIS viewer:
 *   live         its switch, gates and runtime agree — it opens
 *   soon         "Wkrótce" in the switchboard
 *   maintenance  "Prace techniczne"
 *   unavailable  switched on, but its engine / prompt / provider is not ready
 *   disabled     switched off — only an admin is ever shown it
 */
export type ItemStatus = "live" | "soon" | "maintenance" | "unavailable" | "disabled";

/** What /home knows about one catalogue item for THIS viewer. */
export type ItemState = {
  key: string;
  /** The existing route the item opens. */
  href: string;
  status: ItemStatus;
  /** Credits ONE image costs at the tool's default size/quality, from the
   *  tool's own price source. 0 = free; null = no price could be read. */
  credits: number | null;
};

export type ItemStates = Readonly<Record<string, ItemState>>;

export const isLive = (s: ItemState | null | undefined): boolean => s?.status === "live";

/** The small badge an inert item wears; null for a live one. */
export function statusBadge(status: ItemStatus): "soon" | "maintenance" | "unavailable" | "disabled" | null {
  return status === "live" ? null : status;
}

/* ── the upload tile ──────────────────────────────────────────────────────*/

export type UploadToolView = {
  key: UploadToolKey;
  item: string;
  pillKey: string;
  leadKey: string;
  href: string;
  status: ItemStatus;
  /** The target screen takes the photo chosen here (lib/home-handoff.ts). */
  handoff: boolean;
  credits: number | null;
  samples: readonly MediaSrc[];
};

/** The three pills, resolved. A pill whose tool is unknown to the viewer
 *  (switched off, taken off /tools) is left out rather than drawn dead. */
export function resolveUploadTools(states: ItemStates): UploadToolView[] {
  return UPLOAD_TOOLS.flatMap((def) => {
    const s = states[def.item];
    if (!s) return [];
    return [{
      key: def.key,
      item: def.item,
      pillKey: def.pillKey,
      leadKey: def.leadKey,
      href: s.href,
      status: s.status,
      handoff: s.status === "live" && HANDOFF_ROUTES.includes(s.href),
      credits: s.credits,
      samples: def.samples,
    }];
  });
}

/** The live pill with this key, or null. */
export function liveTool(tools: readonly UploadToolView[], key: UploadToolKey | null): UploadToolView | null {
  if (!key) return null;
  return tools.find((t) => t.key === key && t.status === "live") ?? null;
}

/** The pill the tile opens on: the seller's channel's, else the default,
 *  else the first live one; null when nothing runs. */
export function defaultUploadTool(channel: SellerChannel | null, tools: readonly UploadToolView[]): UploadToolKey | null {
  const wanted = channel && isSellerChannel(channel) ? CHANNEL_DEFAULT_TOOL[channel] : DEFAULT_UPLOAD_TOOL;
  return (liveTool(tools, wanted) ?? liveTool(tools, DEFAULT_UPLOAD_TOOL) ?? tools.find((t) => t.status === "live"))?.key ?? null;
}

/** What the tile works with: the picked pill while it is live, else the
 *  page's default, else the first live one — never a dead tool. */
export function selectedUploadTool(
  tools: readonly UploadToolView[], picked: UploadToolKey | null, fallback: UploadToolKey | null,
): UploadToolView | null {
  return liveTool(tools, picked) ?? liveTool(tools, fallback) ?? tools.find((t) => t.status === "live") ?? null;
}

/** True when one image cannot be paid for — the "no credits" moment. */
export function cannotAfford(balance: number, perImage: number | null): boolean {
  return perImage !== null && perImage > 0 && balance < perImage;
}

/* ── seller channel ───────────────────────────────────────────────────────*/

/** A channel from the welcome-bonus survey's "sales_channels" answer. */
export function channelFromSurvey(answer: readonly string[] | null | undefined): SellerChannel | null {
  const mapped = Array.from(new Set((answer ?? []).map((a) => SURVEY_CHANNEL[a]).filter(Boolean)));
  if (mapped.length === 0) return null;
  return mapped.length > 1 ? "multi" : mapped[0];
}

/**
 * Whether to ask "Gdzie sprzedajesz?" now. Only a seller with no generation
 * yet, who has not answered or dismissed it, whose answer is not already
 * known from the bonus survey, and who is not about to see the welcome-bonus
 * dialog (which asks a survey of its own — two dialogs would stack).
 */
export function shouldAskChannel(input: {
  generations: number;
  askedAt: string | null;
  channel: SellerChannel | null;
  surveyChannel: SellerChannel | null;
  bonusPending: boolean;
}): boolean {
  return input.generations === 0 && !input.askedAt && !input.channel && !input.surveyChannel && !input.bonusPending;
}
