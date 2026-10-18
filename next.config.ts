import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist loads its worker file at runtime; bundled, it cannot find it
  // ("Setting up fake worker failed"). Load it with Node's own require instead.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
