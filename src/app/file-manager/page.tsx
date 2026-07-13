"use client";

import { Suspense } from "react";
import FileManagerShell from "@/file-manager/FileManagerShell";

export default function FileManagerPage() {
  return (
    <Suspense fallback={<div className="empty-state">Loading file manager…</div>}>
      <FileManagerShell />
    </Suspense>
  );
}
