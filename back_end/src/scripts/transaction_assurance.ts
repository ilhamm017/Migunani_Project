import { spawnSync } from 'child_process';

type Phase = {
  key: string;
  title: string;
  command: string;
  required: boolean;
  note?: string;
};

const apiBaseUrl = String(process.env.API_BASE_URL || 'http://127.0.0.1:5000/api/v1').replace(/\/$/, '');

const phases: Phase[] = [
  {
    key: 'contract',
    title: 'Phase A - System Status Baseline',
    command: 'ts-node src/scripts/system_status.ts',
    required: true,
    note: 'Memastikan DB dan seed inti tersedia sebelum runtime audit dimulai.'
  },
  {
    key: 'actions',
    title: 'Phase B - Action Matrix Regression',
    command: 'npm run test:action-matrix',
    required: true,
    note: 'Menutup action endpoint finance dan non-finance pada invalid path dan role guard.'
  },
  {
    key: 'ownership',
    title: 'Phase C - Ownership Matrix Regression',
    command: 'npm run test:ownership-matrix',
    required: true,
    note: 'Memastikan resource order/invoice/retur/finance tidak bocor lintas role atau ownership.'
  },
  {
    key: 'finance-replay',
    title: 'Phase D - Finance Replay Regression',
    command: 'npm run test:finance-replay',
    required: true,
    note: 'Membuktikan side effect finansial tidak double-post pada replay atau second action.'
  },
  {
    key: 'notification',
    title: 'Phase E - Notification Soft-Fail Regression',
    command: 'npm run test:notification-softfail',
    required: true,
    note: 'Memastikan WA not-ready menjadi degraded side effect, bukan false 500.'
  },
  {
    key: 'boundary-read',
    title: 'Phase F - Boundary Read Regression',
    command: 'npm run test:boundary-read',
    required: true,
    note: 'Membuktikan public/admin read path pinggiran mengembalikan 4xx/200 yang benar, bukan false 500.'
  },
  {
    key: 'upload-policy',
    title: 'Phase G - Upload Policy Regression',
    command: 'npm run test:upload-policy',
    required: true,
    note: 'Memastikan MIME/size rejection konsisten pada upload path inti.'
  }
];

function runPhase(phase: Phase) {
  console.log(`\n== ${phase.title} ==`);
  if (phase.note) {
    console.log(`note: ${phase.note}`);
  }

  const result = spawnSync(phase.command, {
    shell: true,
    stdio: 'inherit',
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_BASE_URL: apiBaseUrl
    }
  });

  return {
    ...phase,
    exitCode: typeof result.status === 'number' ? result.status : 1
  };
}

function main() {
  console.log('Transaction assurance runner');
  console.log(`API_BASE_URL=${apiBaseUrl}`);
  console.log('Gunakan backend isolated instance agar hasil tidak tercampur proses dev lain.');

  const results = phases.map(runPhase);
  const failed = results.filter((item) => item.exitCode !== 0);

  console.log('\n== Summary ==');
  for (const item of results) {
    console.log(`${item.exitCode === 0 ? 'PASS' : 'FAIL'} ${item.key} -> exit=${item.exitCode}`);
  }

  if (failed.length > 0) {
    console.error('\nTransaction assurance failed.');
    console.error('Periksa execution report, replay matrix, dan root-cause ledger untuk tindak lanjut.');
    process.exit(1);
  }

  console.log('\nTransaction assurance passed.');
  console.log('Lanjutkan dengan smoke UI manual dan freeze evidence ke readiness summary.');
}

main();
