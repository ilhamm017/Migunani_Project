import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const eslintBin = resolve(process.cwd(), 'node_modules/.bin/eslint');
const targets = [
  'app/driver/page.tsx',
  'app/driver/orders/[id]/page.tsx',
  'app/driver/orders/[id]/checklist/page.tsx',
];

if (!existsSync(eslintBin)) {
  console.error('ESLint belum terpasang. Jalankan: npm install (di folder front_end)');
  process.exit(1);
}

const result = spawnSync(eslintBin, ['--max-warnings=0', ...targets], { stdio: 'inherit' });
process.exit(result.status ?? 1);
