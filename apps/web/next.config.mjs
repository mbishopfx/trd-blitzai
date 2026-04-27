import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: "../../.next",
  experimental: {
    outputFileTracingRoot: path.resolve(process.cwd(), "../..")
  },
  transpilePackages: [
    "@trd-aiblitz/worker-ts",
    "@trd-aiblitz/domain",
    "@trd-aiblitz/integrations-gbp",
    "@trd-aiblitz/integrations-attribution"
  ]
};

export default nextConfig;
