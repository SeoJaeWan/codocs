import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { bundledNotices } from './notices.mjs';

/** 임시 폴더에 번들 입력 하나를 가진 패키지와 원문 대체 폴더를 만든다. */
async function project(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-notices-'));
  const directory = path.join(root, 'node_modules/sample');
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(root, 'fallback'));
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: 'sample', version: '1.0.0', license: 'MIT' }),
  );
  await writeFile(path.join(directory, 'index.js'), '');
  for (const [name, text] of Object.entries(files))
    await writeFile(path.join(root, name), text);
  return {
    root,
    fallback: path.join(root, 'fallback'),
    metafile: { inputs: { 'node_modules/sample/index.js': {} } },
  };
}

test('패키지에 라이선스 원문이 있으면 그 원문을 고지에 담는다', /** 패키지의 원문을 대체 원문보다 먼저 쓰는지 확인한다. */ async () => {
  const { root, fallback, metafile } = await project({
    'node_modules/sample/LICENSE': 'package license\n',
    'fallback/sample@1.0.0.txt': 'fallback license\n',
  });
  try {
    assert.equal(
      await bundledNotices(metafile, root, fallback),
      'sample@1.0.0 (MIT)\n\n---\n\npackage license\n\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('패키지에 라이선스 원문이 없으면 대체 폴더의 이름@버전 원문을 고지에 담는다', /** 원문 없는 패키지의 대체 원문을 확인한다. */ async () => {
  const { root, fallback, metafile } = await project({
    'fallback/sample@1.0.0.txt': 'fallback license\n',
  });
  try {
    assert.equal(
      await bundledNotices(metafile, root, fallback),
      'sample@1.0.0 (MIT)\n\n---\n\nfallback license\n\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('패키지에도 대체 폴더에도 그 버전의 원문이 없으면 실패한다', /** 다른 버전의 대체 원문을 쓰지 않는지 확인한다. */ async () => {
  const { root, fallback, metafile } = await project({
    'fallback/sample@0.9.0.txt': 'old license\n',
  });
  try {
    await assert.rejects(
      bundledNotices(metafile, root, fallback),
      /번들 의존성 라이선스 원문 누락: sample@1\.0\.0/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
