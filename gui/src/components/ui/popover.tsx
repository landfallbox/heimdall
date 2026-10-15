import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({ className, align = "center", sideOffset = 4, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={`popover-panel z-50 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-float outline-none ${className ?? ""}`}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

const PopoverHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={className ? `flex flex-col gap-0.5 text-sm ${className}` : "flex flex-col gap-0.5 text-sm"} {...props} />
);

const PopoverTitle = ({ className, ...props }: React.ComponentProps<"h2">) => (
  <h2 className={className ? `font-semibold leading-none ${className}` : "font-semibold leading-none"} {...props} />
);

const PopoverDescription = ({ className, ...props }: React.ComponentProps<"p">) => (
  <p className={className ? `text-xs text-muted-foreground ${className}` : "text-xs text-muted-foreground"} {...props} />
);

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle, PopoverDescription };
