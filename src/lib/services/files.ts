import { callAgent } from "@/lib/agent/client";
import { prisma } from "@/lib/prisma";

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

export async function listFiles(path: string, domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

  const safePath = path.startsWith(domain.documentRoot)
    ? path
    : domain.documentRoot;

  const result = await callAgent<{ entries: FileEntry[] }>(
    { action: "list_files", path: safePath },
    domain.server.agentKey
  );

  if (!result.success) {
    throw new Error(result.error ?? "Failed to list files");
  }

  return result.data?.entries ?? [];
}

export async function readFile(path: string, domainId: string, userId: string) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

  if (!path.startsWith(domain.documentRoot)) {
    throw new Error("Access denied: path outside document root");
  }

  const result = await callAgent<{ content: string }>(
    { action: "read_file", path },
    domain.server.agentKey
  );

  if (!result.success) {
    throw new Error(result.error ?? "Failed to read file");
  }

  return result.data?.content ?? "";
}

export async function writeFile(
  path: string,
  content: string,
  domainId: string,
  userId: string
) {
  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: domainId, userId },
    include: { server: true },
  });

  if (!path.startsWith(domain.documentRoot)) {
    throw new Error("Access denied: path outside document root");
  }

  const result = await callAgent(
    { action: "write_file", path, content },
    domain.server.agentKey
  );

  if (!result.success) {
    throw new Error(result.error ?? "Failed to write file");
  }
}
