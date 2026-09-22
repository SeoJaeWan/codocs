import { defineConfig } from '@playwright/test';
import path from 'node:path';

if (!process.env.CODOCS_UI_RUN)
  throw new Error('pnpm test:ui를 통해 실행하세요.');
const run = JSON.parse(process.env.CODOCS_UI_RUN);
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '**/*.ui.spec.mjs',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 15000 },
  outputDir: path.join(run.output, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(run.output, 'results.json') }],
    ['html', { outputFolder: path.join(run.output, 'html'), open: 'never' }],
  ],
  projects: run.runtimes.map((runtime) => ({
    name: `vscode-${runtime.version}`,
    use: { runtime, vsix: run.vsix },
  })),
});
