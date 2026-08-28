import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingIncludes: { "/*": ["./skills/**/SKILL.md", "./skills/**/*.yaml", "./skills/**/*.md"] },
};
export default nextConfig;
