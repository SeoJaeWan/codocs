import path from 'node:path';

/** Error의 비열거 속성도 실패 증거에 남긴다. */
export function errorRecord(error, stage) {
  return {
    stage,
    name: error.name,
    message: error.message ?? String(error),
    stack: error.stack,
  };
}

/** 화면/trace 실패가 원래 오류를 가리거나 다음 증거 수집을 막지 않게 한다. */
export async function captureEvidence({
  page,
  tracing,
  failed,
  output,
  attach,
  errors,
}) {
  if (failed && page && !page.isClosed()) {
    try {
      const file = path.join(output, 'screen.png');
      await page.screenshot({ path: file, timeout: 10000 });
      await attach('UI screen', { path: file, contentType: 'image/png' });
    } catch (error) {
      errors.push(errorRecord(error, 'screenshot'));
    }
  }
  if (tracing) {
    try {
      const file = path.join(output, 'trace.zip');
      await tracing.stop(failed ? { path: file } : {});
      if (failed)
        await attach('UI trace', {
          path: file,
          contentType: 'application/zip',
        });
    } catch (error) {
      errors.push(errorRecord(error, 'trace'));
    }
  }
}
