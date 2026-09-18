import "server-only";
import type { Client } from "@/lib/services/workspace";
import { ProviderError } from "@/lib/ai/types";
import { callVisionJson, OPENAI_VISION_MODELS, VISION_MODEL } from "@/lib/ai/engine/vision";
import { textCapableBackends } from "@/lib/server/prompt-engine";
import { LOCALES, type Locale, type MailBlock } from "@/lib/newsletter";

/**
 * THE NEWSLETTER'S COPYWRITER.
 *
 * NO SECOND AI STACK WAS BUILT FOR THIS. `lib/ai/engine/vision.ts` is already
 * this codebase's door to a text-capable model — it takes a system prompt, a
 * user message, a JSON schema and a list of configured backends, tries them in
 * order, and survives one provider having a bad day. It is called "vision"
 * because image understanding is what it was written for, but `images: []` is a
 * perfectly ordinary request to both backends it speaks: Gemini gets a
 * `contents` array with one text part, OpenAI gets a chat message with one text
 * item. Everything below is that door with no pictures behind it.
 *
 * THE CREDENTIALS COME FROM WHERE EVERY OTHER PROVIDER CALL GETS THEM. No env
 * var, no second key field, no newsletter-specific credential table: the chain
 * is resolved by `textCapableBackends`, which is the prompt engine's own
 * resolver (active `ai_providers` row → `provider_credential_read` behind the
 * dispatch token → `readProviderKey`, vault first). An operator who adds an
 * OpenAI key in Dostawcy AI has, by doing exactly that, switched this module on.
 * An operator who has added none gets `null` from `textEngine` and an honest
 * "not configured" screen — never a fabricated draft.
 *
 * EVERY SYSTEM PROMPT LIVES IN THIS FILE AND THIS FILE IS `server-only`.
 * That import is the enforcement, not the convention: a client component that
 * imports this module fails the build instead of shipping the instructions that
 * make the feature worth anything into a bundle anybody can read. The actions
 * in app/actions/newsletter-ai.ts return only the model's ANSWER, so nothing
 * that crosses to the browser carries a prompt.
 *
 * ── WHAT THE MODEL IS ALLOWED TO SEE ────────────────────────────────────────
 *
 * The campaign's own copy, and a contact's first name, locale and source key.
 * Nothing else. Not the address, not the tags, not the consent record, not the
 * user id, not another contact.
 *
 * That rule is enforced by `contactForAi` and `campaignForAi`, which BUILD the
 * outgoing object by iterating an allowlist instead of copying an input object.
 * The difference matters more than it looks: a projection written as
 * `{ ...contact, password: undefined }` leaks the next column somebody adds,
 * and a projection written as a type annotation leaks it the moment the object
 * is serialised, because `JSON.stringify` does not read types. These two
 * functions take `Record<string, unknown>` on purpose — they will not even
 * observe a field that is not on the list, so widening `ContactRow` cannot
 * widen what leaves the building. The tests for that are the functions
 * themselves; there is no path around them, because every prompt body in this
 * file is assembled from their output.
 */

/* ── THE ENGINE ──────────────────────────────────────────────────────────── */

/** Gemini-flavoured schema fragments, the dialect `callVisionJson` converts
 *  per backend (see lib/ai/engine/analysis.ts, which declares its own). */
const S = {
  str: { type: "STRING" },
  strArr: { type: "ARRAY", items: { type: "STRING" } },
} as const;

type TextRequest = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
};

/**
 * A resolved provider chain, ready to answer questions.
 *
 * THIS IS A HANDLE RATHER THAN A FUNCTION CALL because resolving it is not
 * free: it reads `ai_providers`, calls a definer RPC per provider and opens a
 * vault secret per provider. The personalisation batch asks the model a few
 * hundred times in one invocation, and doing that work again for every single
 * contact would triple the round trips before a word has been written.
 */
export type TextEngine = {
  ask<T>(req: TextRequest): Promise<T>;
};

