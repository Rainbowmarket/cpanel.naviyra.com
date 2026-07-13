import type { LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = '#34d399',
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent?: string;
}) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>{label}</p>
          <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 700 }}>{value}</p>
        </div>
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: `${accent}22`,
            color: accent,
          }}
        >
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}
