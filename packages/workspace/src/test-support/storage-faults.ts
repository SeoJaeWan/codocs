import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 실패 연산에 실제 시스템 코드 형태를 부여한다. */
export function ioError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * 호출 횟수와 인자로 선택한 호출만 실패시키고 나머지는 실제 연산을 수행하는 래퍼를 만든다.
 * 호출 번호는 1부터 센다. 반영 중간 실패와 복구 실패를 순서대로 주입하는 데 쓴다.
 */
export function failOnCall<Args extends unknown[]>(
  real: (...args: Args) => Promise<void>,
  shouldFail: (args: Args, call: number) => boolean,
  code = 'EIO',
): (...args: Args) => Promise<void> {
  let calls = 0;
  return /** 선택한 호출만 실패시키고 나머지는 실제 연산에 맡긴다. */ async (
    ...args
  ) => {
    calls++;
    if (shouldFail(args, calls)) throw ioError(code);
    await real(...args);
  };
}

/** 대상(두 번째 인자) 경로와 호출 번호로 선택한 rename만 실패시킨다. */
export function failingRename(
  failures: (target: string, call: number) => boolean,
  code?: string,
): (from: string, to: string) => Promise<void> {
  return failOnCall(
    (from: string, to: string) => rename(from, to),
    ([, to], call) => failures(to, call),
    code,
  );
}

/** 새 경로(두 번째 인자)와 호출 번호로 선택한 link만 실패시킨다. */
export function failingLink(
  failures: (target: string, call: number) => boolean,
  code?: string,
): (from: string, to: string) => Promise<void> {
  return failOnCall(
    (from: string, to: string) => link(from, to),
    ([, to], call) => failures(to, call),
    code,
  );
}

/** 경로와 호출 번호로 선택한 unlink만 실패시킨다. */
export function failingUnlink(
  failures: (target: string, call: number) => boolean,
  code?: string,
): (target: string) => Promise<void> {
  return failOnCall(
    (target: string) => unlink(target),
    ([target], call) => failures(target, call),
    code,
  );
}

/** 경로와 호출 번호로 선택한 rmdir만 실패시킨다. */
export function failingRmdir(
  failures: (target: string, call: number) => boolean,
  code?: string,
): (target: string) => Promise<void> {
  return failOnCall(
    (target: string) => rmdir(target),
    ([target], call) => failures(target, call),
    code,
  );
}

/** 경로와 호출 번호로 선택한 mkdir만 실패시킨다. */
export function failingMkdir(
  failures: (target: string, call: number) => boolean,
  code?: string,
): (target: string) => Promise<void> {
  return failOnCall(
    async (target: string) => {
      await mkdir(target);
    },
    ([target], call) => failures(target, call),
    code,
  );
}

/** `.codocs` 폴더가 있는 임시 프로젝트 루트를 만든다. 호출자가 rm으로 지운다. */
export async function createTempCodocsProject(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(root, '.codocs'));
  return root;
}

/** 프로젝트 루트 기준 상대 경로를 키로 파일을 만든다. 필요한 폴더도 함께 만든다. 키가 `/`로 끝나면 빈 폴더다. */
export async function writeProjectTree(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, ...name.split('/'));
    if (name.endsWith('/')) await mkdir(target, { recursive: true });
    else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
}

/**
 * 프로젝트 안 모든 항목을 `상대경로 → 종류·내용` 맵으로 읽는다. 변경 전후 비교에 쓴다.
 * 폴더는 `dir`, 파일은 `file:<권한 8진수>:<내용>`으로 적는다. Windows는 권한을 비교하지 않는다.
 */
export async function snapshotProjectTree(
  root: string,
): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  /** 폴더 하나를 재귀로 읽는다. */
  const walk = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const target = path.join(directory, name);
      const relative = path.relative(root, target).split(path.sep).join('/');
      const stats = await lstat(target);
      if (stats.isDirectory()) {
        entries[relative] = 'dir';
        await walk(target);
      } else {
        const mode =
          process.platform === 'win32' ? '-' : (stats.mode & 0o777).toString(8);
        entries[relative] = `file:${mode}:${await readFile(target, 'utf8')}`;
      }
    }
  };
  await walk(root);
  return entries;
}
