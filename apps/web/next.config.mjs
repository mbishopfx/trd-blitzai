/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@trd-aiblitz/domain",
    "@trd-aiblitz/integrations-gbp",
    "@trd-aiblitz/integrations-attribution"
  ]
};

export default nextConfig;
