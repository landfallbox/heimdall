import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, Server, Trash2 } from "lucide-react";

import { validateVendor } from "../app-model.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { Switch } from "./ui/switch.tsx";
import type { VendorDraft } from "../config-draft.ts";

interface VendorsRailProps {
  vendors: VendorDraft[];
  /** 当前选中（正在编辑）的 vendor 下标；-1 表示未保存的新 vendor */
  selectedIndex: number | null;
  hasUnsavedNew: boolean;
  unsavedName: string;
  onAddVendor: () => void;
  onRemoveVendor: (index: number) => void;
  onReorderVendors: (sourceIndex: number, targetIndex: number) => void;
  onSelectVendor: (index: number) => void;
  onEnableChange: (index: number, enabled: boolean) => void;
  busy: boolean;
}

export function VendorsRail({
  vendors,
  selectedIndex,
  hasUnsavedNew,
  unsavedName,
  onAddVendor,
  onRemoveVendor,
  onReorderVendors,
  onSelectVendor,
  onEnableChange,
  busy,
}: VendorsRailProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) {
      return;
    }
    onReorderVendors(Number(active.id), Number(over.id));
  }

  return (
    <section className="flex flex-col p-2" aria-label="Vendors">
      <div className="flex shrink-0 items-center justify-between px-2 pb-2 pt-1">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          <Server size={14} className="text-primary" aria-hidden="true" />
          Vendors
        </h2>
        <Button size="icon-sm" variant="ghost" onClick={onAddVendor} disabled={busy} title="Add vendor" aria-label="Add vendor">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
        </Button>
      </div>

      <div>
        {vendors.length === 0 && !hasUnsavedNew && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-8 text-center text-muted-foreground">
            <Server size={20} />
            <p className="text-xs">No vendors yet</p>
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={vendors.map((_vendor, index) => index)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {vendors.map((vendor, index) => (
                <SortableVendorRow
                  key={`${vendor.name}-${index}`}
                  vendor={vendor}
                  index={index}
                  selected={selectedIndex === index}
                  onEnableChange={onEnableChange}
                  onRemove={onRemoveVendor}
                  onSelect={onSelectVendor}
                  busy={busy}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {hasUnsavedNew && (
          <div className="mt-0.5 flex items-center gap-1.5 rounded-lg bg-accent py-2 pr-1.5 pl-1 text-sm text-accent-foreground" aria-current="true">
            <span className="w-5 shrink-0" aria-hidden="true" />
            <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{unsavedName || "new-vendor"}</span>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">new</span>
          </div>
        )}
      </div>
    </section>
  );
}

interface SortableVendorRowProps {
  vendor: VendorDraft;
  index: number;
  selected: boolean;
  onEnableChange: (index: number, enabled: boolean) => void;
  onRemove: (index: number) => void;
  onSelect: (index: number) => void;
  busy: boolean;
}

function SortableVendorRow({ vendor, index, selected, onEnableChange, onRemove, onSelect, busy }: SortableVendorRowProps) {
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
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-lg py-2 pr-1.5 pl-1 text-sm transition-colors",
        selected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragging && "relative z-10 opacity-70",
      )}
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(index)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(index);
        }
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground disabled:cursor-not-allowed"
        title="Drag to reorder. Press Space, then Arrow keys to reorder with the keyboard."
        aria-label="Reorder vendor"
        onClick={(event) => event.stopPropagation()}
        disabled={busy}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>

      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          validation.hasErrors ? "bg-destructive" : isEnabled ? "bg-success" : "bg-muted-foreground/40",
        )}
        aria-hidden="true"
      />

      <span className="min-w-0 flex-1 truncate font-medium" title={vendor.name || "New vendor"}>{vendor.name || "New vendor"}</span>

      <span className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => onEnableChange(index, checked)}
          disabled={busy || validation.hasErrors}
          aria-label={isEnabled ? `Disable ${vendor.name || "vendor"}` : `Enable ${vendor.name || "vendor"}`}
          className="scale-90"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(index)}
          title="Remove"
          aria-label={`Remove ${vendor.name || "vendor"}`}
          disabled={busy}
          className="size-6 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </Button>
      </span>
    </div>
  );
}
