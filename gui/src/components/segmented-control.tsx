import { useId } from "react";
import { motion } from "motion/react";

import { cn } from "../lib/utils.ts";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, disabled = false, className }: SegmentedControlProps<T>) {
  const layoutId = useId();
  return (
    <div className={cn("flex w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-white/5 bg-muted/25 p-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "relative h-7 flex-1 min-w-max whitespace-nowrap rounded-md px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 480, damping: 40 }}
                className="absolute inset-0 rounded-md bg-accent shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
