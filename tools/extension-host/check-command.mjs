import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [destination, executable, ...args] = process.argv.slice(2);
if (!destination || !executable)
  throw new Error('usage: check-command.mjs output-prefix executable args...');
await mkdir(path.dirname(destination), { recursive: true });
const started = Date.now();
const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});
/** 자식 명령의 종료 코드와 신호를 수집한다. */
const result = await new Promise(
  /** 자식 명령 종료를 기다린다. */ (resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  },
);
await writeFile(`${destination}.stdout.log`, stdout);
await writeFile(`${destination}.stderr.log`, stderr);
await writeFile(
  `${destination}.json`,
  `${JSON.stringify({ command: [executable, ...args], startedAt: new Date(started).toISOString(), durationMilliseconds: Date.now() - started, ...result }, null, 2)}\n`,
);
process.exitCode = result.code ?? 1;
