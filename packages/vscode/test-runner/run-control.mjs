import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 터미널 신호와 별개로 실행 출력 폴더의 내구 요청을 감독기에 전달한다. */
export async function watchRunCancellation(output, controller, onRequest) {
  const request = path.join(output, 'cancel-run.json');
  await writeFile(
    path.join(output, 'run-control.json'),
    JSON.stringify({ pid: process.pid, cancelRequest: request }, null, 2),
  );
  /** 실행별 요청 파일이 나타나면 한 번만 취소한다. */
  const poll = () => {
    if (!controller.signal.aborted && existsSync(request)) {
      onRequest?.(request);
      controller.abort();
    }
  };
  const timer = setInterval(poll, 100);
  poll();
  /** 종료 중에는 더 이상 요청을 관측하지 않는다. */
  function stop() {
    clearInterval(timer);
  }
  return stop;
}
