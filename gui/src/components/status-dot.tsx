import { cn } from "../lib/utils.ts";

export type StatusTone = "success" | "warning" | "neutral" | "danger";

const toneClasses: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-muted-foreground/60",
  danger: "bg-destructive",
};

export function StatusDot({ tone, pulse = false, className }: { tone: StatusTone; pulse?: boolean; className?: string }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", toneClasses[tone], pulse && "animate-status-pulse", className)}
      aria-hidden="true"
    />
  );
}
