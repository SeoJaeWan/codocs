import { build, stop } from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

const execute = promisify(execFile);
const child = fileURLToPath(
  new URL('./test-support/registration-child.mjs', import.meta.url),
);

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
  it('새 폴더 열거가 끝나고 Chokidar 연결 전 파일이 생기면 해당 경로를 전달한다', async () => {
    const parent = path.resolve('.workbench/fixtures');
    await mkdir(parent, { recursive: true });
    const project = await mkdtemp(path.join(parent, 'watcher-registration-'));
    const entry = path.join(project, 'watcher.mjs');
    try {
      await buildWatcher(entry);
      // 실제 builtin 바인딩을 별도 프로세스에서 제어한다. 이벤트 대기 5초와
      // Windows 감시 해제 시간은 서로 다른 단계라 전체 제한에 따로 반영한다.
      let stdout: string;
      try {
        ({ stdout } = await execute(process.execPath, [child, entry, project], {
          timeout: 15_000,
        }));
      } catch (error) {
        const failure = error as Error & { stderr?: string };
        throw new Error(
          `감시 자식 실패: ${failure.message}\n${failure.stderr ?? ''}`,
          {
            cause: failure,
          },
        );
      }
      expect(JSON.parse(stdout)).toEqual({ reached: true, delivered: true });
    } finally {
      await stop();
      await rmWithRetry(project, { recursive: true, force: true });
    }
  }, 18_000);
  it('하위 폴더 경로 확인 중 종료하면 늦은 반환 뒤에도 자식이 자연 종료한다', async () => {
    const parent = path.resolve('.workbench/fixtures');
    await mkdir(parent, { recursive: true });
    const project = await mkdtemp(path.join(parent, 'watcher-close-'));
    const entry = path.join(project, 'watcher.mjs');
    try {
      await buildWatcher(entry);
      const { stdout } = await execute(
        process.execPath,
        [child, entry, project, 'close-during-path-check'],
        { timeout: 15_000 },
      );
      expect(JSON.parse(stdout)).toEqual({
        pathConfirmed: true,
        closedBeforeRelease: true,
      });
    } finally {
      await stop();
      await rmWithRetry(project, { recursive: true, force: true });
    }
  }, 18_000);
});