/**
 * The configured text chain, or null when there is none.
 *
 * NULL IS NOT AN ERROR AND MUST NOT BE SHOWN AS ONE. "No provider is
 * configured" is a true statement about this deployment that an operator can
 * act on in one click; "AI nie odpowiedziało" sends them looking for an outage
 * that is not happening.
 */
export async function textEngine(supabase: Client): Promise<TextEngine | null> {
  const backends = await textCapableBackends(supabase);
  if (backends.length === 0) return null;
  return {
    ask<T>(req: TextRequest): Promise<T> {
      return callVisionJson<T>(backends, { images: [], ...req }).then((r) => r.data);
    },
  };
}

/** Whether the studio has anything to offer at all — for the page that has to
 *  decide between rendering controls and rendering the unavailable state. */
export async function newsletterAiAvailable(supabase: Client): Promise<boolean> {
  return (await textCapableBackends(supabase)).length > 0;
}

/**
 * What one model call costs, when the deployment knows.
 *
 * WHY THIS CAN HONESTLY RETURN `null`, and why that is the whole point.
 *
 * Text models are billed per token, and this repository has no token
 * accounting anywhere: nothing counts a prompt, nothing stores a rate card,
 * and the vision layer does not read `usage` off the responses. The ONE price
 * the platform actually knows is `ai_models.internal_cost_usd_micros` — a
 * per-call figure an operator types into Modele AI — so that is the only number
 * this function will report, and only when a row for the model that will
 * genuinely serve the request declares one.
 *
 * Everything else would be a guess with a currency symbol in front of it. A
 * personalisation batch is the one screen in this module where a made-up
 * number costs real money: an operator who is shown "≈ 12 zł" and charged
 * ninety has been lied to by their own panel. So when the price is not
 * knowable this returns null and the UI says so in words.
 *
 * `usdMicrosPerCall` is per CALL because that is the unit the batch spends —
 * one call per recipient, stated in the cost note next to it.
 */
export type TextModelCost = {
  provider: string;
  model: string;
  usdMicrosPerCall: number | null;
};

export async function textModelCost(supabase: Client): Promise<TextModelCost | null> {
  const backends = await textCapableBackends(supabase);
  const first = backends[0];
  if (!first) return null;

  // The id the chain will actually try first. Google carries the configured
  // analysis model; OpenAI falls through its own ordered list, so the first
  // entry is the one that answers unless it has been retired.
  const model = first.model ?? (first.provider === "google" ? VISION_MODEL : OPENAI_VISION_MODELS[0]);

  const { data } = await supabase
    .from("ai_models")
    .select("internal_cost_usd_micros, ai_providers!inner(slug)")
    .eq("model_identifier", model)
    .eq("ai_providers.slug", first.provider)
    .limit(1)
    .maybeSingle();

  const declared = (data as { internal_cost_usd_micros?: number } | null)?.internal_cost_usd_micros;
  return {
    provider: first.provider,
    model,
    usdMicrosPerCall: typeof declared === "number" && declared > 0 ? declared : null,
  };
}

/**
 * The two error keys this module is allowed to produce, told apart by cause.
 *
 * `aiUnavailable` means "nothing is configured"; `aiFailed` means "it is
 * configured and it did not answer". Collapsing them into one message is how a
 * misconfigured deployment gets diagnosed as an outage for a week.
 */
export function aiErrorKey(e: unknown): "aiUnavailable" | "aiFailed" {
  if (e instanceof ProviderError && e.safeMessage === "analysis_unavailable") return "aiUnavailable";
  return "aiFailed";
}

/* ── THE ALLOWLISTS ──────────────────────────────────────────────────────── */

/**
 * The only contact fields that may ever be put in front of a model.
 *
 * First name so the opener can use it, locale so the language is right, source
 * key so "zapisał się przez formularz w stopce" can steer the angle. An address
 * is not here: personalisation does not need it, and a third-party API is not a
 * place to send a mailing list.
 */
const CONTACT_FIELDS_FOR_AI = ["firstName", "locale", "sourceKey"] as const;
type ContactFieldForAi = (typeof CONTACT_FIELDS_FOR_AI)[number];

