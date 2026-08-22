"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { documentTitle } from "@/lib/page-title";

/** Keep the browser tab in sync on client-side navigations. */
export function DocumentTitleSync() {
  const pathname = usePathname();
  useEffect(() => {
    document.title = documentTitle(pathname);
  }, [pathname]);
  return null;
}
