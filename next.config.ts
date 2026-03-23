import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/ui',
  allowedDevOrigins: ['127.0.0.1:3001', 'localhost:3001'],
  transpilePackages: ['ui-web'],
};

export default nextConfig;
