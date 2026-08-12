import { Brand } from "@/components/layout/brand";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-4">
      <header className="flex w-full max-w-md items-center justify-between pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <Brand />
        <div className="flex gap-2"><LocaleSwitcher /><ThemeToggle /></div>
      </header>
      <div className="flex w-full max-w-md flex-1 flex-col justify-center pb-24">{children}</div>
    </main>
  );
}
