import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: "../../.next",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: [
    "@trd-aiblitz/domain",
    "@trd-aiblitz/integrations-gbp",
    "@trd-aiblitz/integrations-attribution"
  ]
};

export default nextConfig;