/** The only campaign fields that may ever be put in front of a model. */
const CAMPAIGN_FIELDS_FOR_AI = ["name", "subject", "preheader", "body"] as const;
type CampaignFieldForAi = (typeof CAMPAIGN_FIELDS_FOR_AI)[number];

/** Per-field caps, so one pasted essay cannot push a prompt past a token
 *  limit and turn every personalisation in the batch into a failure. */
const LIMIT: Record<ContactFieldForAi | CampaignFieldForAi, number> = {
  firstName: 60,
  locale: 8,
  sourceKey: 60,
  name: 160,
  subject: 300,
  preheader: 300,
  body: 8_000,
};

export type AiContact = Record<ContactFieldForAi, string>;
export type AiCampaign = Record<CampaignFieldForAi, string>;

/** Written as a code point rather than an escape sequence for the reason
 *  given on `clean`: this file must not depend on an escape surviving a
 *  round trip through a tool. */
const NEWLINE = String.fromCharCode(10);
/** Three or more newlines in a row — collapsed to one blank line. */
const BLANK_RUN = new RegExp(NEWLINE + "{3,}", "g");

/**
 * One value, made safe to sit inside a prompt: no control characters, one
 * paragraph shape, hard cap.
 *
 * THE CONTROL-CHARACTER PASS IS A LOOP RATHER THAN A CHARACTER CLASS. A regex
 * built out of raw escapes is precisely the line that gets mangled on its way
 * into a repository, and a sanitiser that silently stops sanitising is worse
 * than a slightly longer one. Newlines survive because paragraphs are
 * meaningful to every prompt in this file; every other control character
 * becomes a space, so a pasted body cannot smuggle framing into a prompt.
 */
function clean(value: unknown, max: number): string {
  let stripped = "";
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    stripped += ch === NEWLINE ? NEWLINE : code < 32 || code === 127 ? " " : ch;
  }
  return stripped
    .replace(/ {2,}/g, " ")
    .replace(BLANK_RUN, NEWLINE + NEWLINE)
    .trim()
    .slice(0, max);
}

/**
 * A contact, reduced to the three fields the allowlist permits.
 *
 * The parameter is `Record<string, unknown>` DELIBERATELY. Typing it as
 * `ContactRow` would make this function compile against every future column and
 * quietly start forwarding whichever one somebody names `firstName2`; taking an
 * anonymous bag and reading exactly three keys out of it cannot.
 */
export function contactForAi(contact: Readonly<Record<string, unknown>>): AiContact {
  const picked = {} as AiContact;
  for (const field of CONTACT_FIELDS_FOR_AI) picked[field] = clean(contact[field], LIMIT[field]);
  return picked;
}

/** A campaign, reduced to its own copy. Same construction, same reason. */
export function campaignForAi(campaign: Readonly<Record<string, unknown>>): AiCampaign {
  const picked = {} as AiCampaign;
  for (const field of CAMPAIGN_FIELDS_FOR_AI) picked[field] = clean(campaign[field], LIMIT[field]);
  return picked;
}

/**
 * A stored message body as plain words.
 *
 * NOT `renderCampaign`. That function turns a campaign into the email that
 * leaves the building — tracking pixels, tagged hrefs, a footer, table
 * scaffolding — and every one of those is noise a model would have to read past
 * before reaching the first sentence. What a copywriter needs is the copy, so
 * this flattens blocks to their text and strips tags out of the HTML mode.
 *
 * URLs are deliberately dropped rather than included: the model is never asked
 * to produce a link (see `EmailDraft`), so handing it the campaign's real
 * destinations only invites it to invent variations of them.
 */
export function bodyToText(source: {
  editor: "builder" | "html";
  blocks: MailBlock[];
  bodyHtml: string;
}): string {
  if (source.editor === "html") {
    const text = source.bodyHtml
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    return clean(text, LIMIT.body);
  }

  const lines: string[] = [];
  for (const block of source.blocks) {
    if (block.type === "heading" || block.type === "text" || block.type === "footer") {
      if (block.text) lines.push(block.text);
    } else if (block.type === "columns") {
      if (block.text) lines.push(block.text);
      if (block.text2) lines.push(block.text2);
    } else if (block.type === "button") {
      // The label is copy — often the most important six words in the mail —
      // even though the URL behind it is not.
      if (block.label) lines.push(`[CTA] ${block.label}`);
    } else if (block.type === "image" && block.alt) {
      lines.push(`[obraz] ${block.alt}`);
    }
  }
  return clean(lines.join("\n\n"), LIMIT.body);
}

