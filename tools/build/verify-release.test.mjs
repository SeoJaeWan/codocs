import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { releaseFiles } from './verify-release.mjs';

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
