import path from "node:path";
import { prisma } from "@/lib/prisma";
import { callAgent } from "@/lib/agent/client";
import { isPathUnderRoot, resolvePathWithinRoot } from "@/lib/file-manager-path";
import {
  isMailSubdomainName,
  listHostingTargets,
  parseHostingTargetId,
} from "@/lib/hosting-targets";

export type FileManagerListItem = {
  name: string;
  type: "dir" | "file";
  size?: number;
  sizeFormatted?: string;
  mtime?: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function assertPathAllowed(filePath: string, documentRoot: string) {
  if (!isPathUnderRoot(filePath, documentRoot)) {
    throw new Error("Access denied: path outside document root");
  }
}

export async function getTargetContext(target: string, userId: string) {
  const normalized = parseHostingTargetId(target);

  if (normalized.kind === "subdomain") {
    const subdomain = await prisma.subdomain.findFirstOrThrow({
      where: { id: normalized.id, domain: { userId } },
      include: { domain: { include: { server: true } } },
    });
    if (isMailSubdomainName(subdomain.name, subdomain.domain.name)) {
      throw new Error(
        "Mail hosts are webmail proxies — use Webmail, not the file manager"
      );
    }
    return {
      documentRoot: subdomain.documentRoot,
      agentKey: subdomain.domain.server.agentKey,
      allowedPaths: [subdomain.documentRoot],
      label: `${subdomain.name}.${subdomain.domain.name}`,
    };
  }

  const domain = await prisma.domain.findFirstOrThrow({
    where: { id: normalized.id, userId },
    include: { server: true },
  });
  return {
    documentRoot: domain.documentRoot,
    agentKey: domain.server.agentKey,
    allowedPaths: [domain.documentRoot],
    label: domain.name,
  };
}

/** @deprecated alias */
export async function getDomainContext(domainId: string, userId: string) {
  return getTargetContext(domainId, userId);
}

export async function listFileManagerTargets(userId: string) {
  // mail.* / webmail.* are panel proxies, not site document roots
  const targets = await listHostingTargets(userId, {
    excludeMailSubdomains: true,
  });
  return targets.map((t) => ({
    id: t.id,
    label: t.label,
    documentRoot: t.documentRoot,
  }));
}

async function agentCall<T>(
  agentKey: string | undefined,
  payload: Parameters<typeof callAgent>[0]
) {
  const result = await callAgent<T>(payload, agentKey);
  if (!result.success) {
    throw new Error(result.error ?? "File operation failed");
  }
  return result.data as T;
}

export async function fileManagerSession(target: string, userId: string) {
  const ctx = await getTargetContext(target, userId);
  return {
    success: true,
    user: userId,
    permissions: ["read", "edit", "upload", "download", "delete", "admin"],
    breadcrumbHome: ctx.documentRoot,
    allowedPaths: ctx.allowedPaths,
  };
}

export async function fileManagerList(
  target: string,
  userId: string,
  dirPath: string
) {
  const ctx = await getTargetContext(target, userId);
  const resolved = resolvePathWithinRoot(dirPath, ctx.documentRoot);

  const data = await agentCall<{ entries: Array<{ name: string; type: string; size?: number; modifiedAt?: string }> }>(
    ctx.agentKey,
    { action: "list_files", path: resolved }
  );

  const folders = data.entries
    .filter((e) => e.type === "directory")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const files = data.entries
    .filter((e) => e.type === "file")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const items: FileManagerListItem[] = [
    ...folders.map((entry) => ({
      name: entry.name,
      type: "dir" as const,
      mtime: entry.modifiedAt ? Math.floor(new Date(entry.modifiedAt).getTime() / 1000) : 0,
    })),
    ...files.map((entry) => ({
      name: entry.name,
      type: "file" as const,
      size: entry.size ?? 0,
      sizeFormatted: formatBytes(entry.size ?? 0),
      mtime: entry.modifiedAt ? Math.floor(new Date(entry.modifiedAt).getTime() / 1000) : 0,
    })),
  ];

  return { success: true, path: resolved, items };
}

function resolveUnderRoot(inputPath: string, documentRoot: string): string {
  const root = path.resolve(documentRoot);
  const raw = (inputPath || "").trim();
  if (!raw || raw === "." || raw === "/" || raw === "\\") {
    return root;
  }
  // Absolute path: keep if under root, else clamp to root
  if (path.isAbsolute(raw)) {
    const resolved = path.resolve(raw);
    return isPathUnderRoot(resolved, root) ? resolved : root;
  }
  // Relative to document root
  const resolved = path.resolve(root, raw);
  return isPathUnderRoot(resolved, root) ? resolved : root;
}

export async function fileManagerRead(
  target: string,
  userId: string,
  dirPath: string,
  fileName: string
) {
  const ctx = await getTargetContext(target, userId);
  const dirReal = resolveUnderRoot(dirPath, ctx.documentRoot);
  assertPathAllowed(dirReal, ctx.documentRoot);
  const filePath = path.join(dirReal, path.basename(fileName));
  assertPathAllowed(filePath, ctx.documentRoot);

  const data = await agentCall<{ content: string }>(ctx.agentKey, {
    action: "read_file",
    path: filePath,
  });

  return {
    success: true,
    content: data.content,
    path: dirReal,
    file: path.basename(fileName),
    fullPath: filePath,
  };
}

export async function fileManagerWrite(
  target: string,
  userId: string,
  filePath: string,
  content: string
) {
  const ctx = await getTargetContext(target, userId);
  const raw = filePath.trim();
  const finalPath = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.join(path.resolve(ctx.documentRoot), raw.replace(/^[/\\]+/, ""));
  assertPathAllowed(finalPath, ctx.documentRoot);
  await agentCall(ctx.agentKey, { action: "write_file", path: finalPath, content });
  return { success: true, message: "Saved." };
}

export async function fileManagerCreate(
  target: string,
  userId: string,
  dirPath: string,
  name: string,
  kind: "createFolder" | "createFile"
) {
  const ctx = await getTargetContext(target, userId);
  const dirReal = resolveUnderRoot(dirPath, ctx.documentRoot);
  assertPathAllowed(dirReal, ctx.documentRoot);
  const itemPath = path.join(dirReal, path.basename(name));
  assertPathAllowed(itemPath, ctx.documentRoot);

  if (kind === "createFolder") {
    await agentCall(ctx.agentKey, { action: "create_directory", path: itemPath });
  } else {
    await agentCall(ctx.agentKey, { action: "write_file", path: itemPath, content: "" });
  }
  return `${kind === "createFolder" ? "Folder" : "File"} '${name}' created successfully!`;
}

export async function fileManagerDelete(
  target: string,
  userId: string,
  targetPath: string,
  isFile: boolean
) {
  const ctx = await getTargetContext(target, userId);
  const resolved = resolveUnderRoot(targetPath, ctx.documentRoot);
  assertPathAllowed(resolved, ctx.documentRoot);
  await agentCall(ctx.agentKey, {
    action: isFile ? "delete_file" : "delete_directory",
    path: resolved,
  });
  return isFile ? "File deleted successfully!" : "Directory deleted successfully!";
}

export async function fileManagerAction(
  target: string,
  userId: string,
  action: "rename" | "move" | "copy",
  params: { source: string; name?: string; dest?: string }
) {
  const ctx = await getTargetContext(target, userId);
  const source = resolveUnderRoot(params.source, ctx.documentRoot);
  assertPathAllowed(source, ctx.documentRoot);

  if (action === "rename") {
    if (!params.name) throw new Error("New name is required.");
    const parent = path.dirname(source);
    const target = path.join(parent, path.basename(params.name));
    assertPathAllowed(target, ctx.documentRoot);
    await agentCall(ctx.agentKey, { action: "rename_path", source, dest: target });
    return "Renamed successfully.";
  }

  if (!params.dest) throw new Error("Valid destination directory is required.");
  const destDir = resolveUnderRoot(params.dest, ctx.documentRoot);
  assertPathAllowed(destDir, ctx.documentRoot);
  await agentCall(ctx.agentKey, {
    action: action === "move" ? "move_path" : "copy_path",
    source,
    dest: destDir,
  });
  return action === "move" ? "Moved successfully." : "Copied successfully.";
}

export async function fileManagerUpload(
  target: string,
  userId: string,
  dirPath: string,
  fileName: string,
  contentBase64: string
) {
  const ctx = await getTargetContext(target, userId);
  const dirReal = resolveUnderRoot(dirPath, ctx.documentRoot);
  assertPathAllowed(dirReal, ctx.documentRoot);
  const filePath = path.join(dirReal, path.basename(fileName));
  assertPathAllowed(filePath, ctx.documentRoot);
  const result = await agentCall<{
    path: string;
    extracted?: boolean;
    extractedTo?: string;
    removedZip?: boolean;
  }>(ctx.agentKey, {
    action: "upload_file",
    path: filePath,
    contentBase64,
    removeZip: true,
  });
  if (result.extracted) {
    return `ZIP uploaded and extracted to: ${result.extractedTo ?? dirReal}`;
  }
  return `File uploaded successfully to: ${filePath}`;
}

export async function fileManagerExtractZip(
  target: string,
  userId: string,
  dirPath: string,
  fileName: string,
  removeZip = false
) {
  const ctx = await getTargetContext(target, userId);
  const dirReal = resolveUnderRoot(dirPath, ctx.documentRoot);
  assertPathAllowed(dirReal, ctx.documentRoot);
  const filePath = path.join(dirReal, path.basename(fileName));
  assertPathAllowed(filePath, ctx.documentRoot);
  if (!/\.zip$/i.test(fileName)) {
    throw new Error("Only .zip files can be extracted");
  }
  const result = await agentCall<{ extractedTo: string; removedZip: boolean }>(
    ctx.agentKey,
    {
      action: "extract_zip",
      path: filePath,
      dest: dirReal,
      removeZip,
    }
  );
  return `Extracted to: ${result.extractedTo}`;
}

export async function fileManagerDownloadPath(
  target: string,
  userId: string,
  dirPath: string,
  fileName: string
) {
  const ctx = await getTargetContext(target, userId);
  const dirReal = resolveUnderRoot(dirPath, ctx.documentRoot);
  assertPathAllowed(dirReal, ctx.documentRoot);
  const filePath = path.join(dirReal, path.basename(fileName));
  assertPathAllowed(filePath, ctx.documentRoot);
  const data = await agentCall<{ contentBase64: string; size: number }>(ctx.agentKey, {
    action: "read_file_binary",
    path: filePath,
  });
  return { filePath, fileName: path.basename(fileName), ...data };
}
