import { build, stop } from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

/** 실제 builtin IO를 관측할 독립 프로세스용 감시 모듈을 빌드한다. */
async function buildWatcher(entry: string): Promise<void> {
  await build({
    entryPoints: [path.resolve('packages/workspace/src/watcher/index.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: { '@codocs/core': path.resolve('packages/core/src/index.ts') },
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  });
}

describe('새 하위 폴더의 실제 감시 등록 경합', () => {
  it('외부 대상의 조상에 보호된 형제 파일이 있어도 metadata를 읽지 않고 감시를 준비한다', async () => {
    const parent = path.resolve('.workbench/fixtures');
    await mkdir(parent, { recursive: true });
    const project = await mkdtemp(path.join(parent, 'watcher-protected-'));
    const entry = path.join(project, 'watcher.mjs');
    try {
      await buildWatcher(entry);
      const script = `
        import fs from 'node:fs/promises';
        import { syncBuiltinESMExports } from 'node:module';
        import path from 'node:path';
        import { pathToFileURL } from 'node:url';
        const [entry, project] = process.argv.slice(1);
        const workspace = path.join(project, 'workspace');
        const target = path.join(project, 'external', 'document.yaml');
        const protectedFile = path.join(project, 'protected.tmp');
        await fs.mkdir(path.join(workspace, '.codocs'), { recursive: true });
        await fs.mkdir(path.dirname(target));
        await fs.writeFile(target, 'id: external\\n');
        await fs.writeFile(protectedFile, '');
        let attempts = 0;
        for (const operation of ['stat', 'lstat']) {
          const original = fs[operation].bind(fs);
          fs[operation] = async (...args) => {
            if (path.resolve(String(args[0])) === protectedFile) {
              attempts++;
              throw Object.assign(new Error('protected metadata'), { code: 'EINVAL' });
            }
            return original(...args);
          };
        }
        syncBuiltinESMExports();
        const { createWorkspaceWatcher } = await import(pathToFileURL(entry).href);
        const watcher = await createWorkspaceWatcher(workspace);
        try {
          await watcher.trackTargets([target]);
          await new Promise((resolve) => setTimeout(resolve, 250));
          process.stdout.write(JSON.stringify({ attempts, ready: watcher.readiness.ready }));
        } finally { await watcher.close(); }
      `;
      const { stdout } = await execute(
        process.execPath,
        ['--input-type=module', '-e', script, entry, project],
        { timeout: 8_000 },
      );
      expect(JSON.parse(stdout)).toEqual({ attempts: 0, ready: true });
    } finally {
      await stop();
      await rm(project, { recursive: true, force: true });
    }
  }, 10_000);

  it('새 폴더 열거가 끝나고 Chokidar 연결 전 파일이 생기면 해당 경로를 전달한다', async () => {
    const parent = path.resolve('.workbench/fixtures');
    await mkdir(parent, { recursive: true });
    const project = await mkdtemp(path.join(parent, 'watcher-registration-'));
    const entry = path.join(project, 'watcher.mjs');
    try {
      await buildWatcher(entry);
      // 별도 Node 프로세스에서 실제 builtin 바인딩을 제어한다. Vitest의 외부 모듈 mock을 감시 IO 재현으로 오해하지 않는다.
      const script = `
        import fs from 'node:fs/promises';
        import { syncBuiltinESMExports } from 'node:module';
        import path from 'node:path';
        import { pathToFileURL } from 'node:url';
        const [entry, project] = process.argv.slice(1);
        const codocs = path.join(project, '.codocs');
        const directory = path.join(codocs, 'nested', 'deep');
        const target = path.join(directory, 'alpha.yaml');
        const original = fs.readdir.bind(fs);
        let reached = false;
        fs.readdir = async (...args) => {
          const entries = await original(...args);
          if (String(args[0]) === directory && !reached) {
            reached = true;
            await fs.writeFile(target, 'id: alpha\\n');
          }
          return entries;
        };
        syncBuiltinESMExports();
        const { createWorkspaceWatcher } = await import(pathToFileURL(entry).href);
        await fs.mkdir(codocs);
        const watcher = await createWorkspaceWatcher(project);
        let timer;
        try {
          const seen = new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), 5000);
            watcher.subscribe((batch) => { if (batch.paths.includes(target)) resolve(true); });
          });
          await fs.mkdir(directory, { recursive: true });
          const delivered = await seen;
          process.stdout.write(JSON.stringify({ reached, delivered }));
        } finally { clearTimeout(timer); await watcher.close(); }
      `;
      const { stdout } = await execute(
        process.execPath,
        ['--input-type=module', '-e', script, entry, project],
        { timeout: 8_000 },
      );
      expect(JSON.parse(stdout)).toEqual({ reached: true, delivered: true });
    } finally {
      await stop();
      await rm(project, { recursive: true, force: true });
    }
  }, 10_000);
});
