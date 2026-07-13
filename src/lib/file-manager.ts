/** WebEditer (admin.naviyra.com) file manager URL helpers. */

export function getFileManagerBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_FILE_MANAGER_URL ??
    process.env.FILE_MANAGER_URL ??
    "http://admin.naviyra.com";
  return url.replace(/\/$/, "");
}

export function buildFileManagerUrl(options?: { path?: string; file?: string }): string {
  const base = getFileManagerBaseUrl();
  const url = new URL(`${base}/`);
  if (options?.path) url.searchParams.set("p", options.path);
  if (options?.file) url.searchParams.set("file", options.file);
  return url.toString();
}

export function openFileManager(options?: { path?: string; file?: string }) {
  const url = buildFileManagerUrl(options);
  window.open(
    url,
    "naviyra-file-manager",
    "width=1400,height=900,menubar=no,toolbar=no,location=yes,status=no"
  );
}
