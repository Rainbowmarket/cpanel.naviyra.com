import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, type WhitelistEntry } from '../api/client';

export function WhitelistPage() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [ip, setIp] = useState('');
  const [label, setLabel] = useState('');

  function load() {
    api.whitelist().then((d) => setEntries(d.whitelist));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await api.addWhitelist(ip, label);
    setIp('');
    setLabel('');
    load();
  }

  async function remove(id: number) {
    if (!confirm('Remove from whitelist?')) return;
    await api.removeWhitelist(id);
    load();
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>IP Whitelist</h1>
      <p style={{ margin: '0 0 24px', color: '#94a3b8' }}>
        Trusted IPs that bypass threat detection and cannot be auto-blocked.
      </p>

      <form
        onSubmit={handleAdd}
        className="card"
        style={{ padding: 20, marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}
      >
        <input
          className="input"
          style={{ flex: '1 1 160px', maxWidth: 200 }}
          placeholder="IP address"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          required
        />
        <input
          className="input"
          style={{ flex: '2 1 240px' }}
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          <Plus size={16} />
          Add IP
        </button>
      </form>

      <div className="card">
        <div className="card-body">
          {entries.length === 0 ? (
            <p className="empty">No whitelisted IPs.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>IP</th>
                  <th>Label</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'monospace' }}>{e.ip_address}</td>
                    <td>{e.label ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#94a3b8' }}>
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td>
                      <button type="button" className="btn btn-danger" onClick={() => remove(e.id)}>
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
