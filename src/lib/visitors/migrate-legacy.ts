import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { insertVisitorLog, visitorDataDir } from "@/lib/visitors/store";

const FLAG = ".legacy-migrated";

let migrationPromise: Promise<{ migrated: number }> | null = null;

/** Move historical VisitorLog rows from the main panel DB into monthly archives (once). */
export async function migrateLegacyVisitorLogsIfNeeded(): Promise<{ migrated: number }> {
  if (migrationPromise) return migrationPromise;

  migrationPromise = (async () => {
    const dir = visitorDataDir();
    fs.mkdirSync(dir, { recursive: true });
    const flagPath = path.join(dir, FLAG);
    if (fs.existsSync(flagPath)) return { migrated: 0 };

    const rows = await prisma.visitorLog.findMany({
      include: { domain: { select: { name: true, userId: true } } },
      orderBy: { visitedAt: "asc" },
    });
    if (rows.length === 0) {
      fs.writeFileSync(flagPath, new Date().toISOString(), "utf8");
      return { migrated: 0 };
    }

    for (const row of rows) {
      insertVisitorLog({
        id: row.id,
        domainId: row.domainId,
        domainName: row.domain.name,
        userId: row.domain.userId,
        ipAddress: row.ipAddress,
        url: row.url,
        method: row.method,
        userAgent: row.userAgent,
        browser: row.browser,
        os: row.os,
        countryCode: row.countryCode,
        countryName: row.countryName,
        referrer: row.referrer,
        statusCode: row.statusCode,
        isBot: row.isBot,
        visitedAt: row.visitedAt,
      });
    }

    await prisma.visitorLog.deleteMany({});
    fs.writeFileSync(flagPath, new Date().toISOString(), "utf8");
    return { migrated: rows.length };
  })();

  return migrationPromise;
}
