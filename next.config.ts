import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist loads its worker file at runtime; bundled, it cannot find it
  // ("Setting up fake worker failed"). Load it with Node's own require instead.
  serverExternalPackages: ["pdfjs-dist"],
  // The worker is imported through a computed path, so the deploy trace misses
  // it; include it so the parse route works on Vercel, not only locally.
  outputFileTracingIncludes: {
    "/api/collections/imports/\\[id\\]/parse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
