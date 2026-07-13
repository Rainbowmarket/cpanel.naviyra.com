import { useEffect, useState } from 'react';
import { api, type Domain, type Visitor } from '../api/client';

export function VisitorsPage() {
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainId, setDomainId] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.domains().then((d) => setDomains(d.domains));
  }, []);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (domainId) params.domain_id = domainId;
    if (search) params.search = search;
    api.visitors(params).then((d) => setVisitors(d.visitors));
  }, [domainId, search]);

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>Visitor Log</h1>
      <p style={{ margin: '0 0 24px', color: '#94a3b8' }}>
        Every request logged with IP, browser, OS, country, and URL.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ width: 220 }}
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
        <input
          className="input"
          style={{ maxWidth: 320, flex: 1 }}
          placeholder="Search IP, URL, browser…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="card-body">
          {visitors.length === 0 ? (
            <p className="empty">No visitors recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Domain</th>
                  <th>IP</th>
                  <th>URL</th>
                  <th>Browser / OS</th>
                  <th>Country</th>
                </tr>
              </thead>
              <tbody>
                {visitors.map((v) => (
                  <tr key={v.id}>
                    <td style={{ fontSize: 13, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {new Date(v.visited_at).toLocaleString()}
                    </td>
                    <td>{v.domain_name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{v.ip_address}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {v.url}
                    </td>
                    <td>
                      {v.browser} / {v.os}
                      {v.is_bot ? (
                        <span className="badge badge-slate" style={{ marginLeft: 6 }}>
                          bot
                        </span>
                      ) : null}
                    </td>
                    <td>{v.country_name ?? v.country_code ?? '—'}</td>
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
