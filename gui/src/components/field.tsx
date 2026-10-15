import * as React from "react";

import { cn } from "../lib/utils.ts";

interface FieldProps {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  message?: string;
  tone?: "error" | "warning";
  className?: string;
  hint?: React.ReactNode;
}

export function Field({ label, children, wide = false, message, tone, className, hint }: FieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", wide && "sm:col-span-2", className)}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {message ? (
        <small className={cn("text-[11px] leading-snug", tone === "warning" ? "text-warning" : "text-destructive")}>
          {message}
        </small>
      ) : hint ? (
        <small className="text-[11px] leading-snug text-muted-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono">
          {hint}
        </small>
      ) : null}
    </div>
  );
}
