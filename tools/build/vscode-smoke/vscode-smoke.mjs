import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 검증에 쓰는 VS Code 안정 버전 하나다. 올릴 때 이 값만 바꾼다. */
export const vscodeVersion = '1.141.0';

/** 검증용 대상 문서의 이름이다. */
const targetName = 'Smoke Target';

/**
 * 환경이 CI인지 판단한다. GitHub Actions는 CI를 항상 'true'로 둔다.
 * @param env 환경 변수 모음. 기본값은 실행 중인 프로세스의 환경이다.
 */
export function isCi(env = process.env) {
  return env.CI === 'true';
}

/**
 * 대상 문서와 그 문서를 [[이름]]으로 참조하는 원본 문서를 가진 임시 프로젝트를 만든다.
 * @param directory 프로젝트를 만들 폴더
 * @returns 프로젝트 경로와 원본 문서 경로, 대상 이름
 */
export async function createFixture(directory) {
  const project = path.join(directory, 'smoke-project');
  const codocs = path.join(project, '.codocs');
  await mkdir(codocs, { recursive: true });
  await writeFile(
    path.join(codocs, 'target.yaml'),
    `_codocs:\n  id: smoke-target\n  name: ${targetName}\ndefinition: target\n`,
    'utf8',
  );
  const source = path.join(codocs, 'source.yaml');
  await writeFile(
    source,
    `_codocs:\n  id: smoke-source\n  name: Smoke Source\ndefinition: "[[${targetName}]]"\n`,
    'utf8',
  );
  return { project, source, targetName };
}

/**
 * VSIX를 푼 확장 폴더를 고정 버전의 실제 VS Code에서 실행해 검증한다. CI가 아니면 실행하지 않고 건너뛴 사실만 돌려준다.
 * @param options extension(푼 확장 폴더), temporary(임시 폴더), root(저장소 루트), env(환경), runTests(주입용 실행기)
 * @returns 단계 결과. status는 passed 또는 skipped이며 실패는 예외로 전달한다.
 */
export async function runVscodeSmoke(options) {
  const { extension, temporary, root, env = process.env } = options;
  if (!isCi(env))
    return {
      status: 'skipped',
      reason: 'CI가 아니어서 실제 VS Code 실행을 건너뜀',
      version: vscodeVersion,
    };
  const runTests =
    options.runTests ?? (await import('@vscode/test-electron')).runTests;
  const base = path.join(root, '.workbench/vscode-test');
  await mkdir(base, { recursive: true });
  const profile = await mkdtemp(path.join(base, 'p-'));
  try {
    const fixture = await createFixture(temporary);
    await runTests({
      version: vscodeVersion,
      cachePath: path.join(base, 'cache'),
      extensionDevelopmentPath: extension,
      extensionTestsPath: fileURLToPath(
        new URL('./suite.cjs', import.meta.url),
      ),
      extensionTestsEnv: {
        CODOCS_SMOKE_SOURCE: fixture.source,
        CODOCS_SMOKE_TARGET: fixture.targetName,
      },
      launchArgs: [
        fixture.project,
        `--user-data-dir=${path.join(profile, 'u')}`,
        `--extensions-dir=${path.join(profile, 'x')}`,
        '--disable-extensions',
        '--disable-workspace-trust',
      ],
    });
    return { status: 'passed', version: vscodeVersion };
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
