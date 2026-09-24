import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [entry, project] = process.argv.slice(2);
const codocs = path.join(project, '.codocs');
const directory = path.join(codocs, 'nested', 'deep');
const target = path.join(directory, 'alpha.yaml');
const original = fs.readdir.bind(fs);
let reached = false;
const started = Date.now();

/** 시간 초과 시 마지막으로 통과한 단계를 부모에 전달한다. */
function progress(phase) {
  process.stderr.write(`${phase}: ${Date.now() - started}ms\n`);
}

fs.readdir = /** 하위 폴더 열거 직후 파일 생성 경합을 재현한다. */ async (
  ...args
) => {
  const entries = await original(...args);
  if (String(args[0]) === directory && !reached) {
    reached = true;
    await fs.writeFile(target, 'id: alpha\n');
  }
  return entries;
};
syncBuiltinESMExports();

progress('import');
const { createWorkspaceWatcher } = await import(pathToFileURL(entry).href);
await fs.mkdir(codocs);
progress('start');
const watcher = await createWorkspaceWatcher(project);
progress('ready');
let timer;
try {
  const seen = new Promise(
    /** 감시 이벤트가 오거나 제한 시간에 도달할 때까지 기다린다. */ (
      resolve,
    ) => {
      timer = setTimeout(() => resolve(false), 5_000);
      watcher.subscribe(
        /** 대상 파일이 감시 배치에 포함되었는지 확인한다. */ (batch) => {
          if (batch.paths.includes(target)) resolve(true);
        },
      );
    },
  );
  await fs.mkdir(directory, { recursive: true });
  const delivered = await seen;
  progress('delivered');
  process.stdout.write(JSON.stringify({ reached, delivered }));
} finally {
  clearTimeout(timer);
  progress('closing');
  await watcher.close();
  progress('closed');
}
