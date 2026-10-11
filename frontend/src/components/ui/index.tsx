/* Small shadcn/ui-style primitives (same API shape, no extra runtime dependencies). */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Loader2, X, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "../../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "pill";
const variants: Record<Variant, string> = {
  // iOS button styles: filled, gray (tinted fill), plain text
  primary: "bg-accent text-white active:opacity-80",
  secondary: "bg-fill/[0.12] text-accent active:opacity-70",
  ghost: "text-accent active:opacity-60",
  danger: "bg-down-strong/[0.12] text-down active:opacity-70",
  pill: "rounded-full bg-fill/[0.12] text-accent active:opacity-70",
};

export function Button({ variant = "primary", loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[12px] px-4 py-2.5 text-[15px] font-semibold transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none",
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
      className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full text-accent active:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent", className)}
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
    <div role="alert" className="m-4 rounded-2xl border border-down-soft bg-down-soft p-4 text-sm text-down">
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
  return <section className={cn("overflow-hidden rounded-[14px] bg-surface", className)}>{children}</section>;
}

/** iOS large-title header with toolbar icons on the right. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-end justify-between gap-2 px-1 pt-1">
      <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-fg">{title}</h1>
      {children && <div className="-mr-1.5 flex shrink-0 items-center gap-0.5 pb-0.5">{children}</div>}
    </div>
  );
}

/** Section title above a grouped list. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-2 px-1 pb-1.5 pt-2">
      <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[17px] font-semibold text-fg">{title}</p>
      {children && <div className="mt-1.5 text-[15px] text-muted">{children}</div>}
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
      <label htmlFor={id} className="px-1 text-[13px] text-muted">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="px-1 text-[12px] text-muted">{hint}</p>}
      {error && (
        <p className="text-2xs text-down" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-[10px] border-0 bg-field px-3.5 py-[11px] text-[17px] text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

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
        <span className="block text-sm text-fg">{label}</span>
        {description && <span className="block text-2xs text-muted">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-[31px] w-[51px] rounded-full bg-ink-600 transition-colors peer-checked:bg-[#34C759] peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
        <span className="absolute left-0.5 top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)] transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[9px] bg-fill/[0.12] p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex-1 rounded-[7px] px-2 py-[5px] text-[13px] transition-colors", value === o.value ? "bg-white font-semibold text-fg shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] dark:bg-[#636366]" : "font-medium text-fg")}
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-[12px] bg-sheet shadow-2xl focus:outline-none sm:rounded-[14px]",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <div className="mx-auto mt-[5px] h-[5px] w-9 rounded-full bg-fill/30 sm:hidden" aria-hidden />
        <div className="relative flex items-center justify-center px-14 pb-2 pt-2.5">
          <h2 className="truncate text-[17px] font-semibold text-fg">{title}</h2>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className="absolute right-4 top-2 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-fill/[0.12] text-muted active:opacity-60">
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2">{children}</div>
        {footer && <div className="flex gap-2.5 px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-2 [&>button]:h-[50px] [&>button]:rounded-[14px] [&>button]:text-[17px]">{footer}</div>}
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
              "pointer-events-auto flex max-w-md items-start gap-2 rounded-full border px-4 py-2.5 text-[15px] font-medium shadow-[0_8px_30px_rgba(0,0,0,0.12)]",
              t.kind === "success" && "border-up-soft bg-surface text-up",
              t.kind === "error" && "border-down-soft bg-surface text-down",
              t.kind === "info" && "border-line bg-surface text-fg",
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
      <div className="text-sm text-fg2">{message}</div>
    </Sheet>
  );
}
