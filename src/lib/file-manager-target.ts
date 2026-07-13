export function targetFromSearchParams(searchParams: URLSearchParams): string {
  const target = searchParams.get("target");
  if (target) return target;

  const subdomainId = searchParams.get("subdomainId");
  if (subdomainId) return `s:${subdomainId}`;

  const domainId = searchParams.get("domainId");
  if (domainId) {
    return domainId.startsWith("d:") || domainId.startsWith("s:") ? domainId : `d:${domainId}`;
  }

  throw new Error("target required");
}
