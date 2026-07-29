import { getFileManagerTarget } from "./domain-id";

const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json" };

export const NOT_AUTHENTICATED_MESSAGE = "Not authenticated";

export function isSessionExpiredPayload(
  data: { success?: boolean; message?: string } | null | undefined
): boolean {
  if (data == null || data.success !== false) return false;
  const m = data.message;
  return (
    m === NOT_AUTHENTICATED_MESSAGE ||
    (typeof m === "string" && m.includes(NOT_AUTHENTICATED_MESSAGE))
  );
}

export class SessionExpiredError extends Error {
  override name = "SessionExpiredError";
  constructor() {
    super(NOT_AUTHENTICATED_MESSAGE);
  }
}

function apiUrl(path: string, params?: Record<string, string>) {
  const target = getFileManagerTarget();
  const q = new URLSearchParams({ target, ...(params ?? {}) });
  return `/api/file-manager${path}?${q}`;
}

async function readJson<T>(r: Response): Promise<T> {
  const text = await r.text();
  if (!text.trim()) {
    throw new Error(`Empty response (HTTP ${r.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON (${r.status}): ${text.slice(0, 200)}`);
  }
}

export type SessionResponse = {
  success: boolean;
  user?: string;
  permissions?: string[];
  breadcrumbHome?: string;
  allowedPaths?: string[];
  message?: string;
};

export async function apiSession(): Promise<SessionResponse> {
  const r = await fetch(apiUrl("", { action: "session" }), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return readJson<SessionResponse>(r);
}

export async function apiLogin(_username: string, _password: string) {
  return apiSession();
}

export async function apiLogout() {
  /* Panel session handles auth */
}

export type ListItem = {
  name: string;
  type: "dir" | "file";
  size?: number;
  sizeFormatted?: string;
  mtime?: number;
};

export async function apiList(path: string) {
  const q: Record<string, string> = { action: "list" };
  if (path) q.path = path;
  const r = await fetch(apiUrl("", q), { credentials: "include" });
  return readJson<{
    success: boolean;
    path?: string;
    items?: ListItem[];
    message?: string;
  }>(r);
}

export async function apiRead(dirPath: string, file: string) {
  const r = await fetch(
    apiUrl("", { action: "read", path: dirPath, file }),
    { credentials: "include" }
  );
  return readJson<{
    success: boolean;
    content?: string;
    path?: string;
    file?: string;
    fullPath?: string;
    message?: string;
    sizeFormatted?: string;
  }>(r);
}

export async function saveFile(filePath: string, content: string) {
  const r = await fetch("/api/file-manager/update", {
    method: "POST",
    credentials: "include",
    headers: { ...jsonHeaders, "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({
      target: getFileManagerTarget(),
      path: filePath,
      content,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
}

const formHeaders = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

export async function extractZip(dirPath: string, fileName: string, removeZip = false) {
  const body = new URLSearchParams();
  body.set("target", getFileManagerTarget());
  body.set("path", dirPath);
  body.set("file", fileName);
  if (removeZip) body.set("removeZip", "1");
  const r = await fetch("/api/file-manager/extract", {
    method: "POST",
    credentials: "include",
    headers: formHeaders,
    body,
  });
  return readJson<{ success: boolean; message?: string }>(r);
}

export async function fileActions(
  action: "rename" | "move" | "copy",
  params: { source: string; name?: string; dest?: string }
) {
  const body = new URLSearchParams();
  body.set("target", getFileManagerTarget());
  body.set("action", action);
  body.set("source", params.source);
  if (params.name !== undefined) body.set("name", params.name);
  if (params.dest !== undefined) body.set("dest", params.dest);
  const r = await fetch("/api/file-manager/actions", {
    method: "POST",
    credentials: "include",
    headers: formHeaders,
    body,
  });
  return readJson<{ success: boolean; message?: string }>(r);
}

export async function deleteItem(isFile: boolean, targetPath: string) {
  const action = isFile ? "deleteFile" : "deleteDirectory";
  const q = new URLSearchParams({
    target: getFileManagerTarget(),
    action,
    p: targetPath,
  });
  const r = await fetch(`/api/file-manager/delete?${q}`, { credentials: "include" });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
}

export async function createItem(
  kind: "createFolder" | "createFile",
  dirPath: string,
  name: string
) {
  const q = new URLSearchParams({
    target: getFileManagerTarget(),
    action: kind,
    p: dirPath,
    name,
  });
  const r = await fetch(`/api/file-manager/create?${q}`, { credentials: "include" });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  return text;
}

export function uploadFileToFolder(
  dirPath: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.set("target", getFileManagerTarget());
    fd.set("path", dirPath);
    fd.set("file", file, file.name);

    xhr.open("POST", "/api/file-manager/upload");
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    xhr.setRequestHeader("Accept", "application/json, text/plain, */*");

    xhr.upload.onprogress = (ev) => {
      if (!onProgress) return;
      const total = ev.lengthComputable && ev.total > 0 ? ev.total : file.size || ev.loaded || 1;
      onProgress(ev.loaded, total);
    };

    xhr.onload = () => {
      const text = xhr.responseText ?? "";
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(text);
        return;
      }
      reject(new Error(text.trim() || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(fd);
  });
}

export async function uploadToFolder(dirPath: string, files: FileList | File[]) {
  const list = Array.from(files);
  await Promise.all(list.map((file) => uploadFileToFolder(dirPath, file)));
}

export function openFolderDownloadPage(dirPath: string) {
  const q = new URLSearchParams({
    target: getFileManagerTarget(),
    p: dirPath,
  });
  window.open(`/api/file-manager/download-folder?${q}`, "_blank", "width=420,height=480");
}

export function downloadFileUrl(dirPath: string, fileName: string) {
  const q = new URLSearchParams({
    target: getFileManagerTarget(),
    p: dirPath,
    file: fileName,
  });
  return `/api/file-manager/download?${q}`;
}
