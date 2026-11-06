import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import {
  extractZip,
  installedBinPath,
  listZip,
  releaseFiles,
  safeZipPath,
} from './verify-release.mjs';
import {
  createFixture,
  isCi,
  runVscodeSmoke,
  vscodeVersion,
} from './vscode-smoke/vscode-smoke.mjs';

const suite = createRequire(import.meta.url)('./vscode-smoke/suite.cjs');

/** 임시 폴더에 빈 파일을 만들어 선택 규칙만 검사한다. */
async function withFiles(names, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-select-'));
  try {
    for (const name of names) await writeFile(path.join(directory, name), '');
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('tgz와 VSIX가 하나씩이면 두 경로를 고르고 다른 파일은 무시한다', /** 선택 규칙의 입력과 결과를 확인한다. */ async () => {
  await withFiles(
    ['a-1.tgz', 'b-1.vsix', 'a-1.tgz.sha256', 'b-1.vsix.sha256'],
    /** 선택된 두 경로를 관측한다. */ async (directory) => {
      assert.deepEqual(await releaseFiles(directory), {
        tgz: path.join(directory, 'a-1.tgz'),
        vsix: path.join(directory, 'b-1.vsix'),
      });
    },
  );
});

test('tgz가 둘이면 개수를 밝히고 실패한다', /** 선택 규칙의 입력과 결과를 확인한다. */ async () => {
  await withFiles(
    ['a.tgz', 'b.tgz', 'c.vsix'],
    /** 실패 메시지의 개수를 관측한다. */ async (directory) => {
      await assert.rejects(releaseFiles(directory), /2 \.tgz and 1 \.vsix/u);
    },
  );
});

test('VSIX가 없으면 개수를 밝히고 실패한다', /** 선택 규칙의 입력과 결과를 확인한다. */ async () => {
  await withFiles(
    ['a.tgz'],
    /** 실패 메시지의 개수를 관측한다. */ async (directory) => {
      await assert.rejects(releaseFiles(directory), /1 \.tgz and 0 \.vsix/u);
    },
  );
});

test('폴더가 비어 있으면 0개를 밝히고 실패한다', /** 선택 규칙의 입력과 결과를 확인한다. */ async () => {
  await withFiles(
    [],
    /** 실패 메시지의 개수를 관측한다. */ async (directory) => {
      await assert.rejects(releaseFiles(directory), /0 \.tgz and 0 \.vsix/u);
    },
  );
});

/** 압축 없이 저장하는 최소 zip을 만든다. 이름은 그대로 기록한다. */
function storedZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.concat([header, nameBytes, data]);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, nameBytes]));
    local.push(record);
    offset += record.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** 임시 폴더에 zip을 쓰고 검사를 실행한 뒤 폴더를 지운다. */
