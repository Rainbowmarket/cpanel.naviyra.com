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
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\\.php)(/.+)$;
        fastcgi_pass ${fastcgiPass};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
        fastcgi_read_timeout 300;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }
`;
}
