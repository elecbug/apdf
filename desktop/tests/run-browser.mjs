import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['local-app/tests/browser.cjs'], {
  stdio: 'inherit', env: { ...process.env, APDF_TEST_DESKTOP: '1' },
});
process.exitCode = result.status ?? 1;
