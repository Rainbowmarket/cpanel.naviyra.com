/**
 * Rewrite nginx vhosts for domains/subdomains that reverse-proxy an app port.
 * Uses configure_site_app so generators emit $connection_upgrade + long timeouts.
 *
 * Run on the panel host after install-websocket-map.sh (map must exist).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { callAgent } from "../src/lib/agent/client";
import { agentTargetForServerId } from "../src/lib/agent/target";

async function main() {
  const domains = await prisma.domain.findMany({
    where: { upstreamPort: { not: null } },
    select: {
      id: true,
      name: true,
      documentRoot: true,
      appType: true,
      startCommand: true,
      appWorkingDir: true,
      appEnv: true,
      upstreamPort: true,
      serverId: true,
    },
  });

  const subdomains = await prisma.subdomain.findMany({
    where: { upstreamPort: { not: null } },
    select: {
      id: true,
      name: true,
      documentRoot: true,
      appType: true,
      startCommand: true,
      appWorkingDir: true,
      appEnv: true,
      upstreamPort: true,
      domain: { select: { name: true, serverId: true } },
    },
  });

  let ok = 0;
  let fail = 0;

  for (const d of domains) {
    if (!d.upstreamPort) continue;
    const result = await callAgent(
      {
        action: "configure_site_app",
        siteId: d.id,
        siteName: d.name,
        documentRoot: d.documentRoot,
        appType: d.appType,
        startCommand: d.startCommand ?? undefined,
        appWorkingDir: d.appWorkingDir,
        appEnv: d.appEnv,
        upstreamPort: d.upstreamPort,
        isSubdomain: false,
      },
      await agentTargetForServerId(d.serverId)
    );
    if (result.success) {
      ok += 1;
      console.log(`domain ok: ${d.name} :${d.upstreamPort}`);
    } else {
      fail += 1;
      console.error(`domain fail: ${d.name} — ${result.error}`);
    }
  }

  for (const s of subdomains) {
    if (!s.upstreamPort) continue;
    const host = `${s.name}.${s.domain.name}`;
    const result = await callAgent(
      {
        action: "configure_site_app",
        siteId: s.id,
        siteName: host,
        documentRoot: s.documentRoot,
        appType: s.appType,
        startCommand: s.startCommand ?? undefined,
        appWorkingDir: s.appWorkingDir,
        appEnv: s.appEnv,
        upstreamPort: s.upstreamPort,
        isSubdomain: true,
      },
      await agentTargetForServerId(s.domain.serverId)
    );
    if (result.success) {
      ok += 1;
      console.log(`subdomain ok: ${host} :${s.upstreamPort}`);
    } else {
      fail += 1;
      console.error(`subdomain fail: ${host} — ${result.error}`);
    }
  }

  console.log(`regen-proxy-websocket-vhosts: ok=${ok} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
