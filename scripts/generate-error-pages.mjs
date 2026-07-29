#!/usr/bin/env node
/**
 * Generate branded Naviyra HTTP error pages into a directory.
 * Usage: node scripts/generate-error-pages.mjs [/var/www/naviyra-errors]
 */
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || path.join(process.cwd(), "scripts", "error-pages");

const PAGES = [
  { code: 400, title: "Bad Request", message: "The request could not be understood." },
  { code: 401, title: "Unauthorized", message: "You need to sign in to view this page." },
  { code: 403, title: "Forbidden", message: "You don’t have permission to access this resource." },
  { code: 404, title: "Page Not Found", message: "The page you’re looking for doesn’t exist or was moved." },
  { code: 405, title: "Method Not Allowed", message: "This HTTP method isn’t allowed for this URL." },
  { code: 408, title: "Request Timeout", message: "The server timed out waiting for your request." },
  { code: 413, title: "Payload Too Large", message: "The uploaded file or request body is too large." },
  { code: 429, title: "Too Many Requests", message: "You’ve sent too many requests. Please try again later." },
  { code: 500, title: "Server Error", message: "Something went wrong on our side. Please try again." },
  { code: 502, title: "Bad Gateway", message: "The upstream service is unavailable right now." },
  { code: 503, title: "Service Unavailable", message: "The site is temporarily unavailable. Please check back soon." },
  { code: 504, title: "Gateway Timeout", message: "The upstream service took too long to respond." },
];

function pageHtml({ code, title, message }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${code} — ${title}</title>
  <style>
    :root {
      --bg0: #020617;
      --bg1: #0f172a;
      --line: #1e293b;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #34d399;
      --accent-dim: rgba(52, 211, 153, 0.15);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: var(--text);
      background:
        radial-gradient(900px 500px at 15% 10%, rgba(52, 211, 153, 0.12), transparent 55%),
        radial-gradient(700px 400px at 90% 80%, rgba(14, 165, 233, 0.1), transparent 50%),
        linear-gradient(160deg, var(--bg0), var(--bg1));
      padding: 24px;
    }
    .card {
      width: min(520px, 100%);
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(2, 6, 23, 0.72);
      backdrop-filter: blur(10px);
      padding: 40px 36px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .brand span {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 6px var(--accent-dim);
    }
    .code {
      font-size: clamp(4rem, 14vw, 5.5rem);
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.04em;
      margin: 0 0 12px;
      background: linear-gradient(180deg, #fff, #94a3b8);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 1.35rem;
      font-weight: 650;
    }
    p {
      margin: 0 0 28px;
      color: var(--muted);
      line-height: 1.55;
      font-size: 0.98rem;
    }
    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 18px;
      border-radius: 12px;
      background: #059669;
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.92rem;
      transition: background 0.15s ease;
    }
    a:hover { background: #10b981; }
    .meta {
      margin-top: 26px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><span></span> Naviyra Hosting</div>
    <p class="code">${code}</p>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Back to homepage</a>
    <div class="meta">Error ${code}</div>
  </main>
</body>
</html>
`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const page of PAGES) {
  const file = path.join(OUT, `${page.code}.html`);
  fs.writeFileSync(file, pageHtml(page), "utf8");
  console.log("wrote", file);
}
console.log("DONE", PAGES.length, "pages →", OUT);
