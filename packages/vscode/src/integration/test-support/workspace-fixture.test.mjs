import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixtureFiles } from './fixtures.mjs';
import {
  createWorkspaceFixture,
  restoreWorkspaceFixture,
} from './workspace-fixture.mjs';

test('기능 사례 뒤 변경된 파일만 복원하고 읽기 거부 파일은 보존한다', /** 기능 사례가 바꾼 파일만 원래 내용으로 복원한다. */ async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-vscode-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = fixtureFiles();
  await createWorkspaceFixture(root);
  const unchanged = path.join(root, '.codocs/direct.yaml');
  const before = await stat(unchanged);
  await writeFile(path.join(root, '.codocs/zone.yaml'), 'modified');
  await rm(path.join(root, '.codocs/source.yaml'));
  await writeFile(path.join(root, '.codocs/moved.yaml'), 'temporary');
  await writeFile(path.join(root, '.codocs/closed-a.yaml'), 'temporary');
  await writeFile(path.join(root, '.codocs/mcp-moved.yaml'), 'temporary');
  await restoreWorkspaceFixture(root);
  const after = await stat(unchanged);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(
    await readFile(path.join(root, '.codocs/zone.yaml'), 'utf8'),
    files['.codocs/zone.yaml'],
  );
  assert.equal(
    await readFile(path.join(root, '.codocs/source.yaml'), 'utf8'),
    files['.codocs/source.yaml'],
  );
  await assert.rejects(readFile(path.join(root, '.codocs/moved.yaml')), {
    code: 'ENOENT',
  });
  await assert.rejects(readFile(path.join(root, '.codocs/closed-a.yaml')), {
    code: 'ENOENT',
  });
  await assert.rejects(readFile(path.join(root, '.codocs/mcp-moved.yaml')), {
    code: 'ENOENT',
  });
  assert.equal(
    await readFile(path.join(root, 'partial/.codocs/unreadable.yaml'), 'utf8'),
    files['partial/.codocs/unreadable.yaml'],
  );
});
