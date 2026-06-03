"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "warning" | "error" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ─── Icons + styles per variant ──────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: React.ReactNode; bg: string; border: string; title: string; desc: string }
> = {
  success: {
    icon: <CheckCircle2 size={18} className="text-[var(--color-success)] flex-shrink-0 mt-0.5" />,
    bg: "bg-[var(--color-surface)]",
    border: "border-l-4 border-l-[var(--color-success)] border border-[var(--color-border)]",
    title: "text-[var(--color-text-strong)]",
    desc: "text-[var(--color-text-muted)]",
  },
  warning: {
    icon: <AlertTriangle size={18} className="text-[var(--color-warning)] flex-shrink-0 mt-0.5" />,
    bg: "bg-[var(--color-warning-bg)]",
    border: "border-l-4 border-l-[var(--color-warning)] border border-orange-200",
    title: "text-[var(--color-warning-text)]",
    desc: "text-[var(--color-warning-text)] opacity-80",
  },
  error: {
    icon: <XCircle size={18} className="text-[var(--color-danger-text)] flex-shrink-0 mt-0.5" />,
    bg: "bg-[var(--color-danger-bg)]",
    border: "border-l-4 border-l-[var(--color-danger-text)] border border-red-200",
    title: "text-[var(--color-danger-text)]",
    desc: "text-[var(--color-danger-text)] opacity-80",
  },
  info: {
    icon: <Info size={18} className="text-[var(--color-primary)] flex-shrink-0 mt-0.5" />,
    bg: "bg-[var(--color-info-bg)]",
    border: "border-l-4 border-l-[var(--color-primary)] border border-blue-100",
    title: "text-[var(--color-info-text)]",
    desc: "text-[var(--color-info-text)] opacity-80",
  },
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ variant, title, description }: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-4), { id, variant, title, description }]);
      timers.current[id] = setTimeout(() => dismiss(id), 5000);
    },
    [dismiss]
  );

  const success = useCallback((title: string, desc?: string) => toast({ variant: "success", title, description: desc }), [toast]);
  const warning = useCallback((title: string, desc?: string) => toast({ variant: "warning", title, description: desc }), [toast]);
  const error   = useCallback((title: string, desc?: string) => toast({ variant: "error",   title, description: desc }), [toast]);
  const info    = useCallback((title: string, desc?: string) => toast({ variant: "info",    title, description: desc }), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, warning, error, info }}>
      {children}

      {/* Toast stack — fixed bottom-right */}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map((t) => {
          const cfg = VARIANT_CONFIG[t.variant];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-[var(--radius-card)] shadow-lg ${cfg.bg} ${cfg.border}`}
              style={{ animation: "toast-in 0.2s ease" }}
            >
              {cfg.icon}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold leading-snug ${cfg.title}`}>{t.title}</p>
                {t.description && (
                  <p className={`text-xs mt-0.5 leading-relaxed ${cfg.desc}`}>{t.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] cursor-pointer flex-shrink-0"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
