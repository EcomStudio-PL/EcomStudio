/**
 * THE INLINE CONTENT EDITOR'S SHARED VOCABULARY — types only, no values, so
 * any side (server layer, editor chunk, tests) can import it for free.
 */

export type IceLocale = "pl" | "en" | "de";
export const ICE_LOCALES: readonly IceLocale[] = ["pl", "en", "de"];

/** A crop: the focal point (percent of the file) and a zoom ≥ 1. Applied at
 *  render time; the file in the library is never changed. */
export type IceCrop = { x: number; y: number; zoom: number };

/** How a slot is framed on the page. */
export type IceSlotSpec = {
  /** media_slots.slot_key. */
  key: string;
  /** CSS aspect-ratio of the frame the page paints ("1/1", "2336/1744"). */
  ratio: string;
  /** Recommended file size in px. */
  width: number;
  height: number;
  /** Video allowed here. */
  video: boolean;
  /** Images only, ≤ 10 MiB, jpeg/png/webp/avif — handed to a tool as a photo. */
  sample?: boolean;
  /** Rendered by the shared tool-card frame: position (9 cells) only, no zoom. */
  positionOnly?: boolean;
  /** Shared with another page (the tool's card on /tools). */
  sharedWith?: string;
  /** Extra frames the same slot is painted in (banners, showcase). */
  frames?: { label: "wide" | "tablet" | "phone" | "tools"; ratio: string }[];
  /** A separate phone file is allowed (mobile_media_id). */
  mobile?: boolean;
  /** Entity columns for a first write. */
  entityType: "tool" | "workflow" | "category" | "global";
  entityId: string;
  slotName: string;
};

export type IceTextSpec = {
  /** The i18n key (also the element id). */
  key: string;
  /** Hard cap; the panel warns earlier, at about 1.5× the default length. */
  maxLength: number;
};

export type IceElementKind = "text" | "media" | "pair" | "samples";

export type IceElement = {
  /** Stable id: the i18n key for text, the slot key for media, `pair:<n>`,
   *  `samples:<tool>`. */
  id: string;
  kind: IceElementKind;
  /** ice.role.<role> */
  role: string;
  index?: number;
  text?: IceTextSpec;
  /** media: one slot; pair: [before, after]; samples: the tool's five. */
  slots?: IceSlotSpec[];
  /** How the editor finds a media element on the page (CSS selector). */
  dom?: string;
};

export type IceSection = { key: string; elements: IceElement[] };

export type IcePageType = "app" | "public" | "tool" | "cms";

export type IcePage = {
  key: string;
  /** Exact path (no trailing slash). */
  path: string;
  type: IcePageType;
  sections: IceSection[];
  /** Media groups that accept "Wgraj wiele". */
  bulk?: { key: string; slots: string[]; pairs?: boolean }[];
};

/* ── what the server hands the editor ─────────────────────────────────── */

export type IceTextState = {
  key: string;
  locale: IceLocale;
  defaultValue: string;
  override: string | null;
  updatedAt: string | null;
};

export type IceAsset = {
  id: string;
  kind: "image" | "video" | "file";
  url: string;
  posterUrl: string | null;
  title: string | null;
  alt: string | null;
  mime: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  variants: Record<string, string>;
  createdAt: string;
  usage: number;
};

export type IceSlotState = {
  key: string;
  exists: boolean;
  enabled: boolean;
  mediaType: "image" | "video";
  media: IceAsset | null;
  mobile: IceAsset | null;
  poster: IceAsset | null;
  alt: string | null;
  altI18n: Partial<Record<IceLocale, string>>;
  fit: "cover" | "contain";
  position: string;
  crop: (IceCrop & { m?: IceCrop }) | null;
  updatedAt: string | null;
};

export type IceVersion = {
  id: string;
  action: string;
  locale: IceLocale | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  author: string | null;
};

