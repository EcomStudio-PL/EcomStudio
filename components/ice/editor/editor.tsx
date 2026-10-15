"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/lib/notify";
import type { IceLocale, IcePageInfo, IceTransport } from "@/lib/ice/types";
import { UI_ATTR, hitTest, scanPage, targetElements, unionBox, type Target } from "./scan";
import { actionsTransport } from "./transport";
import { Btn, call, cls, errorText, pageLabel, roleLabel, sectionLabel, type EditorCtx, type T } from "./shared";
import { TextPanel } from "./text-panel";
import { CmsMediaPanel, CmsTextPanel, cmsFieldLabel } from "./cms-panel";
import { BulkGroupsPanel, ElementsPanel, PageHistoryPanel } from "./page-panels";
import { MediaPanel } from "./media-panel";
import { PairPanel } from "./pair-panel";
import { SamplesPanel } from "./samples-panel";
import { BulkPanel } from "./bulk-panel";
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
  | { kind: "bulk"; group: string };

type Hover = { box: { x: number; y: number; w: number; h: number }; label: string };

function labelOf(t: T, info: IcePageInfo, target: Target): string {
  if (target.kind === "cms" || target.kind === "cmsMedia") return cmsFieldLabel(t, target.field);
  const section = sectionLabel(t, info, target.element.id);
  return section ? `${section} · ${roleLabel(t, target.element)}` : roleLabel(t, target.element);
}

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
  }
  return null;
}

export default function Editor({ session, path, transport = actionsTransport }: {
  session: { nonce: string; path: string };
  path: string;
  transport?: IceTransport;
}) {
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

  const rescan = useCallback(() => {
    if (!info) return;
    setTargets(scanPage(info, session.nonce));
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
        el.setAttribute("data-ice-target", target.kind === "media" || target.kind === "cmsMedia" ? "media" : "text");
        marked.push(el);
      }
    }
    return () => marked.forEach((el) => el.removeAttribute("data-ice-target"));
  }, [targets]);
  useEffect(() => {
    if (open?.kind !== "target") return;
    const els = targetElements(open.target);
    els.forEach((el) => el.setAttribute("data-ice-selected", ""));
    return () => els.forEach((el) => el.removeAttribute("data-ice-selected"));
  }, [open]);

  const select = useCallback((target: Target) => {
    setHover(null);
    setOpen({ kind: "target", target });
  }, []);

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
      ?? (info ? detachedTarget(info, `t:${id}`) ?? detachedTarget(info, `m:${id}`) : null);
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
    const ui = (e: Event) => (e.target instanceof Element ? Boolean(e.target.closest(`[${UI_ATTR}]`)) : false);
    const warnLink = () => {
      if (Date.now() - lastWarn < 2500) return;
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
      if (hitTest(targetsRef.current, p.clientX, p.clientY)) {
        e.stopPropagation();
        // A slider would start dragging, a text would start a selection.
        if (e.type === "mousedown" || (e.type === "pointerdown" && (e as PointerEvent).pointerType === "mouse")) e.preventDefault();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (ui(e)) return;
      const hit = e.detail === 0 && e.clientX === 0 && e.clientY === 0 ? null : hitTest(targetsRef.current, e.clientX, e.clientY);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        select(hit.target);
        return;
      }
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("a[href], [role='link']")) {
        e.preventDefault();
        e.stopPropagation();
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

  const ctx: EditorCtx | null = useMemo(() => info && ({
    transport,
    path,
    locale: locale as IceLocale,
    info,
    t,
    pageLabel: pageLabel(t, info, path),
    reload: async () => {
      await loadInfo();
    },
    openBulk: (group: string) => setOpen({ kind: "bulk", group }),
  }), [info, loadInfo, locale, path, t, transport]);

  const leave = async () => {
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
        <Btn small kind="ghost" disabled={!ctx} onClick={() => setOpen({ kind: "elements" })}>{t("ice.bar.elements")}</Btn>
        {bulkGroups.length > 0 && <Btn small kind="ghost" onClick={() => setOpen({ kind: "bulkGroups" })}>{t("ice.bar.bulk")}</Btn>}
        <Btn small kind="ghost" disabled={!ctx} onClick={() => setOpen({ kind: "history" })}>{t("ice.bar.history")}</Btn>
        <Btn small kind="primary" disabled={leaving} onClick={() => void leave()}>{leaving ? t("ice.bar.leaving") : t("ice.bar.leave")}</Btn>
      </div>
      {ctx && open?.kind === "target" && (
        open.target.kind === "text" ? <TextPanel key={open.target.uid} ctx={ctx} target={open.target} onClose={close} />
        : open.target.kind === "cms" ? <CmsTextPanel key={open.target.uid} ctx={ctx} target={open.target} onClose={close} />
        : open.target.kind === "cmsMedia" ? <CmsMediaPanel key={open.target.uid} ctx={ctx} target={open.target} onClose={close} />
        : open.target.element.kind === "pair" ? <PairPanel key={open.target.uid} ctx={ctx} element={open.target.element} onClose={close} />
        : open.target.element.kind === "samples" ? <SamplesPanel key={open.target.uid} ctx={ctx} element={open.target.element} onClose={close} />
        : <MediaPanel key={open.target.uid} ctx={ctx} element={open.target.element} onClose={close} />
      )}
      {ctx && open?.kind === "elements" && <ElementsPanel ctx={ctx} targets={targets} onPick={pickUid} onClose={close} />}
      {ctx && open?.kind === "history" && <PageHistoryPanel ctx={ctx} onOpen={pickUid} onClose={close} />}
      {ctx && open?.kind === "bulkGroups" && <BulkGroupsPanel ctx={ctx} onPick={(g) => setOpen({ kind: "bulk", group: g })} onClose={close} />}
      {ctx && open?.kind === "bulk" && <BulkPanel key={open.group} ctx={ctx} groupKey={open.group} onClose={close} />}
    </>
  );
}