/* ── SHARED PROMPT RULES ─────────────────────────────────────────────────── */

const LANGUAGE_NAME: Record<Locale, string> = {
  pl: "Polish", en: "English", de: "German",
};

const asLocale = (value: unknown): Locale =>
  (LOCALES as readonly string[]).includes(String(value)) ? (String(value) as Locale) : "pl";

/**
 * The rules every prompt in this file inherits.
 *
 * THE LINK RULE IS THE ONE THAT MATTERS MOST. A generated URL that looks
 * plausible is the worst possible output of an email writer: it survives
 * proofreading, it goes out to the whole list, and it 404s in four thousand
 * inboxes at once. So the model is told, every time, that it does not produce
 * links — the operator's own button keeps its own destination.
 *
 * THE MERGE-TAG RULE stops the model inventing `{{imie}}`. `applyMerge` has a
 * closed vocabulary and leaves an unknown tag visible in the mail rather than
 * deleting it, which is the right behaviour for a human typo and an embarrassing
 * one for a machine that could simply have been told the list.
 */
const HOUSE_RULES = `You are a direct-response email copywriter for GrovBase, a SaaS that turns product photos into sales content for e-commerce sellers. You write marketing email for that audience: small and mid-size sellers who are short of time.

Hard rules:
- Write in {LANGUAGE}. Every field you return is in that language.
- Never invent a URL, a domain, a price, a discount code, a date, a statistic or a customer quote. If the brief does not contain a fact, write around it.
- You never produce links. Buttons already have their destination; you only ever name the button.
- The only personalisation tags that exist are {{first_name}}, {{last_name}}, {{email}}, {{locale}}, {{source}} and {{unsubscribe_url}}. Use at most {{first_name}}, and always with a fallback: {{first_name | default:"Cześć"}}. Never invent another tag.
- No emoji in subject lines. No ALL CAPS. No "Re:" or "Fwd:" tricks. No false urgency ("ostatnia szansa" when nothing ends).
- Short sentences. One idea per paragraph. Concrete over clever.
- Return JSON only, matching the schema exactly.`;

const house = (locale: Locale): string => HOUSE_RULES.replace("{LANGUAGE}", LANGUAGE_NAME[locale]);

/** Bounds on "how many of these do you want". A model asked for forty subject
 *  lines returns forty, and thirty of them are the same sentence. */
const clampCount = (n: unknown, max: number): number => {
  const parsed = Math.trunc(Number(n));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : 5;
};

const strings = (value: unknown, max: number, cap: number): string[] =>
  (Array.isArray(value) ? value : [])
    .map((v) => clean(v, cap))
    .filter((v) => v.length > 0)
    .slice(0, max);

/* ── 1. WRITE ────────────────────────────────────────────────────────────── */

export const AI_TONES = ["professional", "casual", "premium", "short", "sales"] as const;
export type AiTone = (typeof AI_TONES)[number];

export const asTone = (value: unknown): AiTone =>
  (AI_TONES as readonly string[]).includes(String(value)) ? (String(value) as AiTone) : "professional";

export type EmailBrief = {
  /** What this mail is supposed to achieve. */
  goal: string;
  /** What is being offered. */
  offer: string;
  /** Who is reading. */
  audience: string;
  tone: AiTone;
  locale: Locale;
};

/**
 * A finished draft.
 *
 * THERE IS NO `ctaUrl` FIELD, and that absence is the design. The operator's
 * button already points somewhere; a model-supplied destination would either
 * overwrite a working link or add a broken one, and both are discovered by
 * recipients rather than by the person who pressed "Generuj".
 */
