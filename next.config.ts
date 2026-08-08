import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Middleware/proxy clones request bodies (default 10MB). Larger uploads
    // were truncated → "Failed to parse body as FormData."
    proxyClientMaxBodySize: "512mb",
    serverActions: {
      bodySizeLimit: "512mb",
    },
  },
};

export default nextConfig;
