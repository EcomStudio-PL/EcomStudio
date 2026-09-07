/**
 * FILE INTAKE — one gate for every image that enters GrovBase.
 *
 * A tool can be reached three ways: the file picker, a drag from Finder or
 * Explorer, and a clipboard paste. Before this module each of those was
 * validated where it happened, which is how the editor came to accept three
 * MIME types while the batch tools accepted four, and how a 15 MB limit in
 * `lib/images/tools.ts` sat next to a 10 MB one in the generator's uploader.
 * A seller cannot be expected to know that dragging is stricter than clicking.
 *
 * So every route hands its files here, with the limits of the tool it belongs
 * to, and gets back the same answer. The limits themselves stay where they
 * already lived — this module holds no numbers of its own.
 */

/** What one tool will take. Every field is required so a new caller has to
 *  think about all four rather than inherit somebody else's defaults. */
export type IntakeLimits = {
  /** MIME types the server pipeline can actually process. */
  mime: readonly string[];
  /**
   * Extensions, when the tool checks them as well.
   *
   * The batch tools do, because a file renamed `photo.jpg.txt` can still
   * arrive with an image MIME on some platforms. Tools that do not check
   * extensions pass `null` rather than an empty list, so "no extension rule"
   * cannot be confused with "no extension is acceptable".
   */
  ext: readonly string[] | null;
  /** Largest single file, in bytes. */
  maxBytes: number;
  /** Most files the tool holds at once. 1 for the single-image tools. */
  maxFiles: number;
};

export type IntakeResult = {
  /** Files the tool should take, already trimmed to the room available. */
  accepted: File[];
  /** Not an image this pipeline can read. */
  badType: number;
  /** Over the per-file byte limit, or empty. */
  tooLarge: number;
  /** Valid, but there was no room left in the batch. */
  overflow: number;
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

/**
 * Sort a drop or a picker selection into what the tool takes and what it
 * refuses, and say WHY for each refusal so the caller can tell the seller
 * something more useful than "nie udało się".
 *
 * `room` is how many more files the tool can hold right now — pass the
 * remaining capacity, not the limit, or a second drop will overfill a batch
 * that is already half full.
 */
export function acceptFiles(
  list: FileList | File[] | null | undefined,
  limits: IntakeLimits,
  room: number = limits.maxFiles,
): IntakeResult {
  const out: IntakeResult = { accepted: [], badType: 0, tooLarge: 0, overflow: 0 };
  const space = Math.max(0, Math.min(room, limits.maxFiles));

  for (const file of Array.from(list ?? [])) {
    // A folder dragged in arrives as a zero-typed, zero-sized entry, so the
    // type check catches it before the size check has to explain itself.
    if (!limits.mime.includes(file.type)) { out.badType += 1; continue; }
    if (limits.ext && !limits.ext.includes(extensionOf(file.name))) { out.badType += 1; continue; }
    if (file.size === 0 || file.size > limits.maxBytes) { out.tooLarge += 1; continue; }
    if (out.accepted.length >= space) { out.overflow += 1; continue; }
    out.accepted.push(file);
  }
  return out;
}

/** Files pulled off a paste event — the third route, same gate. */
export function filesFromClipboard(event: ClipboardEvent): File[] {
  const picked: File[] = [];
  for (const item of Array.from(event.clipboardData?.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) picked.push(file);
  }
  return picked;
}

/**
 * THE ONE THING THAT DECIDES WHETHER AN OVERLAY MAY APPEAR.
 *
 * A drag only counts when the browser says it carries actual files. Moving an
 * image inside the editor, reordering a list, dragging a slider thumb or
 * selecting text all produce drag events too — with `text/plain`, `text/html`
 * or a custom type, never `Files`. Checking this is the whole reason the
 * global overlay does not fire on internal drags.
 */
export function dragCarriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types?.includes("Files") === true;
}
