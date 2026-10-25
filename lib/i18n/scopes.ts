// GENERATED — npm run test:i18n:scopes -- --write
//
// WHICH TRANSLATIONS EACH SURFACE SERIALISES INTO ITS HTML.
//
// The root layout used to hand every client page the whole dictionary: 87
// namespaces, inline, on every document including the landing page. These three
// lists are the same dictionary split by who actually renders it, derived from
// the import graph rather than by hand — scripts/i18n-scope-tests.ts re-derives
// them on every run and fails if this file has drifted from the code.
//
// DO NOT EDIT BY HAND, and in particular do not trim a namespace that looks
// unused. The lists are deliberately a superset: this codebase passes
// translation keys around as values (lib/features.ts, lib/tool-search.ts,
// lib/relative-time.ts, lib/roles.ts), so "no t(\"ns.\" in this file" means
// nothing. A namespace removed here does not raise — it renders an English
// word where Polish should be.
//
// Server components are unaffected: getDictionary() still returns everything,
// because a server render never ships the dictionary anywhere.
//
// `app` and `admin` are DELTAS on top of `root`. The root layout wraps both
// surfaces, so anything listed there is already on the page; repeating it would
// serialise it twice.

/** Public pages — landing, legal, CMS pages, unsubscribe, the auth dialog. */
const root = [
  "access",
  "adminLogin",
  "auth",
  "cats",
  "cms",
  "common",
  "credits",
  "grovnews",
  "hub",
  "landing",
  "launch",
  "legal",
  "mega",
  "nav",
  "newsletter",
  "plan",
  "prelaunchUi",
  "security",
  "sellerHome",
  "settings",
  "toolPage",
  "tools",
  "topnav",
  "tpl",
  "video",
  "wf",
] as const;

/** Added by app/(app)/layout.tsx for a signed-in customer. */
const app = [
  "account",
  "admin",
  "auth2",
  "bar",
  "batch",
  "bonus",
  "branding",
  "chat",
  "checkout",
  "company",
  "compress",
  "concepts",
  "controls",
  "creditsPanel",
  "dashboard",
  "dnd",
  "editor",
  "fashion",
  "features",
  "feedback",
  "fmtUse",
  "generator",
  "genv3",
  "greet",
  "history",
  "home2",
  "inflight",
  "insp",
  "library",
  "loginSec",
  "media",
  "mobilenav",
  "models",
  "notif",
  "packs",
  "photoTool",
  "plans",
  "pricing",
  "products",
  "prompts",
  "psess",
  "publicTools",
  "resize",
  "retouch",
  "scene",
  "search",
  "studio",
  "support",
  "thumb",
  "toolFrame",
  "toolGuide",
  "toolsearch",
  "vc",
] as const;

/** Added by app/admin/layout.tsx. */
const admin = [
  "acc",
  "admin",
  "aicc",
  "analytics",
  "audit",
  "bonus",
  "chat",
  "comm",
  "compress",
  "crm",
  "dashboard",
  "dnd",
  "econ",
  "editor",
  "fashion",
  "featAdm",
  "flags",
  "fmtUse",
  "generator",
  "genv3",
  "grovnewsAdm",
  "health",
  "history",
  "iceAdmin",
  "insp",
  "launchAdmin",
  "loginSec",
  "media",
  "models",
  "notif",
  "onb",
  "packs",
  "plans",
  "pricing",
  "prompts",
  "publicTools",
  "reg",
  "resize",
  "retouch",
  "roles",
  "svc",
  "thumb",
  "time",
  "toolGuide",
  "toolGuideDefaults",
] as const;

/** Added by components/ice/ice-gate.tsx — the visual editor, admins only. */
const ice = [
  "ice",
] as const;

export const SCOPES = { root, app, admin, ice };
export type Scope = keyof typeof SCOPES;
