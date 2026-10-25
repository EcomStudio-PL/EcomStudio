"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/lib/notify";
import type { IceLocale, IcePageInfo, IceResult, IceTransport } from "@/lib/ice/types";
import { GALLERY_KEYS, isGalleryKey, type GalleryKey } from "@/lib/launch/gallery";
import { UI_ATTR, galleryUid, hitTest, scanPage, targetElements, unionBox, type Target } from "./scan";
import { actionsTransport } from "./transport";
import { Btn, call, cls, errorText, pageLabel, roleLabel, sectionLabel, type EditorCtx, type T } from "./shared";
import { TextPanel } from "./text-panel";
import { CmsLinkPanel, CmsMediaPanel, CmsTextPanel, cmsFieldLabel } from "./cms-panel";
import { BulkGroupsPanel, ElementsPanel, PageHistoryPanel } from "./page-panels";
import { VisibilityPanel } from "./visibility-panel";
import { MediaPanel } from "./media-panel";
import { PairPanel } from "./pair-panel";
import { SamplesPanel } from "./samples-panel";
import { BulkPanel } from "./bulk-panel";
import { GalleryPanel } from "./gallery-panel";
import { FaqPanel } from "./faq-panel";
import { isFaqPage, type FaqPage } from "@/lib/faq";
import { useFramed } from "../framed";
import s from "./editor.module.css";

/**
 * THE VISUAL EDITOR, in edit mode on one page.
 *
 * It never rewrites the page: it finds the elements the server marked for
 * this session (texts) or the registry names (frames), outlines them, and
 * takes over a click on one — the element's own action (a link, a slider, a
 * tool hand-off) does not run while editing. Links and forms elsewhere on the
 * page are held too; plain buttons (carousel arrows, tabs) keep working so
 * every element can be reached. Everything is written through the server, so
 * what the admin sees after a save is the page as a visitor will see it.
 */

type Open =
  | { kind: "target"; target: Target }
  | { kind: "elements" }
  | { kind: "history" }
  | { kind: "bulkGroups" }
  | { kind: "bulk"; group: string }
  /** "Widoczność": the switches of a CMS page's sections and items. */
  | { kind: "visibility" }
  /** The launch page's galleries — one panel for all three; `key` is the
   *  section that was clicked (null: the toolbar button). */
  | { kind: "gallery"; key: GalleryKey | null }
  /** FAQ V1: the shared FAQ base, on a page that shows it. */
  | { kind: "faq" };

type Hover = { box: { x: number; y: number; w: number; h: number }; label: string };

/** The page is the launch page at "/" — the only page with galleries. */
const hasGalleries = (info: IcePageInfo | null, path: string) => info?.kind === "cms" && info.cms.launch && path === "/";

function labelOf(t: T, info: IcePageInfo, target: Target): string {
  if (target.kind === "gallery") return `${t("ice.gallery.title")} · ${t(`ice.gallery.name.${target.key}`)}`;
  if (target.kind === "cms" || target.kind === "cmsMedia" || target.kind === "cmsLink") return cmsFieldLabel(t, target.field);
  const section = sectionLabel(t, info, target.element.id);
  return section ? `${section} · ${roleLabel(t, target.element)}` : roleLabel(t, target.element);
}

/** Controls that only move the page's own view, kept working in edit mode. */
const KEEP_WORKING = [
  "[data-rail-prev]", "[data-rail-next]", "[role='tab']", "[role='radio']", "[aria-pressed]", "[aria-expanded]",
  "[aria-selected]", "summary",
  // The page's own open overlays (a phone menu, a dialog): what opened them
  // keeps working, so what closes them must too. Their links stay held.
  "[role='dialog']", "[aria-modal='true']", "[role='menu']", "[role='listbox']",
].join(", ");

