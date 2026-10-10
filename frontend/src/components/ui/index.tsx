/* Small shadcn/ui-style primitives (same API shape, no extra runtime dependencies). */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Loader2, X, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "../../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "pill";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-blue-500 active:bg-blue-600",
  secondary: "bg-ink-700 text-slate-100 hover:bg-ink-600",
  ghost: "text-slate-300 hover:bg-ink-700",
  danger: "bg-down/15 text-down hover:bg-down/25",
  pill: "rounded-full bg-accent/15 text-blue-300 hover:bg-accent/25 border border-accent/25",
};

export function Button({ variant = "primary", loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent", className)}
    >
      {children}
    </button>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> <span className="text-sm">{label}…</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="m-4 rounded-2xl border border-down/30 bg-down/10 p-4 text-sm text-red-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex-1">{msg}</div>
      </div>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("overflow-hidden rounded-[22px] border border-white/[0.06] bg-ink-800 shadow-lg shadow-black/20", className)}>{children}</section>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="font-semibold text-slate-200">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold", className)}>{children}</span>;
}

/* ---------------------------------------------------------------- forms */
export function Field({ label, error, hint, children, className }: { label: string; error?: string | null; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-2xs text-faint">{hint}</p>}
      {error && (
        <p className="text-2xs text-down" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-[16px] text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, "appearance-none pr-8", props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, "min-h-[72px]", props.className)} />;
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-2">
      <span>
        <span className="block text-sm text-slate-100">{label}</span>
        {description && <span className="block text-2xs text-muted">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-ink-600 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-ink-900 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors", value === o.value ? "bg-ink-700 text-white" : "text-muted hover:text-slate-200")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- sheet (modal) */
export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-[26px] border border-white/10 bg-ink-850 shadow-2xl focus:outline-none sm:rounded-[26px]",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3.5">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="flex gap-2 border-t border-white/5 px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts & confirm */
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl border px-4 py-3 text-sm shadow-xl",
              t.kind === "success" && "border-up/30 bg-[#0f2a22] text-emerald-100",
              t.kind === "error" && "border-down/30 bg-[#2c1418] text-red-100",
              t.kind === "info" && "border-accent/30 bg-ink-750 text-slate-100",
            )}
          >
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function ConfirmSheet({ open, title, message, confirmLabel = "Delete", onConfirm, onClose, loading }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => void; onClose: () => void; loading?: boolean }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-300">{message}</div>
    </Sheet>
  );
}
