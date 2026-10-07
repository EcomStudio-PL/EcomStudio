/**
 * THE START'S OWN SKELETON — the shape of the seller home
 * (components/seller-home): a headline, four 4:3 task cards, the upload with
 * its button panel, and the first row of tools, at the sizes they will have,
 * so the page settles into the space it was promised instead of reflowing.
 */
export default function HomeLoading() {
  return (
    <div aria-busy className="mx-auto w-full max-w-6xl animate-pulse space-y-9 sm:space-y-12">
      <div>
        <div className="h-9 w-[min(36rem,90%)] rounded-lg bg-raised/70 lg:h-11" />
        <div className="mt-3 h-4 w-[min(26rem,70%)] rounded bg-raised/50" />
        <div className="mt-6 flex gap-3 overflow-hidden sm:grid sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-[72vw] max-w-[18rem] shrink-0 overflow-hidden rounded-2xl bg-raised/40 sm:w-auto sm:max-w-none">
              <div className="aspect-[4/3] bg-raised/60" />
              <div className="space-y-2 p-3.5">
                <div className="h-4 w-2/3 rounded bg-raised/70" />
                <div className="h-3 w-5/6 rounded bg-raised/50" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
          <div className="h-[10.5rem] rounded-2xl bg-raised/50 sm:h-[11.5rem]" />
          <div className="h-[10.5rem] rounded-2xl bg-raised/40 sm:h-[11.5rem]" />
        </div>
      </div>
      <div>
        <div className="mb-4 h-5 w-48 rounded bg-raised/60" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="aspect-[4/3] rounded-2xl bg-raised/50" />)}
        </div>
      </div>
    </div>
  );
}
