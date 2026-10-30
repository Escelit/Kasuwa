/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Allow importing .ts/.tsx files using .js extensions (TS convention).
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

module.exports = nextConfig;
