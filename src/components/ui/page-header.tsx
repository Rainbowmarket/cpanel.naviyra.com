import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { SearchInput } from "@/components/ui/search-input";

type PageHeaderProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
};

export function PageHeader({
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <h2 className="shrink-0 text-lg font-semibold text-white sm:text-xl">
        {title}
      </h2>

      {onSearchChange ? (
        <SearchInput
          value={searchValue ?? ""}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          className="w-full min-w-0 flex-1 sm:max-w-sm"
        />
      ) : (
        <div className="hidden min-w-0 flex-1 sm:block" />
      )}

      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 sm:w-auto sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm"
        >
          {actionIcon ?? <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          {actionLabel}
        </button>
      ) : null}

      {/* Keep prop for callers; not shown to reduce clutter */}
      {description ? <span className="sr-only">{description}</span> : null}
    </div>
  );
}

export function ModalActions({
  onCancel,
  submitLabel,
  submitting,
  submitDisabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  submitting?: boolean;
  submitDisabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-800 pt-4 sm:gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 sm:px-4 sm:py-2"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting || submitDisabled}
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 sm:px-4 sm:py-2"
      >
        {submitting ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}
