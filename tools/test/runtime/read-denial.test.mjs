import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import denial from './read-denial.cjs';

test('현재 OS에서 읽기만 거부하고 파일 감시와 해제 뒤 원문을 보존한다', /** Windows 데이터 잠금 또는 Mac 권한 제한이 감시 등록을 방해하지 않는지 확인한다. */ async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codocs-denial-'));
  const target = path.join(root, 'document.yaml');
  await writeFile(target, 'original');
  let release;
  let watcher;
  try {
    release = await denial.denyRead(target, path.join(root, 'lock'));
    await assert.rejects(
      readFile(target),
      /** 실제 OS의 읽기 거부를 확인한다. */ (error) =>
        ['EACCES', 'EPERM', 'EBUSY'].includes(error.code),
    );
    watcher = watch(target);
    const changed = once(watcher, 'change', {
      signal: AbortSignal.timeout(5000),
    });
    await release();
    assert.equal(await readFile(target, 'utf8'), 'original');
    await writeFile(target, 'updated');
    await changed;
  } finally {
    watcher?.close();
    await release?.();
    await rm(root, { recursive: true, force: true });
  }
});

test('macOS 권한 준비는 읽기 거부를 확인하고 원래 권한으로 복원한다', /** OS 권한 호출을 대체해 Mac 경계의 상태 전이를 확인한다. */ async () => {
  const state = { mode: 0o640, marker: false };
  const target = '/fixture/document.yaml';
  const marker = '/fixture/lock';
  const io = {
    /** 기존 권한을 반환한다. */
    stat: async () => ({ mode: state.mode }),
    /** 시험 대상 권한 변경을 기록한다. */
    chmod: async (_, mode) => {
      state.mode = mode;
    },
    /** 준비 표시를 기록한다. */
    writeFile: async () => {
      state.marker = true;
    },
    /** 권한이 없을 때 실제 read 실패와 같은 오류를 반환한다. */
    readFile: async (file) => {
      if (file === target && state.mode === 0)
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      if (file !== target && !state.marker)
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return 'original';
    },
    /** 준비 표시를 정리한다. */
    rm: async () => {
      state.marker = false;
    },
  };
  const release = await denial.denyRead(target, marker, 'darwin', io);
  assert.equal(state.mode, 0);
  await release();
  assert.equal(state.mode, 0o640);
});

test('macOS에서 실제 read가 성공하면 준비 실패로 처리하고 권한을 복원한다', /** 잘못된 준비 성공을 거부하고 이전 권한을 돌려놓는지 확인한다. */ async () => {
  const state = { mode: 0o600 };
  const io = {
    /** 기존 권한을 반환한다. */
    stat: async () => ({ mode: state.mode }),
    /** 권한 변경을 기록한다. */
    chmod: async (_, mode) => {
      state.mode = mode;
    },
    /** 읽기 가능 실패 조건에는 준비 표시 내용이 필요하지 않다. */
    writeFile: async () => {},
    /** 권한 변경 뒤에도 읽기가 가능한 조건을 만든다. */
    readFile: async () => 'still readable',
    /** 준비 표시 제거를 완료한다. */
    rm: async () => {},
  };
  await assert.rejects(
    denial.denyRead('/fixture/document.yaml', '/fixture/lock', 'darwin', io),
    /실제 read 성공/u,
  );
  assert.equal(state.mode, 0o600);
});

test('macOS 준비 표시 쓰기가 실패해도 파일 권한을 즉시 복원한다', /** 권한 변경 후 실패하는 준비 단계를 확인한다. */ async () => {
  const state = { mode: 0o644 };
  const io = {
    /** 기존 권한을 반환한다. */
    stat: async () => ({ mode: state.mode }),
    /** 권한 변경과 복원을 기록한다. */
    chmod: async (_, mode) => {
      state.mode = mode;
    },
    /** 준비 표시 쓰기 실패를 만든다. */
    writeFile: async () => {
      throw new Error('marker failed');
    },
  };
  await assert.rejects(
    denial.denyRead('/fixture/document.yaml', '/fixture/lock', 'darwin', io),
    /marker failed/u,
  );
  assert.equal(state.mode, 0o644);
});

test(
  'Windows 대상 파일이 없으면 잠금 준비 실패를 반환한다',
  { skip: process.platform !== 'win32' },
  /** 생성되지 않은 대상의 잠금 준비 실패를 관측한다. */ async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'codocs-denial-missing-'),
    );
    try {
      await assert.rejects(
        denial.denyRead(
          path.join(root, 'missing.yaml'),
          path.join(root, 'lock'),
        ),
        /준비 실패/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
