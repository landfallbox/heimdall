import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Loader2, Plus, Server } from "lucide-react";

import { SortableVendorCard } from "../components/vendor-card.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader } from "../components/ui/card.tsx";
import type { VendorDraft } from "../config-draft.ts";
import type { VendorHealth } from "../types.ts";

interface VendorsPageProps {
  vendors: VendorDraft[];
  vendorHealth: VendorHealth[] | undefined;
  onUpdateVendor: (index: number, field: string, value: unknown) => void;
  onAddVendor: () => void;
  onRemoveVendor: (index: number) => void;
  onReorderVendors: (sourceIndex: number, targetIndex: number) => void;
  onOpenVendorEditor: (index: number) => void;
  busy: boolean;
}

export function VendorsPage({
  vendors,
  vendorHealth,
  onUpdateVendor,
  onAddVendor,
  onRemoveVendor,
  onReorderVendors,
  onOpenVendorEditor,
  busy,
}: VendorsPageProps) {
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
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Server size={16} />
          </span>
          <h2 className="text-[15px] font-semibold tracking-tight">Vendors</h2>
        </div>
        <CardAction>
          <Button size="sm" onClick={onAddVendor} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
            Add
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="flex flex-col gap-3">
            {vendors.length === 0 && (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-muted-foreground">
                <Server size={26} />
                <h3 className="text-sm font-semibold text-foreground">No vendors configured</h3>
              </div>
            )}

            <SortableContext items={vendors.map((_vendor, index) => index)} strategy={verticalListSortingStrategy}>
              {vendors.map((vendor, index) => (
                <SortableVendorCard
                  key={`${vendor.name}-${index}`}
                  vendor={vendor}
                  health={vendorHealth?.find((item) => item.priority === index)}
                  index={index}
                  onEnableChange={(vendorIndex, enabled) => onUpdateVendor(vendorIndex, "enabled", enabled)}
                  onRemove={onRemoveVendor}
                  onOpen={onOpenVendorEditor}
                  busy={busy}
                />
              ))}
            </SortableContext>
          </div>
        </DndContext>
      </CardContent>
    </Card>
  );
}