async function withZip(entries, run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-zip-'));
  try {
    const file = path.join(directory, 'fixture.zip');
    await writeFile(file, storedZip(entries));
    await run(file, path.join(directory, 'out'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('zip 목록은 항목 이름의 대소문자를 그대로 돌려준다', /** 목록의 이름을 확인한다. */ async () => {
  await withZip(
    [
      ['extension/README.md', 'a'],
      ['extension/readme.md', 'b'],
      ['extension/LICENSE.txt', 'c'],
    ],
    /** 원래 이름을 관측한다. */ async (file) => {
      assert.deepEqual(await listZip(file), [
        'extension/README.md',
        'extension/readme.md',
        'extension/LICENSE.txt',
      ]);
    },
  );
});

test('zip 해제는 대소문자를 보존하고 폴더 항목은 폴더만 만든다', /** 해제된 파일을 확인한다. */ async () => {
  await withZip(
    [
      ['extension/', ''],
      ['extension/dist/', ''],
      ['extension/THIRD-PARTY-NOTICES.txt', '한글 notice'],
      ['extension/dist/index.cjs', 'main'],
    ],
    /** 해제 결과를 관측한다. */ async (file, out) => {
      await extractZip(file, out);
      assert.equal(
        await readFile(
          path.join(out, 'extension/THIRD-PARTY-NOTICES.txt'),
          'utf8',
        ),
        '한글 notice',
      );
      assert.equal(
        await readFile(path.join(out, 'extension/dist/index.cjs'), 'utf8'),
        'main',
      );
      assert.ok((await stat(path.join(out, 'extension/dist'))).isDirectory());
    },
  );
});

test('상위 경로로 나가는 zip 항목은 해제를 거부하고 밖에 파일을 만들지 않는다', /** 거부와 부작용 없음을 확인한다. */ async () => {
  await withZip(
    [['../escape.txt', 'x']],
    /** 실패와 바깥 파일 부재를 관측한다. */ async (file, out) => {
      await assert.rejects(extractZip(file, out));
      await assert.rejects(stat(path.join(path.dirname(out), 'escape.txt')));
    },
  );
});

test('절대 경로 zip 항목은 해제를 거부한다', /** 거부를 확인한다. */ async () => {
  await withZip(
    [['/abs-escape.txt', 'x']],
    /** 실패를 관측한다. */ async (file, out) => {
      await assert.rejects(extractZip(file, out));
    },
  );
});

test('safeZipPath는 이름의 대소문자를 보존하고 탈출 경로를 모두 거부한다', /** 허용과 거부 입력을 확인한다. */ () => {
  const base = path.resolve('base');
  assert.equal(
    safeZipPath(base, 'extension/README.md'),
    path.join(base, 'extension', 'README.md'),
  );
  for (const name of [
    '../x',
    'a/../../x',
    'a\\..\\..\\x',
    '/abs',
    '\\abs',
    'C:/abs',
    '',
    '.',
  ])
    assert.throws(() => safeZipPath(base, name), /Unsafe zip entry path/u);
});

test('Windows에서는 설치된 bin이 .cmd 래퍼를 가리킨다', /** win32 규칙의 bin 경로를 확인한다. */ () => {
  assert.equal(
    installedBinPath('consumer', 'win32'),
    path.join('consumer', 'node_modules/.bin/codocs.cmd'),
  );
});

test('macOS에서는 설치된 bin이 확장자 없는 링크를 가리킨다', /** darwin 규칙의 bin 경로를 확인한다. */ () => {
  assert.equal(
    installedBinPath('consumer', 'darwin'),
    path.join('consumer', 'node_modules/.bin/codocs'),
  );
});

test('Linux에서는 설치된 bin이 확장자 없는 링크를 가리킨다', /** linux 규칙의 bin 경로를 확인한다. */ () => {
  assert.equal(
    installedBinPath('consumer', 'linux'),
    path.join('consumer', 'node_modules/.bin/codocs'),
  );
});

test('CI 환경 변수가 문자열 true이면 CI로 판단한다', /** CI 판단의 입력과 결과를 확인한다. */ () => {
  assert.equal(isCi({ CI: 'true' }), true);
});

test('CI 환경 변수가 없거나 true가 아니면 CI가 아니다', /** CI 판단의 입력과 결과를 확인한다. */ () => {
  assert.equal(isCi({}), false);
  assert.equal(isCi({ CI: 'false' }), false);
  assert.equal(isCi({ CI: '1' }), false);
});

/** 임시 저장소 루트와 임시 폴더를 만들어 VS Code 단계 시험에 넘긴다. */
async function withSmokeRoots(run) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'codocs-smoke-'));
  try {
    await run({
      root: path.join(base, 'root'),
      temporary: path.join(base, 'tmp'),
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test('CI가 아니면 VS Code를 실행하지 않고 건너뜀으로 기록한다', /** 실행기 미호출과 결과를 확인한다. */ async () => {
  await withSmokeRoots(
    /** 임시 루트에서 VS Code 단계를 실행한다. */ async (roots) => {
      let called = false;
      const result = await runVscodeSmoke({
        ...roots,
        extension: roots.root,
        env: {},
        runTests: /** 실행기 호출을 기록한다. */ async () => {
          called = true;
          return 0;
        },
      });
      assert.equal(called, false);
      assert.equal(result.status, 'skipped');
      assert.equal(result.version, vscodeVersion);
      assert.match(result.reason, /CI가 아니어서/u);
    },
  );
});

test('CI이면 고정 버전과 .workbench 아래 프로필로 VS Code를 실행하고 정리한다', /** 실행기에 넘긴 옵션과 정리를 확인한다. */ async () => {
  await withSmokeRoots(
    /** 임시 루트에서 VS Code 단계를 실행한다. */ async (roots) => {
      let options;
      const result = await runVscodeSmoke({
        ...roots,
        extension: '/extracted/extension',
        env: { CI: 'true' },
        runTests: /** 실행기에 넘어온 옵션을 기록한다. */ async (given) => {
          options = given;
          await access(given.extensionTestsPath);
          await access(given.extensionTestsEnv.CODOCS_SMOKE_SOURCE);
          return 0;
        },
      });
      assert.deepEqual(result, { status: 'passed', version: vscodeVersion });
      const base = path.join(roots.root, '.workbench/vscode-test');
      assert.equal(options.version, vscodeVersion);
      assert.equal(options.cachePath, path.join(base, 'cache'));
      assert.equal(options.extensionDevelopmentPath, '/extracted/extension');
      assert.equal(
        options.extensionTestsEnv.CODOCS_SMOKE_TARGET,
        'Smoke Target',
      );
      for (const name of ['--user-data-dir=', '--extensions-dir='])
        assert.ok(
          options.launchArgs.some((arg) =>
            arg.startsWith(name + base + path.sep),
          ),
          name,
        );
      assert.deepEqual(await readdir(base), []);
    },
  );
});

test('VS Code 실행이 실패하면 오류를 전달하고 프로필 폴더를 정리한다', /** 거부와 정리를 확인한다. */ async () => {
  await withSmokeRoots(
    /** 임시 루트에서 VS Code 단계를 실행한다. */ async (roots) => {
      await assert.rejects(
        runVscodeSmoke({
          ...roots,
          extension: roots.root,
          env: { CI: 'true' },
          runTests: /** 실행기 호출을 기록한다. */ async () => {
            throw new Error('Test run failed with code 1');
          },
        }),
        /Test run failed/u,
      );
      assert.deepEqual(
        await readdir(path.join(roots.root, '.workbench/vscode-test')),
        [],
      );
    },
  );
});

test('검증 문서는 대상 문서를 [[이름]]으로 참조한다', /** 만든 문서의 참조를 확인한다. */ async () => {
  await withSmokeRoots(
    /** 임시 루트에서 VS Code 단계를 실행한다. */ async (roots) => {
      const fixture = await createFixture(roots.temporary);
      const text = await readFile(fixture.source, 'utf8');
      assert.ok(text.includes('[[' + fixture.targetName + ']]'));
      assert.match(
        await readFile(
          path.join(fixture.project, '.codocs/target.yaml'),
          'utf8',
        ),
        /name: Smoke Target/u,
      );
    },
  );
});

/** 확장 활성화·명령·Hover 응답을 지정한 값으로 돌려주는 VS Code API 대역을 만든다. */
function fakeVscode({ active = true, commands, hover }) {
  return {
    extensions: {
      getExtension: /** 시험 대역이 값을 돌려준다. */ () => ({
        isActive: active,
        activate: /** 시험 대역이 값을 돌려준다. */ async () => {},
      }),
    },
    commands: {
      getCommands: /** 시험 대역이 값을 돌려준다. */ async () => commands,
      executeCommand: /** 시험 대역이 값을 돌려준다. */ async () => hover,
    },
    workspace: {
      openTextDocument: /** 시험 대역이 값을 돌려준다. */ async (uri) => ({
        uri,
        positionAt: /** 시험 대역이 값을 돌려준다. */ (offset) => ({ offset }),
      }),
    },
    Uri: { file: /** 시험 대역이 값을 돌려준다. */ (file) => ({ file }) },
  };
}

/** 대상 참조를 담은 원본 문서를 만들고 그 경로와 환경을 넘긴다. */
async function withSourceEnv(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codocs-suite-'));
  try {
    const fixture = await createFixture(directory);
    await run({
      CODOCS_SMOKE_SOURCE: fixture.source,
      CODOCS_SMOKE_TARGET: fixture.targetName,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** 기다리지 않고 한 번만 확인하게 하는 시간 대역이다. */
const noWait = {
  deadlineMs: 0,
  intervalMs: 0,
  wait: /** 시험 대역이 값을 돌려준다. */ async () => {},
};

test('활성화·명령·Hover가 모두 맞으면 검증이 통과한다', /** 통과를 확인한다. */ async () => {
  await withSourceEnv(
    /** 검증 문서 환경에서 검사를 실행한다. */ async (env) => {
      await suite.runChecks(
        fakeVscode({
          commands: ['codocs.restartLanguageServers'],
          hover: [{ contents: [{ value: 'Smoke Target 문서' }] }],
        }),
        env,
        noWait,
      );
    },
  );
});

test('명령이 등록되지 않았으면 검증이 실패한다', /** 실패를 확인한다. */ async () => {
  await withSourceEnv(
    /** 검증 문서 환경에서 검사를 실행한다. */ async (env) => {
      await assert.rejects(
        suite.runChecks(
          fakeVscode({
            commands: [],
            hover: [{ contents: ['Smoke Target'] }],
          }),
          env,
          noWait,
        ),
        /codocs\.restartLanguageServers/u,
      );
    },
  );
});

test('확장이 활성화되지 않았으면 검증이 실패한다', /** 실패를 확인한다. */ async () => {
  await withSourceEnv(
    /** 검증 문서 환경에서 검사를 실행한다. */ async (env) => {
      await assert.rejects(
        suite.runChecks(
          fakeVscode({
            active: false,
            commands: ['codocs.restartLanguageServers'],
            hover: [{ contents: ['Smoke Target'] }],
          }),
          env,
          noWait,
        ),
        /활성화되지 않았습니다/u,
      );
    },
  );
});

test('Hover에 대상 이름이 없으면 마감 뒤 검증이 실패한다', /** 실패를 확인한다. */ async () => {
  await withSourceEnv(
    /** 검증 문서 환경에서 검사를 실행한다. */ async (env) => {
      await assert.rejects(
        suite.runChecks(
          fakeVscode({
            commands: ['codocs.restartLanguageServers'],
            hover: [{ contents: ['다른 내용'] }],
          }),
          env,
          noWait,
        ),
        /Hover에 대상 이름이/u,
      );
    },
  );
});

test('Hover가 처음엔 비어 있다가 나타나면 마감 안에서 다시 확인해 통과한다', /** 재확인 횟수와 결과를 확인한다. */ async () => {
  let calls = 0;
  let clock = 0;
  const result = await suite.pollUntil(
    async () => (++calls >= 3 ? 'ready' : ''),
    {
      deadlineMs: 100,
      intervalMs: 10,
      now: /** 시험 대역이 값을 돌려준다. */ () => clock,
      wait: /** 시험 대역이 값을 돌려준다. */ async (ms) => {
        clock += ms;
      },
    },
  );
  assert.deepEqual(result, { ok: true, last: 'ready' });
  assert.equal(calls, 3);
});

test('Hover 내용은 문자열과 Markdown 값을 모두 이어 붙인다', /** 합친 문자열을 확인한다. */ () => {
  assert.equal(
    suite.hoverText([
      { contents: ['가'] },
      { contents: [{ value: '나' }, '다'] },
    ]),
    '가\n나\n다',
  );
});
