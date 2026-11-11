import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// One .env at the repo root serves every app and package.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

const config: NextConfig = {
  // Self-contained server bundle for the Docker image; tracing starts at the repo root
  // so the workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  transpilePackages: ['@fin/calc', '@fin/core', '@fin/db'],
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'nodemailer'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
