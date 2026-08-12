import { cn } from "@/lib/utils";
import { PanelHeader } from "./section-header";

/** Card is the panel surface — kept as the app-wide alias so every existing
 *  screen picks up the new elevation language without being rewritten. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel rounded-2xl", className)} {...props} />;
}

/** Card header. Accepts the original title/sub/action API, plus the overline
 *  and icon the redesigned screens use. */
export function CardHeader({ title, sub, action, overline, icon }: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  overline?: string;
  icon?: React.ComponentProps<typeof PanelHeader>["icon"];
}) {
  return <PanelHeader title={title} sub={sub} action={action} overline={overline} icon={icon} />;
}
