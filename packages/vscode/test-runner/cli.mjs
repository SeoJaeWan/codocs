const exactVersion = /^\d+\.\d+\.\d+$/u;
const stableReleases =
  'https://update.code.visualstudio.com/api/releases/stable?released=true';

/** 공식 stable 출시 목록에서 CI 실행에 고정할 한 버전만 돌려준다. */
export async function resolveStableVersion(fetcher = fetch) {
  const response = await fetcher(stableReleases, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`VS Code stable 버전 조회 실패: HTTP ${response.status}`);
  const versions = await response.json();
  if (!Array.isArray(versions) || !exactVersion.test(versions[0]))
    throw new Error('공식 stable 버전 응답이 정확한 버전 목록이 아닙니다');
  return versions[0];
}
