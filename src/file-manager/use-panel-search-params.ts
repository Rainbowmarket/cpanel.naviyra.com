"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SearchUpdater =
  | URLSearchParams
  | Record<string, string | null | undefined>
  | ((prev: URLSearchParams) => URLSearchParams);

/**
 * Preserve existing query keys (especially `target`) unless the updater removes them.
 * Passing a plain object merges into the current params instead of replacing them.
 */
export function usePanelSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setSearchParams = useCallback(
    (updater: SearchUpdater) => {
      const prev = new URLSearchParams(params.toString());
      let next: URLSearchParams;

      if (typeof updater === "function") {
        next = updater(prev);
      } else if (updater instanceof URLSearchParams) {
        next = updater;
      } else {
        next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updater)) {
          if (value == null || value === "") next.delete(key);
          else next.set(key, value);
        }
      }

      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      const current = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      if (href === current) return;

      router.replace(href, { scroll: false });
    },
    [router, pathname, params]
  );

  return { searchParams: params, setSearchParams };
}
