// The REAL details view (components/genv3/image-details.tsx) on a synthetic
// shelf, the way the Library mounts it: one view, prev/next through the grid,
// close and reopen. Driven by scripts/preview-sources-tests.ts.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n/provider";
import { ImageDetails } from "@/components/genv3/image-details";
import type { GalleryItem } from "@/components/genv3/types";

type Fixture = { items: GalleryItem[]; dict: Record<string, unknown> };
type Harness = { index: number; open: boolean; setIndex: (i: number) => void; setOpen: (o: boolean) => void };
const w = window as unknown as { __fx: Fixture; __h: Harness };

function App() {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  w.__h = { index, open, setIndex, setOpen };
  const none = () => {};
  return (
    <>
      <button type="button" data-reopen onClick={() => setOpen(true)}>Otwórz</button>
      {open && (
        <ImageDetails items={w.__fx.items} index={index} onIndex={setIndex} onClose={() => setOpen(false)}
          canRegenerate={false} onRegenerate={none} onFavorite={none} onDelete={none} onNote={none} />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider locale="pl" dict={w.__fx.dict}><App /></I18nProvider>,
);
