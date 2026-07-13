"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SearchUpdater =
  | URLSearchParams
  | Record<string, string>
  | ((prev: URLSearchParams) => URLSearchParams);

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
        next = new URLSearchParams();
        for (const [key, value] of Object.entries(updater)) {
          if (value) next.set(key, value);
        }
      }

      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params]
  );

  return { searchParams: params, setSearchParams };
}
