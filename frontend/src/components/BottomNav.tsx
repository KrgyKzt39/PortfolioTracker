import { BarChart3, CalendarDays, DollarSign, PieChart, Sparkles } from "lucide-react";
import { cn } from "../lib/format";

export type Tab = "portfolio" | "dashboard" | "dividends" | "calendar" | "ask";
export const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "portfolio", label: "Portfolio", icon: BarChart3 },
  { id: "dashboard", label: "Dashboard", icon: PieChart },
  { id: "dividends", label: "Dividends", icon: DollarSign },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "ask", label: "Ask AI", icon: Sparkles },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl">
      <ul className="mx-auto flex max-w-[640px] px-1.5 pt-1.5">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab;
          return (
            <li key={id} className="flex-1 px-0.5 pb-1.5">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                className={cn("flex w-full flex-col items-center gap-0.5 rounded-xl pb-1.5 pt-2 text-[10.5px] font-medium transition-colors", active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-fg2")}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.1 : 1.7} aria-hidden />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
