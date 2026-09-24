import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { formatIndex } from './format-index.mjs';
import { checkStaged, git, isolatedEnvironment } from './staged.mjs';

/** 사용자 저장소와 분리된 실제 Git 저장소를 준비한다. */
async function fixture(t) {
  const parent = path.resolve('.workbench/staged-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'repo-'));
  t.after(() =>
    rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  );
  const env = isolatedEnvironment();
  git(root, ['init', '--quiet'], env);
  await writeFile(path.join(root, '.gitignore'), '.workbench/\n');
  await writeFile(path.join(root, 'sample.txt'), 'base\n\n\n\nlast\n');
  git(root, ['add', '.'], env);
  git(
    root,
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'base',
    ],
    env,
  );
  await writeFile(path.join(root, 'sample.txt'), 'staged\n\n\n\nlast\n');
  git(root, ['add', 'sample.txt'], env);
  await writeFile(path.join(root, 'sample.txt'), 'staged\n\n\n\nunstaged\n');
  await writeFile(path.join(root, 'untracked.txt'), 'private\n');
  return root;
}

/** 인덱스와 사용자 파일을 바이트 단위로 관찰한다. */
async function state(root) {
  return {
    tree: git(root, ['write-tree']),
    file: await readFile(path.join(root, 'sample.txt'), 'utf8'),
    untracked: await readFile(path.join(root, 'untracked.txt'), 'utf8'),
  };
}

/** 조건별 실행 결과와 변경 보존을 확인한다. */
async function verifyPartialStaging(t) {
  const root = await fixture(t);
  const before = await state(root);
  const result = await checkStaged({
    root,
    snapshotParent: root,
    /** 조건별 실행 결과와 변경 보존을 확인한다. */
    format: async () => true,
    /** 조건별 실행 결과와 변경 보존을 확인한다. */
    verify: async (snapshot) => {
      assert.equal(
        await readFile(path.join(snapshot, 'sample.txt'), 'utf8'),
        'staged\n\n\n\nlast\n',
      );
      await assert.rejects(readFile(path.join(snapshot, 'untracked.txt')), {
        code: 'ENOENT',
      });
    },
  });
  assert.equal(result.tree, before.tree);
  assert.equal(result.passed, true);
  assert.deepEqual(await state(root), before);
}
test(
  '부분 스테이징을 검사하면 커밋 대상만 읽고 사용자 변경을 보존한다',
  verifyPartialStaging,
);

/** 조건별 실행 결과와 변경 보존을 확인한다. */
async function verifyFormatting(t) {
  const root = await fixture(t);
  await writeFile(
    path.join(root, 'format.cjs'),
    'const fs=require("node:fs"); for(const f of process.argv.slice(2)) fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("staged","FORMATTED"));',
  );
  const result = await checkStaged({
    root,
    snapshotParent: root,
    /** 조건별 실행 결과와 변경 보존을 확인한다. */
    format: () =>
      formatIndex({
        cwd: root,
        quiet: true,
        config: { '*.txt': 'node format.cjs' },
      }),
    /** 조건별 실행 결과와 변경 보존을 확인한다. */
    verify: async (snapshot) => {
      assert.equal(
        await readFile(path.join(snapshot, 'sample.txt'), 'utf8'),
        'FORMATTED\n\n\n\nlast\n',
      );
    },
  });
  assert.equal(result.passed, true);
  assert.equal(
    await readFile(path.join(root, 'sample.txt'), 'utf8'),
    'FORMATTED\n\n\n\nunstaged\n',
  );
  assert.equal(
    await readFile(path.join(root, 'untracked.txt'), 'utf8'),
    'private\n',
  );
}
test(
  'lint-staged 자동 수정 후 검사하면 수정된 인덱스를 읽고 비스테이징 줄을 보존한다',
  verifyFormatting,
);

