import { FormEvent, useEffect, useState } from 'react';
import { Plus, Unlock } from 'lucide-react';
import { api, type BlockedIp } from '../api/client';

export function BlocklistPage() {
  const [blocked, setBlocked] = useState<BlockedIp[]>([]);
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('Manual block');

  function load() {
    api.blocklist().then((d) => setBlocked(d.blocked));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    await api.blockIp(ip, reason);
    setIp('');
    load();
  }

  async function unblock(ipAddr: string) {
    if (!confirm(`Unblock ${ipAddr}?`)) return;
    await api.unblockIp(ipAddr);
    load();
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700 }}>Blocked IPs</h1>
      <p style={{ margin: '0 0 24px', color: '#94a3b8' }}>
        IPs blocked via UFW, iptables, or Nginx with reason and source.
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
          placeholder="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary">
          <Plus size={16} />
          Block IP
        </button>
      </form>

      <div className="card">
        <div className="card-body">
          {blocked.length === 0 ? (
            <p className="empty">No blocked IPs.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>IP</th>
                  <th>Reason</th>
                  <th>Source</th>
                  <th>Via</th>
                  <th>Blocked at</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {blocked.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontFamily: 'monospace' }}>{b.ip_address}</td>
                    <td>{b.reason}</td>
                    <td>
                      <span className="badge badge-slate">{b.source}</span>
                    </td>
                    <td>{b.blocked_via}</td>
                    <td style={{ fontSize: 13, color: '#94a3b8' }}>
                      {new Date(b.blocked_at).toLocaleString()}
                    </td>
                    <td>
                      <button type="button" className="btn" onClick={() => unblock(b.ip_address)}>
                        <Unlock size={14} />
                        Unblock
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