function detachedTarget(info: IcePageInfo, uid: string): Target | null {
  if (info.kind === "registry") {
    for (const sec of info.page.sections) for (const e of sec.elements) {
      if (e.kind === "text" && e.text && uid === `t:${e.text.key}`) return { kind: "text", uid, element: e, key: e.text.key, runs: [] };
      if (e.kind !== "text" && uid === `m:${e.id}`) return { kind: "media", uid, element: e, els: [] };
    }
    return null;
  }
  for (const f of info.cms.fields) {
    if (f.kind === "text" && uid === `c:${f.id}`) return { kind: "cms", uid, field: f, runs: [] };
    if (f.kind === "media" && uid === `cm:${f.id}`) return { kind: "cmsMedia", uid, field: f, els: [] };
    if (f.kind === "link" && uid === `cl:${f.id}`) return { kind: "cmsLink", uid, field: f, els: [] };
  }
  // A picture slot with no frame on the page: the share image, or one in a
  // section that is switched off.
  for (const { element: e } of info.cms.slots) if (uid === `m:${e.id}`) return { kind: "media", uid, element: e, els: [] };
  // A gallery that is not on the page (empty, hidden, never published) is
  // still reachable from the list, a deep link or the builder.
  if (info.cms.launch) {
    const key = GALLERY_KEYS.find((k) => uid === galleryUid(k));
    if (key) return { kind: "gallery", uid, key, els: [] };
  }
  return null;
}

type EditorProps = {
  session: { nonce: string; path: string };
  path: string;
  transport?: IceTransport;
};

/**
 * Nothing at all inside a frame. The edit cookie is Path=/ for "/", so it
 * reaches the builder's preview and the galleries' "Podgląd PC / Telefon"
 * too; those frames must show the page as a visitor sees it, not a second
 * editor fighting the first one.
 */
export default function Editor(props: EditorProps) {
  const framed = useFramed();
  return framed ? null : <EditorInFrameless {...props} />;
}

