import { MARK_START, stegaLocate } from "@/lib/ice/stega";
import type { IceCmsField, IceElement, IcePageInfo } from "@/lib/ice/types";

/**
 * FINDING THE EDITABLE ELEMENTS ON THE PAGE AS IT IS PAINTED.
 *
 * Texts: every text node that carries an invisible marker with THIS session's
 * nonce and a payload that names an element of THIS page. The visible run
 * before the marker is the element — measured with a Range, so a heading
 * that shares its box with a link or a badge is still hit exactly.
 *
 * Media: the registry's selectors (frames that already carry data-config-key,
 * data-ba-card, data-promo, data-tool-card, data-sample…) and, on a CMS page,
 * the <img> inside a section whose file is the field's file.
 */

export type TextRun = { node: Text; start: number; end: number };

export type Target =
  | { kind: "text"; uid: string; element: IceElement; key: string; runs: TextRun[] }
  | { kind: "cms"; uid: string; field: IceCmsField; runs: TextRun[] }
  | { kind: "media"; uid: string; element: IceElement; els: HTMLElement[] }
  | { kind: "cmsMedia"; uid: string; field: IceCmsField; els: HTMLElement[] };

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "TEXTAREA", "OPTION"]);

export const UI_ATTR = "data-ice-ui";

function textRuns(root: ParentNode, nonce: string): { code: string; run: TextRun }[] {
  const out: { code: string; run: TextRun }[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || SKIP.has(p.tagName) || p.closest(`[${UI_ATTR}]`)) return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.includes(MARK_START) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const prefix = `${nonce}.`;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    let from = 0;
    for (const hit of stegaLocate(node.data)) {
      if (hit.payload.startsWith(prefix)) out.push({ code: hit.payload.slice(prefix.length), run: { node, start: from, end: hit.at } });
      from = hit.end;
    }
  }
  return out;
}

const T_CODE = /^t(\d{1,4})$/;
const C_CODE = /^c([0-9a-f]{8})\.(\d{1,3})$/;

/** The URL a picture's file is known by, without its derivative suffix. */
export function fileStem(url: string): string {
  try {
    const u = new URL(url, location.href);
    // next/image: /_next/image?url=<encoded>
    const inner = u.pathname.startsWith("/_next/image") ? u.searchParams.get("url") : null;
    const path = inner ? new URL(inner, location.href).pathname : u.pathname;
    return decodeURIComponent(path).replace(/_w\d+\.webp$/i, "").replace(/\.[a-z0-9]{2,5}$/i, "");
  } catch {
    return url;
  }
}

function imgStems(img: HTMLImageElement): string[] {
  const urls = [img.currentSrc, img.getAttribute("src") ?? ""];
  for (const set of [img.getAttribute("srcset"), ...Array.from(img.parentElement?.querySelectorAll("source") ?? []).map((s) => s.getAttribute("srcset"))]) {
    if (set) for (const part of set.split(",")) urls.push(part.trim().split(/\s+/)[0]);
  }
  return urls.filter(Boolean).map(fileStem);
}

export function scanPage(info: IcePageInfo, nonce: string): Target[] {
  const targets: Target[] = [];
  const runs = textRuns(document.body, nonce);

  if (info.kind === "registry") {
    const byKey = new Map<string, IceElement>();
    for (const s of info.page.sections) for (const e of s.elements) if (e.kind === "text" && e.text) byKey.set(e.text.key, e);
    const texts = new Map<string, Target & { kind: "text" }>();
    for (const { code, run } of runs) {
      const m = T_CODE.exec(code);
      const key = m ? info.textKeys[Number(m[1])] : undefined;
      const element = key ? byKey.get(key) : undefined;
      if (!key || !element) continue;
      const t = texts.get(key) ?? { kind: "text" as const, uid: `t:${key}`, element, key, runs: [] };
      t.runs.push(run);
      texts.set(key, t);
    }
    targets.push(...texts.values());
    for (const s of info.page.sections) {
      for (const e of s.elements) {
        if (e.kind === "text" || !e.dom) continue;
        const els = Array.from(document.querySelectorAll<HTMLElement>(e.dom)).filter((el) => !el.closest(`[${UI_ATTR}]`));
        if (els.length) targets.push({ kind: "media", uid: `m:${e.id}`, element: e, els });
      }
    }
    return targets;
  }

  const fields = info.cms.fields;
  const byCode = new Map(fields.map((f) => [`${f.blockId.slice(0, 8)}.${f.n}`, f]));
  const texts = new Map<string, Target & { kind: "cms" }>();
  for (const { code, run } of runs) {
    const m = C_CODE.exec(code);
    const field = m ? byCode.get(`${m[1]}.${m[2]}`) : undefined;
    if (!field || field.kind !== "text") continue;
    const t = texts.get(field.id) ?? { kind: "cms" as const, uid: `c:${field.id}`, field, runs: [] };
    t.runs.push(run);
    texts.set(field.id, t);
  }
  targets.push(...texts.values());
  for (const f of fields) {
    if (f.kind !== "media" || !f.url) continue;
    const stem = fileStem(f.url);
    const section = document.querySelector(`[data-cms-section="${CSS.escape(f.blockId)}"]`);
    if (!section) continue;
    const els = Array.from(section.querySelectorAll("img")).filter((img) => imgStems(img).includes(stem));
    if (els.length) targets.push({ kind: "cmsMedia", uid: `cm:${f.id}`, field: f, els });
  }
  return targets;
}

