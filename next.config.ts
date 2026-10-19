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
  // Baseline browser protections. Framing is limited to this site, so another
  // site cannot overlay the app (clickjacking) while our own pages still can.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
