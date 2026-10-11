import { cn } from "../lib/format";

// Soft pastel badges, each passing WCAG AA for text on its own background.
const PALETTES = [
  "bg-[#E7EEFD] text-[#1D4ED8]",
  "bg-[#F1E9FE] text-[#6D28D9]",
  "bg-[#FDF3DC] text-[#A16207]",
  "bg-[#DFF5F3] text-[#0F766E]",
  "bg-[#E2F1FC] text-[#0369A1]",
  "bg-[#FCE8F3] text-[#BE185D]",
  "bg-[#E3F6E9] text-[#15803D]",
  "bg-[#FDEBE3] text-[#C2410C]",
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
        "flex h-[30px] w-[50px] shrink-0 items-center justify-center rounded-[9px] font-bold tracking-tight",
        symbol.length > 5 ? "text-[7.5px]" : symbol.length > 4 ? "text-[9px]" : "text-[10px]",
        p,
        className,
      )}
    >
      {symbol}
    </div>
  );
}
