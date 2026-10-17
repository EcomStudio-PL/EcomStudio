"use client";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown, ArrowUp, BookOpen, Check, Eye, EyeOff, ImageIcon, Monitor, Plus, RefreshCw, RotateCcw, Smartphone, Trash2,
} from "lucide-react";
import { toast } from "@/lib/notify";
import { I18nScope, useI18n } from "@/lib/i18n/provider";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { normaliseText } from "@/lib/ice/validate";
import { hasInvisible } from "@/lib/ice/stega";
import { cn, formatInstant } from "@/lib/utils";
import { saveToolGuideAction, showToolGuideAgainAction } from "@/app/actions/tool-guides";
import type { LibraryItem } from "@/lib/services/media-slots";
import {
  GUIDE_ARTS, GUIDE_LIMITS, GUIDE_MAX_STEPS, guideHasStarter, guideSurface, normalizeGuideContent,
  type GuideArt, type GuideContent, type GuideImage, type GuideProblem, type GuideToolKey,
  type LocaleText, type ResolvedGuide,
} from "@/lib/tool-guides";
import { AssetPicker } from "@/components/admin/media/asset-picker";
import { GuideArtwork } from "@/components/tool-guide/guide-art";
import { StarterGallery } from "@/components/tool-guide/starter-gallery";
import { TutorialModal } from "@/components/tool-guide/tutorial-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/record";

/**
 * THE TUTORIAL AND STARTER GALLERY OF ONE TOOL, EDITED — the tool's
 * Samouczek tab.
 *
 * One form for both parts, saved together by saveToolGuideAction (which
 * validates everything again — this file mirrors its rules for the admin's
 * sake only). "Pokaż ponownie wszystkim" is the one other write, and it is
 * deliberately separate (showToolGuideAgainAction): it raises the version of
 * what is ALREADY published and nothing else. Three things shape the form:
 *
 *  · THE SHIPPED COPY IS A STATE, NOT A STARTING TEXT. Until an admin changes
 *    a word, the guide is saved as `content: null`, so an improved default in
 *    the dictionaries still reaches this tool. Any edit to text, steps or
 *    illustrations turns that off; "Przywróć domyślne teksty" turns it back on.
 *  · A STEP CARRIES ITS PICTURE. Pictures are media slots keyed by POSITION
 *    (`guide.<tool>.tutorial.<n>`), so the form keeps each step's library file
 *    on the step itself and sends them in order: moving a step moves its
 *    texts, its illustration and its photo together.
 *  · THE PREVIEW IS THE CUSTOMER'S UI. The same TutorialModal and
 *    StarterGallery the tool screens render, fed through the same fallbacks
 *    resolveGuide applies (a missing language → Polish → the shipped text),
 *    so what the admin approves here is what a seller sees. Each step card
 *    shows its picture in the tutorial's own frame for the same reason.
 *
 * Presentation only: nothing here reaches a model, a provider or a price.
 */

type Text3 = Record<Locale, string>;

type StepForm = {
  /** React identity only — survives reordering so a moved step keeps focus
   *  and its inputs; never sent anywhere. */
  uid: string;
  title: Text3;
  body: Text3;
  art: GuideArt;
  imageId: string | null;
};

type Form = {
  tutorialEnabled: boolean;
  starterEnabled: boolean;
  /** Save as `content: null` (the shipped copy). */
  useDefault: boolean;
  tutorial: { title: Text3; body: Text3 };
  steps: StepForm[];
  starter: { title: Text3; body: Text3; imageId: string | null };
};

type FieldProblem = Extract<GuideProblem, "required" | "too_long" | "markup" | "invisible">;
type Tutorial = NonNullable<ResolvedGuide["tutorial"]>;
type Starter = NonNullable<ResolvedGuide["starter"]>;

export type ToolGuideEditorProps = {
  tool: GuideToolKey;
  /** The shipped copy in all three languages (defaultGuideContent). */
  defaults: GuideContent;
  initial: {
    tutorialEnabled: boolean;
    starterEnabled: boolean;
    /** The saved copy; null = the shipped default. */
    content: GuideContent | null;
    /** Library asset per tutorial position (GUIDE_MAX_STEPS long). */
    stepImages: (string | null)[];
    starterImage: string | null;
    /** updated_at of the row the form was opened on; null = no row yet. */
    base: string | null;
    /** Per picture slot key, its updated_at when the form opened (null = no
     *  slot yet) — the pictures' own compare-and-set base. */
    imageBases: Record<string, string | null>;
    version: number;
  };
  /** What customers get right now, read on the server for this render. */
  status: {
    /** toolIsLive(…, { admin: false }): the tool runs for customers, so they
     *  can see its tutorial and starter gallery at all. */
    live: boolean;
    /** The switchboard status ("Wkrótce", …) when it is not ACTIVE, already
     *  in the admin's language; null = ACTIVE. */
    availability: string | null;
    /** Who saved the row `initial.base` describes (full name or e-mail), when
     *  readable; null = unknown or never saved. */
    savedBy: string | null;
  };
  library: LibraryItem[];
  /** What the starter shows with no picture chosen: the tool's catalogue
   *  picture, resolved server-side; null = the drawn showcase. */
  catalogueImage: GuideImage | null;
  /** The tutorial's and starter's own words (`toolGuide`) per language, so
   *  a preview reads like the customer's screen in the language shown. */
  chrome: Record<Locale, Record<string, unknown>>;
};

/** Every code saveToolGuideAction / showToolGuideAgainAction can answer with
 *  — each has its own sentence under aicc "guide.error.*"; anything else
 *  reads as generic. */
const ERROR_CODES = new Set([
  "unknown_tool", "invalid_shape", "invalid_steps_min", "invalid_steps_max", "invalid_art", "invalid_too_long",
  "invalid_invisible", "invalid_markup", "invalid_required", "invalid_image", "migration_pending", "conflict",
  "conflict_images", "images_failed", "unauthenticated", "not_admin", "step_up_required", "generic",
]);

/** The database's bound on tutorial_version (0142) — "show again" stops there. */
const MAX_VERSION = 1000000;

/** The tutorial's picture backdrop (components/tool-guide/tutorial-modal.tsx). */
const STEP_BACKDROP = "linear-gradient(160deg, rgb(var(--accent) / 0.07), rgb(var(--raised) / 0.9) 45%, rgb(var(--violet) / 0.07))";

/* ── PURE HELPERS ──────────────────────────────────────────────────────── */

