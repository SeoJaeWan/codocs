import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import denial from './read-denial.cjs';

test('지원하지 않는 OS에서 읽기 거부를 준비하면 미지원 OS 오류로 거부한다', /** 주입한 platform이 지원 목록에 없을 때의 실패를 확인한다. */ async () => {
  await assert.rejects(
    denial.denyRead('/fixture/document.yaml', '/fixture/lock', 'linux', {}),
    /읽기 거부 fixture 미지원 OS: linux/u,
  );
});

test('macOS에서 읽기 거부를 해제하면 원문을 보존하고 준비 표시를 정리한다', /** 권한 제한 동안 준비 표시가 기록되고 해제 뒤 원문이 그대로인지 확인한다. */ async () => {
  const target = '/fixture/document.yaml';
  const marker = '/fixture/lock';
  const state = { mode: 0o640, content: 'original', files: new Set() };
  const io = {
    /** 기존 권한을 반환한다. */
    stat: async () => ({ mode: state.mode }),
    /** 권한 변경을 기록한다. */
    chmod: async (_, mode) => {
      state.mode = mode;
    },
    /** 준비 표시 파일을 기록한다. */
    writeFile: async (file) => {
      state.files.add(file);
    },
    /** 권한이 없는 대상은 EACCES로, 표시 파일은 존재 여부로 응답한다. */
    readFile: async (file) => {
      if (file === target) {
        if (state.mode === 0)
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return state.content;
      }
      if (!state.files.has(file))
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return '';
    },
    /** 표시 파일을 제거한다. */
    rm: async (file) => {
      state.files.delete(file);
    },
  };
  const release = await denial.denyRead(target, marker, 'darwin', io);
  assert.ok(state.files.has(marker + '-ready'));
  await release();
  assert.equal(await io.readFile(target), 'original');
  assert.equal(state.files.size, 0);
});

test('Windows에서 잠금 프로세스가 준비 표시를 남기면 읽기를 거부하고 해제 시 프로세스를 종료하며 원문을 보존한다', /** 주입한 PowerShell 프로세스와 파일 호출로 Windows 잠금 성공 경로를 확인한다. */ async () => {
  const target = 'C:\\fixture\\document.yaml';
  const marker = 'C:\\fixture\\lock';
  const state = { locked: false, content: 'original', files: new Set() };
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  /** 강제 종료 요청을 기록한다. */
  child.kill = () => {
    child.killed = true;
  };
  const io = {
    systemRoot: 'C:\\Windows',
    /** 잠금을 잡고 준비 표시를 남긴 PowerShell 프로세스를 대신한다. */
    spawn: () => {
      state.locked = true;
      state.files.add(marker + '-ready');
      return child;
    },
    /** 잠긴 동안 대상은 EBUSY로, 표시 파일은 존재 여부로 응답한다. */
    readFile: async (file) => {
      if (file === target) {
        if (state.locked)
          throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        return state.content;
      }
      if (!state.files.has(file))
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return '';
    },
    /** 해제 표시를 받으면 프로세스가 잠금을 풀고 종료한 것으로 처리한다. */
    writeFile: async (file) => {
      state.files.add(file);
      if (file === marker + '-release') {
        state.locked = false;
        child.exitCode = 0;
        setImmediate(() => child.emit('close'));
      }
    },
    /** 표시 파일을 제거한다. */
    rm: async (file) => {
      state.files.delete(file);
    },
  };
  const release = await denial.denyRead(target, marker, 'win32', io);
  assert.equal(state.locked, true);
  await release();
  assert.equal(state.locked, false);
  assert.equal(child.killed, false);
  assert.equal(await io.readFile(target), 'original');
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

test('Windows 대상 파일이 없어 잠금 프로세스가 먼저 끝나면 잠금 준비 실패를 반환한다', /** 주입한 프로세스 종료로 준비 실패를 관측한다. */ async () => {
  const spawned = [];
  const files = new Set();
  const io = {
    systemRoot: 'C:\\Windows',
    /** 대상 파일이 없다는 오류를 내고 종료한 PowerShell 프로세스를 대신한다. */
    spawn: (command, args) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 1;
      child.exitCode = 1;
      child.signalCode = null;
      /** 이미 종료한 프로세스라 종료할 것이 없다. */
      child.kill = () => {};
      spawned.push({ command, args });
      return child;
    },
    /** 준비 표시가 만들어지지 않은 상태를 만든다. */
    readFile: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    /** 해제 표시 기록을 관측한다. */
    writeFile: async (file) => {
      files.add(file);
    },
    /** 정리 호출을 받아들인다. */
    rm: async () => {},
  };
  await assert.rejects(
    denial.denyRead(
      'C:\\fixture\\missing.yaml',
      'C:\\fixture\\lock',
      'win32',
      io,
    ),
    /준비 실패/u,
  );
  assert.equal(spawned.length, 1);
  assert.match(spawned[0].command, /powershell\.exe$/u);
  assert.ok(spawned[0].args.includes('C:\\fixture\\missing.yaml'));
  assert.ok(files.has('C:\\fixture\\lock-release'));
});
