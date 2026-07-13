import { useEffect, useState } from 'react';
import { Activity, Ban, Eye, Globe, ShieldAlert, Users } from 'lucide-react';
import { api, type LiveVisitor, type StatsOverview } from '../api/client';
import { StatCard } from '../components/StatCard';

export function DashboardPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [live, setLive] = useState<LiveVisitor[]>([]);

  useEffect(() => {
    api.statsOverview().then((d) => setStats(d.stats));
    api.live().then((d) => setLive(d.live));
    const t = setInterval(() => {
      api.live().then((d) => setLive(d.live));
      api.statsOverview().then((d) => setStats(d.stats));
    }, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>Security Overview</h1>
      <p style={{ margin: '0 0 28px', color: '#94a3b8' }}>
        Monitor visitors, threats, and blocked IPs across all hosted domains.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <StatCard label="Visitors today" value={stats?.visitors_today ?? '—'} icon={Eye} />
        <StatCard label="Unique IPs" value={stats?.unique_today ?? '—'} icon={Users} />
        <StatCard label="Live now" value={stats?.live_now ?? '—'} icon={Activity} accent="#38bdf8" />
        <StatCard label="Threats today" value={stats?.threats_today ?? '—'} icon={ShieldAlert} accent="#f87171" />
        <StatCard label="Blocked IPs" value={stats?.blocked_ips ?? '—'} icon={Ban} accent="#f87171" />
        <StatCard label="Domains" value={stats?.domains ?? '—'} icon={Globe} />
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={18} color="#34d399" />
          Live visitors
          <span className="badge badge-emerald" style={{ marginLeft: 8 }}>
            {live.length} active
          </span>
        </div>
        <div className="card-body">
          {live.length === 0 ? (
            <p className="empty">No active visitors in the last 5 minutes.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>IP</th>
                  <th>Page</th>
                  <th>Browser</th>
                  <th>Country</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {live.map((v) => (
                  <tr key={v.id}>
                    <td>{v.domain_name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{v.ip_address}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {v.url}
                    </td>
                    <td>{v.browser}</td>
                    <td>{v.country_code ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#94a3b8' }}>
                      {new Date(v.last_seen).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
