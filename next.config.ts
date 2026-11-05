import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pdfkit reads its font files (Helvetica ≈ Arial) from node_modules at runtime: don't bundle it.
  serverExternalPackages: ["pdfkit"],
  // Photos attached to customer messages (e.g. a nameplate) go through server actions.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
