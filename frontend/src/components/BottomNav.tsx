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
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-[#0f1729]/95 backdrop-blur">
      <ul className="mx-auto flex max-w-[640px]">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                className={cn("flex w-full flex-col items-center gap-1 pb-2 pt-3 text-[11px] font-medium transition-colors", active ? "text-accent" : "text-faint hover:text-muted")}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