const text3 = (v: LocaleText | undefined): Text3 =>
  Object.fromEntries(LOCALES.map((l) => [l, v?.[l] ?? ""])) as Text3;

/** The tidy-up normalizeGuideContent applies before it measures: one
 *  paragraph per field, whitespace collapsed. Counters count THIS length. */
const clean = (raw: string) => normaliseText(raw.replace(/[\r\n]+/g, " "));

/** One field against the rules lib/tool-guides.ts cleanText enforces, in the
 *  same order, so the inline message names the problem the save would. */
function problemOf(raw: string, max: number, required: boolean): FieldProblem | null {
  const text = clean(raw);
  if (!text) return required ? "required" : null;
  if (text.length > max) return "too_long";
  if (/[<>]/.test(text)) return "markup";
  if (hasInvisible(text)) return "invisible";
  return null;
}

/** Every text field the admin can see, with its limit; a title is required
 *  in Polish. A screen without a starter gallery shows no starter fields. */
function fieldsOf(form: Form, hasStarter: boolean): { value: Text3; max: number; required: boolean }[] {
  return [
    { value: form.tutorial.title, max: GUIDE_LIMITS.tutorialTitle, required: true },
    { value: form.tutorial.body, max: GUIDE_LIMITS.tutorialBody, required: false },
    ...form.steps.flatMap((s) => [
      { value: s.title, max: GUIDE_LIMITS.stepTitle, required: true },
      { value: s.body, max: GUIDE_LIMITS.stepBody, required: false },
    ]),
    ...(hasStarter ? [
      { value: form.starter.title, max: GUIDE_LIMITS.starterTitle, required: true },
      { value: form.starter.body, max: GUIDE_LIMITS.starterBody, required: false },
    ] : []),
  ];
}

function contentOf(form: Form, hasStarter: boolean): GuideContent {
  // A screen without a starter gallery never shows starter copy (resolveGuide
  // sends none, and its fields are hidden here), yet the validator wants a
  // Polish starter title. A blank one borrows the tutorial's, so the admin is
  // never stopped by a field they cannot see.
  const starterTitle = hasStarter || clean(form.starter.title.pl)
    ? form.starter.title : { ...form.starter.title, pl: form.tutorial.title.pl };
  return {
    tutorial: {
      title: form.tutorial.title,
      body: form.tutorial.body,
      steps: form.steps.map((s) => ({ title: s.title, body: s.body, art: s.art })),
    },
    starter: { title: starterTitle, body: form.starter.body },
  };
}

/** What "unchanged" is measured against. Step uids are left out: they are
 *  identity, not content. */
function snapshot(form: Form): string {
  return JSON.stringify({
    ...form,
    steps: form.steps.map((s) => [s.title, s.body, s.art, s.imageId]),
  });
}

function stepsFrom(content: GuideContent, images: (string | null)[], uid: (i: number) => string): StepForm[] {
  return content.tutorial.steps.map((s, i) => ({
    uid: uid(i), title: text3(s.title), body: text3(s.body), art: s.art, imageId: images[i] ?? null,
  }));
}

function initialForm(initial: ToolGuideEditorProps["initial"], defaults: GuideContent): Form {
  const content = initial.content ?? defaults;
  return {
    tutorialEnabled: initial.tutorialEnabled,
    starterEnabled: initial.starterEnabled,
    useDefault: initial.content === null,
    tutorial: { title: text3(content.tutorial.title), body: text3(content.tutorial.body) },
    steps: stepsFrom(content, initial.stepImages, (i) => `i${i}`),
    starter: { title: text3(content.starter.title), body: text3(content.starter.body), imageId: initial.starterImage },
  };
}

/** resolveGuide's pick() (lib/server/tool-guides.ts): this language, else
 *  Polish, else the shipped text. */
function pick(saved: LocaleText | undefined, fallback: LocaleText, l: Locale): string {
  return clean(saved?.[l] ?? "") || clean(saved?.pl ?? "") || fallback[l] || fallback.pl || "";
}

/** A library file as the customer's screen receives a picture. */
function guideImage(item: LibraryItem | null | undefined): GuideImage | null {
  return item?.url
    ? { url: item.url, width: item.width ?? undefined, height: item.height ?? undefined, alt: item.alt ?? "" }
    : null;
}

/** The drawing each screen's empty gallery falls back to — what the tool
 *  screens pass to StarterGallery (the generators' default, the photo tools'
 *  before/after, the batch tools their own). */
function starterArt(tool: GuideToolKey): GuideArt {
  if (tool === "resize" || tool === "compress") return tool;
  return guideSurface(tool) === "photo" ? "compare" : "result";
}

/* ── THE EDITOR ────────────────────────────────────────────────────────── */

