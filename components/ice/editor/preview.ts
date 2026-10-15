import type { TextRun } from "./scan";

/**
 * A LIVE PREVIEW OF A TEXT ON THE PAGE ITSELF, while the admin types.
 *
 * The runs are the exact characters the element painted; each is replaced in
 * place (marker kept after it), always rebuilt from the text as it was when
 * the panel opened, so the offsets never drift. `restore()` puts every node
 * back — on cancel, or when the panel closes without a save. After a save the
 * page re-renders and React writes the saved text over the node anyway.
 */
export function livePreview(runs: TextRun[]) {
  const original = new Map<Text, string>();
  for (const r of runs) if (!original.has(r.node)) original.set(r.node, r.node.data);
  const shown = new Map<Text, string>();

  return {
    show(value: string) {
      for (const [node, data] of original) {
        if (!node.isConnected) continue;
        const mine = runs.filter((r) => r.node === node).sort((a, b) => b.start - a.start);
        let next = data;
        for (const r of mine) next = next.slice(0, r.start) + value + next.slice(r.end);
        if (node.data !== next) node.data = next;
        shown.set(node, next);
      }
    },
    restore() {
      for (const [node, data] of original) {
        // Only a node still showing OUR preview is put back: if React has
        // since written something else into it, that is the truth.
        if (node.isConnected && shown.get(node) === node.data && node.data !== data) node.data = data;
      }
      shown.clear();
    },
  };
}
