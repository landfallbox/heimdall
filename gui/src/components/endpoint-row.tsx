import { Clipboard } from "lucide-react";

import { Button } from "./ui/button.tsx";

interface EndpointRowProps {
  label: string;
  endpoint: string;
  onCopy: (endpoint: string, label: string) => void;
}

export function EndpointRow({ label, endpoint, onCopy }: EndpointRowProps) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <span className="w-32 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <strong className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium" title={endpoint}>
        {endpoint}
      </strong>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onCopy(endpoint, label)}
        title={`Copy ${label} endpoint`}
        aria-label={`Copy ${label} endpoint`}
      >
        <Clipboard size={14} />
      </Button>
    </div>
  );
}