export type EmailDraft = {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  /** The words on the button, never where it goes. */
  ctaLabel: string;
};

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    subject: S.str,
    preheader: S.str,
    heading: S.str,
    paragraphs: S.strArr,
    cta_label: S.str,
  },
  required: ["subject", "preheader", "heading", "paragraphs", "cta_label"],
};

const TONE_DIRECTIVE: Record<AiTone, string> = {
  professional: "Tone: professional and plain. Competent, not stiff. No exclamation marks.",
  casual: "Tone: relaxed and human, as if writing to one person you know. Contractions are fine.",
  premium: "Tone: restrained and premium. Fewer words, more space, nothing shouted. Quality is implied, never claimed.",
  short: "Tone: as short as the message allows. Two or three paragraphs of one or two sentences each.",
  sales: "Tone: openly commercial. Lead with the benefit, name the offer early, make the CTA unmistakable — but never invent scarcity.",
};

/** A first draft from a brief. Four to six short paragraphs, one CTA. */
export async function writeEmail(engine: TextEngine, brief: EmailBrief): Promise<EmailDraft> {
  const locale = asLocale(brief.locale);
  const out = await engine.ask<{
    subject?: unknown; preheader?: unknown; heading?: unknown;
    paragraphs?: unknown; cta_label?: unknown;
  }>({
    system: `${house(locale)}

${TONE_DIRECTIVE[asTone(brief.tone)]}

Write one marketing email.
- subject: under 60 characters, says what is inside, no clickbait.
- preheader: under 90 characters, EXTENDS the subject instead of repeating it.
- heading: the first line inside the mail.
- paragraphs: 3 to 6 short paragraphs, plain text, no markdown, no headings.
- cta_label: 2 to 5 words, a verb first.`,
    user: JSON.stringify({
      goal: clean(brief.goal, 400),
      offer: clean(brief.offer, 400),
      audience: clean(brief.audience, 400),
    }),
    schema: DRAFT_SCHEMA,
  });

  return {
    subject: clean(out.subject, LIMIT.subject),
    preheader: clean(out.preheader, LIMIT.preheader),
    heading: clean(out.heading, 160),
    paragraphs: strings(out.paragraphs, 8, 1_200),
    ctaLabel: clean(out.cta_label, 60),
  };
}

/* ── 2. IMPROVE ──────────────────────────────────────────────────────────── */

export const IMPROVE_ACTIONS = [
  "shorten", "conversion", "cta", "natural", "trim", "premium", "sales",
] as const;
export type ImproveAction = (typeof IMPROVE_ACTIONS)[number];

export const asImproveAction = (value: unknown): ImproveAction =>
  (IMPROVE_ACTIONS as readonly string[]).includes(String(value))
    ? (String(value) as ImproveAction) : "shorten";

/** What each button on the panel actually asks for. The labels live in the
 *  dictionary under `newsletter.ai.action.*`; the instructions live here,
 *  server-side, because they are the part worth keeping. */
const IMPROVE_DIRECTIVE: Record<ImproveAction, string> = {
  shorten: "Cut the length by roughly a third. Remove sentences, not words — half-sentences read as damage. Keep every concrete fact.",
  conversion: "Rewrite for conversion: lead with the reader's outcome, move the strongest reason to the first paragraph, make the next step obvious. Add no new claims.",
  cta: "Keep the body almost untouched and rewrite the call to action so it is specific and visible: name the action and what happens after it. Return the CTA wording in cta_label.",
  natural: "Rewrite so it sounds like one person writing to another. Remove corporate phrasing, passive voice and anything nobody says out loud.",
  trim: "Remove filler: throat-clearing openers, adjectives that carry no information, sentences that only announce the next sentence. Keep the structure.",
  premium: "Raise the register. Fewer words, calmer rhythm, no exclamation marks, no superlatives. Quality shown, not claimed.",
  sales: "Make it more commercial: benefit first, offer named early, urgency only where the brief genuinely supports it. Invent no deadline and no discount.",
};

export type ImprovedEmail = {
  paragraphs: string[];
  /** The CTA wording, when the model was asked to touch it. */
  ctaLabel: string;
  /** One line telling the operator what actually changed, so "Popraw" is a
   *  decision they can review rather than a diff they have to hunt for. */
  note: string;
};

