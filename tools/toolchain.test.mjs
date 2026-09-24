import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { resolvePnpm } from './toolchain.mjs';

/** Windows wrapper 옆의 공식 Node 진입점을 실제 프로세스로 탐색한다. */
async function verifyNativeWrapper(t) {
  const parent = path.resolve('.workbench/pnpm-discovery');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'bin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@10.34.5' }),
  );
  const bin = path.join(directory, 'node_modules/pnpm/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(directory, 'pnpm'), '#!/bin/sh\nexit 1\n');
  const cli = path.join(bin, 'pnpm.mjs');
  await writeFile(
    path.join(bin, '../package.json'),
    JSON.stringify({ name: 'pnpm', version: '10.34.5' }),
  );
  await writeFile(cli, 'process.stdout.write("10.34.5");');
  assert.equal(resolvePnpm({ PATH: directory }, directory), cli);
  await writeFile(cli, 'process.stdout.write("0.0.0");');
  assert.throws(
    () => resolvePnpm({ PATH: directory }, directory),
    /10.34.5를 찾을 수 없습니다/,
  );
}
test(
  'pnpm native wrapper를 Node로 실행할 수 없으면 인접 공식 진입점을 찾고 버전을 검증한다',
  verifyNativeWrapper,
);

/** 다른 pnpm 패키지가 프로젝트 버전을 출력해도 실제 패키지 버전으로 거부한다. */
async function verifyMisleadingVersion(t) {
  const parent = path.resolve('.workbench/pnpm-discovery');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'wrong-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'node_modules/pnpm/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@10.34.5' }),
  );
  await writeFile(
    path.join(bin, '../package.json'),
    JSON.stringify({ name: 'pnpm', version: '12.5.1' }),
  );
  await writeFile(
    path.join(bin, 'pnpm.mjs'),
    'process.stdout.write("10.34.5");',
  );
  assert.throws(
    () => resolvePnpm({ PATH: directory }, directory),
    /10.34.5를 찾을 수 없습니다/,
  );
}
test(
  '다른 버전 pnpm이 프로젝트 버전을 출력하면 준비 실패로 처리한다',
  verifyMisleadingVersion,
);
