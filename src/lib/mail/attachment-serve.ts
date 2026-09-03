/**
 * Safe Content-Type for serving mailbox attachments in the panel origin.
 * Incoming MIME types are attacker-controlled; never reflect HTML/SVG/JS.
 */

const SAFE_INLINE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const EXT_SAFE_INLINE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

function baseMime(raw: string | undefined | null): string {
  return (raw || "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function isActiveDocumentType(mime: string): boolean {
  if (!mime) return false;
  if (
    mime === "text/html" ||
    mime === "application/xhtml+xml" ||
    mime === "image/svg+xml" ||
    mime === "text/xml" ||
    mime === "application/xml" ||
    mime === "text/javascript" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime === "text/ecmascript" ||
    mime === "application/ecmascript" ||
    mime === "text/css"
  ) {
    return true;
  }
  // image/svg+xml already covered; catch other +xml that browsers may execute
  if (mime.endsWith("+xml") && mime !== "application/vnd.adobe.xfdf") {
    return true;
  }
  return false;
}

function guessSafeInlineFromName(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_SAFE_INLINE[ext] ?? null;
}

export function resolveAttachmentServeHeaders(input: {
  contentType: string;
  filename: string;
  wantInline: boolean;
}): { contentType: string; disposition: "inline" | "attachment" } {
  const declared = baseMime(input.contentType);
  const fromName = guessSafeInlineFromName(input.filename);

  let contentType =
    declared && declared !== "application/octet-stream"
      ? declared
      : fromName || "application/octet-stream";

  if (isActiveDocumentType(contentType)) {
    contentType = "application/octet-stream";
  }

  if (input.wantInline && SAFE_INLINE.has(contentType)) {
    return { contentType, disposition: "inline" };
  }

  // Downloads / non-allowlisted inline: never serve active types; keep
  // non-executable types (pdf, plain text, zip) for Content-Type only.
  if (isActiveDocumentType(declared) || contentType === "application/octet-stream") {
    contentType = "application/octet-stream";
  }

  return { contentType, disposition: "attachment" };
}
