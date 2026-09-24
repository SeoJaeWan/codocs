import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rename, writeFile } from 'node:fs/promises';

const [mode, marker] = process.argv.slice(2);
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
await once(child, 'spawn');

// 완성된 PID만 준비 신호로 노출한다. 존재하지만 비어 있는 파일을 읽지 않게 한다.
await writeFile(`${marker}.pending`, JSON.stringify(child.pid));
await rename(`${marker}.pending`, marker);

if (mode === 'failure') throw new Error('expected failure');
if (mode === 'timeout' || mode === 'cancelled')
  await new Promise(/** 부모가 중단할 때까지 자식을 유지한다. */ () => {});
