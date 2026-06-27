/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This project has its own lockfile; pin the workspace root to avoid Next
  // selecting a parent directory when multiple lockfiles are present.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
