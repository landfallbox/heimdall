import { Clipboard, Eye, EyeOff } from "lucide-react";

import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

interface SecretInputProps {
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  onCopy: () => void;
  ariaLabel?: string;
}

export function SecretInput({ value, onChange, show, onToggleShow, onCopy, ariaLabel }: SecretInputProps) {
  return (
    <div className="relative">
      <Input
        value={value}
        type={show ? "text" : "password"}
        onChange={(event) => onChange(event.target.value)}
        className="pr-[70px] font-mono"
        aria-label={ariaLabel}
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onCopy} title="Copy API key" aria-label="Copy API key" className="size-7">
          <Clipboard size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleShow}
          title={show ? "Hide key" : "Show key"}
          aria-label={show ? "Hide key" : "Show key"}
          className="size-7"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </Button>
      </div>
    </div>
  );
}
