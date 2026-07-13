import { Suspense } from "react";
import FilesPageContent from "./files-content";

export default function FilesPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Loading file manager...</p>}>
      <FilesPageContent />
    </Suspense>
  );
}
