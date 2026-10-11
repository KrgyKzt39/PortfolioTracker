import { cn } from "../lib/format";

// Soft tint + strong text; colours in index.css (.tk-0 … .tk-7) for light and dark.
const PALETTES = 8;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Round symbol badge, like an app icon in a list. The full symbol is printed beside it. */
export function TickerBadge({ symbol, className }: { symbol: string; className?: string }) {
  const p = `tk-${hash(symbol) % PALETTES}`;
  const label = symbol.replace(/\.[A-Z]{1,3}$/, "").replace(/-.*$/, "").slice(0, 4);
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.02em]",
        label.length > 3 ? "text-[10.5px]" : "text-[12px]",
        p,
        className,
      )}
    >
      {label}
    </div>
  );
}
