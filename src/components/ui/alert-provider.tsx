"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger";

type AlertOptions = {
  title?: string;
  tone?: AlertTone;
  confirmLabel?: string;
  /** Extra technical text shown in a scrollable block */
  detail?: string;
};

type ConfirmOptions = AlertOptions & {
  cancelLabel?: string;
  /** Destructive action styling */
  danger?: boolean;
};

type DialogState = {
  mode: "alert" | "confirm";
  message: string;
  detail: string;
  title: string;
  tone: AlertTone;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: boolean) => void;
};

type AlertContextValue = {
  alert: (message: string, options?: AlertOptions) => Promise<void>;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
};

const AlertContext = createContext<AlertContextValue | null>(null);

const toneMeta: Record<
  AlertTone,
  { icon: typeof Info; ring: string; iconClass: string; btn: string }
> = {
  info: {
    icon: Info,
    ring: "ring-sky-500/25",
    iconClass: "text-sky-400",
    btn: "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25",
  },
  success: {
    icon: CheckCircle2,
    ring: "ring-emerald-500/25",
    iconClass: "text-emerald-400",
    btn: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
  },
  warning: {
    icon: AlertTriangle,
    ring: "ring-amber-500/25",
    iconClass: "text-amber-400",
    btn: "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
  },
  danger: {
    icon: AlertTriangle,
    ring: "ring-red-500/25",
    iconClass: "text-red-400",
    btn: "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25",
  },
};

function defaultTitle(mode: "alert" | "confirm", tone: AlertTone) {
  if (mode === "confirm") {
    return tone === "danger" ? "Please confirm" : "Confirm";
  }
  if (tone === "danger") return "Error";
  if (tone === "warning") return "Warning";
  if (tone === "success") return "Done";
  return "Notice";
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const queueRef = useRef<DialogState[]>([]);
  const openRef = useRef(false);

  const showNext = useCallback(() => {
    if (openRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setDialog(null);
      return;
    }
    openRef.current = true;
    setDialog(next);
  }, []);

  const enqueue = useCallback(
    (item: DialogState) => {
      queueRef.current.push(item);
      showNext();
    },
    [showNext]
  );

  const close = useCallback(
    (value: boolean) => {
      if (!dialog) return;
      dialog.resolve(value);
      openRef.current = false;
      setDialog(null);
      // Let state flush before next dialog
      queueMicrotask(() => showNext());
    },
    [dialog, showNext]
  );

  const alertFn = useCallback(
    (message: string, options?: AlertOptions) => {
      const tone = options?.tone ?? "info";
      return new Promise<void>((resolve) => {
        enqueue({
          mode: "alert",
          message,
          detail: options?.detail?.trim() ?? "",
          title: options?.title ?? defaultTitle("alert", tone),
          tone,
          confirmLabel: options?.confirmLabel ?? "OK",
          cancelLabel: "Cancel",
          resolve: () => resolve(),
        });
      });
    },
    [enqueue]
  );

  const confirmFn = useCallback(
    (message: string, options?: ConfirmOptions) => {
      const tone =
        options?.tone ?? (options?.danger ? "danger" : "warning");
      return new Promise<boolean>((resolve) => {
        enqueue({
          mode: "confirm",
          message,
          detail: options?.detail?.trim() ?? "",
          title: options?.title ?? defaultTitle("confirm", tone),
          tone,
          confirmLabel:
            options?.confirmLabel ?? (options?.danger ? "Delete" : "Confirm"),
          cancelLabel: options?.cancelLabel ?? "Cancel",
          resolve,
        });
      });
    },
    [enqueue]
  );

  useEffect(() => {
    if (!dialog) return;
    const isConfirm = dialog.mode === "confirm";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(isConfirm ? false : true);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [dialog, close]);

  const value = useMemo(
    () => ({ alert: alertFn, confirm: confirmFn }),
    [alertFn, confirmFn]
  );

  const meta = dialog ? toneMeta[dialog.tone] : null;
  const Icon = meta?.icon ?? Info;

  return (
    <AlertContext.Provider value={value}>
      {children}
      {dialog && meta ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="Dismiss"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => close(dialog.mode === "confirm" ? false : true)}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="naviyra-alert-title"
            aria-describedby="naviyra-alert-desc"
            className={cn(
              "relative w-full max-w-lg overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 shadow-2xl ring-1 sm:rounded-xl",
              meta.ring
            )}
          >
            <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
              <div
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-950/80 ring-1 ring-slate-800",
                  meta.iconClass
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3
                    id="naviyra-alert-title"
                    className="text-sm font-semibold text-white sm:text-base"
                  >
                    {dialog.title}
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      close(dialog.mode === "confirm" ? false : true)
                    }
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p
                  id="naviyra-alert-desc"
                  className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-300"
                >
                  {dialog.message}
                </p>
                {dialog.detail ? (
                  <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-400">
                    {dialog.detail}
                  </pre>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-800 px-4 py-3 sm:px-5">
              {dialog.mode === "confirm" ? (
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  {dialog.cancelLabel}
                </button>
              ) : null}
              <button
                type="button"
                autoFocus
                onClick={() => close(true)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                  meta.btn
                )}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    throw new Error("useAlert must be used within AlertProvider");
  }
  return ctx;
}
