import { fileURLToPath } from "url";
import path from "path";

// Monorepo root (two levels up from apps/web). Required so Next's serverless
// file tracing follows pnpm's symlinked node_modules and bundles next/dist.
const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@arctreasury/domain", "@arctreasury/chain", "@arctreasury/config", "@arctreasury/ai"],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // Workspace packages use NodeNext-style ".js" import specifiers over ".ts"
    // source. Teach webpack to resolve them.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default nextConfig;
