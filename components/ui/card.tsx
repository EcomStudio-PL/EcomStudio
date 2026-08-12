import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass rounded-2xl", className)} {...props} />
  );
}

export function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
