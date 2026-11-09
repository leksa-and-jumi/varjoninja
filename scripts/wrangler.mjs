// Runs the Wrangler CLI with the Cloudflare token from .env.local.
//   node scripts/wrangler.mjs deploy → npx wrangler deploy
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  const value = process.env[name] ?? '';
  if (!value || value.includes('TAYTA_TAHAN')) {
    console.error(`${name} puuttuu tiedostosta .env.local (katso .env.example).`);
    process.exit(1);
  }
}

// Wrangler reads the token from the environment; never print it.
const result = spawnSync('npx', ['wrangler', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
