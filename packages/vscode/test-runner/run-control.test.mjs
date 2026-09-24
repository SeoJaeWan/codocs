import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('기본 파이프로 실행한 부모가 내구 제어 파일을 읽어 정상 종료한다', /** 파이프 환경을 검사한다. */ async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'codocs-run-control-'));
  try {
    const script = `import { watchRunCancellation } from ${JSON.stringify(
      new URL('./run-control.mjs', import.meta.url).href,
    )};
      const controller = new AbortController();
      const stop = await watchRunCancellation(process.argv[1], controller);
      process.stdout.write('ready\\n');
      await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
      stop();
      process.stdout.write('finalized\\n');`;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script, output],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    child.stdout.on(
      'data',
      /** 자식의 준비와 종료 출력을 보존한다. */ (data) => {
        stdout += data;
      },
    );
    const ready = new Promise(
      /** 준비 출력을 기다린다. */ (resolve) =>
        child.stdout.on('data', () => {
          if (stdout.includes('ready\n')) resolve();
        }),
    );
    await ready;
    const control = JSON.parse(
      await readFile(path.join(output, 'run-control.json'), 'utf8'),
    );
    assert.equal(control.pid, child.pid);
    await writeFile(control.cancelRequest, '{}');
    const exitCode = await new Promise(
      /** 자식 종료를 기다린다. */ (resolve) => child.once('exit', resolve),
    );
    assert.equal(exitCode, 0);
    assert.match(stdout, /finalized/u);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