const IMPROVE_SCHEMA = {
  type: "OBJECT",
  properties: { paragraphs: S.strArr, cta_label: S.str, note: S.str },
  required: ["paragraphs", "note"],
};

export async function improveEmail(
  engine: TextEngine, body: string, action: ImproveAction, locale: Locale = "pl",
): Promise<ImprovedEmail> {
  const resolved = asLocale(locale);
  const out = await engine.ask<{ paragraphs?: unknown; cta_label?: unknown; note?: unknown }>({
    system: `${house(resolved)}

${IMPROVE_DIRECTIVE[asImproveAction(action)]}

You are editing an existing email. Return the rewritten body as paragraphs, plus one short note (in ${LANGUAGE_NAME[resolved]}) saying what you changed. Preserve every fact, offer and merge tag that is already there — you may move them, never invent or drop them.`,
    user: clean(body, LIMIT.body),
    schema: IMPROVE_SCHEMA,
  });

  return {
    paragraphs: strings(out.paragraphs, 12, 1_200),
    ctaLabel: clean(out.cta_label, 60),
    note: clean(out.note, 240),
  };
}

/* ── 3. SUBJECTS AND PREHEADERS ──────────────────────────────────────────── */

const LIST_SCHEMA = {
  type: "OBJECT",
  properties: { ideas: S.strArr },
  required: ["ideas"],
};

/** `n` subject lines for the same mail, each on a different angle. */
export async function subjectIdeas(
  engine: TextEngine, context: string, n = 5, locale: Locale = "pl",
): Promise<string[]> {
  const count = clampCount(n, 10);
  const resolved = asLocale(locale);
  const out = await engine.ask<{ ideas?: unknown }>({
    system: `${house(resolved)}

Produce exactly ${count} subject lines for the email below.
- Each under 60 characters.
- Each on a DIFFERENT angle: the outcome, the problem, the news, the question, the plain description. Five rewordings of one sentence is a failed answer.
- No emoji, no ALL CAPS, no clickbait, no invented numbers.`,
    user: clean(context, LIMIT.body),
    schema: LIST_SCHEMA,
  });
  return strings(out.ideas, count, LIMIT.subject);
}

/** `n` preheaders. A preheader that repeats the subject wastes the second-best
 *  piece of real estate in the inbox, so the prompt spends its words on that. */
export async function preheaderIdeas(
  engine: TextEngine, context: string, n = 5, locale: Locale = "pl",
): Promise<string[]> {
  const count = clampCount(n, 10);
  const resolved = asLocale(locale);
  const out = await engine.ask<{ ideas?: unknown }>({
    system: `${house(resolved)}

Produce exactly ${count} preheaders for the email below.
- Each under 90 characters.
- A preheader CONTINUES the subject line — it never repeats it and never summarises the whole mail.
- No emoji. No "Nie możesz wyświetlić tej wiadomości?".`,
    user: clean(context, LIMIT.body),
    schema: LIST_SCHEMA,
  });
  return strings(out.ideas, count, LIMIT.preheader);
}

/* ── 4. ANALYSE ──────────────────────────────────────────────────────────── */

export const ANALYSIS_AREAS = [
  "offer", "cta", "length", "spam", "subject_match", "hierarchy",
] as const;
export type AnalysisArea = (typeof ANALYSIS_AREAS)[number];

export const ANALYSIS_VERDICTS = ["ok", "warn", "problem"] as const;
export type AnalysisVerdict = (typeof ANALYSIS_VERDICTS)[number];

export type AnalysisFinding = {
  area: AnalysisArea;
  verdict: AnalysisVerdict;
  /** What is true about the mail as written. */
  finding: string;
  /** What to do about it. Empty when the verdict is "ok". */
  fix: string;
};

export type CampaignAnalysis = {
  findings: AnalysisFinding[];
  /** Two sentences an operator can act on without reading the table. */
  summary: string;
};

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: S.str,
    findings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          area: { type: "STRING", enum: [...ANALYSIS_AREAS] },
          verdict: { type: "STRING", enum: [...ANALYSIS_VERDICTS] },
          finding: S.str,
          fix: S.str,
        },
        required: ["area", "verdict", "finding", "fix"],
      },
    },
  },
  required: ["summary", "findings"],
};