export type IceCmsField = {
  /** `<blockId>|<path>` — the element id on a CMS page. */
  id: string;
  blockId: string;
  blockType: string;
  /** The field's number inside its block — what the page's marker carries. */
  n: number;
  /** Path inside the block's content, without the locale: ["title"],
   *  ["items", "2", "description"], ["fields", "hero.h1"], ["mediaUrl"]. */
  path: string[];
  kind: "text" | "media";
  /** Split into paragraphs on blank lines when painted. */
  multiline: boolean;
  /** Text: the published value per language (absent = not written). */
  values: Partial<Record<IceLocale, string>>;
  /** Media: the published URL. */
  url?: string;
  /** The block's draft updated_at, for compare-and-set. */
  base: string | null;
};

export type IceCmsPage = {
  pageId: string;
  slug: string;
  path: string;
  title: string;
  launch: boolean;
  fields: IceCmsField[];
};

export type IceResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; current?: unknown };

/** What the editor needs to know about the page it is on. */
export type IcePageInfo =
  | { kind: "registry"; page: IcePage; textKeys: string[] }
  | { kind: "cms"; cms: IceCmsPage };

export type IceTextInfo = {
  states: IceTextState[];
  /** Pages the same key renders on (a shared label changes everywhere). */
  pages: string[];
  maxLength: number;
};

export type IceUsage = { kind: string; key: string; label: string };

/** The server actions the editor calls — passed in, so a probe can swap them. */
export type IceTransport = {
  setEdit: (on: boolean, path: string) => Promise<IceResult<{ nonce: string | null }>>;
  page: (path: string) => Promise<IceResult<IcePageInfo>>;
  textState: (key: string) => Promise<IceResult<IceTextInfo>>;
  textSave: (input: { key: string; locale: IceLocale; value: string | null; base: string | null; action?: "save" | "reset" | "restore" }) => Promise<IceResult<{ updatedAt: string | null }>>;
  slotState: (keys: string[]) => Promise<IceResult<IceSlotState[]>>;
  slotSave: (input: { writes: IceSlotWrite[]; action: "save" | "restore" | "clear" | "bulk" }) => Promise<IceResult<{ updatedAt: Record<string, string> }>>;
  history: (input: { target: "text" | "slot" | "cms"; key: string; locale?: IceLocale | null; limit?: number }) => Promise<IceResult<IceVersion[]>>;
  pageHistory: (path: string) => Promise<IceResult<(IceVersion & { target: string; key: string })[]>>;
  library: (input: { kind?: "image" | "video"; q?: string; offset?: number }) => Promise<IceResult<IceAsset[]>>;
  usage: (mediaId: string) => Promise<IceResult<IceUsage[]>>;
  assets: (ids: string[]) => Promise<IceResult<IceAsset[]>>;
  uploadTicket: (input: { name: string; size: number; type: string }) => Promise<IceResult<{ path: string }>>;
  registerUpload: (input: { path: string; name: string }) => Promise<IceResult<IceAsset>>;
  cmsMap: (path: string) => Promise<IceResult<IceCmsPage>>;
  cmsSave: (input: { blockId: string; path: string[]; locale: IceLocale | null; value: string; expected: string | null; base: string | null; action?: "save" | "restore" }) => Promise<IceResult<{ updatedAt: string }>>;
  /** Where the browser puts an uploaded file. Absent = Supabase Storage (the
   *  real editor); a probe passes its own so nothing leaves the page. */
  putFile?: (path: string, file: File) => Promise<boolean>;
};

export type IceSlotWrite = {
  key: string;
  mediaType: "image" | "video";
  mediaId: string | null;
  mobileMediaId: string | null;
  posterMediaId: string | null;
  alt: string | null;
  altI18n: Partial<Record<IceLocale, string>>;
  fit: "cover" | "contain";
  position: string;
  crop: (IceCrop & { m?: IceCrop }) | null;
  base: string | null;
};
