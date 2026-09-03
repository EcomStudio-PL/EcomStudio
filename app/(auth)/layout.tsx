import { Brand } from "@/components/layout/brand";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { KeyboardInset } from "@/components/auth/keyboard-inset";

/**
 * AUTH SHELL — one quiet, centered composition for every account-entry page.
 * The container allows up to max-w-xl (registration needs the room); the
 * narrower cards center themselves inside it. A single ambient wash behind
 * the card carries the brand without competing with the form.
 *
 * TYPING ON A PHONE decides the geometry here. `svh` is the SMALL viewport —
 * the height that is still visible with the browser chrome expanded — so the
 * shell never claims space the customer cannot see, and the card is only
 * centred from `sm` up. Below that it starts at the top and the page simply
 * scrolls, which is what lets a focused field escape the keyboard: an
 * exactly-one-viewport-tall centred layout has nothing to scroll, and in an
 * installed PWA (where the layout viewport ignores the keyboard) the field
 * would stay stuck behind it. `--kb` adds the keyboard's own height to the
 * bottom padding while it is open (see KeyboardInset).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-[100svh] flex-col items-center overflow-x-clip px-4">
      <KeyboardInset />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem]"
        style={{
          background:
            "radial-gradient(32rem 16rem at 50% -22%, rgb(var(--accent) / 0.16), transparent 70%)," +
            "radial-gradient(24rem 12rem at 82% -8%, rgb(var(--violet) / 0.10), transparent 72%)",
        }}
      />
      <header className="relative flex w-full max-w-xl items-center justify-between pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <Brand />
        <div className="flex gap-2"><LocaleSwitcher /><ThemeToggle /></div>
      </header>
      <div
        className="auth-body relative flex w-full max-w-xl flex-1 flex-col justify-start sm:justify-center"
        style={{ paddingBottom: "calc(var(--kb, 0px) + max(2.5rem, calc(2rem + env(safe-area-inset-bottom))))" }}
      >
        {children}
      </div>
    </main>
  );
}
