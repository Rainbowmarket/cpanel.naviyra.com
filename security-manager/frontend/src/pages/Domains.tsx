import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, type Domain } from '../api/client';

export function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [name, setName] = useState('');

  function load() {
    api.domains().then((d) => setDomains(d.domains));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await api.addDomain(name);
    setName('');
    load();
  }

  async function remove(id: number) {
    if (!confirm('Remove domain and all its analytics?')) return;
    await api.deleteDomain(id);
    load();
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>Monitored Domains</h1>
      <p style={{ margin: '0 0 24px', color: '#94a3b8' }}>
        Unlimited domains with separate visitor and threat analytics per site.
      </p>

      <form
        onSubmit={handleAdd}
        className="card"
        style={{ padding: 20, marginBottom: 24, display: 'flex', gap: 12 }}
      >
        <input
          className="input"
          style={{ flex: 1, maxWidth: 360 }}
          placeholder="example.com"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary">
          <Plus size={16} />
          Add domain
        </button>
      </form>

      <div className="card">
        <div className="card-body">
          {domains.length === 0 ? (
            <p className="empty">No domains yet. Domains are auto-created when traffic is ingested.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Visitors today</th>
                  <th>Threats today</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.name}</td>
                    <td>{d.visitors_today ?? 0}</td>
                    <td>
                      {(d.threats_today ?? 0) > 0 ? (
                        <span className="badge badge-red">{d.threats_today}</span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td>
                      <span className="badge badge-emerald">
                        {d.is_active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn btn-danger" onClick={() => remove(d.id)}>
                        <Trash2 size={14} />
                        Remove
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
