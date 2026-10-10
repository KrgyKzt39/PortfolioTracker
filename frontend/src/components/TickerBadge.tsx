import { cn } from "../lib/format";

// Muted, distinct badge palettes in the style of the reference screenshot.
const PALETTES = [
  "bg-[#1e3a6e] text-[#8fb6ff]",
  "bg-[#3a1d5c] text-[#c9a2ff]",
  "bg-[#4a3a12] text-[#f3c95a]",
  "bg-[#123f45] text-[#6fe0e6]",
  "bg-[#14304a] text-[#7cc4ff]",
  "bg-[#3d1f3f] text-[#f0a2e8]",
  "bg-[#173d2c] text-[#7ee2a8]",
  "bg-[#452318] text-[#ffab85]",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function TickerBadge({ symbol, className }: { symbol: string; className?: string }) {
  const p = PALETTES[hash(symbol) % PALETTES.length];
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-[30px] w-[50px] shrink-0 items-center justify-center rounded-[8px] font-extrabold tracking-tight",
        symbol.length > 5 ? "text-[7.5px]" : symbol.length > 4 ? "text-[9px]" : "text-[10px]",
        p,
        className,
      )}
    >
      {symbol}
    </div>
  );
}
