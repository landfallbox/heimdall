import { Toaster as Sonner, type ToasterProps } from "sonner";

import { cn } from "../../lib/utils.ts";

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      position="bottom-right"
      closeButton
      {...props}
    />
  );
}

export { Toaster, cn };
