import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** 별도 저장소에 부모 Git 인덱스·작업 트리 환경이 전파되지 않게 한다. */
export function isolatedEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([key]) => !key.startsWith('GIT_'))
      .concat([['HUSKY', '0']]),
  );
}

/** 실제 Git 명령의 실패를 전달하고 출력 바이트를 보존한다. */
export function git(root, args, env = process.env) {
  return execFileSync(
    'git',
    ['-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', ...args],
    {
      cwd: root,
      env,
      windowsHide: true,
      encoding: 'utf8',
    },
  ).trim();
}

/** 자식이 정상적으로 자원을 정리할 때까지 기다린다. 취소 중 강제 종료하지 않는다. */
export async function runNode(root, args) {
  /** 자식 프로세스의 오류와 종료를 기다린다. */
  function waitForChild(resolve, reject) {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: isolatedEnvironment(),
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', reject);
    /** 실패한 자식의 종료 상태를 보존한다. */
    function completed(code, signal) {
      if (code === 0) resolve();
      else
        reject(
          new Error('검사 실패 (' + (code ?? signal) + '): ' + args.join(' ')),
        );
    }
    child.once('close', completed);
  }
  await new Promise(waitForChild);
}

/** 자동 수정 뒤 인덱스의 정확한 트리를 격리하여 검사하고 인덱스 변경을 거부한다. */
export async function checkStaged({
  root,
  format,
  verify,
  signal,
  snapshotParent = os.tmpdir(),
}) {
  signal?.throwIfAborted();
  if (!(await format()))
    throw new Error('lint-staged 실패: 커밋을 중단합니다.');
  signal?.throwIfAborted();
  const tree = git(root, ['write-tree']);
  const base = git(root, ['rev-parse', 'HEAD']);
  const parent = path.join(root, '.workbench', 'commit-check');
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(path.join(parent, 'run-'));
  const snapshot = await mkdtemp(
    path.join(path.resolve(snapshotParent), 'codocs-staged-'),
  );
  const result = { base, tree, snapshot, passed: false, phase: 'preparation' };
  try {
    const env = isolatedEnvironment();
    git(
      root,
      ['clone', '--quiet', '--shared', '--no-checkout', '--', root, snapshot],
      env,
    );
    git(snapshot, ['read-tree', tree], env);
    git(snapshot, ['checkout-index', '--all', '--force'], env);
    signal?.throwIfAborted();
    result.phase = 'verification';
    await verify(snapshot, signal);
    signal?.throwIfAborted();
    git(snapshot, ['diff', '--exit-code', '--quiet'], env);
    if (git(snapshot, ['write-tree'], env) !== tree)
      throw new Error('검사 과정에서 복사본 인덱스가 변경되었습니다.');
    if (path.dirname(snapshot) !== path.resolve(snapshotParent))
      throw new Error('복사본 정리 경로가 임시 부모를 벗어났습니다.');
    await rm(snapshot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    result.snapshotCleaned = true;
    if (
      git(root, ['write-tree']) !== tree ||
      git(root, ['rev-parse', 'HEAD']) !== base
    )
      throw new Error(
        '검사 도중 커밋 대상 인덱스 또는 HEAD가 변경되었습니다. 다시 커밋하세요.',
      );
    result.passed = true;
    result.phase = 'complete';
  } catch (error) {
    result.error = error.stack ?? String(error);
    throw error;
  } finally {
    await writeFile(
      path.join(output, 'result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(`커밋 검사 ${result.passed ? 'PASS' : 'FAIL'}: ${output}`);
  }
  return result;
}
