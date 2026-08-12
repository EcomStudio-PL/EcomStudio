"use client";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  // Primary carries the lit-edge CTA treatment; everything else stays quiet
  // so a screen never has two things shouting at the same volume.
  primary: "cta font-semibold",
  secondary: "plate text-ink hover:border-[rgb(var(--accent)/0.35)] hover:bg-raised",
  ghost: "text-muted hover:text-ink hover:bg-raised",
  danger: "bg-danger text-white hover:brightness-110 shadow-e1",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[13px] rounded-lg",
  md: "h-11 px-5 text-sm rounded-xl",
  lg: "h-12 px-6 text-[15px] rounded-2xl w-full sm:w-auto",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ className, variant = "primary", size = "md", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:opacity-50 disabled:pointer-events-none",
        variants[variant], sizes[size], className
      )}
      {...props}
    />
  );
});
