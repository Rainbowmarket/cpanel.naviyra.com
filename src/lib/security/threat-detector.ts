export type ThreatFinding = {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  payload: string;
};

const RULES: Array<{ type: string; severity: ThreatFinding["severity"]; pattern: RegExp }> = [
  {
    type: "SQL_INJECTION",
    severity: "critical",
    pattern: /(\bunion\b.+\bselect\b|\bselect\b.+\bfrom\b|\bdrop\b.+\btable\b|\bor\b\s+1\s*=\s*1|--|;\s*--|\bxp_\w+)/i,
  },
  {
    type: "SQL_INJECTION",
    severity: "high",
    pattern: /(\binsert\b.+\binto\b|\bupdate\b.+\bset\b|\bdelete\b.+\bfrom\b)/i,
  },
  {
    type: "XSS",
    severity: "high",
    pattern: /(<script\b|javascript\s*:|onerror\s*=|onload\s*=|<iframe\b|document\.cookie)/i,
  },
  {
    type: "PATH_TRAVERSAL",
    severity: "high",
    pattern: /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c)/i,
  },
  {
    type: "SCANNER",
    severity: "medium",
    pattern: /(\/wp-admin|\/wp-login|\/\.env|\/phpmyadmin|\/\.git|\/admin\.php|\/xmlrpc\.php|\/shell\.php)/i,
  },
  {
    type: "SCANNER",
    severity: "medium",
    pattern: /(nikto|sqlmap|acunetix|nmap|masscan|dirbuster|gobuster)/i,
  },
];

const BOT_PATTERNS = [
  /bot/i,
  /crawl/i,
  /spider/i,
  /slurp/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /Go-http-client/i,
];

export function analyzeThreats(url: string, userAgent?: string | null, body?: string): ThreatFinding[] {
  const haystack = `${url} ${body ?? ""}`;
  const findings: ThreatFinding[] = [];

  for (const rule of RULES) {
    const match = haystack.match(rule.pattern);
    if (match) {
      findings.push({
        type: rule.type,
        severity: rule.severity,
        payload: match[0].slice(0, 500),
      });
    }
  }

  if (userAgent) {
    for (const pattern of BOT_PATTERNS) {
      if (pattern.test(userAgent)) {
        findings.push({ type: "BOT", severity: "low", payload: userAgent.slice(0, 200) });
        break;
      }
    }
  }

  return findings;
}

export function parseUserAgent(ua?: string | null): { browser: string; os: string } {
  if (!ua) return { browser: "Unknown", os: "Unknown" };

  let browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";

  let os = "Unknown";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return { browser, os };
}

export async function lookupGeo(ip: string): Promise<{ countryCode: string | null; countryName: string | null }> {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return { countryCode: null, countryName: "Local/Private" };
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    if (data.status === "success") {
      return { countryCode: data.countryCode ?? null, countryName: data.country ?? null };
    }
  } catch {
    /* offline */
  }
  return { countryCode: null, countryName: null };
}
