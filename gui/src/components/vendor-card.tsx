import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { ChevronRight, GripVertical, Trash2 } from "lucide-react";

import { cn } from "../lib/utils.ts";
import { getVendorCircuitSummary, validateVendor } from "../app-model.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Switch } from "./ui/switch.tsx";
import { getVendorModels, type VendorDraft } from "../config-draft.ts";
import type { VendorHealth } from "../types.ts";

interface SortableVendorCardProps {
  vendor: VendorDraft;
  health: VendorHealth | undefined;
  index: number;
  onEnableChange: (index: number, enabled: boolean) => void;
  onRemove: (index: number) => void;
  onOpen: (index: number) => void;
  busy: boolean;
}

export function SortableVendorCard({ vendor, health, index, onEnableChange, onRemove, onOpen, busy }: SortableVendorCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: index, disabled: busy });
  const validation = validateVendor(vendor);
  const isEnabled = vendor.enabled !== false && !validation.hasErrors;
  const enabledModels = getVendorModels(vendor).filter((model) => model.enabled !== false);
  const circuitSummary = getVendorCircuitSummary(health);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn(
        // 左侧 32px 手柄框与表头图标 chip 同宽，序号/名称列与 "Vendors" 标题对齐
        "flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card py-4 pr-4 pl-0 shadow-card transition-shadow",
        "hover:border-ring/50",
        !isEnabled && "opacity-65",
        validation.hasErrors && "border-destructive/50",
        isDragging && "relative z-10 border-ring shadow-float",
      )}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(index)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(index);
        }
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed"
        title="Drag to reorder. Press Space, then Arrow keys to reorder with the keyboard."
        aria-label="Reorder vendor"
        onClick={(event) => event.stopPropagation()}
        disabled={busy}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>

      {/* 序号徽标提升到行级，随 items-center 在整行（名称 + URL 两行）内垂直居中。
          -ml-2 抵消手柄按钮（size-8 内 16px 图标）右侧 8px 内边距，使手柄→徽标与徽标→名称两处留白一致 */}
      <span className="-ml-2 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="min-w-0 truncate text-sm font-semibold">{vendor.name || "New vendor"}</h3>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-xs text-muted-foreground">{vendor.baseUrl || "Base URL not set"}</span>
          {enabledModels.slice(0, 3).map((model) => (
            <Badge key={model.id} variant="muted" className="max-w-[180px] font-mono font-medium">
              {model.id}
            </Badge>
          ))}
          {enabledModels.length > 3 && <Badge variant="muted">{enabledModels.length} models</Badge>}
          {circuitSummary && (
            <Badge variant={circuitSummary.tone === "danger" ? "destructive" : circuitSummary.tone === "warning" ? "warning" : "muted"}>
              {circuitSummary.label}
            </Badge>
          )}
          {validation.errors.map((message) => (
            <Badge key={message} variant="destructive">
              {message}
            </Badge>
          ))}
          {validation.warnings.map((message) => (
            <Badge key={message} variant="warning">
              {message}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5" onClick={(event) => event.stopPropagation()}>
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => onEnableChange(index, checked)}
          disabled={busy || validation.hasErrors}
          aria-label={isEnabled ? "Disable vendor" : "Enable vendor"}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(index)}
          title="Remove"
          aria-label="Remove vendor"
          disabled={busy}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={15} />
        </Button>
        <span className="text-muted-foreground/50">
          <ChevronRight size={16} />
        </span>
      </div>
    </section>
  );
}