/**
 * Six questions about one campaign, answered concretely.
 *
 * THERE IS NO SCORE, AND THERE IS NO FIELD FOR ONE. A model asked to rate an
 * email out of a hundred will happily answer "97" about a mail with no call to
 * action, because the number is generated by the same process as the prose and
 * is accountable to nothing. The brief forbids it and so does the schema:
 * there is nowhere to put one. What an operator can act on is "the CTA is a
 * link in the fourth paragraph, make it a button above the fold", and that is
 * what every finding has to be — a fact about this mail plus a fix.
 *
 * `ok` is a real verdict, not a consolation. An analysis that finds six
 * problems in every campaign is an analysis nobody reads by the third one.
 */
export async function analyzeCampaign(
  engine: TextEngine, subject: string, preheader: string, body: string, locale: Locale = "pl",
): Promise<CampaignAnalysis> {
  const resolved = asLocale(locale);
  const out = await engine.ask<{ summary?: unknown; findings?: unknown }>({
    system: `${house(resolved)}

Review this campaign as an experienced email marketer reviewing a colleague's draft. Answer exactly these six areas, one finding each, in this order:
- offer: is it clear within the first two paragraphs WHAT is on offer and what the reader gets?
- cta: is there one unmistakable next step, and is it visible without scrolling past three paragraphs?
- length: is it too long for what it says? Name what you would cut.
- spam: does any wording invite a spam filter or read as manipulation (FREE, capitals, "ostatnia szansa", stacked exclamation marks, one big image and no text)?
- subject_match: does the subject line describe the mail that follows, or promise something the body does not deliver?
- hierarchy: can a reader skimming in five seconds tell what this is about — heading, first line, button?

Rules for the answer:
- NEVER return a score, a rating, a percentage, a grade or a mark out of anything. There is no field for one and inventing a number in the prose is the same mistake.
- "finding" describes THIS mail, quoting its own words where useful. Never generic email advice.
- "fix" is one concrete instruction. Leave it empty only when the verdict is "ok".
- Use verdict "ok" when the area is genuinely fine. Do not manufacture six problems.
- summary: at most two sentences, the single most important thing to change.`,
    user: JSON.stringify({
      subject: clean(subject, LIMIT.subject),
      preheader: clean(preheader, LIMIT.preheader),
      body: clean(body, LIMIT.body),
    }),
    schema: ANALYSIS_SCHEMA,
  });

  const raw = Array.isArray(out.findings) ? out.findings : [];
  const findings: AnalysisFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const area = String(row.area);
    const verdict = String(row.verdict);
    if (!(ANALYSIS_AREAS as readonly string[]).includes(area)) continue;
    findings.push({
      area: area as AnalysisArea,
      verdict: (ANALYSIS_VERDICTS as readonly string[]).includes(verdict)
        ? (verdict as AnalysisVerdict) : "warn",
      finding: clean(row.finding, 600),
      fix: clean(row.fix, 600),
    });
    if (findings.length >= ANALYSIS_AREAS.length) break;
  }

  return { findings, summary: clean(out.summary, 400) };
}

/* ── 5. A/B VARIANTS ─────────────────────────────────────────────────────── */

export type AbVariantDraft = {
  /** Why this one is different — the thing the test is actually measuring. */
  angle: string;
  subject: string;
  preheader: string;
  paragraphs: string[];
};

const VARIANTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    variants: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          angle: S.str, subject: S.str, preheader: S.str, paragraphs: S.strArr,
        },
        required: ["angle", "subject", "preheader", "paragraphs"],
      },
    },
  },
  required: ["variants"],
};

/**
 * `n` genuinely different versions of one campaign.
 *
 * EACH VARIANT CARRIES ITS ANGLE, because an A/B test between two mails that
 * differ only in adjectives measures nothing and costs a real send to find out.
 * Naming the hypothesis on screen is what lets an operator reject a variant
 * before it is queued rather than after the result comes back flat.
 */
