import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

const cwd = process.cwd();
const frontendFromRepoRoot = path.join(cwd, "front_end");
const frontendRoot = fs.existsSync(path.join(frontendFromRepoRoot, "app"))
  ? frontendFromRepoRoot
  : cwd;
const backendApiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const backendOrigin = backendApiBase.replace(/\/api\/v1\/?$/, "");

const nextConfig: NextConfig = {
  turbopack: {
    root: frontendRoot,
  },
  images: {
    remotePatterns: [
      // Temporary: allow all remote image hosts.
      { protocol: "https", hostname: "**", pathname: "/**" },
      { protocol: "http", hostname: "**", pathname: "/**" },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendApiBase}/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendOrigin}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
