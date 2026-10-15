import { Toaster as Sonner, type ToasterProps } from "sonner";

import { cn } from "../../lib/utils.ts";

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-float group-[.toaster]:rounded-xl",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, cn };
