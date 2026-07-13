"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { setFileManagerTarget } from "@/file-manager/domain-id";
import { isPathUnderRoot } from "@/lib/file-manager-path";
import "@/file-manager/file-manager.css";

const WorkspacePage = dynamic(
  () => import("@/file-manager/WorkspacePage").then((m) => ({ default: m.WorkspacePage })),
  {
    ssr: false,
    loading: () => <div className="empty-state">Loading editor…</div>,
  }
);

type FileTarget = { id: string; label: string; documentRoot: string };

function resolveInitialTarget(
  searchParams: URLSearchParams,
  targets: FileTarget[]
): string | null {
  const explicit = searchParams.get("target");
  if (explicit && targets.some((t) => t.id === explicit)) return explicit;

  const subdomainId = searchParams.get("subdomainId");
  if (subdomainId) {
    const id = subdomainId.startsWith("s:") ? subdomainId : `s:${subdomainId}`;
    if (targets.some((t) => t.id === id)) return id;
  }

  const domainId = searchParams.get("domainId");
  if (domainId) {
    const id = domainId.startsWith("d:") || domainId.startsWith("s:") ? domainId : `d:${domainId}`;
    if (targets.some((t) => t.id === id)) return id;
  }

  return targets[0]?.id ?? null;
}

export default function FileManagerShell() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [targets, setTargets] = useState<FileTarget[]>([]);
  const [targetId, setTargetId] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-file-manager", "");
    return () => document.documentElement.removeAttribute("data-file-manager");
  }, []);

  useEffect(() => {
    fetch("/api/file-manager/targets")
      .then((r) => r.json())
      .then((d) => {
        const list = d.targets ?? [];
        setTargets(list);
        const initial = resolveInitialTarget(searchParams, list);
        if (initial) {
          setFileManagerTarget(initial);
          setTargetId(initial);
        }
      });
  }, [searchParams]);

  const selectedTarget = targets.find((t) => t.id === targetId);

  useEffect(() => {
    if (!targetId || !selectedTarget) return;

    const urlTarget = searchParams.get("target");
    const currentP = searchParams.get("p");
    const legacyPath = searchParams.get("path");
    const pathValue = currentP || legacyPath || selectedTarget.documentRoot;
    const pathOk = isPathUnderRoot(pathValue, selectedTarget.documentRoot);

    if (urlTarget === targetId && currentP && pathOk && !legacyPath) return;

    const next = new URLSearchParams(searchParams.toString());
    next.set("target", targetId);
    next.delete("domainId");
    next.delete("subdomainId");
    next.delete("path");
    next.set("p", pathOk ? pathValue : selectedTarget.documentRoot);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [targetId, selectedTarget, searchParams, router, pathname]);

  function handleTargetChange(id: string) {
    const target = targets.find((t) => t.id === id);
    if (!target) return;

    setFileManagerTarget(id);
    setTargetId(id);

    const next = new URLSearchParams();
    next.set("target", id);
    next.set("p", target.documentRoot);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const urlTarget = searchParams.get("target");
  const urlPath = searchParams.get("p");
  const isReady =
    !!targetId &&
    !!selectedTarget &&
    urlTarget === targetId &&
    !!urlPath &&
    isPathUnderRoot(urlPath, selectedTarget.documentRoot);

  if (!targetId && targets.length > 0) {
    return <div className="empty-state">No site selected for file manager.</div>;
  }

  if (!isReady) {
    return <div className="empty-state">Loading file manager…</div>;
  }

  return (
    <div className="file-manager-shell">
      <WorkspacePage
        key={`${targetId}:${urlPath}`}
        domainOptions={targets.map((t) => ({ value: t.id, label: t.label }))}
        domainId={targetId}
        onDomainChange={handleTargetChange}
      />
    </div>
  );
}
