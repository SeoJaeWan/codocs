import { spawnSync } from 'node:child_process';

/** CI 전용 경계 검사는 로컬 실행이나 지원하지 않는 호스트를 성공으로 처리하지 않는다. */
export function assertEnvironmentHost(
  env = process.env,
  platform = process.platform,
) {
  if (env.CI !== 'true')
    throw new Error(
      'ENVIRONMENT_PREPARATION_FAILED: test:environment는 CI에서만 실행합니다.',
    );
  if (!['win32', 'darwin'].includes(platform))
    throw new Error(
      'ENVIRONMENT_PREPARATION_FAILED: Windows 또는 macOS runner가 필요합니다.',
    );
}

/** 준비 명령의 실제 종료 상태를 검사한다. 권한 부족도 준비 실패다. */
export function preparationCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      'ENVIRONMENT_PREPARATION_FAILED: ' +
        command +
        ': ' +
        (result.error?.message ?? result.stderr),
    );
  return result.stdout.trim();
}