function EditorInFrameless({ session, path, transport = actionsTransport }: EditorProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [info, setInfo] = useState<IcePageInfo | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [leaving, setLeaving] = useState(false);
  const targetsRef = useRef<Target[]>([]);
  const openRef = useRef<Open | null>(null);
  const refreshed = useRef(false);
  const deepLinked = useRef(false);
  targetsRef.current = targets;
  openRef.current = open;

  const loadInfo = useCallback(async () => {
    const res = await call(transport.page(path));
    if (res.ok) setInfo(res.data);
    else notify.error(errorText(t, res.error));
  }, [path, t, transport]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  // FAQ V1: a page that paints the shared FAQ (/faq, /plany, /o-nas) marks
  // its list with data-faq-shared — the "FAQ" button opens the base there.
  const [faqPage, setFaqPage] = useState<FaqPage | "none">("none");
  const rescan = useCallback(() => {
    if (!info) return;
    setTargets(scanPage(info, session.nonce));
    const shared = document.querySelector("[data-faq-shared]")?.getAttribute("data-faq-shared");
    setFaqPage(isFaqPage(shared) ? shared : "none");
  }, [info, session.nonce]);

  // Find the elements now, and again whenever the page changes under us (a
  // re-render after a save, a carousel cloning its tiles, a tab switching).
  useEffect(() => {
    if (!info) return;
    rescan();
    let timer = 0;
    const mo = new MutationObserver((records) => {
      if (records.every((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest(`[${UI_ATTR}]`))) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(rescan, 200);
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      mo.disconnect();
      window.clearTimeout(timer);
    };
  }, [info, rescan]);

  // Arrived here by a client-side navigation, the layout's copy is not marked
  // yet: ask for this page once more, from the server.
  useEffect(() => {
    if (!info || refreshed.current || info.kind !== "registry" || info.textKeys.length === 0) return;
    const id = window.setTimeout(() => {
      if (!targetsRef.current.some((x) => x.kind === "text")) {
        refreshed.current = true;
        router.refresh();
      }
    }, 900);
    return () => window.clearTimeout(id);
  }, [info, router]);

  // Outlines: every editable element carries a dashed frame in edit mode, so
  // a phone (no hover) shows what can be tapped.
  useEffect(() => {
    document.documentElement.classList.add(s.on);
    return () => document.documentElement.classList.remove(s.on);
  }, []);
  useEffect(() => {
    const marked: Element[] = [];
    for (const target of targets) {
      for (const el of targetElements(target)) {
        el.setAttribute("data-ice-target", target.kind === "media" || target.kind === "cmsMedia" ? "media"
          : target.kind === "gallery" ? "gallery" : "text");
        marked.push(el);
      }
    }
    return () => marked.forEach((el) => el.removeAttribute("data-ice-target"));
  }, [targets]);
  useEffect(() => {
    const gallery = open?.kind === "gallery" && open.key ? targets.find((x) => x.uid === galleryUid(open.key as GalleryKey)) : undefined;
    const els: Element[] = open?.kind === "target" ? targetElements(open.target) : gallery ? targetElements(gallery) : [];
    els.forEach((el) => el.setAttribute("data-ice-selected", ""));
    return () => els.forEach((el) => el.removeAttribute("data-ice-selected"));
  }, [open, targets]);

  const openTarget = useCallback((target: Target) => {
    // Re-read the page NOW: the scan after a change is debounced, and a panel
    // opened from a stale scan would measure text that has moved since (a
    // preview just restored, a re-render after a save).
    let chosen = target;
    if (info) {
      const fresh = scanPage(info, session.nonce);
      setTargets(fresh);
      chosen = fresh.find((x) => x.uid === target.uid) ?? target;
    }
    setOpen({ kind: "target", target: chosen });
  }, [info, session.nonce]);

  // A phone or tablet: the panel is a bottom sheet. While one is open the page
  // gets room at its end (so even the last section can rise above the sheet),
  // and the element being edited is brought just below the admin bar, where
  // its live preview stays in view.
  useEffect(() => {
    if (open?.kind !== "target" || !window.matchMedia("(max-width: 1023.98px)").matches) return;
    const body = document.body;
    const before = body.style.paddingBottom;
    body.style.paddingBottom = "80dvh";
    const id = requestAnimationFrame(() => {
      const el = targetElements(open.target)[0];
      const bar = document.querySelector(`.${s.bar}`)?.getBoundingClientRect().bottom ?? 0;
      if (el) window.scrollBy({ top: el.getBoundingClientRect().top - bar - 12, behavior: "smooth" });
    });
    return () => {
      cancelAnimationFrame(id);
      body.style.paddingBottom = before;
    };
  }, [open]);

  /*
    THE GALLERY PANEL HOLDS UNSAVED WORK FOR THREE GALLERIES at once, and
    closing it any other way than its own close button (which asks) would
    drop that work silently. While it has unsaved edits, opening another
    element or panel is refused with a sentence instead.
  */
  const galleryDirty = useRef(false);
  const galleryHeld = useCallback((): boolean => {
    if (openRef.current?.kind !== "gallery" || !galleryDirty.current) return false;
    notify.message(t("ice.gallery.unsavedElsewhere"));
    return true;
  }, [t]);
  const openPanel = (next: Open) => {
    if (!galleryHeld()) setOpen(next);
  };

  const select = useCallback((target: Target) => {
    setHover(null);
    // A gallery opens THE gallery panel. If it is already open (for this or
    // another gallery) it stays open and switches tab — its unsaved edits of
    // every gallery live in that one panel and must survive the click.
    if (target.kind === "gallery") {
      setOpen({ kind: "gallery", key: target.key });
      return;
    }
    if (galleryHeld()) return;
    // The element already open: keep its panel (and the unsaved draft).
    if (openRef.current?.kind === "target" && openRef.current.target.uid === target.uid) return;
    // Another panel is open: close it first (it puts its preview back), and
    // only then measure the page for the new one.
    if (openRef.current?.kind === "target") {
      setOpen(null);
      window.setTimeout(() => openTarget(target), 0);
      return;
    }
    openTarget(target);
  }, [galleryHeld, openTarget]);

  // From the list (or the history): the element on the page if it is
  // painted, else a target with nothing on the page — every panel works from
  // the element's definition alone (a tool's samples behind another pill, a
  // text in another language).
  const pickUid = useCallback((uid: string) => {
    const found = targetsRef.current.find((x) => x.uid === uid) ?? (info ? detachedTarget(info, uid) : null);
    if (!found) return;
    targetElements(found)[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
    select(found);
  }, [info, select]);

  // #ice=<element id> (from Admin → Edytor wizualny's search): open it.
  useEffect(() => {
    if (deepLinked.current || targets.length === 0) return;
    const m = /^#ice=(.+)$/.exec(location.hash);
    if (!m) return;
    deepLinked.current = true;
    const id = decodeURIComponent(m[1]);
    const target = targets.find((x) => x.uid === `t:${id}` || x.uid === `m:${id}` || x.uid === id)
      ?? (info ? detachedTarget(info, `t:${id}`) ?? detachedTarget(info, `m:${id}`) ?? detachedTarget(info, id) : null);
    history.replaceState(null, "", location.pathname + location.search);
    if (target) {
      targetElements(target)[0]?.scrollIntoView({ block: "center" });
      select(target);
    } else {
      notify.message(t("ice.elements.notShown"));
    }
  }, [info, targets, select, t]);

  // Take over the pointer: hover frames, and a click on an element opens it
  // instead of doing what the element normally does.
  useEffect(() => {
    if (!info) return;
    let frame = 0;
    let lastWarn = 0;
    // The editor's own UI, and the app's toaster (its close button is not the
    // page's): never held, never hit-tested.
    const ui = (e: Event) => (e.target instanceof Element ? Boolean(e.target.closest(`[${UI_ATTR}], [data-sonner-toaster]`)) : false);
    const keep = (e: Event) => (e.target instanceof Element ? e.target.closest(KEEP_WORKING) !== null : false);
    const warnLink = () => {
      // Once in a while, not on every press: on a phone a stack of toasts
      // would cover the page being edited.
      if (Date.now() - lastWarn < 8000) return;
      lastWarn = Date.now();
      notify.message(t("ice.blockedLink"));
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (ui(e)) {
        setHover(null);
        return;
      }
      cancelAnimationFrame(frame);
      const { clientX: x, clientY: y } = e;
      frame = requestAnimationFrame(() => {
        const hit = hitTest(targetsRef.current, x, y);
        const box = hit ? unionBox(hit.rects) : null;
        setHover(hit && box ? { box, label: labelOf(t, info, hit.target) } : null);
      });
    };
    const onDown = (e: PointerEvent | MouseEvent | TouchEvent) => {
      if (ui(e)) return;
      const p = "touches" in e ? e.touches[0] : e;
      if (!p) return;
      if (hitTest(targetsRef.current, p.clientX, p.clientY, { exactTextOnly: keep(e) })) {
        e.stopPropagation();
        // A slider would start dragging, a text would start a selection.
        if (e.type === "mousedown" || (e.type === "pointerdown" && (e as PointerEvent).pointerType === "mouse")) e.preventDefault();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (ui(e)) return;
      const kept = keep(e);
      const hit = e.detail === 0 && e.clientX === 0 && e.clientY === 0 ? null
        : hitTest(targetsRef.current, e.clientX, e.clientY, { exactTextOnly: kept });
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        select(hit.target);
        return;
      }
      const el = e.target instanceof Element ? e.target : null;
      const hold = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      // A control that only moves the page's view: let it work.
      if (kept && !el?.closest("a[href], [role='link']")) return;
      // An icon or the padding inside an outlined element: that element.
      const marked = el?.closest("[data-ice-target]");
      const owner = marked ? targetsRef.current.find((x) => targetElements(x).includes(marked)) : undefined;
      if (owner) {
        hold();
        select(owner);
        return;
      }
      // Nothing the page does runs while editing: links, and every control
      // that might navigate or act in code (router.push, a server action) are
      // held. What only moves the page's own view keeps working — carousel
      // arrows, tabs, toggles and pills — so every element can be reached.
      if (el?.closest("a[href], [role='link']")) {
        hold();
        warnLink();
        return;
      }
      const control = el?.closest("button, [role='button'], input, select, label");
      if (control) {
        hold();
        warnLink();
      }
    };
    const onSubmit = (e: Event) => {
      if (ui(e)) return;
      e.preventDefault();
      e.stopPropagation();
      warnLink();
    };
    const onScroll = () => setHover(null);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("touchstart", onDown, { capture: true, passive: true });
    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("touchstart", onDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [info, select, t]);

  // Every successful write is followed by a fresh render of the page. The
  // render that comes back with a server action's answer is made without the
  // edit markers (a server action never gets them — what it builds may be
  // stored or sent), so without this every text would stop being clickable
  // after the first save.
  const tx = useMemo<IceTransport>(() => {
    const after = <R,>(p: Promise<IceResult<R>>): Promise<IceResult<R>> =>
      p.then((r) => {
        if (r.ok) router.refresh();
        return r;
      });
    return {
      ...transport,
      textSave: (input) => after(transport.textSave(input)),
      slotSave: (input) => after(transport.slotSave(input)),
      cmsSave: (input) => after(transport.cmsSave(input)),
      cmsVisibility: (input) => after(transport.cmsVisibility(input)),
      cmsMove: (input) => after(transport.cmsMove(input)),
      // Registering an upload revalidates too (the library screen), and any
      // revalidation re-renders this page inside the action — unmarked.
      registerUpload: (input) => after(transport.registerUpload(input)),
      // Publishing the galleries revalidates "/", the page under the editor.
      // A gallery DRAFT save, discard or restore changes nothing a visitor
      // sees and revalidates nothing, so it needs no fresh render.
      galleryPublish: (input) => after(transport.galleryPublish(input)),
    };
  }, [router, transport]);

  const ctx: EditorCtx | null = useMemo(() => info && ({
    transport: tx,
    path,
    locale: locale as IceLocale,
    info,
    t,
    pageLabel: pageLabel(t, info, path),
    reload: async () => {
      await loadInfo();
    },
    openBulk: (group: string) => setOpen({ kind: "bulk", group }),
  }), [info, loadInfo, locale, path, t, tx]);

  const leave = async () => {
    if (galleryHeld()) return;
    setLeaving(true);
    const res = await call(transport.setEdit(false, path));
    if (!res.ok) {
      setLeaving(false);
      notify.error(errorText(t, res.error));
      return;
    }
    router.refresh();
  };

  const close = useCallback(() => setOpen(null), []);
  const found = targets.length;
  const bulkGroups = info?.kind === "registry" ? info.page.bulk ?? [] : [];
  const hasToggles = info?.kind === "cms" && info.cms.toggles.length > 0;

  return (
    <>
      {hover && !open && (
        <div className={s.hover} {...{ [UI_ATTR]: "" }} aria-hidden="true"
          style={{ left: hover.box.x - 3, top: hover.box.y - 3, width: hover.box.w + 6, height: hover.box.h + 6 }}>
          <span className={cls(s.hoverLabel, hover.box.y < 90 && s.hoverLabelBelow)}>{hover.label}</span>
        </div>
      )}
      <div className={s.bar} role="toolbar" aria-label={t("ice.bar.label")} {...{ [UI_ATTR]: "" }}>
        <span className={s.dot} aria-hidden="true" />
        <span className={s.barTitle}>
          <strong>{ctx ? ctx.pageLabel : t("ice.loading")}</strong>
          <span>{t("ice.bar.mode")} · {path} · {t("ice.bar.count", { n: found })}</span>
        </span>
        <Btn small kind="ghost" disabled={!ctx} onClick={() => openPanel({ kind: "elements" })}>{t("ice.bar.elements")}</Btn>
        {bulkGroups.length > 0 && <Btn small kind="ghost" onClick={() => openPanel({ kind: "bulkGroups" })}>{t("ice.bar.bulk")}</Btn>}
        {hasToggles && <Btn small kind="ghost" onClick={() => openPanel({ kind: "visibility" })}>{t("ice.bar.visibility")}</Btn>}
        {hasGalleries(info, path) && (
          <Btn small kind="ghost" onClick={() => setOpen({ kind: "gallery", key: open?.kind === "gallery" ? open.key : null })}>
            {t("ice.bar.galleries")}
          </Btn>
        )}
        {faqPage !== "none" && <Btn small kind="ghost" disabled={!ctx} onClick={() => openPanel({ kind: "faq" })}>{t("ice.bar.faq")}</Btn>}
        <Btn small kind="ghost" disabled={!ctx} onClick={() => openPanel({ kind: "history" })}>{t("ice.bar.history")}</Btn>
        <Btn small kind="primary" disabled={leaving} onClick={() => void leave()}>{leaving ? t("ice.bar.leaving") : t("ice.bar.leave")}</Btn>
      </div>
      {ctx && open?.kind === "target" && (
        open.target.kind === "text" ? <TextPanel key={open.target.uid} ctx={ctx} target={open.target} onClose={close} />
        : open.target.kind === "cms" ? <CmsTextPanel key={open.target.uid} ctx={ctx} target={open.target} onClose={close} />
        : open.target.kind === "cmsMedia" ? <CmsMediaPanel key={open.target.uid} ctx={ctx} target={open.target} onClose={close} />
        : open.target.kind === "cmsLink" ? <CmsLinkPanel key={open.target.uid} ctx={ctx} target={open.target} onClose={close} />
        // A gallery never opens as a target (select() routes it to its own
        // panel below); nothing is drawn for one here.
        : open.target.kind === "gallery" ? null
        : open.target.element.kind === "pair" ? <PairPanel key={open.target.uid} ctx={ctx} element={open.target.element} onClose={close} />
        : open.target.element.kind === "samples" ? <SamplesPanel key={open.target.uid} ctx={ctx} element={open.target.element} onClose={close} />
        : <MediaPanel key={open.target.uid} ctx={ctx} element={open.target.element} onClose={close} />
      )}
      {ctx && open?.kind === "elements" && <ElementsPanel ctx={ctx} targets={targets} onPick={pickUid} onClose={close} />}
      {ctx && open?.kind === "history" && <PageHistoryPanel ctx={ctx} onOpen={pickUid} onClose={close} />}
      {ctx && open?.kind === "bulkGroups" && <BulkGroupsPanel ctx={ctx} onPick={(g) => setOpen({ kind: "bulk", group: g })} onClose={close} />}
      {ctx && open?.kind === "bulk" && <BulkPanel key={open.group} ctx={ctx} groupKey={open.group} onClose={close} />}
      {ctx && open?.kind === "visibility" && <VisibilityPanel ctx={ctx} onPick={pickUid} onClose={close} />}
      {ctx && open?.kind === "faq" && <FaqPanel ctx={ctx} page={faqPage === "none" ? null : faqPage} onClose={close} />}
      {ctx && open?.kind === "gallery" && hasGalleries(info, path) && (
        <GalleryPanel ctx={ctx} focusKey={isGalleryKey(open.key) ? open.key : null} onClose={close}
          onDirtyChange={(dirty) => { galleryDirty.current = dirty; }} />
      )}
    </>
  );
}
