/** 자식 종료 관측에 필요한 최소 Node 프로세스 경계다. */
interface ChildBoundary {
  exitCode: number | null;
  signalCode: string | null;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

/** spawn 직후 close를 구독하여 exit·kill 요청과 실제 stdio 종료를 구분한다. */
export function trackChildClosure(child: ChildBoundary): {
  completion: Promise<void>;
  stop(): Promise<void>;
} {
  let closed = false;
  const completion = new Promise<void>(
    /** 종료 이벤트 또는 실행 실패를 관측한다. */ (resolve, reject) => {
      child.once('close', () => {
        closed = true;
        resolve();
      });
      child.once('error', reject);
    },
  );
  // 준비 실패가 먼저 발생해도 종료를 기다리는 호출 전까지 미처리 rejection을 만들지 않는다.
  completion.catch(() => undefined);
  return {
    completion,
    /** 종료를 요청한 뒤 이미 발생했거나 앞으로 발생할 close까지 기다린다. */
    async stop() {
      if (!closed && child.exitCode === null && child.signalCode === null)
        child.kill('SIGTERM');
      await completion;
    },
  };
}
