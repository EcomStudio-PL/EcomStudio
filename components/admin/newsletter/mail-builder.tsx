"use client";
import { useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2, TriangleAlert,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  BLOCK_TYPES, MERGE_FIELDS, unknownMergeTags,
  type BlockType, type MailBlock,
} from "@/lib/newsletter";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { RowAction } from "@/components/ui/record";

/**
 * KROK 2 — THE MESSAGE ITSELF.
 *
 * TWO AUTHORING MODES AND ONE RENDERER. Whatever is typed here ends up in
 * `renderCampaign`, which knows how to turn either a block list or a pasted
 * document into an email-safe message. This editor therefore never produces
 * HTML: it produces the two shapes the renderer already understands, which is
 * why the preview can be the real thing rather than an approximation.
 *
 * SUBJECT AND PREHEADER LIVE HERE, with the body, and not one panel higher.
 * They are part of the message, they carry merge tags like everything else,
 * and the merge-tag palette has to be able to insert into them — a palette
 * that can fill a paragraph but not a subject line is a palette an operator
 * learns to work around by typing `{{first_name}}` from memory, which is how
 * `{{frist_name}}` reaches four thousand inboxes.
 *
 * THE PALETTE INSERTS AT THE CARET OF THE LAST FIELD THAT WAS FOCUSED, and it
 * is deliberately STICKY — pressing a chip does not clear the target, and the
 * chip suppresses its own mousedown so the field never loses focus in the
 * first place. Until something has been focused the chips are disabled with a
 * hint saying so, which is honest; a palette that silently appends to whatever
 * field happens to be first is a palette that puts the recipient's name in the
 * preheader.
 *
 * WHAT THE BLOCK FORMS DO NOT OFFER. `MailBlock` also carries `background` and
 * `imageUrl2`, and the renderer ignores both. Offering a colour picker whose
 * colour never appears in the sent mail is exactly the fake functionality the
 * house rules forbid, so those fields are absent until the renderer grows
 * them.
 *
 * REORDERING IS BUTTONS FIRST AND DRAG SECOND. The arrows are the real
 * control: they work on a phone, with a keyboard, and with a screen reader.
 * Dragging is layered on top with the platform's own drag events — no
 * dependency, and nothing breaks if it is unavailable.
 */

/** The editable half of a campaign step. The delay and the variant belong to
 *  the step's place in a sequence, not to its contents, so they are the
 *  wizard's business rather than this editor's. */
export type StepDraft = {
  subject: string;
  preheader: string;
  editor: "builder" | "html";
  blocks: MailBlock[];
  bodyHtml: string;
};

/**
 * WHAT THE SANITISER WILL TAKE OUT, recognised here so the warning appears as
 * the operator pastes rather than after they have sent.
 *
 * This is a WARNING AND NOT THE ENFORCEMENT, and the distinction matters: the
 * removal happens in `sanitizeMailHtml` on the server, on an allowlist, every
 * single time the mail is rendered. A regex in a browser is not a security
 * boundary and is not being used as one — it exists so that "why did my
 * countdown timer disappear" is answered next to the textarea instead of in a
 * support thread.
 */
