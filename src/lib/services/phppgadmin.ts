import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { postgresConnectionInfo } from "@/lib/services/databases";
import { domainAccessWhere } from "@/lib/hosting-targets";

const TOKEN_TTL_SEC = 60;

export function isPostgresLikeEngine(engine: string | null | undefined): boolean {
  const e = (engine || "postgres").toLowerCase();
  return e === "postgres" || e === "timescaledb" || e === "postgresql";
}

function panelRoot(): string {
  return process.env.NAVIYRA_ROOT?.trim() || process.cwd();
}

export function ppaTokenDir(): string {
  const custom = process.env.NAVIYRA_PPA_TOKEN_DIR?.trim();
  return custom || path.join(panelRoot(), "data", "ppa-tokens");
}

export function phpPgAdminUrlPath(): string {
  const p = process.env.PHPPGADMIN_URL_PATH?.trim() || "/_ppa";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

type PpaTokenPayload = {
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
  const dir = ppaTokenDir();
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

export function issuePpaToken(payload: Omit<PpaTokenPayload, "exp">): string {
  const dir = ensureTokenDir();
  purgeExpiredTokens(dir);
  const token = randomBytes(24).toString("hex");
  const body: PpaTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  };
  fs.writeFileSync(path.join(dir, `${token}.json`), JSON.stringify(body), {
    mode: 0o644,
    encoding: "utf8",
  });
  return token;
}

/**
 * Build a one-time phpPgAdmin signon redirect URL for this PostgreSQL database.
 * If passwordEnc is missing, pass `password` once (also saved encrypted).
 */
export async function openPhpPgAdminSession(input: {
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
  if (!isPostgresLikeEngine(record.engine)) {
    throw new Error("phpPgAdmin is only available for PostgreSQL");
  }

  let password: string | null = null;
  if (input.password?.trim()) {
    password = input.password.trim();
    try {
      await prisma.postgresDatabase.update({
        where: { id: record.id },
        data: { passwordEnc: encryptSecret(password) },
      });
    } catch {
      /* still allow one-shot open */
    }
  } else if (record.passwordEnc) {
    try {
      password = decryptSecret(record.passwordEnc);
    } catch {
      password = null;
    }
  }

  if (!password) {
    return { url: "", needsPassword: true };
  }

  const pg = postgresConnectionInfo();
  const token = issuePpaToken({
    user: record.roleName,
    password,
    host: pg.host,
    port: pg.port,
    only_db: record.dbName,
    userId: input.userId,
    databaseId: record.id,
  });

  const base = phpPgAdminUrlPath();
  return { url: `${base}/signon.php?token=${token}` };
}
