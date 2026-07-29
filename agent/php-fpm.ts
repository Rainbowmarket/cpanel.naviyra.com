/**
 * Resolve PHP-FPM socket / TCP upstream for nginx fastcgi_pass.
 */
import fs from "node:fs/promises";

const CANDIDATE_SOCKETS = [
  process.env.PHP_FPM_SOCKET?.trim(),
  "/run/php/php8.4-fpm.sock",
  "/run/php/php8.3-fpm.sock",
  "/run/php/php8.2-fpm.sock",
  "/run/php/php8.1-fpm.sock",
  "/run/php/php-fpm.sock",
].filter(Boolean) as string[];

async function socketExists(sock: string): Promise<boolean> {
  try {
    await fs.access(sock);
    return true;
  } catch {
    return false;
  }
}

/** Returns nginx fastcgi_pass value, e.g. `unix:/run/php/php8.3-fpm.sock` */
export async function resolvePhpFpmPass(): Promise<string | null> {
  const tcp = process.env.PHP_FPM_TCP?.trim();
  if (tcp) return tcp;

  for (const sock of CANDIDATE_SOCKETS) {
    if (await socketExists(sock)) {
      return `unix:${sock}`;
    }
  }
  return null;
}

export function buildPhpLocationBlock(fastcgiPass: string): string {
  return `
    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass ${fastcgiPass};
        fastcgi_read_timeout 300;
        fastcgi_intercept_errors on;
    }
`;
}

/** Prevent browsers from downloading raw .php when FPM is not available. */
export function buildPhpDenyBlock(): string {
  return `
    location ~ \\.php$ {
        return 404;
    }
`;
}
