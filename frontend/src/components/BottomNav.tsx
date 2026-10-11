import { BarChart3, CalendarDays, DollarSign, PieChart, Sparkles } from "lucide-react";
import { cn } from "../lib/format";

export type Tab = "portfolio" | "dashboard" | "dividends" | "calendar" | "ask";
export const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "dashboard", label: "Dashboard", icon: PieChart },
  { id: "portfolio", label: "Portfolio", icon: BarChart3 },
  { id: "dividends", label: "Dividends", icon: DollarSign },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "ask", label: "AI assistant", icon: Sparkles },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-[0.5px] border-line bg-surface/80 backdrop-blur-xl backdrop-saturate-150 dark:bg-[#161618]/85">
      <ul className="mx-auto flex max-w-[640px]">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                className={cn("flex w-full flex-col items-center gap-[3px] pb-1 pt-[7px] text-[10px] font-medium tracking-[0.01em]", active ? "text-accent" : "text-muted")}
              >
                <Icon className="h-[25px] w-[25px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