/** Where one run of text is on screen right now (viewport coordinates). */
export function runRects(r: TextRun): DOMRect[] {
  if (!r.node.isConnected) return [];
  const len = r.node.data.length;
  const start = Math.min(r.start, len);
  const end = Math.min(r.end, len);
  if (end <= start) return [];
  const range = document.createRange();
  range.setStart(r.node, start);
  range.setEnd(r.node, end);
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
}

/** Where a target is on screen right now (viewport coordinates). */
export function targetRects(t: Target): DOMRect[] {
  if (t.kind === "text" || t.kind === "cms") return t.runs.flatMap(runRects);
  return t.els.filter((el) => el.isConnected).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 1 && r.height > 1);
}

/** One box around all of a target's rects that sit near `near` (the
 *  occurrence that was hovered — a text can render in several places). */
export function unionBox(rects: DOMRect[]): { x: number; y: number; w: number; h: number } | null {
  if (rects.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top);
    x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const inside = (r: DOMRect, x: number, y: number, pad = 2) =>
  x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

/** The elements a target paints (for outlines and for "is it visible"). */
export function targetElements(t: Target): Element[] {
  if (t.kind === "text" || t.kind === "cms") {
    return [...new Set(t.runs.map((r) => r.node.parentElement).filter((e): e is HTMLElement => Boolean(e)))];
  }
  return t.els;
}

/**
 * What the pointer is on. Texts before pictures: walk the elements under the
 * point from the top; a text whose run is under the point wins, else the
 * first media frame in that stack. A text under something that takes no
 * pointer events (an overlay with pointer-events: none) is found by its
 * rects as a last resort.
 */
export function hitTest(targets: Target[], x: number, y: number): { target: Target; rects: DOMRect[] } | null {
  const stack = document.elementsFromPoint(x, y).filter((el) => !el.closest(`[${UI_ATTR}]`)).slice(0, 16);
  const textByParent = new Map<Element, Target[]>();
  const mediaByEl = new Map<Element, Target>();
  for (const t of targets) {
    if (t.kind === "text" || t.kind === "cms") {
      for (const el of targetElements(t)) textByParent.set(el, [...(textByParent.get(el) ?? []), t]);
    } else {
      for (const el of t.els) if (!mediaByEl.has(el)) mediaByEl.set(el, t);
    }
  }
  for (const el of stack) {
    for (const t of textByParent.get(el) ?? []) {
      if (t.kind !== "text" && t.kind !== "cms") continue;
      for (const run of t.runs) {
        if (run.node.parentElement !== el) continue;
        const rects = runRects(run);
        if (rects.some((r) => inside(r, x, y))) return { target: t, rects };
      }
    }
  }
  for (const t of targets) {
    if (t.kind !== "text" && t.kind !== "cms") continue;
    for (const run of t.runs) {
      const rects = runRects(run);
      if (rects.some((r) => inside(r, x, y, 0))) return { target: t, rects };
    }
  }
  for (const el of stack) {
    let cur: Element | null = el;
    while (cur) {
      const t = mediaByEl.get(cur);
      if (t) return { target: t, rects: [cur.getBoundingClientRect()] };
      cur = cur.parentElement;
    }
  }
  return null;
}
