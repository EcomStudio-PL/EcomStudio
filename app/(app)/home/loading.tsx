/**
 * THE START'S OWN SKELETON — the shape of the Home rather than the generic
 * dashboard-shaped one in app/(app)/loading.tsx: the rail, the upload box, the
 * chip row, the samples, a section heading and a row of effect cards, at the
 * sizes they will have, so the page settles into the space it was promised
 * instead of reflowing.
 */
export default function HomeLoading() {
  return (
    <div aria-busy className="animate-pulse space-y-9 sm:space-y-11">
      <div className="flex gap-2.5 overflow-hidden sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="w-[56vw] max-w-[16rem] shrink-0 sm:w-auto sm:max-w-none">
            <div className="aspect-[2336/1744] rounded-xl bg-raised/70" />
            <div className="mt-2 h-3 w-2/3 rounded bg-raised/60" />
          </div>
        ))}
      </div>
      <div>
        <div className="mx-auto h-[13rem] w-full max-w-[56rem] rounded-2xl bg-raised/50" />
        <div className="mt-5 flex justify-center gap-2 overflow-hidden">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="h-9 w-24 shrink-0 rounded-xl bg-raised/50" />)}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5">
          <div className="h-3 w-56 basis-full rounded bg-raised/40 sm:basis-auto" />
          <div className="flex gap-2.5">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 w-10 rounded-full bg-raised/50 sm:h-11 sm:w-11" />)}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-3 space-y-1.5">
          <div className="h-4 w-36 rounded bg-raised/60" />
          <div className="h-3 w-56 rounded bg-raised/40" />
        </div>
        <div className="flex gap-2.5 overflow-hidden sm:grid sm:grid-cols-4 lg:grid-cols-8">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="aspect-[2336/1744] w-[40vw] max-w-[11rem] shrink-0 rounded-xl bg-raised/60 sm:w-auto sm:max-w-none" />
          ))}
        </div>
      </div>
    </div>
  );
}
