import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Photos attached to customer messages (e.g. a nameplate) go through server actions.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
