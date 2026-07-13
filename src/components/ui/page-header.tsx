import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { SearchInput } from "@/components/ui/search-input";

type PageHeaderProps = {
  title: string;
  description: string;
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
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        <p className="mt-1 text-slate-400">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {onSearchChange && (
          <SearchInput
            value={searchValue ?? ""}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            className="w-56 sm:w-64"
          />
        )}
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            {actionIcon ?? <Plus className="h-4 w-4" />}
            {actionLabel}
          </button>
        )}
      </div>
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
    <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting || submitDisabled}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {submitting ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}
