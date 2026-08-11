export function EmptyState({ title, body, action }: {
  title: string; body?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
      <div className="frame-mark mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-raised text-xl">📦</div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
