import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { mysqlConnectionInfo } from "@/lib/services/databases";
import { domainAccessWhere } from "@/lib/hosting-targets";

const TOKEN_TTL_SEC = 60;

export function isMysqlLikeEngine(engine: string | null | undefined): boolean {
  const e = (engine || "").toLowerCase();
  return e === "mysql" || e === "mariadb";
}

function panelRoot(): string {
  const fromEnv = process.env.NAVIYRA_ROOT?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync("/opt/naviyra-panel/package.json")) return "/opt/naviyra-panel";
  return process.cwd();
}

export function pmaTokenDir(): string {
  const custom = process.env.NAVIYRA_PMA_TOKEN_DIR?.trim();
  return custom || path.join(panelRoot(), "data", "pma-tokens");
}

export function phpMyAdminUrlPath(): string {
  const p = process.env.PHPMYADMIN_URL_PATH?.trim() || "/_pma";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

type PmaTokenPayload = {
  user: string;
  password: string;
  host: string;
  port: number;
  only_db: string;
  exp: number;
  userId: string;
  databaseId: string;
};

function ensureTokenDir() {
  const dir = pmaTokenDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  return dir;
}

function purgeExpiredTokens(dir: string) {
  const now = Math.floor(Date.now() / 1000);
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const full = path.join(dir, name);
      try {
        const raw = JSON.parse(fs.readFileSync(full, "utf8")) as { exp?: number };
        if (typeof raw.exp === "number" && raw.exp < now) fs.unlinkSync(full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export function issuePmaToken(payload: Omit<PmaTokenPayload, "exp">): string {
  const dir = ensureTokenDir();
  purgeExpiredTokens(dir);
  const token = randomBytes(24).toString("hex");
  const body: PmaTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  };
  fs.writeFileSync(path.join(dir, `${token}.json`), JSON.stringify(body), {
    mode: 0o644,
    encoding: "utf8",
  });
  return token;
}

/** Verify MySQL/MariaDB login before opening phpMyAdmin. */
export function verifyMysqlPassword(input: {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}): boolean {
  const bin =
    (fs.existsSync("/usr/bin/mysql") && "/usr/bin/mysql") ||
    (fs.existsSync("/usr/bin/mariadb") && "/usr/bin/mariadb") ||
    "mysql";
  const r = spawnSync(
    bin,
    [
      "-h",
      input.host,
      "-P",
      String(input.port),
      "-u",
      input.user,
      "--protocol=TCP",
      "-N",
      "-e",
      "SELECT 1",
      input.database,
    ],
    {
      encoding: "utf8",
      timeout: 12000,
      env: { ...process.env, MYSQL_PWD: input.password },
      windowsHide: true,
    }
  );
  return r.status === 0;
}

export async function saveDatabasePasswordEnc(input: {
  id: string;
  userId: string;
  role?: string;
  password: string;
}) {
  if (!input.password || input.password.length < 8) {
    throw new Error("Database password must be at least 8 characters");
  }
  const record = await prisma.postgresDatabase.findFirst({
    where: {
      id: input.id,
      domain: domainAccessWhere(
        {
          id: input.userId,
          role: input.role === "ADMIN" ? "ADMIN" : "USER",
        },
        "databases"
      ),
    },
  });
  if (!record) throw new Error("Database not found");
  if (!isMysqlLikeEngine(record.engine)) {
    throw new Error("Password save for phpMyAdmin is only for MySQL/MariaDB");
  }
  await prisma.postgresDatabase.update({
    where: { id: record.id },
    data: { passwordEnc: encryptSecret(input.password) },
  });
  return { ok: true };
}

/**
 * Build a one-time phpMyAdmin signon redirect URL for this MySQL/MariaDB database.
 * Verifies the password first. Wrong password → clear message in the panel.
 */
export async function openPhpMyAdminSession(input: {
  id: string;
  userId: string;
  role?: string;
  password?: string;
}): Promise<{ url: string; needsPassword?: boolean }> {
  const record = await prisma.postgresDatabase.findFirst({
    where: {
      id: input.id,
      isActive: true,
      domain: domainAccessWhere(
        {
          id: input.userId,
          role: input.role === "ADMIN" ? "ADMIN" : "USER",
        },
        "databases"
      ),
    },
  });
  if (!record) throw new Error("Database not found");
  if (!isMysqlLikeEngine(record.engine)) {
    throw new Error("phpMyAdmin is only available for MySQL and MariaDB");
  }

  let password: string | null = null;
  let fromStored = false;
  if (input.password?.trim()) {
    password = input.password.trim();
  } else if (record.passwordEnc) {
    try {
      password = decryptSecret(record.passwordEnc);
      fromStored = true;
    } catch {
      password = null;
    }
  }

  if (!password) {
    return { url: "", needsPassword: true };
  }

  const mysql = mysqlConnectionInfo();
  const ok = verifyMysqlPassword({
    user: record.roleName,
    password,
    host: mysql.host,
    port: mysql.port,
    database: record.dbName,
  });

  if (!ok) {
    if (fromStored) {
      try {
        await prisma.postgresDatabase.update({
          where: { id: record.id },
          data: { passwordEnc: null },
        });
      } catch {
        /* ignore */
      }
      return { url: "", needsPassword: true };
    }
    throw new Error(
      "Wrong database password. Use Reset password on this database, then Browse again."
    );
  }

  try {
    await prisma.postgresDatabase.update({
      where: { id: record.id },
      data: { passwordEnc: encryptSecret(password) },
    });
  } catch {
    /* still allow open */
  }

  const token = issuePmaToken({
    user: record.roleName,
    password,
    host: mysql.host,
    port: mysql.port,
    only_db: record.dbName,
    userId: input.userId,
    databaseId: record.id,
  });

  return { url: `${phpMyAdminUrlPath()}/signon.php?token=${token}` };
}

export function pmaInstallFingerprint(): string {
  const dir = process.env.PHPMYADMIN_DIR?.trim() || path.join(panelRoot(), "phpmyadmin");
  try {
    const idx = fs.readFileSync(path.join(dir, "index.php"), "utf8").slice(0, 200);
    return createHash("sha256").update(idx).digest("hex").slice(0, 12);
  } catch {
    return "missing";
  }
}
