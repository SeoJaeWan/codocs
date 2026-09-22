import { formatIndex } from './format-index.mjs';
import { assertNodeVersion, resolvePnpm, root } from './runtime.mjs';
import { checkStaged, runNode } from './staged.mjs';

const controller = new AbortController();
/** 취소를 기록하되 lint-staged 복원과 실행 중인 검사 정리를 기다린다. */
function cancel() {
  controller.abort(new Error('커밋 검사가 취소되었습니다.'));
  console.error(
    '커밋 취소: 실행 중인 단계의 복원·정리가 끝날 때까지 기다립니다.',
  );
}
/** SIGTERM도 lint-staged의 SIGINT 복원 경로로 전달한다. */
function terminate() {
  process.emit('SIGINT');
}
process.on('SIGINT', cancel);
process.on('SIGTERM', terminate);
try {
  assertNodeVersion();
  const pnpm = resolvePnpm();
  await checkStaged({
    root,
    signal: controller.signal,
    /** 스테이징 파일의 서식과 lint를 자동 수정한다. */
    format: () => formatIndex({ cwd: root }),
    /** 복사본에 의존성을 준비한 뒤 기능과 실제 VS Code를 검사한다. */
    verify: async (snapshot, signal) => {
      await runNode(snapshot, [pnpm, 'install', '--frozen-lockfile']);
      signal.throwIfAborted();
      await runNode(snapshot, ['tools/check/run.mjs', 'test:run']);
      signal.throwIfAborted();
      await runNode(snapshot, ['tools/vscode-tests/run.mjs']);
    },
  });
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', terminate);
}
