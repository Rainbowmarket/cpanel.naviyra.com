export const PANEL_PERMISSION_CATALOG = [
  {
    key: "admin",
    label: "Administrator",
    description:
      "Full panel access: users, groups, settings, backups, terminal, and every hosting feature",
  },
  { key: "domains", label: "Domains", description: "Add and manage domains" },
  { key: "subdomains", label: "Subdomains", description: "Create and manage subdomains" },
  { key: "apps", label: "Apps", description: "Start and manage Node, Python, and Go apps" },
  { key: "mail", label: "Mail", description: "Mail accounts, aliases, and webmail" },
  { key: "ftp", label: "FTP", description: "FTP accounts" },
  { key: "databases", label: "Databases", description: "PostgreSQL databases and table editor" },
  { key: "ssl", label: "SSL", description: "Certificates and renewal" },
  { key: "dns", label: "DNS", description: "DNS zones and records" },
  { key: "files", label: "File Manager", description: "Browse and edit site files" },
  { key: "cron", label: "Cron jobs", description: "Scheduled commands on the server" },
  { key: "security", label: "Security", description: "Visitors, blocklists, and threat events" },
] as const;

export type PanelPermissionKey = (typeof PANEL_PERMISSION_CATALOG)[number]["key"];

export const PANEL_PERMISSION_KEYS = PANEL_PERMISSION_CATALOG.map((item) => item.key);

const ADMIN_PATH_PREFIXES = [
  "/dashboard/users",
  "/dashboard/groups",
  "/dashboard/domain-access",
  "/dashboard/settings",
  "/dashboard/backups",
  "/dashboard/servers",
  "/dashboard/terminal",
  "/dashboard/speed-test",
  "/dashboard/services",
  "/dashboard/service-tests",
];

export function isPanelPermissionKey(value: string): value is PanelPermissionKey {
  return (PANEL_PERMISSION_KEYS as string[]).includes(value);
}

export function sanitizePermissionKeys(keys: string[]): PanelPermissionKey[] {
  return [...new Set(keys.filter(isPanelPermissionKey))];
}

export function permissionKeyForPath(pathname: string): PanelPermissionKey | null {
  if (pathname.startsWith("/dashboard/domains")) return "domains";
  if (pathname.startsWith("/dashboard/subdomains")) return "subdomains";
  if (pathname.startsWith("/dashboard/apps")) return "apps";
  if (pathname.startsWith("/dashboard/docker")) return "apps";
  if (pathname.startsWith("/dashboard/git")) return "apps";
  if (pathname.startsWith("/dashboard/mail")) return "mail";
  if (pathname.startsWith("/dashboard/ftp")) return "ftp";
  if (pathname.startsWith("/dashboard/databases") || pathname.startsWith("/db-browser")) {
    return "databases";
  }
  if (pathname.startsWith("/dashboard/ssl")) return "ssl";
  if (pathname.startsWith("/dashboard/dns")) return "dns";
  if (pathname.startsWith("/dashboard/files") || pathname.startsWith("/file-manager")) {
    return "files";
  }
  if (pathname.startsWith("/dashboard/cron")) return "cron";
  if (pathname.startsWith("/dashboard/security")) return "security";
  return null;
}

export type PanelAccessUser = {
  role: string;
  permissionKeys: string[] | null;
};

export function userHasAdminAccess(user: PanelAccessUser): boolean {
  if (user.role === "ADMIN") return true;
  return user.permissionKeys?.includes("admin") === true;
}

export function userHasPanelPermission(
  user: PanelAccessUser,
  key: PanelPermissionKey
): boolean {
  if (userHasAdminAccess(user)) return true;
  if (user.permissionKeys === null) return true;
  return user.permissionKeys.includes(key);
}

export function canAccessDashboardPath(user: PanelAccessUser, pathname: string): boolean {
  if (userHasAdminAccess(user)) return true;

  if (
    ADMIN_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return false;
  }

  const key = permissionKeyForPath(pathname);
  if (!key) return true;
  return userHasPanelPermission(user, key);
}