const STRIPPED = /<\s*(script|style|iframe|object|embed|form|link|meta|base)\b|\son[a-z]+\s*=\s*["']/i;

/** Block ids only have to be unique inside one message. `randomUUID` is there
 *  in every browser this admin panel supports; the fallback keeps a very old
 *  one from producing two blocks that React treats as the same row. */
function newBlockId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Starting values that make a freshly added block look like something rather
 *  than like a bug. A spacer with no height and a logo hard against the left
 *  edge both read as "the builder is broken". */
const BLOCK_DEFAULTS: Partial<Record<BlockType, Partial<MailBlock>>> = {
  logo: { align: "center" },
  button: { align: "left" },
  spacer: { size: 20 },
};

/** Which fields each block type actually uses. Kept in step with
 *  `blockHtml` in lib/server/newsletter/render.ts — a field the renderer does
 *  not read is a control that does nothing. */
const FIELDS: Record<BlockType, ReadonlyArray<
  "text" | "textarea" | "text2" | "url" | "imageUrl" | "alt" | "label" | "align" | "size"
>> = {
  logo: ["align"],
  heading: ["text", "align"],
  text: ["textarea", "align"],
  image: ["imageUrl", "alt", "align"],
  button: ["label", "url", "align"],
  columns: ["textarea", "text2"],
  divider: [],
  spacer: ["size"],
  social: ["label", "url", "align"],
  footer: ["textarea", "align"],
};

export function MailBuilder({ value, onChange, disabled }: {
  value: StepDraft;
  /** A patch, not a whole draft: the wizard owns the step and merges. */
  onChange: (patch: Partial<StepDraft>) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();

  /** The field a merge tag would go into, and the setter that owns its text.
   *  Both are refs rather than state: re-rendering the editor on every focus
   *  change would cost a keystroke's worth of work for nothing visible. */
  const activeEl = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const activeSet = useRef<((next: string) => void) | null>(null);
  const [hasTarget, setHasTarget] = useState(false);

  const dragId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  function fieldProps<E extends HTMLInputElement | HTMLTextAreaElement>(
    current: string, set: (next: string) => void,
  ) {
    return {
      value: current,
      disabled,
      onChange: (e: React.ChangeEvent<E>) => set(e.target.value),
      onFocus: (e: React.FocusEvent<E>) => {
        activeEl.current = e.currentTarget;
        activeSet.current = set;
        setHasTarget(true);
      },
    };
  }

  function insertTag(field: string) {
    const el = activeEl.current;
    const set = activeSet.current;
    if (!el || !set) return;
    const tag = `{{${field}}}`;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    set(`${el.value.slice(0, start)}${tag}${el.value.slice(end)}`);
    // The caret goes after what was inserted, so a second chip does not
    // overwrite the first. The frame's delay is what lets React commit the new
    // value before the selection is moved inside it.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + tag.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const patchBlock = (id: string, patch: Partial<MailBlock>) =>
    onChange({ blocks: value.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= value.blocks.length || from === to) return;
    const next = [...value.blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({ blocks: next });
  };

  const addBlock = (type: BlockType) => onChange({
    blocks: [...value.blocks, { id: newBlockId(), type, ...(BLOCK_DEFAULTS[type] ?? {}) }],
  });

  const duplicate = (index: number) => {
    const next = [...value.blocks];
    next.splice(index + 1, 0, { ...next[index], id: newBlockId() });
    onChange({ blocks: next });
  };

  const removeBlock = (id: string) =>
    onChange({ blocks: value.blocks.filter((b) => b.id !== id) });

  /* ── WHAT THE AUTHOR ACTUALLY TYPED, for the tag check ──────────────────
     Every field that survives into the mail, including the pasted document:
     a misspelled tag in HTML mode reaches the inbox exactly as a misspelled
     tag in a text block does. */
  const written = [
    value.subject,
    value.preheader,
    ...(value.editor === "html"
      ? [value.bodyHtml]
      : value.blocks.flatMap((b) => [b.text ?? "", b.text2 ?? "", b.label ?? "", b.alt ?? ""])),
  ].join("\n");
  const unknown = unknownMergeTags(written);
  const stripped = value.editor === "html" && STRIPPED.test(value.bodyHtml);

  return (
    <div className="space-y-5" data-mail-builder>
      {/* ── THE ENVELOPE ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="step-subject">{t("newsletter.editor.subject")}</Label>
          <Input id="step-subject" maxLength={300} data-step-subject
            {...fieldProps<HTMLInputElement>(value.subject, (next) => onChange({ subject: next }))} />
        </div>
        <div className="min-w-0">
          <Label htmlFor="step-preheader">{t("newsletter.editor.preheader")}</Label>
          <Input id="step-preheader" maxLength={300} data-step-preheader
            {...fieldProps<HTMLInputElement>(value.preheader, (next) => onChange({ preheader: next }))} />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
            {t("newsletter.editor.preheaderHint")}
          </p>
        </div>
      </div>

      {/* ── MERGE TAGS ───────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[13px] font-semibold tracking-tight">
          {t("newsletter.editor.mergeTags")}
        </p>
        <ChipRow>
          {MERGE_FIELDS.map((field) => (
            <Chip
              key={field}
              disabled={disabled || !hasTarget}
              // `Chip` has no disabled styling of its own, and a chip that is
              // inert but looks pressable is a control an operator taps twice
              // before deciding the screen is broken.
              className={cn((disabled || !hasTarget) && "opacity-40")}
              data-merge-tag={field}
              // Keeping the focus is the whole mechanism: without this the
              // browser moves it to the chip and there is no caret to insert
              // at by the time the click handler runs.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertTag(field)}
            >
              {`{{${field}}}`}
            </Chip>
          ))}
        </ChipRow>
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          {hasTarget ? t("newsletter.editor.mergeHint") : t("newsletter.editor.focusFirst")}
        </p>
        {unknown.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-3 py-2 text-[12px] leading-relaxed text-ink"
            data-unknown-merge-tags>
            <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0 text-warning" />
            <span>
              {t("newsletter.editor.unknownTag")}: <code className="font-mono">
                {unknown.map((tag) => `{{${tag}}}`).join(", ")}
              </code>
            </span>
          </p>
        )}
      </div>

      {/* ── MODE ─────────────────────────────────────────────────────────── */}
      <Segmented
        label={t("newsletter.step.content")}
        value={value.editor}
        onChange={(next) => !disabled && onChange({ editor: next === "html" ? "html" : "builder" })}
        options={[
          { value: "builder", label: t("newsletter.editor.builder"), disabled },
          { value: "html", label: t("newsletter.editor.html"), disabled },
        ]}
      />

      {value.editor === "html" ? (
        <div data-html-mode>
          <Textarea rows={16} spellCheck={false} data-step-html
            className="font-mono text-xs"
            {...fieldProps<HTMLTextAreaElement>(value.bodyHtml, (next) => onChange({ bodyHtml: next }))} />
          <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
            {t("newsletter.editor.htmlHint")}
          </p>
          {stripped && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.08)] px-3 py-2 text-[12px] leading-relaxed text-ink"
              data-html-stripped>
              <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0 text-warning" />
              <span>{t("newsletter.editor.htmlStripped")}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-builder-mode>
          {value.blocks.length === 0 ? (
            <p className="plate rounded-xl px-3.5 py-6 text-center text-[12.5px] text-muted"
              data-builder-empty>
              {t("newsletter.editor.empty")}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {value.blocks.map((block, index) => (
                <li
                  key={block.id}
                  data-block={block.type}
                  className={cn(
                    "panel rounded-2xl p-3.5 transition-shadow",
                    dragOver === block.id && "ring-2 ring-[rgb(var(--accent)/0.45)]",
                  )}
                  onDragOver={(e) => {
                    if (!dragId.current || dragId.current === block.id) return;
                    e.preventDefault();
                    setDragOver(block.id);
                  }}
                  onDragLeave={() => setDragOver((current) => (current === block.id ? null : current))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = value.blocks.findIndex((b) => b.id === dragId.current);
                    if (from >= 0) reorder(from, index);
                    dragId.current = null;
                    setDragOver(null);
                  }}
                >
                  <div className="flex items-center gap-2">
                    {/* The grip is the drag handle and nothing else: making the
                        whole card draggable makes the text fields inside it
                        impossible to select. */}
                    <span
                      aria-hidden
                      draggable={!disabled}
                      onDragStart={(e) => {
                        dragId.current = block.id;
                        e.dataTransfer.effectAllowed = "move";
                        // Firefox refuses to start a drag without payload.
                        e.dataTransfer.setData("text/plain", block.id);
                      }}
                      onDragEnd={() => { dragId.current = null; setDragOver(null); }}
                      className={cn("shrink-0 text-faint", !disabled && "cursor-grab active:cursor-grabbing")}
                    >
                      <GripVertical size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {t(`newsletter.block.${block.type}`)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-faint">
                      {t("newsletter.editor.blockN", { n: index + 1 })}
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {FIELDS[block.type].map((field) => {
                      const id = `${block.id}-${field}`;
                      if (field === "align") {
                        return (
                          <div key={field}>
                            <Label htmlFor={id}>{t("newsletter.editor.field.align")}</Label>
                            <Select id={id} value={block.align ?? "left"} disabled={disabled}
                              onChange={(e) => patchBlock(block.id, {
                                align: e.target.value as MailBlock["align"],
                              })}>
                              <option value="left">{t("newsletter.editor.align.left")}</option>
                              <option value="center">{t("newsletter.editor.align.center")}</option>
                              <option value="right">{t("newsletter.editor.align.right")}</option>
                            </Select>
                          </div>
                        );
                      }
                      if (field === "size") {
                        return (
                          <div key={field}>
                            <Label htmlFor={id}>{t("newsletter.editor.field.size")}</Label>
                            <Input id={id} inputMode="numeric" className="w-28" disabled={disabled}
                              value={String(block.size ?? 20)}
                              onChange={(e) => patchBlock(block.id, {
                                // The renderer clamps to 4–96 anyway; keeping
                                // the field numeric here stops "20px" from
                                // being stored as text nobody can read back.
                                size: Number.parseInt(e.target.value.replace(/\D/g, ""), 10) || 0,
                              })} />
                          </div>
                        );
                      }

                      const map = {
                        text: { key: "text" as const, label: "text", area: false },
                        textarea: { key: "text" as const, label: "text", area: true },
                        text2: { key: "text2" as const, label: "text2", area: true },
                        url: { key: "url" as const, label: "url", area: false },
                        imageUrl: { key: "imageUrl" as const, label: "imageUrl", area: false },
                        alt: { key: "alt" as const, label: "alt", area: false },
                        label: { key: "label" as const, label: "label", area: false },
                      }[field];

                      const set = (next: string) => patchBlock(block.id, { [map.key]: next });

                      return (
                        <div key={field}>
                          <Label htmlFor={id}>{t(`newsletter.editor.field.${map.label}`)}</Label>
                          {map.area ? (
                            <Textarea id={id} rows={4}
                              {...fieldProps<HTMLTextAreaElement>(block[map.key] ?? "", set)} />
                          ) : (
                            <Input id={id}
                              {...fieldProps<HTMLInputElement>(block[map.key] ?? "", set)} />
                          )}
                          {(field === "url" || field === "imageUrl") && (
                            <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
                              {t("newsletter.editor.urlHint")}
                            </p>
                          )}
                        </div>
                      );
                    })}

                    {block.type === "logo" && (
                      <p className="text-[11.5px] leading-relaxed text-faint">
                        {t("newsletter.editor.logoNote")}
                      </p>
                    )}
                    {block.type === "divider" && (
                      <p className="text-[11.5px] leading-relaxed text-faint">
                        {t("newsletter.editor.dividerNote")}
                      </p>
                    )}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-line pt-2.5">
                    <RowAction icon={ArrowUp} label={t("newsletter.editor.moveUp")}
                      disabled={disabled || index === 0}
                      data-block-up={block.id}
                      onClick={() => reorder(index, index - 1)} />
                    <RowAction icon={ArrowDown} label={t("newsletter.editor.moveDown")}
                      disabled={disabled || index === value.blocks.length - 1}
                      data-block-down={block.id}
                      onClick={() => reorder(index, index + 1)} />
                    <RowAction icon={Copy} label={t("newsletter.editor.duplicateBlock")}
                      disabled={disabled} data-block-copy={block.id}
                      onClick={() => duplicate(index)} />
                    <RowAction icon={Trash2} tone="danger" label={t("newsletter.editor.removeBlock")}
                      disabled={disabled} data-block-remove={block.id}
                      onClick={() => removeBlock(block.id)} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
              <Plus size={14} aria-hidden />{t("newsletter.editor.addBlock")}
            </p>
            <ChipRow>
              {BLOCK_TYPES.map((type) => (
                <Chip key={type} disabled={disabled} data-add-block={type}
                  className={cn(disabled && "opacity-40")}
                  onClick={() => addBlock(type)}>
                  {t(`newsletter.block.${type}`)}
                </Chip>
              ))}
            </ChipRow>
          </div>
        </div>
      )}
    </div>
  );
}
