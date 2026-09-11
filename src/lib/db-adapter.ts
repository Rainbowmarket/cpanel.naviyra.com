import fs from "node:fs";
import path from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";

/** Normalize DATABASE_URL to a libSQL file: URL (absolute path). */
export function sqliteFileUrl(raw?: string): string {
  const value = (raw || process.env.DATABASE_URL || "file:./data/naviyra.db").trim();
  if (value === ":memory:" || value.startsWith("file::memory:")) {
    return ":memory:";
  }
  const stripped = value.replace(/^file:/, "");
  const abs = path.isAbsolute(stripped)
    ? stripped
    : path.resolve(process.cwd(), stripped);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return `file:${abs.replace(/\\/g, "/")}`;
}

export function createPrismaAdapter(rawUrl?: string) {
  return new PrismaLibSql({ url: sqliteFileUrl(rawUrl) });
}
