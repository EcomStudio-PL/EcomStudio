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
  "cms",
  "common",
  "landing",
  "launch",
  "legal",
  "nav",
  "newsletter",
  "plan",
  "security",
  "settings",
] as const;

/** Added by app/(app)/layout.tsx for a signed-in customer. */
const app = [
  "account",
  "admin",
  "auth2",
  "batch",
  "bonus",
  "branding",
  "catpage",
  "cats",
  "chat",
  "company",
  "compress",
  "concepts",
  "credits",
  "creditsPanel",
  "dashboard",
  "editor",
  "fashion",
  "features",
  "feedback",
  "generator",
  "genv3",
  "greet",
  "gtb",
  "history",
  "home",
  "hub",
  "insp",
  "library",
  "loginSec",
  "match",
  "mega",
  "mobilenav",
  "notif",
  "packs",
  "plans",
  "products",
  "prompts",
  "psess",
  "resize",
  "retouch",
  "scene",
  "search",
  "studio",
  "support",
  "tools",
  "topnav",
  "vc",
  "video",
  "wf",
] as const;

/** Added by app/admin/layout.tsx. */
const admin = [
  "acc",
  "admin",
  "aicc",
  "analytics",
  "audit",
  "bonus",
  "cats",
  "chat",
  "comm",
  "credits",
  "crm",
  "econ",
  "featAdm",
  "flags",
  "health",
  "history",
  "insp",
  "launchAdmin",
  "loginSec",
  "media",
  "models",
  "onb",
  "reg",
  "svc",
  "tools",
  "tpl",
  "wf",
] as const;

export const SCOPES = { root, app, admin };
export type Scope = keyof typeof SCOPES;
