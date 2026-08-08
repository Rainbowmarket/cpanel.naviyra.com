/**
 * Server-side network speed probe (runs on the panel host, not the browser).
 * Downloads/uploads against public endpoints and measures throughput.
 */

export type SpeedProbeResult = {
  direction: "download" | "upload";
  provider: string;
  url: string;
  bytes: number;
  seconds: number;
  /** Megabits per second */
  mbps: number;
  /** Megabytes per second */
  MBps: number;
  ok: boolean;
  error?: string;
};

export type SpeedTestReport = {
  testedAt: string;
  download: SpeedProbeResult | null;
  upload: SpeedProbeResult | null;
  /** Best download Mbps across successful probes */
  downloadMbps: number | null;
  /** Best upload Mbps across successful probes */
  uploadMbps: number | null;
  probes: SpeedProbeResult[];
};

const DOWNLOAD_TARGETS: Array<{
  provider: string;
  url: string;
  /** Soft cap — stop reading after this many bytes */
  maxBytes: number;
}> = [
  {
    provider: "Cloudflare",
    url: "https://speed.cloudflare.com/__down?bytes=25000000",
    maxBytes: 25 * 1024 * 1024,
  },
  {
    provider: "Cachefly",
    url: "https://cachefly.cachefly.net/10mb.test",
    maxBytes: 10 * 1024 * 1024,
  },
  {
    provider: "OVH",
    url: "https://proof.ovh.net/files/10Mb.dat",
    maxBytes: 10 * 1024 * 1024,
  },
];

const UPLOAD_TARGETS: Array<{
  provider: string;
  url: string;
  bytes: number;
}> = [
  {
    provider: "Cloudflare",
    url: "https://speed.cloudflare.com/__up",
    // Larger payload = more stable Mbps (tiny uploads finish too fast to trust)
    bytes: 16 * 1024 * 1024,
  },
];

const MAX_MS = 12_000;

function errMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Request failed";
  const parts = [error.message];
  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    parts.push(cause.message);
  } else if (typeof cause === "string" && cause) {
    parts.push(cause);
  }
  return parts.join(": ");
}

function toRates(bytes: number, seconds: number) {
  const safeSec = Math.max(seconds, 0.001);
  const bps = bytes / safeSec;
  return {
    mbps: Math.round(((bps * 8) / 1_000_000) * 100) / 100,
    MBps: Math.round((bps / (1024 * 1024)) * 100) / 100,
  };
}

async function measureDownload(
  provider: string,
  url: string,
  maxBytes: number
): Promise<SpeedProbeResult> {
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(MAX_MS + 3000),
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error("No response body");
    }

    const reader = res.body.getReader();
    let loaded = 0;
    try {
      while (loaded < maxBytes) {
        if (performance.now() - started > MAX_MS) break;
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }

    const seconds = (performance.now() - started) / 1000;
    if (loaded < 64 * 1024) {
      throw new Error("Downloaded too little data to measure");
    }
    const rates = toRates(loaded, seconds);
    return {
      direction: "download",
      provider,
      url,
      bytes: loaded,
      seconds: Math.round(seconds * 100) / 100,
      ...rates,
      ok: true,
    };
  } catch (error) {
    const seconds = (performance.now() - started) / 1000;
    return {
      direction: "download",
      provider,
      url,
      bytes: 0,
      seconds: Math.round(seconds * 100) / 100,
      mbps: 0,
      MBps: 0,
      ok: false,
      error: errMessage(error),
    };
  }
}

async function measureUpload(
  provider: string,
  url: string,
  bytes: number
): Promise<SpeedProbeResult> {
  const started = performance.now();
  try {
    // Deterministic compressible-avoiding payload
    const chunk = Buffer.alloc(bytes);
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] = (i * 31 + 17) & 0xff;
    }

    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      body: chunk,
      signal: AbortSignal.timeout(MAX_MS + 3000),
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-cache",
      },
    });
    // Cloudflare __up often returns 200 with empty body; accept 2xx/4xx that still transferred
    if (!res.ok && res.status !== 405 && res.status < 500) {
      // still count if server received body
    }
    if (res.status >= 500) {
      throw new Error(`HTTP ${res.status}`);
    }

    const seconds = (performance.now() - started) / 1000;
    if (seconds < 0.05) {
      throw new Error("Upload finished too quickly to measure");
    }
    const rates = toRates(bytes, seconds);
    return {
      direction: "upload",
      provider,
      url,
      bytes,
      seconds: Math.round(seconds * 100) / 100,
      ...rates,
      ok: true,
    };
  } catch (error) {
    const seconds = (performance.now() - started) / 1000;
    return {
      direction: "upload",
      provider,
      url,
      bytes: 0,
      seconds: Math.round(seconds * 100) / 100,
      mbps: 0,
      MBps: 0,
      ok: false,
      error: errMessage(error),
    };
  }
}

function pickBest(probes: SpeedProbeResult[]): SpeedProbeResult | null {
  const ok = probes.filter((p) => p.ok);
  if (!ok.length) return null;
  return ok.reduce((a, b) => (b.mbps > a.mbps ? b : a));
}

export async function runServerSpeedTest(options?: {
  download?: boolean;
  upload?: boolean;
}): Promise<SpeedTestReport> {
  const wantDownload = options?.download !== false;
  const wantUpload = options?.upload !== false;
  const probes: SpeedProbeResult[] = [];

  if (wantDownload) {
    for (const t of DOWNLOAD_TARGETS) {
      probes.push(await measureDownload(t.provider, t.url, t.maxBytes));
    }
  }
  if (wantUpload) {
    for (const t of UPLOAD_TARGETS) {
      probes.push(await measureUpload(t.provider, t.url, t.bytes));
    }
  }

  const downloadProbes = probes.filter((p) => p.direction === "download");
  const uploadProbes = probes.filter((p) => p.direction === "upload");
  const download = pickBest(downloadProbes);
  const upload = pickBest(uploadProbes);

  return {
    testedAt: new Date().toISOString(),
    download,
    upload,
    downloadMbps: download?.mbps ?? null,
    uploadMbps: upload?.mbps ?? null,
    probes,
  };
}

export function formatMbps(mbps: number | null | undefined): string {
  if (mbps == null || !Number.isFinite(mbps)) return "—";
  if (mbps < 10) return `${mbps.toFixed(1)} Mbps`;
  return `${Math.round(mbps)} Mbps`;
}

export function formatBytesShort(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
