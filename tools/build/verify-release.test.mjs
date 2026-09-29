import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import {
  extractZip,
  listZip,
  releaseFiles,
  safeZipPath,
} from './verify-release.mjs';

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
