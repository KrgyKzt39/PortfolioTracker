import { cn } from "../lib/format";

// Soft tint + strong text; colours in index.css (.tk-0 … .tk-7) for light and dark.
const PALETTES = 8;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function TickerBadge({ symbol, className }: { symbol: string; className?: string }) {
  const p = `tk-${hash(symbol) % PALETTES}`;
  const label = symbol.replace(/\.[A-Z]{1,3}$/, "").slice(0, 5); // the full symbol is printed beside it
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-[30px] w-[50px] shrink-0 items-center justify-center rounded-[9px] font-bold tracking-tight",
        label.length > 4 ? "text-[9px]" : "text-[10px]",
        p,
        className,
      )}
    >
      {label}
    </div>
  );
}
