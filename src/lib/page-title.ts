import { getDocBySlug } from "@/lib/docs/content";

/** Longest prefix first so /dashboard/service-tests wins over /dashboard. */
const ROUTES: { prefix: string; title: string }[] = [
  { prefix: "/dashboard/account", title: "Account security" },
  { prefix: "/dashboard/docs", title: "Docs" },
  { prefix: "/dashboard/domains", title: "Domains" },
  { prefix: "/dashboard/subdomains", title: "Subdomains" },
  { prefix: "/dashboard/apps", title: "App Deployment" },
  { prefix: "/dashboard/docker", title: "Docker" },
  { prefix: "/dashboard/git", title: "Git Deployments" },
  { prefix: "/dashboard/mail", title: "Mail" },
  { prefix: "/dashboard/ftp", title: "FTP" },
  { prefix: "/dashboard/databases", title: "Databases" },
  { prefix: "/dashboard/ssl", title: "SSL" },
  { prefix: "/dashboard/dns", title: "DNS" },
  { prefix: "/dashboard/files", title: "File Manager" },
  { prefix: "/dashboard/cron", title: "Cron Jobs" },
  { prefix: "/dashboard/monitoring", title: "Monitoring" },
  { prefix: "/dashboard/security", title: "Security" },
  { prefix: "/dashboard/users", title: "Users" },
  { prefix: "/dashboard/groups", title: "Groups" },
  { prefix: "/dashboard/settings", title: "Settings" },
  { prefix: "/dashboard/servers", title: "Servers" },
  { prefix: "/dashboard/backups", title: "Backups" },
  { prefix: "/dashboard/speed-test", title: "Speed Test" },
  { prefix: "/dashboard/services", title: "Services" },
  { prefix: "/dashboard/service-tests", title: "Service tests" },
  { prefix: "/dashboard/terminal", title: "Terminal" },
  { prefix: "/dashboard", title: "Dashboard" },
  { prefix: "/login/forgot", title: "Forgot password" },
  { prefix: "/login/reset", title: "Reset password" },
  { prefix: "/login", title: "Login" },
  { prefix: "/file-manager", title: "File Manager" },
  { prefix: "/db-browser", title: "Database" },
  { prefix: "/mailbox", title: "Mail" },
  { prefix: "/webmail", title: "Webmail" },
].sort((a, b) => b.prefix.length - a.prefix.length);

export function pageTitleFromPath(pathname: string): string | null {
  const path = (pathname.split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
  if (path === "/") return null;

  const docMatch = /^\/dashboard\/docs\/([^/]+)$/.exec(path);
  if (docMatch) {
    return getDocBySlug(docMatch[1])?.title ?? "Docs";
  }

  for (const route of ROUTES) {
    if (path === route.prefix || path.startsWith(`${route.prefix}/`)) {
      return route.title;
    }
  }
  return null;
}

export function documentTitle(pathname: string): string {
  const page = pageTitleFromPath(pathname);
  return page ? `Naviyra Panel - ${page}` : "Naviyra Panel";
}
