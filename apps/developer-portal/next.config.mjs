import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Explicit in this pnpm workspace so the standalone trace mirrors paths
  // relative to the monorepo root, not this app's own directory.
  outputFileTracingRoot: workspaceRoot,
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
