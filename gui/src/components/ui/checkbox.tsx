import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "../../lib/utils.ts";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/40 aria-disabled:opacity-50 size-4 shrink-0 rounded-[4px] border bg-transparent shadow-xs outline-none transition-colors focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
        {props.checked === "indeterminate" ? (
          <span className="block h-px w-2 bg-current" />
        ) : (
          <Check size={12} strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
