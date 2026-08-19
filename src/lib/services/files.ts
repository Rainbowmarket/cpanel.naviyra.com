import path from "node:path";
import { callAgent } from "@/lib/agent/client";
import {
  isPathUnderRoot,
  resolvePathWithinRoot,
} from "@/lib/file-manager-path";
import { prisma } from "@/lib/prisma";

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

function assertOwnedPath(filePath: string, documentRoot: string): string {
  const root = path.resolve(documentRoot);
  const resolved = path.resolve(filePath);
  if (!isPathUnderRoot(resolved, root)) {
    throw new Error("Access denied: path outside document root");
  }
  return resolved;
}

export async function listFiles(dirPath: string, domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

  const safePath = resolvePathWithinRoot(dirPath, domain.documentRoot);

  const result = await callAgent<{ entries: FileEntry[] }>(
    { action: "list_files", path: safePath, root: domain.documentRoot },
    domain.server.agentKey
  );

  if (!result.success) {
    throw new Error(result.error ?? "Failed to list files");
  }

  return result.data?.entries ?? [];
}

export async function readFile(filePath: string, domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

  const safePath = assertOwnedPath(filePath, domain.documentRoot);

  const result = await callAgent<{ content: string }>(
    { action: "read_file", path: safePath, root: domain.documentRoot },
    domain.server.agentKey
  );

  if (!result.success) {
    throw new Error(result.error ?? "Failed to read file");
  }

  return result.data?.content ?? "";
}

export async function writeFile(
  filePath: string,
  content: string,
  domainId: string,
  userId: string
) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

  const safePath = assertOwnedPath(filePath, domain.documentRoot);

  const result = await callAgent(
    { action: "write_file", path: safePath, content, root: domain.documentRoot },
    domain.server.agentKey
  );

  if (!result.success) {
    throw new Error(result.error ?? "Failed to write file");
  }
}
