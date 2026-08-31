/**
 * Mirror of panel Let's Encrypt on-demand heuristic so the agent fails fast
 * with a clear message (same rules as Boulder WFE).
 */

const BLOCKED = new Set([
  "test",
  "dev",
  "api",
  "app",
  "git",
  "www",
  "update",
  "admin",
  "mail",
  "web",
  "cdn",
  "staging",
  "stage",
  "prod",
  "production",
  "beta",
  "alpha",
  "demo",
  "new",
  "old",
  "tmp",
  "temp",
  "vpn",
  "ssh",
  "ftp",
  "ns",
  "mx",
  "smtp",
  "imap",
  "pop",
  "db",
  "sql",
  "redis",
  "cache",
  "node",
  "server",
  "host",
  "proxy",
  "gateway",
  "portal",
  "login",
  "auth",
  "sso",
  "oauth",
  "status",
  "monitor",
  "metrics",
  "grafana",
  "prometheus",
  "jenkins",
  "ci",
  "cd",
  "build",
  "deploy",
  "k8s",
  "kube",
  "docker",
  "asdf",
]);

export function looksLikeLetsEncryptOnDemandBlock(hostname: string): boolean {
  const labels = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length < 4) return false;

  for (let i = 0; i < labels.length - 1; i++) {
    const a = labels[i]!;
    const b = labels[i + 1]!;
    if (a === b && BLOCKED.has(a)) return true;
  }
  for (let i = 0; i < labels.length - 2; i++) {
    if (
      BLOCKED.has(labels[i]!) &&
      BLOCKED.has(labels[i + 1]!) &&
      BLOCKED.has(labels[i + 2]!)
    ) {
      return true;
    }
  }
  return false;
}

export function letsEncryptOnDemandBlockMessage(hostname: string): string {
  const apex = hostname.split(".").slice(-2).join(".");
  return (
    `Let's Encrypt will not issue a certificate for "${hostname}": ` +
    `the hostname looks like recursive on-demand TLS (e.g. test.test… or test.api.app…). ` +
    `Rename the subdomain (e.g. demo.test.${apex}) and re-issue SSL. Nested subdomains are supported; this naming pattern is blocked by the CA.`
  );
}

export function assertLetsEncryptWillIssue(hostname: string): void {
  if (looksLikeLetsEncryptOnDemandBlock(hostname)) {
    throw new Error(letsEncryptOnDemandBlockMessage(hostname));
  }
}

export function rewriteLetsEncryptCertbotError(
  hostname: string,
  error: unknown
): Error {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  if (
    /recursive on-demand issuance/i.test(raw) ||
    /too many subdomain labels/i.test(raw)
  ) {
    return new Error(letsEncryptOnDemandBlockMessage(hostname));
  }
  return error instanceof Error ? error : new Error(raw);
}
