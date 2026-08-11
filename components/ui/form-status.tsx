"use client";
import { useFormStatus } from "react-dom";
import { Button } from "./button";

export function SubmitButton({ children, className, pendingLabel }: {
  children: React.ReactNode; className?: string; pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className}>
      {pending ? (pendingLabel ?? "…") : children}
    </Button>
  );
}
