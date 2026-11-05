import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pdfkit reads its font files (Helvetica ≈ Arial) from node_modules at runtime: don't bundle it.
  serverExternalPackages: ["pdfkit"],
  // Photos attached to customer messages (e.g. a nameplate) go through server actions.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // The logo rarely changes: let browsers keep it for a week instead of asking every page load.
  async headers() {
    return [{ source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] }];
  },
};

export default nextConfig;
