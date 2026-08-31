/**
 * Let's Encrypt rejects some hostnames that look like recursive on-demand TLS
 * (crawler feedback loops). Heuristic (Boulder WFE):
 * - hostname has ≥ 4 labels; and either
 * - two identical blocked labels in a row, or
 * - any three blocked labels in a row
 *
 * @see https://community.letsencrypt.org/t/blocking-some-on-demand-issuance-caused-by-internet-scanning/245553
 */

/** Labels commonly blocked by Let's Encrypt production (non-exhaustive). */
export const LE_ON_DEMAND_BLOCKED_LABELS = [
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
] as const;

const blockedSet = new Set(
  LE_ON_DEMAND_BLOCKED_LABELS.map((label) => label.toLowerCase())
);

export function looksLikeLetsEncryptOnDemandBlock(
  hostname: string,
  blockedLabels: Iterable<string> = blockedSet
): boolean {
  const labels = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length < 4) return false;

  const blocked = blockedLabels instanceof Set
    ? blockedLabels
    : new Set([...blockedLabels].map((l) => l.toLowerCase()));

  // Two identical blocked labels in a row (e.g. test.test.example.com)
  for (let i = 0; i < labels.length - 1; i++) {
    const a = labels[i]!;
    const b = labels[i + 1]!;
    if (a === b && blocked.has(a)) return true;
  }

  // Any three blocked labels in a row (e.g. test.api.app.example.com)
  for (let i = 0; i < labels.length - 2; i++) {
    if (
      blocked.has(labels[i]!) &&
      blocked.has(labels[i + 1]!) &&
      blocked.has(labels[i + 2]!)
    ) {
      return true;
    }
  }

  return false;
}

export function letsEncryptOnDemandBlockMessage(hostname: string): string {
  return (
    `Let's Encrypt will not issue a certificate for "${hostname}": ` +
    `the hostname looks like recursive on-demand TLS (repeated or chained labels such as test.test… or test.api.app…). ` +
    `Rename the subdomain (e.g. demo.test.${hostname.split(".").slice(-2).join(".")} or api.v1.${hostname.split(".").slice(-2).join(".")}) and re-issue SSL. ` +
    `Nested subdomains themselves are supported; this specific naming pattern is blocked by the CA.`
  );
}

export function assertLetsEncryptWillIssue(hostname: string): void {
  if (looksLikeLetsEncryptOnDemandBlock(hostname)) {
    throw new Error(letsEncryptOnDemandBlockMessage(hostname));
  }
}

/** Map raw certbot/LE errors into a clearer panel message when possible. */
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
