import { cn } from "../lib/utils.ts";
import { Switch } from "./ui/switch.tsx";

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
}

export function ToggleRow({ label, checked, onCheckedChange, disabled = false, title, description, compact = false, className }: ToggleRowProps) {
  if (compact) {
    return (
      <label className={cn("flex min-w-0 cursor-pointer select-none items-center gap-2", className)} title={title}>
        <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} />
        <span className="block min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</span>
      </label>
    );
  }
  return (
    <label
      className={cn("flex min-w-0 cursor-pointer select-none items-center gap-3", description && "items-start", className)}
      title={title}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span> : null}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
        className={cn("shrink-0", description && "mt-0.5")}
      />
    </label>
  );
}
