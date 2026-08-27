import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingIncludes: { "/*": ["./agents/**/*.yaml", "./agents/**/*.md"] },
};
export default nextConfig;
