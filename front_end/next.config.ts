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
const backendOriginUrl = new URL(backendOrigin);
const externalImageHosts = (process.env.NEXT_PUBLIC_IMAGE_HOSTS || "www.berkatakurnanjaya.com")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  turbopack: {
    root: frontendRoot,
  },
  images: {
    remotePatterns: [
      {
        protocol: backendOriginUrl.protocol.replace(':', '') as 'http' | 'https',
        hostname: backendOriginUrl.hostname,
        port: backendOriginUrl.port || undefined,
        pathname: '/uploads/**',
      },
      ...externalImageHosts.flatMap((hostname) => ([
        {
          protocol: 'https' as const,
          hostname,
          pathname: '/**',
        },
        {
          protocol: 'http' as const,
          hostname,
          pathname: '/**',
        },
      ])),
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