export async function abVariants(
  engine: TextEngine, campaign: AiCampaign, n = 2, locale: Locale = "pl",
): Promise<AbVariantDraft[]> {
  const count = clampCount(n, 4);
  const resolved = asLocale(locale);
  const out = await engine.ask<{ variants?: unknown }>({
    system: `${house(resolved)}

Produce exactly ${count} variants of the campaign below for an A/B test.
- Each variant tests ONE hypothesis and states it in "angle" (for example: benefit-led versus problem-led, short versus detailed, curiosity subject versus plain subject).
- Variants that differ only in wording are worthless — a test has to be able to lose.
- Keep every fact, offer and merge tag from the original.
- paragraphs: 3 to 6 short paragraphs.`,
    user: JSON.stringify(campaign),
    schema: VARIANTS_SCHEMA,
  });

  const raw = Array.isArray(out.variants) ? out.variants : [];
  const variants: AbVariantDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const subject = clean(row.subject, LIMIT.subject);
    const paragraphs = strings(row.paragraphs, 8, 1_200);
    // A variant with no subject and no body is not a variant. Dropping it is
    // better than putting an empty card on screen next to two real ones.
    if (!subject && paragraphs.length === 0) continue;
    variants.push({
      angle: clean(row.angle, 200),
      subject,
      preheader: clean(row.preheader, LIMIT.preheader),
      paragraphs,
    });
    if (variants.length >= count) break;
  }
  return variants;
}

/* ── 6. PERSONALISATION ──────────────────────────────────────────────────── */

/**
 * EXACTLY the shape `newsletter_recipients.personalization` holds and
 * `lib/server/newsletter/worker.ts` reads back (`{ subject, intro }`). The
 * worker's own type is private to that module on purpose — it is the consumer,
 * and a shared type would invite a third writer. If this shape ever changes,
 * the worker's `toPersonalization` is the other half and both move together.
 */
export type Personalization = { subject: string; intro: string };

const PERSONALIZATION_SCHEMA = {
  type: "OBJECT",
  properties: { subject: S.str, intro: S.str },
  required: ["subject", "intro"],
};

/**
 * One contact's subject line and opening sentence.
 *
 * WHY THE INTRO IS ONE OR TWO SENTENCES AND NOT A REWRITTEN MAIL. The worker
 * inserts it above the body (`withIntro`), after the logo and heading — so the
 * campaign an operator approved is still the campaign that goes out, with a
 * personal opener in front of it. A per-contact rewrite of the whole message
 * would mean four thousand emails nobody has read, which is not personalisation,
 * it is an unreviewed send.
 *
 * THE MODEL SEES `contact` AND `campaign`, BOTH ALREADY PROJECTED through the
 * allowlists above. This function does not accept a `ContactRow` and cannot be
 * handed one by accident: the type it takes has three fields and they are the
 * three that are allowed.
 */
export async function personalizeFor(
  engine: TextEngine, contact: AiContact, campaign: AiCampaign,
): Promise<Personalization> {
  // The contact's OWN language, not the operator's: a German subscriber gets a
  // German opener or the personalisation is a downgrade.
  const resolved = asLocale(contact.locale);
  const out = await engine.ask<{ subject?: unknown; intro?: unknown }>({
    system: `${house(resolved)}

Write a personalised subject line and opening for ONE recipient of the campaign below.
- subject: under 60 characters. It must describe the SAME mail as the campaign's own subject — a personalised subject that promises something else is a lie at scale.
- intro: one or two sentences that will be placed above the existing body. It leads INTO that body; it does not summarise or replace it.
- You know only the recipient's first name, language and how they joined the list. Use what is there and say nothing about what is not — never guess their company, industry, purchases or behaviour.
- If the first name is empty, write an opener that works without one. Never write "Cześć ," and never write the word "null".
- Do not use merge tags here: the name is already resolved.`,
    user: JSON.stringify({ contact, campaign }),
    schema: PERSONALIZATION_SCHEMA,
  });

  return {
    subject: clean(out.subject, LIMIT.subject),
    intro: clean(out.intro, 600),
  };
}