/** 조건별 실행 결과와 변경 보존을 확인한다. */
async function verifyFormatterFailure(t) {
  const root = await fixture(t);
  const before = await state(root);
  await writeFile(
    path.join(root, 'format.cjs'),
    'require("node:fs").writeFileSync(process.argv[2],"broken"); process.exit(1);',
  );
  await assert.rejects(
    checkStaged({
      root,
      snapshotParent: root,
      /** 조건별 실행 결과와 변경 보존을 확인한다. */
      format: () =>
        formatIndex({
          cwd: root,
          quiet: true,
          config: { '*.txt': 'node format.cjs' },
        }),
      /** 조건별 실행 결과와 변경 보존을 확인한다. */
      verify: async () => assert.fail('검사를 실행하면 안 됩니다.'),
    }),
    /lint-staged 실패/,
  );
  assert.deepEqual(await state(root), before);
}
test(
  'lint-staged가 수정 후 실패하면 원래 인덱스와 사용자 변경을 복원한다',
  verifyFormatterFailure,
);

for (const kind of ['기능 실패', '취소']) {
  /** 조건별 실행 결과와 변경 보존을 확인한다. */
  async function verifyRejectedCheck(t) {
    const root = await fixture(t);
    const before = await state(root);
    const controller = new AbortController();
    await assert.rejects(
      checkStaged({
        root,
        snapshotParent: root,
        signal: controller.signal,
        /** 조건별 실행 결과와 변경 보존을 확인한다. */
        format: async () => true,
        /** 조건별 실행 결과와 변경 보존을 확인한다. */
        verify: async () => {
          if (kind === '취소') controller.abort(new Error('취소'));
          else throw new Error(kind);
        },
      }),
      new RegExp(kind),
    );
    assert.deepEqual(await state(root), before);
  }
  test(
    `${kind}가 발생하면 커밋을 거부하고 사용자 변경을 보존한다`,
    verifyRejectedCheck,
  );
}

/** 조건별 실행 결과와 변경 보존을 확인한다. */
async function verifyIndexMutation(t) {
  const root = await fixture(t);
  await assert.rejects(
    checkStaged({
      root,
      snapshotParent: root,
      /** 조건별 실행 결과와 변경 보존을 확인한다. */
      format: async () => true,
      /** 조건별 실행 결과와 변경 보존을 확인한다. */
      verify: async () => git(root, ['add', 'sample.txt']),
    }),
    /인덱스 또는 HEAD가 변경/,
  );
  assert.equal(git(root, ['show', ':sample.txt']), 'staged\n\n\n\nunstaged');
  assert.equal(
    await readFile(path.join(root, 'untracked.txt'), 'utf8'),
    'private\n',
  );
}
test(
  '검사 도중 사용자가 인덱스를 변경하면 새 변경을 보존하고 커밋을 거부한다',
  verifyIndexMutation,
);

/** 조건별 실행 결과와 변경 보존을 확인한다. */
async function verifySnapshotMutation(t) {
  const root = await fixture(t);
  const before = await state(root);
  await assert.rejects(
    checkStaged({
      root,
      snapshotParent: root,
      /** 조건별 실행 결과와 변경 보존을 확인한다. */
      format: async () => true,
      /** 조건별 실행 결과와 변경 보존을 확인한다. */
      verify: async (snapshot) =>
        writeFile(path.join(snapshot, 'sample.txt'), 'changed'),
    }),
  );
  assert.deepEqual(await state(root), before);
}
test(
  '검사가 복사본 소스를 변경하면 커밋을 거부하고 원본을 보존한다',
  verifySnapshotMutation,
);

