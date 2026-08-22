import { requireIngestKey } from "@/lib/secrets";

function managerBase(): string | null {
  const raw = process.env.SECURITY_MANAGER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Panel SQLite is the source of truth. Mirror to Security Manager when configured. */
export async function syncBlocklistToSecurityManager(input: {
  op: "block" | "unblock" | "whitelist" | "unwhitelist";
  ip: string;
  reason?: string;
  label?: string;
}): Promise<void> {
  const base = managerBase();
  if (!base) return;
  try {
    const key = requireIngestKey();
    await fetch(`${base}/api/ingest/blocklist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ingest-Key": key,
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* SM is optional; panel + agent nginx/ufw already applied */
  }
}
