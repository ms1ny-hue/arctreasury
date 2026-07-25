/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: new URL(".", import.meta.url).pathname,
  transpilePackages: ["@arctreasury/domain", "@arctreasury/chain", "@arctreasury/config"],
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
