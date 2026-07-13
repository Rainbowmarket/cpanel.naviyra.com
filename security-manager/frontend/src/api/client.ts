const API_BASE = import.meta.env.VITE_API_URL ?? '';

function getToken(): string | null {
  return localStorage.getItem('naviyra_sec_token');
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem('naviyra_sec_token', token);
  else localStorage.removeItem('naviyra_sec_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: number; email: string; name: string } }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    ),
  me: () => request<{ user: { id: number; email: string; name: string } }>('/api/auth/me'),
  domains: () => request<{ domains: Domain[] }>('/api/domains'),
  addDomain: (name: string) =>
    request('/api/domains', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteDomain: (id: number) => request(`/api/domains/${id}`, { method: 'DELETE' }),
  visitors: (params?: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return request<{ visitors: Visitor[] }>(`/api/visitors${q ? `?${q}` : ''}`);
  },
  live: (domainId?: number) =>
    request<{ live: LiveVisitor[] }>(
      `/api/visitors/live${domainId ? `?domain_id=${domainId}` : ''}`
    ),
  statsOverview: (domainId?: number) =>
    request<{ stats: StatsOverview }>(
      `/api/stats/overview${domainId ? `?domain_id=${domainId}` : ''}`
    ),
  statsChart: (days = 7, domainId?: number) => {
    const q = new URLSearchParams({ days: String(days) });
    if (domainId) q.set('domain_id', String(domainId));
    return request<{ chart: ChartPoint[]; countries: CountryStat[] }>(
      `/api/stats/chart?${q}`
    );
  },
  securityEvents: (domainId?: number) =>
    request<{ events: SecurityEvent[] }>(
      `/api/security/events${domainId ? `?domain_id=${domainId}` : ''}`
    ),
  blockEvent: (id: number) =>
    request(`/api/security/events/${id}/block`, { method: 'POST' }),
  blocklist: () => request<{ blocked: BlockedIp[] }>('/api/blocklist'),
  blockIp: (ip: string, reason: string) =>
    request('/api/blocklist', { method: 'POST', body: JSON.stringify({ ip, reason }) }),
  unblockIp: (ip: string) =>
    request(`/api/blocklist/${encodeURIComponent(ip)}`, { method: 'DELETE' }),
  whitelist: () => request<{ whitelist: WhitelistEntry[] }>('/api/whitelist'),
  addWhitelist: (ip: string, label: string) =>
    request('/api/whitelist', { method: 'POST', body: JSON.stringify({ ip, label }) }),
  removeWhitelist: (id: number) =>
    request(`/api/whitelist/${id}`, { method: 'DELETE' }),
};

export type Domain = {
  id: number;
  name: string;
  is_active: number;
  visitors_today?: number;
  threats_today?: number;
};

export type Visitor = {
  id: number;
  domain_name: string;
  ip_address: string;
  url: string;
  browser: string;
  os: string;
  country_code: string;
  country_name: string;
  visited_at: string;
  is_bot: number;
};

export type LiveVisitor = {
  id: number;
  domain_name: string;
  ip_address: string;
  url: string;
  browser: string;
  country_code: string;
  last_seen: string;
};

export type StatsOverview = {
  visitors_today: number;
  unique_today: number;
  threats_today: number;
  blocked_ips: number;
  live_now: number;
  domains: number;
};

export type ChartPoint = {
  stat_date: string;
  views: number;
  uniques: number;
  threats: number;
};

export type CountryStat = {
  country_code: string;
  country_name: string;
  hits: number;
};

export type SecurityEvent = {
  id: number;
  domain_name: string | null;
  ip_address: string;
  threat_type: string;
  severity: string;
  url: string;
  payload: string;
  action_taken: string;
  detected_at: string;
};

export type BlockedIp = {
  id: number;
  ip_address: string;
  reason: string;
  source: string;
  blocked_at: string;
  blocked_via: string;
};

export type WhitelistEntry = {
  id: number;
  ip_address: string;
  label: string | null;
  created_at: string;
};
