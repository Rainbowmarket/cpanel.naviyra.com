import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function matchesSearch(query: string, ...values: Array<string | number | null | undefined>) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(term)
  );
}
