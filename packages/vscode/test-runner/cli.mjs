import { readFile } from 'node:fs/promises';
import { scenarioNames } from '../../../tools/test/runtime/performance-contract.mjs';
import { vscodeVersion } from '../../../tools/test/runtime/vscode.mjs';

const exactVersion = /^\d+\.\d+\.\d+$/u;
const stableReleases =
  'https://update.code.visualstudio.com/api/releases/stable?released=true';

/** 인자 누락·중복·잘못된 조합은 빌드나 다운로드 전에 거부한다. */
export function parseRunnerArgs(args) {
  const options = {
    mode: 'functional',
    version: vscodeVersion,
    scenario: 'all',
    config: null,
    resolveVersion: null,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      ![
        '--mode',
        '--vscode-version',
        '--scenario',
        '--config',
        '--resolve-version',
      ].includes(flag) ||
      value == null ||
      value.startsWith('--')
    )
      throw new Error(
        `지원하지 않거나 값이 없는 옵션: ${args.slice(index).join(' ')}`,
      );
    if (seen.has(flag)) throw new Error(`중복 옵션: ${flag}`);
    seen.add(flag);
    if (flag === '--mode') options.mode = value;
    if (flag === '--vscode-version') options.version = value;
    if (flag === '--scenario') options.scenario = value;
    if (flag === '--config') options.config = value;
    if (flag === '--resolve-version') options.resolveVersion = value;
  }
  if (!['functional', 'performance'].includes(options.mode))
    throw new Error(`지원하지 않는 모드: ${options.mode}`);
  if (!exactVersion.test(options.version))
    throw new Error('VS Code 버전은 정확한 x.y.z여야 합니다');
  if (options.resolveVersion) {
    if (options.resolveVersion !== 'stable' || seen.size !== 1)
      throw new Error('--resolve-version stable은 단독으로 사용해야 합니다');
    return options;
  }
  if (
    options.mode === 'functional' &&
    (seen.has('--scenario') || seen.has('--config'))
  )
    throw new Error(
      '시나리오와 설정 파일은 성능 모드에서만 선택할 수 있습니다',
    );
  if (
    options.mode === 'performance' &&
    options.scenario !== 'all' &&
    !scenarioNames.includes(options.scenario)
  )
    throw new Error(`알 수 없는 시나리오: ${options.scenario}`);
  return options;
}

/** 공식 stable 출시 목록에서 실행에 고정할 한 버전만 돌려준다. */
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

/** 선택 설정을 제한된 스키마로 검증한다. */
export async function readPerformanceConfig(filename) {
  if (!filename) return {};
  const value = JSON.parse(await readFile(filename, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw new Error('성능 설정은 JSON 객체여야 합니다');
  const allowed = new Set([
    'seed',
    'apiWarmup',
    'propagationPollMs',
    'targets',
    'changeReason',
  ]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`알 수 없는 성능 설정: ${key}`);
  for (const key of ['seed', 'apiWarmup', 'propagationPollMs']) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || value[key] < 0)
    )
      throw new Error(`성능 설정 ${key}는 0 이상의 정수여야 합니다`);
  }
  if (value.targets !== undefined) {
    if (
      !value.targets ||
      Array.isArray(value.targets) ||
      typeof value.targets !== 'object'
    )
      throw new Error('targets는 객체여야 합니다');
    for (const [name, count] of Object.entries(value.targets))
      if (
        !scenarioNames.includes(name) ||
        !Number.isSafeInteger(count) ||
        count < 1
      )
        throw new Error(`시나리오 표본 수가 잘못되었습니다: ${name}`);
  }
  if (
    value.propagationPollMs !== undefined &&
    value.propagationPollMs !== 50 &&
    !value.changeReason
  )
    throw new Error('조회 간격 변경에는 changeReason이 필요합니다');
  return value;
}
