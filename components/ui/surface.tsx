import { cn } from "@/lib/utils";

/**
 * SURFACES — the three planes of the interface.
 *
 * `Panel` is the standard content container: a real plane with a lit top
 * edge and a shadow that says how far it floats above the page. `Plate` is
 * the flatter inset used for rows and tiles INSIDE a panel, so nesting reads
 * as depth instead of as two identical boxes. Everything else in the app
 * composes from these two rather than inventing its own border/background.
 */
export function Panel({ className, interactive, ...props }: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
}) {
  return (
    <div
      className={cn("panel rounded-2xl", interactive && "panel-interactive", className)}
      {...props}
    />
  );
}

export function Plate({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("plate rounded-xl", className)} {...props} />;
}
