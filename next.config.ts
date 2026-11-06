import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pdfkit reads its font files (Helvetica ≈ Arial) from node_modules at runtime: don't bundle it.
  serverExternalPackages: ["pdfkit", "unpdf"],
  // Photos attached to customer messages (e.g. a nameplate) go through server actions.
  // Customer documents (RUT, Cámara de Comercio) too: up to 6 files of 5 MB.
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
  // The logo rarely changes: let browsers keep it for a week instead of asking every page load.
  async headers() {
    return [{ source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] }];
  },
};

export default nextConfig;
