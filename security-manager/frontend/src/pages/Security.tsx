import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { api, type Domain, type SecurityEvent } from '../api/client';

const severityClass: Record<string, string> = {
  critical: 'badge-red',
  high: 'badge-red',
  medium: 'badge-amber',
  low: 'badge-slate',
};

export function SecurityPage() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState('');

  function load() {
    api
      .securityEvents(domainId ? Number(domainId) : undefined)
      .then((d) => setEvents(d.events));
  }

  useEffect(() => {
    api.domains().then((d) => setDomains(d.domains));
  }, []);

  useEffect(() => {
    load();
  }, [domainId]);

  async function blockIp(id: number) {
    if (!confirm('Block this IP via firewall?')) return;
    await api.blockEvent(id);
    load();
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>Security Events</h1>
      <p style={{ margin: '0 0 24px', color: '#94a3b8' }}>
        SQL injection, XSS, scanners, bots, and path traversal attempts.
      </p>

      <select
        className="input"
        style={{ width: 220, marginBottom: 20 }}
        value={domainId}
        onChange={(e) => setDomainId(e.target.value)}
      >
        <option value="">All domains</option>
        {domains.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <div className="card">
        <div className="card-body">
          {events.length === 0 ? (
            <p className="empty">No threats detected.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>IP</th>
                  <th>Domain</th>
                  <th>URL / Payload</th>
                  <th>Action</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontSize: 13, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {new Date(e.detected_at).toLocaleString()}
                    </td>
                    <td>
                      <span className="badge badge-amber">{e.threat_type.replace('_', ' ')}</span>
                    </td>
                    <td>
                      <span className={`badge ${severityClass[e.severity] ?? 'badge-slate'}`}>
                        {e.severity}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{e.ip_address}</td>
                    <td>{e.domain_name ?? '—'}</td>
                    <td style={{ maxWidth: 200, fontSize: 12, color: '#94a3b8' }}>
                      {e.url}
                      {e.payload ? ` · ${e.payload.slice(0, 60)}` : ''}
                    </td>
                    <td>{e.action_taken.replace('_', ' ')}</td>
                    <td>
                      <button type="button" className="btn btn-danger" onClick={() => blockIp(e.id)}>
                        <Ban size={14} />
                        Block
                      </button>
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
