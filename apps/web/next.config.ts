import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';

// One .env at the repo root serves every app and package.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

const config: NextConfig = {
  transpilePackages: ['@fin/core', '@fin/db'],
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
