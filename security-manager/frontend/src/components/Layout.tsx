import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  Ban,
  Globe,
  LayoutDashboard,
  LogOut,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/domains', label: 'Domains', icon: Globe },
  { to: '/visitors', label: 'Visitors', icon: Users },
  { to: '/security', label: 'Threats', icon: Shield },
  { to: '/blocklist', label: 'Blocked IPs', icon: Ban },
  { to: '/whitelist', label: 'Whitelist', icon: ShieldCheck },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: '1px solid rgba(30,41,59,0.8)',
          background: 'linear-gradient(to bottom, #020617, #0f172a)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '20px 20px 16px',
            borderBottom: '1px solid rgba(30,41,59,0.8)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'rgba(16,185,129,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 0 1px rgba(16,185,129,0.3)',
              }}
            >
              <Activity size={18} color="#34d399" />
            </div>
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.2em',
                  color: '#34d399',
                }}
              >
                NAVIYRA
              </p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Security Manager</p>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '12px 10px' }}>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                marginBottom: 4,
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                color: isActive ? '#6ee7b7' : '#94a3b8',
                background: isActive ? 'rgba(16,185,129,0.12)' : 'transparent',
                boxShadow: isActive ? 'inset 0 0 0 1px rgba(16,185,129,0.2)' : 'none',
              })}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div
          style={{
            padding: 16,
            borderTop: '1px solid rgba(30,41,59,0.8)',
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#cbd5e1' }}>{user?.name}</p>
          <button type="button" className="btn btn-danger" onClick={logout} style={{ width: '100%' }}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto', padding: 32 }}>
        <Outlet />
      </main>
    </div>
  );
}