for (const mode of ['success', 'failure', 'cancel']) {
  /** 조건별 실행 결과와 변경 보존을 확인한다. */
  async function verifyGitHook(t) {
    const root = await fixture(t);
    const before = await state(root);
    const previousHead = git(root, ['rev-parse', 'HEAD']);
    const engine = new URL('./staged.mjs', import.meta.url).href;
    const formatter = new URL('./format-index.mjs', import.meta.url).href;
    await writeFile(
      path.join(root, 'format.cjs'),
      mode === 'cancel'
        ? 'const fs=require("node:fs");fs.writeFileSync(process.argv[2],"temporary"); fs.writeFileSync("ready","ready");setInterval(()=>{},1000);'
        : 'process.exit(0);',
    );
    const driver = `import {checkStaged} from ${JSON.stringify(engine)};
import {formatIndex} from ${JSON.stringify(formatter)};
import {watch,existsSync,readFileSync} from 'node:fs';
const root=${JSON.stringify(root)};
const controller=new AbortController();
process.on('SIGINT',()=>controller.abort(new Error('cancel')));
const watcher=${JSON.stringify(mode)}==='cancel'?watch(root,()=>{if(existsSync(root+'/ready')){watcher.close();process.emit('SIGINT');}}):null;
try { await checkStaged({root,snapshotParent:root,signal:controller.signal,format:()=>formatIndex({cwd:root,quiet:true,config:{'*.txt':'node format.cjs'}}),verify:async(snapshot)=>{if(${JSON.stringify(mode)}==='failure')throw Error('failure'); if(readFileSync(snapshot+'/sample.txt','utf8')!=='staged\\n\\n\\n\\nlast\\n')throw Error('wrong staged bytes');}}); }
catch(error){console.error(error.message);process.exitCode=1;}
finally{watcher?.close();}`;
    await writeFile(path.join(root, 'driver.mjs'), driver);
    await writeFile(
      path.join(root, '.git/hooks/pre-commit'),
      `#!/bin/sh\n"${process.execPath.replaceAll('\\', '/')}" "${path.join(root, 'driver.mjs').replaceAll('\\', '/')}"\n`,
      { mode: 0o755 },
    );
    const args = [
      '-c',
      'core.hooksPath=.git/hooks',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'candidate',
    ];
    if (mode === 'success') {
      git(root, args);
      assert.notEqual(git(root, ['rev-parse', 'HEAD']), previousHead);
      assert.equal(git(root, ['rev-parse', 'HEAD^{tree}']), before.tree);
    } else {
      assert.throws(() => git(root, args));
      assert.equal(git(root, ['rev-parse', 'HEAD']), previousHead);
    }
    assert.deepEqual(await state(root), before);
  }
  test(
    `실제 Git 훅의 ${mode} 결과가 커밋 허용과 사용자 변경 보존에 반영된다`,
    verifyGitHook,
  );
}

/** 자동 수정된 CRLF blob만 정규화하고 미스테이징 작업 파일을 다시 추가하지 않는다. */
async function verifyCleanFilter(t) {
  const root = await fixture(t);
  await writeFile(path.join(root, 'sample.txt'), 'staged\n\n\n\nlast\n');
  await writeFile(
    path.join(root, '.gitignore'),
    '.workbench/\nprivate-ignore\n',
  );
  await writeFile(
    path.join(root, 'format.cjs'),
    'const fs=require("node:fs");for(const f of process.argv.slice(2))fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("staged","FORMATTED").replaceAll("\\n","\\r\\n"));',
  );
  const previous = process.env.GIT_CONFIG_PARAMETERS;
  process.env.GIT_CONFIG_PARAMETERS = "'core.autocrlf'='true'";
  try {
    assert.equal(
      await formatIndex({
        cwd: root,
        quiet: true,
        config: { '*.txt': 'node format.cjs' },
      }),
      true,
    );
    assert.equal(git(root, ['show', ':sample.txt']), 'FORMATTED\n\n\n\nlast');
    assert.equal(
      await readFile(path.join(root, '.gitignore'), 'utf8'),
      '.workbench/\nprivate-ignore\n',
    );
    assert.equal(
      await readFile(path.join(root, 'untracked.txt'), 'utf8'),
      'private\n',
    );
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
    else process.env.GIT_CONFIG_PARAMETERS = previous;
  }
}
test(
  '자동 수정한 CRLF는 Git clean 규칙으로 정규화하고 미스테이징 줄을 커밋에 넣지 않는다',
  verifyCleanFilter,
);

/** 줄바꿈 변환이 미스테이징 패치와 충돌하면 성공시키지 않고 원본을 보존한다. */
async function verifyFormattingConflict(t) {
  const root = await fixture(t);
  const before = await state(root);
  await writeFile(
    path.join(root, 'format.cjs'),
    'const fs=require("node:fs");for(const f of process.argv.slice(2))fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("staged","FORMATTED").replaceAll("\\n","\\r\\n"));',
  );
  const passed = await formatIndex({
    cwd: root,
    quiet: true,
    config: { '*.txt': 'node format.cjs' },
  });
  assert.equal(passed, false);
  assert.deepEqual(await state(root), before);
}
test(
  '자동 수정의 줄바꿈 변환이 부분 스테이징과 충돌하면 사용자 변경을 보존하고 실패한다',
  verifyFormattingConflict,
);
