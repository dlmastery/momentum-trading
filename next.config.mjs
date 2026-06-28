/** @type {import('next').NextConfig} */
// Static export for GitHub Pages. The repo is served at
// https://<user>.github.io/momentum-trading/, so we set a base path.
// Override with BASE_PATH="" for local root serving.
const basePath = process.env.BASE_PATH ?? "/momentum-trading";

const nextConfig = {
  output: "export",
  reactStrictMode: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
