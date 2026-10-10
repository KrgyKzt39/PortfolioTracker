import { useEffect, useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { useInvalidateAll, useOpenSheet } from "../lib/hooks";
import type { Portfolio } from "../lib/types";
import { Button, Card, IconButton, useToast } from "./ui";
import { TickerBadge } from "./TickerBadge";

type Groups = { key: string; id: number | null; name: string; items: number[] }[];
const keyOf = (id: number | null) => (id === null ? "none" : `c${id}`);

/** Drag stocks within and between categories; reorder categories with the arrows. Saved in one go. */
export function Arrange({ data, onDone }: { data: Portfolio; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const open = useOpenSheet();
  const symbols = useMemo(() => {
    const m = new Map<number, string>();
    data.categories.forEach((c) => c.holdings.forEach((h) => m.set(h.instrument_id, h.symbol)));
    return m;
  }, [data]);
  const [groups, setGroups] = useState<Groups>(() => {
    const g = data.categories.filter((c) => c.id !== null).map((c) => ({ key: keyOf(c.id), id: c.id, name: c.name, items: c.holdings.map((h) => h.instrument_id) }));
    const none = data.categories.find((c) => c.id === null);
    g.push({ key: "none", id: null, name: "Uncategorised", items: none ? none.holdings.map((h) => h.instrument_id) : [] });
    return g;
  });
  // A category created while arranging is added (empty) just above Uncategorised.
  useEffect(() => {
    setGroups((gs) => {
      const known = new Set(gs.map((g) => g.key));
      const fresh = data.categories.filter((c) => c.id !== null && !known.has(keyOf(c.id)));
      if (!fresh.length) return gs;
      const none = gs[gs.length - 1];
      return [...gs.slice(0, -1), ...fresh.map((c) => ({ key: keyOf(c.id), id: c.id, name: c.name, items: [] as number[] })), none];
    });
  }, [data.categories]);
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (id: string | number) => {
    if (typeof id === "string" && groups.some((g) => g.key === id)) return id;
    return groups.find((g) => g.items.includes(Number(id)))?.key;
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over) return;
    const from = containerOf(a.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    setGroups((gs) => {
      const src = gs.find((g) => g.key === from)!;
      const dst = gs.find((g) => g.key === to)!;
      const item = Number(a.id);
      const overIndex = dst.items.indexOf(Number(over.id));
      const at = overIndex >= 0 ? overIndex : dst.items.length;
      return gs.map((g) =>
        g.key === src.key ? { ...g, items: g.items.filter((x) => x !== item) } : g.key === dst.key ? { ...g, items: [...g.items.slice(0, at), item, ...g.items.slice(at)] } : g,
      );
    });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    if (!over) return;
    const c = containerOf(a.id);
    if (!c || c !== containerOf(over.id)) return;
    setGroups((gs) =>
      gs.map((g) => {
        if (g.key !== c) return g;
        const oldI = g.items.indexOf(Number(a.id));
        const newI = g.items.indexOf(Number(over.id));
        return oldI >= 0 && newI >= 0 ? { ...g, items: arrayMove(g.items, oldI, newI) } : g;
      }),
    );
  };

  const moveGroup = (i: number, dir: -1 | 1) =>
    setGroups((gs) => {
      const j = i + dir;
      if (j < 0 || j >= gs.length - 1) return gs; // Uncategorised stays last
      return arrayMove(gs, i, j);
    });

  const save = async () => {
    setBusy(true);
    try {
      await api("/layout", { method: "PUT", body: { categories: groups.map((g) => ({ id: g.id, instrument_ids: g.items })) } });
      invalidate();
      toast("Layout saved");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-sm text-muted">Drag stocks to sort them or move them between categories.</p>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e: DragStartEvent) => setActive(Number(e.active.id))} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        {groups.map((g, i) => (
          <Card key={g.key} className="p-0">
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
              <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{g.name}</h2>
              {g.id !== null && (
                <span className="flex">
                  <IconButton label={`Move ${g.name} up`} className="h-8 w-8" disabled={i === 0} onClick={() => moveGroup(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton label={`Move ${g.name} down`} className="h-8 w-8" disabled={i >= groups.length - 2} onClick={() => moveGroup(i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                </span>
              )}
            </div>
            <Container id={g.key} items={g.items} symbols={symbols} />
          </Card>
        ))}
        <DragOverlay dropAnimation={null}>{active !== null ? <ItemView symbol={symbols.get(active) ?? ""} lifted /> : null}</DragOverlay>
      </DndContext>
      <Button variant="ghost" onClick={() => open({ kind: "category" })}>
        <Plus className="h-4 w-4" /> New category
      </Button>
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 flex gap-2 rounded-2xl bg-ink-900/90 p-2 backdrop-blur">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={save} loading={busy}>
          Save layout
        </Button>
      </div>
    </div>
  );
}

function Container({ id, items, symbols }: { id: string; items: number[]; symbols: Map<number, string> }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className={cn("min-h-[52px] space-y-1.5 px-3 pb-3 transition-colors", isOver && "bg-accent/5")}>
        {items.map((iid) => (
          <SortableItem key={iid} id={iid} symbol={symbols.get(iid) ?? ""} />
        ))}
        {items.length === 0 && <li className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-center text-xs text-faint">Drop stocks here</li>}
      </ul>
    </SortableContext>
  );
}

function SortableItem({ id, symbol }: { id: number; symbol: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-30")}>
      <ItemView symbol={symbol} handleProps={{ ...attributes, ...listeners }} />
    </li>
  );
}

function ItemView({ symbol, lifted, handleProps }: { symbol: string; lifted?: boolean; handleProps?: Record<string, unknown> }) {
  return (
    <div
      {...handleProps}
      aria-label={`Drag ${symbol}`}
      className={cn(
        "flex touch-none select-none items-center gap-3 rounded-xl border border-white/[0.06] bg-ink-750 px-3 py-2.5",
        lifted ? "cursor-grabbing shadow-2xl shadow-black/50 ring-1 ring-accent/60" : "cursor-grab",
      )}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      <TickerBadge symbol={symbol} className="h-[26px] w-[40px]" />
      <span className="text-[14px] font-bold text-white">{symbol}</span>
    </div>
  );
}
