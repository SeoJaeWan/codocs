import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [entry, project, mode] = process.argv.slice(2);
const closeDuringPathCheck = mode === 'close-during-path-check';
const codocs = path.join(project, '.codocs');
const directory = path.join(codocs, 'nested', 'deep');
const target = path.join(directory, 'alpha.yaml');
const original = fs.readdir.bind(fs);
let reached = false;
let pathConfirmed = false;
let confirmPath;
let releasePath;
const pathReached = new Promise(
  /** 실제 경로 확인이 반환 직전에 도달했음을 부모 흐름에 알린다. */ (
    resolve,
  ) => {
    confirmPath = resolve;
  },
);
const pathReleased = new Promise(
  /** close 완료 뒤 경로 확인 결과를 반환하도록 해제 함수를 보관한다. */ (
    resolve,
  ) => {
    releasePath = resolve;
  },
);
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
if (closeDuringPathCheck) {
  const originalRealpath = fs.realpath.bind(fs);
  fs.realpath =
    /** 실제 확인 결과를 보존하고 하위 폴더 등록의 반환 경계만 제어한다. */ async (
      ...args
    ) => {
      const result = await originalRealpath(...args);
      if (String(args[0]) === directory && !pathConfirmed) {
        pathConfirmed = true;
        confirmPath();
        await pathReleased;
      }
      return result;
    };
}
syncBuiltinESMExports();

progress('import');
const { createWorkspaceWatcher } = await import(pathToFileURL(entry).href);
await fs.mkdir(codocs);
progress('start');
const watcher = await createWorkspaceWatcher(project);
progress('ready');
let timer;
try {
  if (closeDuringPathCheck) {
    const boundary = Promise.race([
      pathReached.then(
        /** 경로 확인에 도달한 경우만 성공으로 구분한다. */ () => true,
      ),
      new Promise(
        /** 감시가 경계에 도달하지 못하면 기존 이벤트 대기 한도에서 실패한다. */ (
          resolve,
        ) => {
          timer = setTimeout(() => resolve(false), 5_000);
        },
      ),
    ]);
    await fs.mkdir(directory, { recursive: true });
    if (!(await boundary))
      throw new Error('하위 폴더 경로 확인에 도달하지 못했습니다.');
    progress('path-confirmed');
    await watcher.close();
    progress('closed-before-release');
    const closedBeforeRelease = watcher.readiness.state === 'closed';
    releasePath();
    process.stdout.write(
      JSON.stringify({
        pathConfirmed,
        closedBeforeRelease,
      }),
    );
  } else {
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
  }
} finally {
  releasePath();
  clearTimeout(timer);
  progress('closing');
  await watcher.close();
  progress('closed');
}