export function ToolGuideEditor({ tool, defaults, initial, status, library, catalogueImage, chrome }: ToolGuideEditorProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  // The workbenches and the editor have no results gallery: no starter.
  const hasStarter = guideHasStarter(tool);

  const [form, setForm] = useState<Form>(() => initialForm(initial, defaults));
  const [saved, setSaved] = useState<string>(() => snapshot(initialForm(initial, defaults)));
  const [base, setBase] = useState<string | null>(initial.base);
  const [imageBases, setImageBases] = useState(initial.imageBases);
  const [version, setVersion] = useState(initial.version);
  const [lang, setLang] = useState<Locale>("pl");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [picker, setPicker] = useState<{ step: string } | { starter: true } | null>(null);
  const [picked, setPicked] = useState<LibraryItem[]>([]);
  /** The tutorial preview, open at this step (0-based); null = closed. */
  const [tutorialOpen, setTutorialOpen] = useState<number | null>(null);
  const [starterPreview, setStarterPreview] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  /** The step (uid) a delete is waiting to be confirmed for. */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /** The step (uid) whose "Zmień ilustrację" chooser is open. */
  const [chooser, setChooser] = useState<string | null>(null);
  /** The last write of this session that went live, kept on screen (a toast
   *  fades; "published at" should not). */
  const [published, setPublished] = useState<{ at: string; again: boolean; version: number } | null>(null);
  const seq = useRef(0);
  const fresh = () => `n${++seq.current}`;

  /**
   * THE COMPARE-AND-SET BASES AFTER A SAVE. A success answers with the row's
   * own time and the pictures' (the action compares instants, not
   * spellings); the refreshed server props confirm them. A failed save wrote
   * nothing, so the bases stay. State, not a ref, so it holds whichever
   * arrives first — the refreshed props or the action's answer.
   */
  const [adoptWant, setAdoptWant] = useState<{ at: string } | null>(null);
  useEffect(() => {
    if (!adoptWant || !initial.base) return;
    if (Date.parse(initial.base) !== Date.parse(adoptWant.at)) return;
    setAdoptWant(null);
    setBase(initial.base);
    setImageBases(initial.imageBases);
    setVersion(initial.version);
  }, [adoptWant, initial.base, initial.imageBases, initial.version]);

  const dirty = snapshot(form) !== saved;
  const items = useMemo(() => new Map([...library, ...picked].map((a) => [a.id, a])), [library, picked]);
  const itemOf = (id: string | null) => (id ? items.get(id) ?? null : null);

  // Inline problems for the language on screen; the language switch marks
  // the others. The shipped copy is not the admin's to fix.
  const fieldProblem = (value: Text3, max: number, required: boolean): FieldProblem | null =>
    form.useDefault ? null : problemOf(value[lang], max, required && lang === "pl");
  const badLocales = form.useDefault ? [] : LOCALES.filter((l) =>
    fieldsOf(form, hasStarter).some((f) => problemOf(f.value[l], f.max, f.required && l === "pl") !== null));

  /* ── edits ── */

  /** A change to the copy: from now on the admin's own, saved as written. */
  const edit = (fn: (f: Form) => Form) => {
    setError(null);
    setForm((f) => ({ ...fn(f), useDefault: false }));
  };
  /** A change that is not copy (switches, pictures). */
  const set = (fn: (f: Form) => Form) => {
    setError(null);
    setForm(fn);
  };
  const inLang = (v: Text3, next: string): Text3 => ({ ...v, [lang]: next });
  const patchStep = (uid: string, fn: (s: StepForm) => StepForm, copy = true) =>
    (copy ? edit : set)((f) => ({ ...f, steps: f.steps.map((s) => (s.uid === uid ? fn(s) : s)) }));
  const move = (i: number, by: -1 | 1) => edit((f) => {
    const j = i + by;
    if (j < 0 || j >= f.steps.length) return f;
    const steps = [...f.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...f, steps };
  });
  const removeStep = (uid: string) => edit((f) => (f.steps.length <= 1 ? f : { ...f, steps: f.steps.filter((s) => s.uid !== uid) }));
  const addStep = () => edit((f) => (f.steps.length >= GUIDE_MAX_STEPS ? f : {
    ...f, steps: [...f.steps, { uid: fresh(), title: text3(undefined), body: text3(undefined), art: "settings", imageId: null }],
  }));

  /** A drawing chosen in "Zmień ilustrację" is what the step shows from now
   *  on, so a photo lying over it goes (the drawing is copy; the photo is a
   *  picture — the same split the rest of the form keeps). */
  function chooseArt(uid: string, art: GuideArt) {
    const step = form.steps.find((s) => s.uid === uid);
    setChooser(null);
    if (!step) return;
    if (step.art !== art) patchStep(uid, (s) => ({ ...s, art, imageId: null }));
    else if (step.imageId) patchStep(uid, (s) => ({ ...s, imageId: null }), false);
  }

  /** Back to the shipped copy in every language. Pictures stay, by position:
   *  they are the admin's choice, not part of the copy. */
  function resetToDefaults() {
    setError(null);
    setForm((f) => ({
      ...f,
      useDefault: true,
      tutorial: { title: text3(defaults.tutorial.title), body: text3(defaults.tutorial.body) },
      steps: stepsFrom(defaults, f.steps.map((s) => s.imageId), () => fresh()),
      starter: { ...f.starter, title: text3(defaults.starter.title), body: text3(defaults.starter.body) },
    }));
    setConfirmReset(false);
  }

  function onPick(item: LibraryItem) {
    // A file uploaded inside the picker is not in the server's list until the
    // page reloads; remember it so its thumbnail and preview resolve now.
    setPicked((p) => (items.has(item.id) ? p : [...p, item]));
    if (!picker) return;
    if ("starter" in picker) set((f) => ({ ...f, starter: { ...f.starter, imageId: item.id } }));
    else patchStep(picker.step, (s) => ({ ...s, imageId: item.id }), false);
  }

  /* ── preview: the customer's resolution of this form ── */

  const previewTutorial = useMemo<Tutorial>(() => {
    const custom = !form.useDefault;
    const shippedSteps = defaults.tutorial.steps;
    return {
      title: pick(custom ? form.tutorial.title : undefined, defaults.tutorial.title, lang),
      // An intro the admin left empty stays empty, as resolveGuide does.
      body: pick(custom ? form.tutorial.body : undefined, custom ? {} : defaults.tutorial.body, lang),
      steps: form.steps.map((s, i) => {
        // As resolveGuide: the admin's steps fall back to their own Polish,
        // never to whichever shipped step sat at that position; only a title
        // may not end up blank.
        const shipped = shippedSteps[Math.min(i, shippedSteps.length - 1)];
        const fallback = custom ? { title: {}, body: {} } : shipped;
        return {
          title: pick(s.title, fallback.title, lang) || pick(undefined, shipped.title, lang),
          body: pick(s.body, fallback.body, lang),
          art: s.art,
          image: s.imageId ? guideImage(items.get(s.imageId)) : null,
        };
      }),
    };
  }, [form, defaults, lang, items]);

  // The preview's own words in the language being previewed.
  const previewWords = useMemo(() => ({ toolGuide: chrome[lang] }), [chrome, lang]);

  // As resolveGuide: the chosen picture, else the tool's catalogue picture,
  // else (null) the drawn showcase.
  const previewStarter: Starter = {
    title: pick(form.useDefault ? undefined : form.starter.title, defaults.starter.title, lang),
    body: pick(form.useDefault ? undefined : form.starter.body, form.useDefault ? defaults.starter.body : {}, lang),
    image: guideImage(itemOf(form.starter.imageId)) ?? catalogueImage,
  };

  /* ── save ── */

  const errorText = (code: string) =>
    t(`aicc.guide.error.${ERROR_CODES.has(code) ? code : "generic"}`, { max: GUIDE_MAX_STEPS });
  const reload = () => window.location.reload();

  function save() {
    setError(null);
    let content: GuideContent | null = null;
    if (!form.useDefault) {
      const n = normalizeGuideContent(contentOf(form, hasStarter));
      if (!n.ok) {
        const where = badLocales.length > 0
          ? ` ${t("aicc.guide.fixErrors", { langs: badLocales.map((l) => l.toUpperCase()).join(", ") })}` : "";
        setError(`${errorText(`invalid_${n.problem}`)}${where}`);
        // Put the admin where the problem is.
        if (badLocales.length > 0 && !badLocales.includes(lang)) setLang(badLocales[0]);
        return;
      }
      content = n.content;
    }
    const sent = form;
    const sentBase = base;
    start(async () => {
      const res = await saveToolGuideAction({
        tool,
        tutorialEnabled: sent.tutorialEnabled,
        // Never touched on a screen without a starter gallery: sent as it was.
        starterEnabled: sent.starterEnabled,
        content,
        images: { steps: sent.steps.map((s) => s.imageId), starter: sent.starter.imageId },
        base: sentBase,
        imageBases,
        // "Show again" is its own action now; a save never raises the version.
        showAgain: false,
      });
      if (res.ok) {
        // Functional updates: an edit made while the request was in flight
        // stays in the form and keeps it dirty.
        setSaved(snapshot(sent));
        setConflict(false);
        if (res.data) {
          setBase(res.data.updatedAt);
          setImageBases(res.data.imageBases);
          setVersion(res.data.version);
          setAdoptWant({ at: res.data.updatedAt });
          setPublished({ at: res.data.updatedAt, again: false, version: res.data.version });
        }
        toast.success(t("aicc.guide.saved"));
        router.refresh();
        return;
      }
      if (res.error === "conflict") {
        // Nothing was written: someone else saved first. Their version is
        // only one reload away; overwriting it silently is not an option.
        setConflict(true);
        toast.error(errorText("conflict"), { action: { label: t("aicc.guide.reload"), onClick: reload } });
        return;
      }
      // Every other failure wrote nothing: the form stays as it is, dirty,
      // so "Zapisz i opublikuj" simply tries again.
      setError(errorText(res.error));
      toast.error(errorText(res.error), res.error === "conflict_images"
        ? { action: { label: t("aicc.guide.reload"), onClick: reload } } : undefined);
    });
  }

  /**
   * "Pokaż ponownie wszystkim", confirmed: the published guide's version goes
   * up by one and nothing else changes. Offered only on a clean form, so what
   * opens again for everyone is exactly what is on screen; the form and its
   * saved snapshot are left alone either way.
   */
  function showAgain() {
    const sentBase = base;
    setError(null);
    start(async () => {
      const res = await showToolGuideAgainAction({ tool, base: sentBase });
      setConfirmAgain(false);
      if (res.ok) {
        setConflict(false);
        if (res.data) {
          setBase(res.data.updatedAt);
          setVersion(res.data.version);
          setAdoptWant({ at: res.data.updatedAt });
          setPublished({ at: res.data.updatedAt, again: true, version: res.data.version });
        }
        toast.success(t("aicc.guide.again.done", { n: res.data?.version ?? version + 1 }));
        router.refresh();
        return;
      }
      if (res.error === "conflict") {
        setConflict(true);
        toast.error(errorText("conflict"), { action: { label: t("aicc.guide.reload"), onClick: reload } });
        return;
      }
      setError(errorText(res.error));
      toast.error(errorText(res.error));
    });
  }

  /* ── render ── */

  const L = lang.toUpperCase();
  const fid = (name: string) => `${ids}-${name}-${lang}`;
  const pickerItem = picker && "step" in picker ? form.steps.find((s) => s.uid === picker.step) : null;
  const chooserIndex = chooser ? form.steps.findIndex((s) => s.uid === chooser) : -1;
  const chooserStep = chooserIndex >= 0 ? form.steps[chooserIndex] : null;
  const removeIndex = confirmRemove ? form.steps.findIndex((s) => s.uid === confirmRemove) : -1;

  // Who saved: only while the server's facts describe the row on screen (a
  // save of this session is attributed once the refreshed props arrive).
  const savedBy = status.savedBy && base && initial.base && Date.parse(base) === Date.parse(initial.base)
    ? status.savedBy : null;
  const atMax = version >= MAX_VERSION;
  const againDisabled = pending || dirty || conflict || !form.tutorialEnabled || atMax;
  const againHint = dirty ? t("aicc.guide.again.dirtyHint")
    : !form.tutorialEnabled ? t("aicc.guide.again.offHint")
    : atMax ? t("aicc.guide.again.maxHint")
    : t("aicc.guide.again.hint", { n: version, next: version + 1 });
  const publishedLine = published
    ? published.again
      ? t("aicc.guide.status.shownAgainAt", { when: formatInstant(published.at, locale), n: published.version })
      : t("aicc.guide.status.publishedAt", { when: formatInstant(published.at, locale) })
    : null;

  return (
    <div className="space-y-6" data-tool-guide-editor={tool}>
      {/* ── A. USTAWIENIA I STATUS ────────────────────────────────────── */}
      <section aria-labelledby={`${ids}-set`} className="space-y-4" data-guide-settings>
        <h3 id={`${ids}-set`} className="font-display text-[15px] font-semibold">{t("aicc.guide.settings.heading")}</h3>
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <div className="space-y-4">
            {/* THE SWITCHES — the starter's only where a starter can exist. */}
            <div className={cn("grid gap-3", hasStarter && "sm:grid-cols-2")}>
              <SwitchRow checked={form.tutorialEnabled} label={t("aicc.guide.tutorialEnabled")} hint={t("aicc.guide.tutorialEnabledHint")}
                onChange={(v) => set((f) => ({ ...f, tutorialEnabled: v }))} />
              {hasStarter && (
                <SwitchRow checked={form.starterEnabled} label={t("aicc.guide.starterEnabled")} hint={t("aicc.guide.starterEnabledHint")}
                  onChange={(v) => set((f) => ({ ...f, starterEnabled: v }))} />
              )}
            </div>

            {/* LANGUAGE — which locale's copy the fields below edit. */}
            <div>
              <p className="mb-1.5 text-[13px] font-semibold tracking-tight">{t("aicc.guide.lang.label")}</p>
              <Segmented className="max-w-md" label={t("aicc.guide.lang.label")} value={lang}
                onChange={(v) => setLang(v as Locale)}
                options={LOCALES.map((l) => ({
                  value: l,
                  label: l.toUpperCase(),
                  meta: badLocales.includes(l) ? t("aicc.guide.lang.hasErrors")
                    : l === "pl" ? t("aicc.guide.lang.required") : t("aicc.guide.lang.optional"),
                }))} />
              <p className="mt-1.5 text-[11.5px] text-faint">{t("aicc.guide.lang.hint")}</p>
            </div>
          </div>

          {/* STATUS — what is published, since when, by whom, and whether a
              customer can see any of it right now. */}
          <div className="rounded-xl border border-line bg-sunken/40 p-4" role="group" aria-labelledby={`${ids}-status`} data-guide-status>
            <p id={`${ids}-status`} className="text-[13px] font-semibold tracking-tight">{t("aicc.guide.status.heading")}</p>
            <dl className="mt-3 space-y-2.5 text-[12.5px]">
              <Fact label={t("aicc.guide.status.publication")}>
                {base
                  ? <Badge tone="success" dot>{t("aicc.guide.status.saved")}</Badge>
                  : <Badge tone="neutral">{t("aicc.guide.status.neverSaved")}</Badge>}
              </Fact>
              {base && (
                <Fact label={t("aicc.guide.status.lastSaved")}>
                  <time dateTime={base} data-guide-saved-at>{formatInstant(base, locale)}</time>
                  {savedBy && <span className="block break-words text-muted" data-guide-saved-by>{t("aicc.guide.status.by", { name: savedBy })}</span>}
                </Fact>
              )}
              <Fact label={t("aicc.guide.status.copy")}>
                <Badge tone={form.useDefault ? "neutral" : "accent"}>
                  {form.useDefault ? t("aicc.guide.usingDefault") : t("aicc.guide.usingCustom")}
                </Badge>
              </Fact>
              <Fact label={t("aicc.guide.status.version")}>
                <span className="tabular-nums" data-guide-version>{version}</span>
              </Fact>
              <Fact label={t("aicc.guide.status.steps")}>
                <span className="tabular-nums">{form.steps.length}</span>
              </Fact>
              <Fact label={t("aicc.guide.status.customers")}>
                <span data-guide-live={status.live ? "yes" : "no"}>
                  {status.live
                    ? <Badge tone="success" dot>{t("aicc.guide.status.live")}</Badge>
                    : <Badge tone="warning" dot>{t("aicc.guide.status.notLive")}</Badge>}
                </span>
              </Fact>
            </dl>
            {!base && <p className="mt-3 text-[11.5px] leading-relaxed text-muted">{t("aicc.guide.status.neverSavedHint")}</p>}
            {status.live ? (
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted">{t("aicc.guide.status.liveHint")}</p>
            ) : (
              <p className="mt-3 rounded-lg bg-[rgb(var(--warning)/0.08)] px-3 py-2 text-[12px] leading-relaxed text-ink" data-guide-not-live>
                {status.availability
                  ? t("aicc.guide.status.notLiveStatus", { status: status.availability })
                  : t("aicc.guide.status.notLiveRun")}
              </p>
            )}
            {/* Always in the DOM (empty until a write of this session goes
                live), so the announcement is not lost on its first fill. */}
            <p aria-live="polite" className={cn("flex items-start gap-1.5 text-[12px] font-medium text-success", publishedLine && "mt-3")}
              data-guide-published>
              {publishedLine && <><Check size={14} aria-hidden className="mt-px shrink-0" /><span className="min-w-0">{publishedLine}</span></>}
            </p>

            {/* SHOW AGAIN — a version bump of what is published, confirmed. */}
            <div className="mt-3 border-t border-line pt-3">
              <Button size="sm" variant="secondary" onClick={() => setConfirmAgain(true)} disabled={againDisabled}
                aria-haspopup="dialog" aria-describedby={`${ids}-again-hint`} data-guide-show-again>
                <RefreshCw size={14} aria-hidden /> {t("aicc.guide.again.button")}
              </Button>
              <p id={`${ids}-again-hint`} className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{againHint}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── B. SAMOUCZEK ──────────────────────────────────────────────── */}
      <section aria-labelledby={`${ids}-tut`} className="space-y-4 border-t border-line pt-5" data-guide-tutorial-form>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${ids}-tut`} className="font-display text-[15px] font-semibold">{t("aicc.guide.tutorial.heading")}</h3>
          <Button size="sm" variant="secondary" onClick={() => setTutorialOpen(0)} aria-haspopup="dialog" data-guide-preview-tutorial>
            <BookOpen size={14} aria-hidden /> {t("aicc.guide.preview.tutorial")}
            <span className="text-[11px] font-semibold text-faint">{L}</span>
          </Button>
        </div>
        {!form.tutorialEnabled && (
          <p className="rounded-xl bg-raised px-3.5 py-2.5 text-[12.5px] text-muted">{t("aicc.guide.preview.offTutorial")}</p>
        )}
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
          <TextField id={fid("tt")} label={`${t("aicc.guide.tutorial.title")} · ${L}`} lang={lang} required
            value={form.tutorial.title[lang]} max={GUIDE_LIMITS.tutorialTitle}
            problem={fieldProblem(form.tutorial.title, GUIDE_LIMITS.tutorialTitle, true)}
            onChange={(v) => edit((f) => ({ ...f, tutorial: { ...f.tutorial, title: inLang(f.tutorial.title, v) } }))} />
          <TextField id={fid("tb")} label={`${t("aicc.guide.tutorial.body")} · ${L}`} lang={lang} multiline rows={3}
            value={form.tutorial.body[lang]} max={GUIDE_LIMITS.tutorialBody}
            problem={fieldProblem(form.tutorial.body, GUIDE_LIMITS.tutorialBody, false)}
            onChange={(v) => edit((f) => ({ ...f, tutorial: { ...f.tutorial, body: inLang(f.tutorial.body, v) } }))} />
        </div>

        <div>
          <p className="text-[13px] font-semibold tracking-tight">
            {t("aicc.guide.steps.heading", { n: form.steps.length, max: GUIDE_MAX_STEPS })}
          </p>
          <ol className="mt-2 space-y-3">
            {form.steps.map((s, i) => {
              const n = i + 1;
              const item = itemOf(s.imageId);
              // Exactly what the tutorial will draw for this step.
              const shown = previewTutorial.steps[i];
              return (
                <li key={s.uid} className="rounded-xl border border-line p-3 sm:p-4" data-guide-step-form={n}
                  aria-labelledby={`${ids}-${s.uid}-h`}>
                  <div className="flex items-center justify-between gap-2">
                    <h4 id={`${ids}-${s.uid}-h`} className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-[12px] font-bold text-accent">{n}</span>
                      {t("aicc.guide.step.label", { n })}
                    </h4>
                    <span className="flex shrink-0 gap-1">
                      <IconButton label={t("aicc.guide.step.preview", { n })} onClick={() => setTutorialOpen(i)} haspopup data-guide-step-preview={n}>
                        <Eye size={14} aria-hidden />
                      </IconButton>
                      <IconButton label={t("aicc.guide.step.up", { n })} onClick={() => move(i, -1)} disabled={i === 0}>
                        <ArrowUp size={14} aria-hidden />
                      </IconButton>
                      <IconButton label={t("aicc.guide.step.down", { n })} onClick={() => move(i, 1)} disabled={i === form.steps.length - 1}>
                        <ArrowDown size={14} aria-hidden />
                      </IconButton>
                      <IconButton label={t("aicc.guide.step.remove", { n })} onClick={() => setConfirmRemove(s.uid)} disabled={form.steps.length <= 1} haspopup>
                        <Trash2 size={14} aria-hidden />
                      </IconButton>
                    </span>
                  </div>
                  <div className="mt-3 grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-3">
                      <TextField id={fid(`${s.uid}-t`)} label={`${t("aicc.guide.step.title")} · ${L}`} lang={lang} required
                        value={s.title[lang]} max={GUIDE_LIMITS.stepTitle}
                        problem={fieldProblem(s.title, GUIDE_LIMITS.stepTitle, true)}
                        onChange={(v) => patchStep(s.uid, (x) => ({ ...x, title: inLang(x.title, v) }))} />
                      <TextField id={fid(`${s.uid}-b`)} label={`${t("aicc.guide.step.body")} · ${L}`} lang={lang} multiline rows={3}
                        value={s.body[lang]} max={GUIDE_LIMITS.stepBody}
                        problem={fieldProblem(s.body, GUIDE_LIMITS.stepBody, false)}
                        onChange={(v) => patchStep(s.uid, (x) => ({ ...x, body: inLang(x.body, v) }))} />
                    </div>
                    <div data-guide-step-illustration={shown?.image ? "photo" : "art"}>
                      <p className="mb-1.5 text-[13px] font-semibold tracking-tight">{t("aicc.guide.illustration.current")}</p>
                      <StepIllustration image={shown?.image ?? null} art={s.art} />
                      <p className="mt-1.5 break-words text-[11.5px] leading-relaxed text-muted">
                        {shown?.image
                          ? t("aicc.guide.illustration.photo", { name: item?.title ?? t("aicc.guide.untitled") })
                          : s.imageId
                            ? t("aicc.guide.unknownPhoto")
                            : t("aicc.guide.illustration.drawing", { name: t(`aicc.guide.art.${s.art}`) })}
                        {shown?.image && item?.width && item.height
                          ? <span className="tabular-nums text-faint"> · {item.width}×{item.height}</span> : null}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setChooser(s.uid)} aria-haspopup="dialog" data-guide-change-illustration={n}>
                          <ImageIcon size={14} aria-hidden /> {t("aicc.guide.illustration.change")}
                        </Button>
                        {s.imageId && (
                          <Button size="sm" variant="ghost" onClick={() => patchStep(s.uid, (x) => ({ ...x, imageId: null }), false)}>
                            {t("aicc.guide.illustration.removePhoto")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={addStep} disabled={form.steps.length >= GUIDE_MAX_STEPS}>
              <Plus size={14} aria-hidden /> {t("aicc.guide.step.add")}
            </Button>
            {form.steps.length >= GUIDE_MAX_STEPS && (
              <span className="text-[11.5px] text-faint">{t("aicc.guide.step.maxReached", { max: GUIDE_MAX_STEPS })}</span>
            )}
          </div>
        </div>
      </section>

      {/* ── C. GALERIA STARTOWA ───────────────────────────────────────── */}
      {hasStarter ? (
        <section aria-labelledby={`${ids}-sta`} className="space-y-4 border-t border-line pt-5" data-guide-starter-form>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${ids}-sta`} className="font-display text-[15px] font-semibold">{t("aicc.guide.starter.heading")}</h3>
            <Button size="sm" variant="secondary" onClick={() => setStarterPreview((v) => !v)} aria-expanded={starterPreview}
              aria-controls={`${ids}-sta-preview`} data-guide-preview-starter>
              {starterPreview ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              {starterPreview ? t("aicc.guide.preview.hideStarter") : t("aicc.guide.preview.starter")}
              <span className="text-[11px] font-semibold text-faint">{L}</span>
            </Button>
          </div>
          {!form.starterEnabled && (
            <p className="rounded-xl bg-raised px-3.5 py-2.5 text-[12.5px] text-muted">{t("aicc.guide.preview.offStarter")}</p>
          )}
          <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <TextField id={fid("st")} label={`${t("aicc.guide.starter.title")} · ${L}`} lang={lang} required
                value={form.starter.title[lang]} max={GUIDE_LIMITS.starterTitle}
                problem={fieldProblem(form.starter.title, GUIDE_LIMITS.starterTitle, true)}
                onChange={(v) => edit((f) => ({ ...f, starter: { ...f.starter, title: inLang(f.starter.title, v) } }))} />
              <TextField id={fid("sb")} label={`${t("aicc.guide.starter.body")} · ${L}`} lang={lang} multiline rows={3}
                value={form.starter.body[lang]} max={GUIDE_LIMITS.starterBody}
                problem={fieldProblem(form.starter.body, GUIDE_LIMITS.starterBody, false)}
                onChange={(v) => edit((f) => ({ ...f, starter: { ...f.starter, body: inLang(f.starter.body, v) } }))} />
            </div>
            <div className="space-y-2">
              <PhotoControl label={t("aicc.guide.starter.image")} imageId={form.starter.imageId} item={itemOf(form.starter.imageId)}
                onPick={() => setPicker({ starter: true })}
                onClear={() => set((f) => ({ ...f, starter: { ...f.starter, imageId: null } }))}
                emptyText={catalogueImage ? t("aicc.guide.starter.usingCatalogue") : t("aicc.guide.starter.usingArt")} />
              <p className="text-[11px] leading-relaxed text-faint">{t("aicc.guide.starter.fallbackNote")}</p>
            </div>
          </div>

          {starterPreview && (
            <div id={`${ids}-sta-preview`} className="rounded-2xl border border-dashed border-line p-3 sm:p-4" data-guide-starter-preview>
              <p className="mb-3 text-[11.5px] text-muted">{t("aicc.guide.preview.locale", { lang: L })}</p>
              <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <DeviceFrame width={720} label={t("aicc.guide.preview.desktop")} icon={Monitor}>
                  <I18nScope dict={previewWords}>
                    <StarterGallery title={previewStarter.title} body={previewStarter.body} image={previewStarter.image} fallbackArt={starterArt(tool)} />
                  </I18nScope>
                </DeviceFrame>
                <DeviceFrame width={360} label={t("aicc.guide.preview.mobile")} icon={Smartphone}>
                  <I18nScope dict={previewWords}>
                    <StarterGallery title={previewStarter.title} body={previewStarter.body} image={previewStarter.image} fallbackArt={starterArt(tool)} />
                  </I18nScope>
                </DeviceFrame>
              </div>
            </div>
          )}
        </section>
      ) : (
        // No results gallery on this screen (a workbench, the editor), so
        // there is nothing a starter gallery could stand in for.
        <section aria-labelledby={`${ids}-sta`} className="space-y-3 border-t border-line pt-5" data-guide-starter-form="none">
          <h3 id={`${ids}-sta`} className="font-display text-[15px] font-semibold">{t("aicc.guide.starter.heading")}</h3>
          <p className="rounded-xl bg-raised px-3.5 py-2.5 text-[12.5px] text-muted">{t("aicc.guide.starter.none")}</p>
        </section>
      )}

      {/* ── D. PODGLĄD I PUBLIKACJA ───────────────────────────────────── */}
      <div className="space-y-3 border-t border-line pt-5">
        {conflict ? (
          // Beside the button that hit it: someone else's version is one
          // reload away, and this form must not overwrite it.
          <div role="alert" data-guide-conflict
            className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-ink">{errorText("conflict")}</p>
            <Button size="sm" variant="secondary" onClick={reload} className="shrink-0">{t("aicc.guide.reload")}</Button>
          </div>
        ) : error && (
          <p role="alert" className="rounded-xl bg-[rgb(var(--danger)/0.08)] px-3.5 py-2.5 text-[12.5px] text-danger" data-guide-error>
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} disabled={form.useDefault || pending} className="self-start">
            <RotateCcw size={14} aria-hidden /> {t("aicc.guide.resetDefaults")}
          </Button>
          <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
            <span aria-live="polite">
              {dirty
                ? <Badge tone="warning" dot>{t("aicc.guide.dirty")}</Badge>
                : published && !published.again
                  ? <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-success" data-guide-saved-note>
                      <Check size={13} aria-hidden /> {t("aicc.guide.status.publishedShort", { when: formatInstant(published.at, locale) })}
                    </span>
                  : <span className="text-[11.5px] text-faint">{t("aicc.guide.clean")}</span>}
            </span>
            <Button onClick={save} disabled={!dirty || pending} data-guide-save>
              {pending ? t("common.saving") : t("aicc.guide.save")}
            </Button>
          </div>
        </div>
      </div>

      <AssetPicker open={picker !== null} onClose={() => setPicker(null)} onPick={onPick} library={library}
        kind="image" portal
        title={pickerItem ? `${t("aicc.guide.pickTitle")} · ${t("aicc.guide.step.label", { n: form.steps.indexOf(pickerItem) + 1 })}` : t("aicc.guide.pickTitle")} />
      <I18nScope dict={previewWords}>
        <TutorialModal open={tutorialOpen !== null} onClose={() => setTutorialOpen(null)} tutorial={previewTutorial}
          initialStep={tutorialOpen ?? 0} />
      </I18nScope>

      {/* "Zmień ilustrację": a photo from the library, or one of the drawings. */}
      <Modal open={chooserStep !== null} onClose={() => setChooser(null)} wide portal
        title={`${t("aicc.guide.illustration.change")} · ${t("aicc.guide.step.label", { n: chooserIndex + 1 })}`}>
        {chooserStep && (
          <div className="space-y-5" data-guide-illustration-chooser>
            <section aria-labelledby={`${ids}-ch-photo`}>
              <p id={`${ids}-ch-photo`} className="text-[13px] font-semibold tracking-tight">{t("aicc.guide.illustration.photoHeading")}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{t("aicc.guide.illustration.photoHint")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" aria-haspopup="dialog"
                  onClick={() => { const uid = chooserStep.uid; setChooser(null); setPicker({ step: uid }); }}>
                  <ImageIcon size={14} aria-hidden /> {chooserStep.imageId ? t("aicc.guide.changePhoto") : t("aicc.guide.pickFromLibrary")}
                </Button>
                {chooserStep.imageId && (
                  <Button size="sm" variant="ghost"
                    onClick={() => { patchStep(chooserStep.uid, (x) => ({ ...x, imageId: null }), false); setChooser(null); }}>
                    {t("aicc.guide.illustration.removePhoto")}
                  </Button>
                )}
              </div>
            </section>
            <section aria-labelledby={`${ids}-ch-art`}>
              <p id={`${ids}-ch-art`} className="text-[13px] font-semibold tracking-tight">{t("aicc.guide.illustration.drawingsHeading")}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                {chooserStep.imageId ? t("aicc.guide.illustration.drawingsReplacePhoto") : t("aicc.guide.illustration.drawingsHint")}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {GUIDE_ARTS.map((a) => {
                  const current = !chooserStep.imageId && chooserStep.art === a;
                  return (
                    <button key={a} type="button" onClick={() => chooseArt(chooserStep.uid, a)} aria-pressed={current} data-guide-art={a}
                      className={cn(
                        "min-w-0 rounded-xl border p-1.5 text-left transition-colors",
                        current ? "border-accent bg-accent/10" : "border-line hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised",
                      )}>
                      <span className="block overflow-hidden rounded-lg bg-raised/60">
                        <GuideArtwork art={a} className="block aspect-[16/10] h-auto w-full" />
                      </span>
                      <span className="mt-1 flex items-start gap-1 px-0.5 text-[11.5px] font-medium leading-snug">
                        {current && <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-accent" />}
                        <span className="min-w-0 break-words">{t(`aicc.guide.art.${a}`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </Modal>

      <ConfirmModal open={removeIndex >= 0} onClose={() => setConfirmRemove(null)} danger portal
        onConfirm={() => { if (confirmRemove) removeStep(confirmRemove); setConfirmRemove(null); }}
        title={t("aicc.guide.step.removeConfirmTitle", { n: removeIndex + 1 })}
        body={t("aicc.guide.step.removeConfirmBody")} confirmLabel={t("aicc.guide.step.removeConfirm")} />
      <ConfirmModal open={confirmAgain} onClose={() => { if (!pending) setConfirmAgain(false); }} onConfirm={showAgain}
        pending={pending} portal
        title={t("aicc.guide.again.confirmTitle")}
        body={t("aicc.guide.again.confirmBody", { n: version, next: Math.min(version + 1, MAX_VERSION) })}
        confirmLabel={t("aicc.guide.again.confirm")} />
      <ConfirmModal open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={resetToDefaults} portal
        title={t("aicc.guide.resetConfirmTitle")} body={t("aicc.guide.resetConfirmBody")} confirmLabel={t("aicc.guide.resetConfirm")} />
    </div>
  );
}

/* ── PIECES ────────────────────────────────────────────────────────────── */

function SwitchRow({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; hint: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line p-3">
      <span className="mt-0.5"><Switch checked={checked} onChange={onChange} label={label} /></span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{label}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{hint}</p>
      </div>
    </div>
  );
}

/** One line of the status block: a label and its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/** A step's picture in the tutorial's own frame — the proportions, backdrop
 *  and fit TutorialModal draws it with — so the card shows what a customer
 *  will see: the library photo when there is one, else the drawing. */
function StepIllustration({ image, art }: { image: GuideImage | null; art: GuideArt }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line" style={{ background: STEP_BACKDROP }}>
      <div className="aspect-[16/10] w-full">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} srcSet={image.srcSet} sizes="300px" alt="" loading="lazy" decoding="async"
            className="h-full w-full object-contain" />
        ) : (
          <GuideArtwork art={art} className="h-full w-full" />
        )}
      </div>
    </div>
  );
}

/** One text field in one language: its label (and which language), the
 *  count the save will measure, and the problem the save would report. */
function TextField({ id, label, lang, required, value, max, multiline, rows, problem, onChange }: {
  id: string;
  label: string;
  lang: Locale;
  required?: boolean;
  value: string;
  max: number;
  multiline?: boolean;
  rows?: number;
  problem: FieldProblem | null;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const length = clean(value).length;
  const metaId = `${id}-meta`;
  const hint = required && lang === "pl" ? t("aicc.guide.required")
    : lang !== "pl" ? t("aicc.guide.fallbackPl") : t("aicc.guide.optional");
  const shared = {
    id, value, maxLength: max,
    "aria-invalid": problem ? true : undefined,
    "aria-describedby": metaId,
  } as const;
  return (
    <div>
      <Label htmlFor={id} hint={hint}>{label}</Label>
      {/* No size override: the fields keep their 16 px on touch screens,
          below which iOS Safari zooms into the focused field. */}
      {multiline
        ? <Textarea {...shared} rows={rows ?? 3} onChange={(e) => onChange(e.target.value)} />
        : <Input {...shared} onChange={(e) => onChange(e.target.value)} />}
      <p id={metaId} className="mt-1 flex justify-between gap-2 text-[11px]">
        <span className="text-danger">{problem ? t(`aicc.guide.problem.${problem}`, { max }) : ""}</span>
        <span className={cn("shrink-0 tabular-nums", length > max ? "text-danger" : "text-faint")}>
          {t("aicc.guide.counter", { n: length, max })}
        </span>
      </p>
    </div>
  );
}

/** The library picture of the starter: thumbnail, name, and the two
 *  actions. Without one, a line says what is shown instead. */
function PhotoControl({ label, imageId, item, onPick, onClear, emptyText }: {
  label: string;
  imageId: string | null;
  item: LibraryItem | null;
  onPick: () => void;
  onClear: () => void;
  emptyText: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold tracking-tight">{label}</p>
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-sunken/40 p-2">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-raised">
          {item?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon size={16} aria-hidden className="text-faint" />
          )}
        </span>
        <span className="min-w-0 flex-1 basis-32">
          {/* A file name may be cut; the "no photo" sentence is read whole. */}
          <span className={cn("block text-[12.5px] font-medium", item ? "truncate" : "break-words")}>
            {item ? item.title ?? t("aicc.guide.untitled") : imageId ? t("aicc.guide.unknownPhoto") : emptyText}
          </span>
          {item?.width && item.height ? (
            <span className="block text-[10.5px] tabular-nums text-faint">{item.width}×{item.height}</span>
          ) : null}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={onPick} aria-haspopup="dialog">
            {imageId ? t("aicc.guide.changePhoto") : t("aicc.guide.pickFromLibrary")}
          </Button>
          {imageId && (
            <Button size="sm" variant="ghost" onClick={onClear}>{t("aicc.guide.removePhoto")}</Button>
          )}
        </span>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, disabled, haspopup, children, ...data }: {
  label: string; onClick: () => void; disabled?: boolean; haspopup?: boolean; children: ReactNode;
} & { [k: `data-${string}`]: string | number | undefined }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      aria-haspopup={haspopup ? "dialog" : undefined} {...data}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}

/**
 * A screen of a given width: the content is laid out at exactly that width
 * (its wrapping, its picture's proportions) and then scaled down to fit the
 * column, rather than squeezed into whatever the admin's column happens to
 * be. The frame's height follows the scaled content, and the frame clips, so
 * the page never scrolls sideways. (The gallery's few `sm:` paddings follow
 * the admin's viewport, not the frame — a pixel or two, not the layout.)
 */
function DeviceFrame({ width, label, icon: Icon, children }: {
  width: number; label: string; icon: LucideIcon; children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const scale = Math.min(1, o.clientWidth / width);
      const height = Math.ceil(i.offsetHeight * scale);
      setFit((prev) => (prev && prev.scale === scale && prev.height === height ? prev : { scale, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [width]);

  return (
    <figure className="min-w-0" data-preview-frame={width}>
      <figcaption className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
        <Icon size={13} aria-hidden /> {label}
        <span className="font-normal tabular-nums text-faint">{width} px</span>
      </figcaption>
      <div ref={outer} className="w-full overflow-hidden rounded-xl border border-line bg-bg"
        style={fit ? { height: fit.height } : undefined}>
        <div ref={inner} className={width < 500 ? "p-4" : "p-6"}
          style={{ width, transform: fit && fit.scale < 1 ? `scale(${fit.scale})` : undefined, transformOrigin: "top left" }}>
          {children}
        </div>
      </div>
    </figure>
  );
}
