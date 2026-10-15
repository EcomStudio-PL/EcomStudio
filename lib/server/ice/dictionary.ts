import "server-only";
import { headers } from "next/headers";
import { applyOverrides, rewriteKeys } from "@/lib/i18n/overrides";
import { icePageFor, pageTextKeys } from "@/lib/ice/registry";
import { stegaMark, stegaStrip } from "@/lib/ice/stega";
import type { IceLocale } from "@/lib/ice/types";
import { applicableOverrides, overrideBag } from "./overrides";
import { iceEditSession } from "./session";

/**
 * THE DICTIONARY AS A PAGE RENDERS IT — the shipped JSON, with the visual
 * editor's published overrides laid over a copy, and, in an admin's edit
 * session, an invisible marker after each text of the page being edited.
 *
 * Called by lib/i18n/server.ts for every dictionary a request asks for. With
 * nothing published and no edit session it returns the shipped object
 * itself: no copy, no work. Any failure returns the shipped object too —
 * a page must never fail to render over its copy.
 *
 * A SERVER-ONLY BOUNDARY for scripts/i18n-scope-tests.ts: the registry's key
 * literals behind this file decide nothing a client receives, so the scope
 * walk stops here instead of counting them into every public page.
 */
type Dict = Record<string, unknown>;

/** A server action's request carries this header (Next's own marker). */
async function isServerAction(): Promise<boolean> {
  try {
    return (await headers()).has("next-action");
  } catch {
    return true;
  }
}

export async function layerDictionary(locale: IceLocale, base: Dict): Promise<Dict> {
  try {
    const [bag, edit] = await Promise.all([overrideBag(), iceEditSession()]);
    let dict = applyOverrides(base, applicableOverrides(bag[locale], base));
    // "/" is the launch page, whose copy is a CMS block (marked where it is
    // read, lib/server/ice/cms.ts) — the dictionary has nothing of its own.
    // A server action never gets markers: what it builds from the dictionary
    // may be stored or sent (a notification, a mail), never only painted.
    if (edit && edit.path !== "/" && !(await isServerAction())) {
      const page = icePageFor(edit.path);
      if (page) {
        const keys = pageTextKeys(page);
        const index = new Map(keys.map((k, i) => [k, i]));
        dict = rewriteKeys(dict, keys, (key, current) => {
          const clean = stegaStrip(current);
          if (!clean.trim()) return undefined;
          return clean + stegaMark(`${edit.nonce}.t${index.get(key)}`);
        });
      }
    }
    return dict;
  } catch (e) {
    console.warn("ice dictionary layer failed, rendering the shipped copy", e instanceof Error ? e.message : e);
    return base;
  }
}
