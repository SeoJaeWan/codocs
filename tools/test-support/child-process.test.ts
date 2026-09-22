import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { osContracts } from './os-contracts.js';
import { trackChildClosure } from './child-process.js';

describe.each(osContracts)('$platform 자식 종료 경계', (contract) => {
  it('kill과 exit가 발생해도 stdio close 전에는 정리를 완료하지 않는다', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn(),
    });
    const lifecycle = trackChildClosure(child);
    let cleaned = false;
    const stopping = lifecycle.stop().then(() => {
      cleaned = true;
    });
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    child.exitCode = contract.exitCode;
    child.signalCode = contract.signal;
    child.emit('exit', child.exitCode, child.signalCode);
    await Promise.resolve();
    expect(cleaned).toBe(false);
    child.emit('close', child.exitCode, child.signalCode);
    await stopping;
    expect(cleaned).toBe(true);
  });

  it('이미 close한 자식을 다시 정리하면 kill 없이 종료한다', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn(),
    });
    const lifecycle = trackChildClosure(child);
    child.exitCode = 0;
    child.emit('close', 0, null);
    await lifecycle.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('spawn 오류가 발생하면 원래 실패를 정리 호출에 전달한다', async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn(),
    });
    const lifecycle = trackChildClosure(child);
    const failure = Object.assign(new Error('실행 파일 없음'), {
      code: contract.platform === 'win32' ? 'ENOENT' : 'EACCES',
    });
    child.emit('error', failure);
    await expect(lifecycle.stop()).rejects.toBe(failure);
  });
});
