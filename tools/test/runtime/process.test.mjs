import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runSupervised } from './process.mjs';

for (const mode of ['success', 'failure', 'timeout', 'cancelled']) {
  test(`${mode} 이후 시험 자식 프로세스를 종료한다`, /** 실제 자식을 만들어 종료 여부를 확인한다. */ async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-process-'));
    const controller = new AbortController();
    const script = path.join(root, 'fixture.mjs');
    const marker = path.join(root, 'child.json');
    await writeFile(
      script,
      `
      import { spawn } from 'node:child_process';
      import { writeFile } from 'node:fs/promises';
      import { once } from 'node:events';
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      await once(child, 'spawn');
      await writeFile(${JSON.stringify(marker)}, JSON.stringify(child.pid));
      ${mode === 'failure' ? "throw new Error('expected failure');" : ''}
      ${['timeout', 'cancelled'].includes(mode) ? 'await new Promise(() => {});' : ''}
    `,
    );
    let pending;
    try {
      pending = runSupervised({
        executable: process.execPath,
        args: [script],
        cwd: root,
        output: root,
        timeout: 2500,
        signal: controller.signal,
      });
      // 준비 확인은 경과 시간이 아닌 fixture가 기록한 실제 자식 PID로 판단한다.
      let pid;
      const deadline = Date.now() + 2000;
      while (!pid) {
        try {
          pid = JSON.parse(await readFile(marker, 'utf8'));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (Date.now() > deadline) throw new Error('fixture 준비 실패');
        if (!pid) await delay(20);
      }
      if (mode === 'cancelled') controller.abort();
      const report = await pending;
      assert.equal(
        report.reason,
        ['success', 'failure'].includes(mode) ? 'exit' : mode,
      );
      assert.equal(
        report.exitCode,
        mode === 'success' ? 0 : mode === 'failure' ? 1 : null,
      );
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    } finally {
      controller.abort();
      await pending?.catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  });
}
