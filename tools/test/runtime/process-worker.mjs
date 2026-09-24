import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// 감독기가 완료 보고를 받은 뒤 트리를 정리할 때까지 루트 프로세스를 유지한다.
process.on('message', () => {});
process.on(
  'disconnect',
  /** 감독기 사망 시 시험 자식을 정리한다. */ () => {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], {
        windowsHide: true,
      });
    else process.kill(-process.pid, 'SIGKILL');
  },
);
const [module, ...args] = process.argv.slice(2);
process.argv = [process.execPath, module, ...args];
try {
  await import(pathToFileURL(module).href);
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
}
process.send({ type: 'complete', exitCode: Number(process.exitCode ?? 0) });
