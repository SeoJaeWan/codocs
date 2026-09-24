import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [label, command, ...args] = process.argv.slice(2);
if (!label || !command || !/^[a-z0-9-]+$/u.test(label))
  throw new Error('검사 이름과 명령이 필요합니다.');
const directory = path.resolve('.workbench/followup-evidence');
await mkdir(directory, { recursive: true });
const start = Date.now();
const log = createWriteStream(path.join(directory, label + '.log'));
const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
child.on(
  'error',
  /** 실행 실패를 원본 로그에 보존한다. */ (error) => {
    log.write(String(error));
  },
);
const code = await new Promise(
  /** 자식 명령 종료 상태를 기다린다. */ (resolve) =>
    child.on('close', resolve),
);
await new Promise(
  /** 원본 로그 쓰기가 끝난 뒤 결과를 기록한다. */ (resolve) =>
    log.end(resolve),
);
const result = {
  command: [command, ...args],
  code,
  durationMs: Date.now() - start,
  log: label + '.log',
};
await writeFile(
  path.join(directory, label + '.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
process.exitCode = code ?? 1;
