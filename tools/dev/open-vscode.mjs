import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * VS Code CLI는 `--extensionDevelopmentPath`를 Windows에서 현재 폴더가 아닌 드라이브 루트 기준으로
 * 해석하므로, 개발용 창에 넘기는 경로를 모두 절대 경로로 바꿔 공식 `code` 명령 인자로 만든다.
 * @param {string} repository 저장소 루트의 절대 경로
 * @param {NodeJS.Platform} platform 실행 중인 운영체제
 * @returns {{ command: string, args: string[], shell: boolean }} 실행할 명령, 인자 배열, 셸 사용 여부
 */
export function createCodeInvocation(repository, platform = process.platform) {
  const manual = path.resolve(repository, '.workbench/vscode-manual');
  const args = [
    '--new-window',
    `--user-data-dir=${path.join(manual, 'user-data')}`,
    `--extensions-dir=${path.join(manual, 'extensions')}`,
    `--extensionDevelopmentPath=${path.resolve(repository, 'packages/vscode')}`,
    path.resolve(repository),
  ];
  if (platform !== 'win32') return { command: 'code', args, shell: false };
  // Windows의 code는 code.cmd이므로 셸이 필요하다. 셸은 인자를 이어 붙이므로 공백 경로를 직접 인용하고,
  // 인자 배열과 shell 옵션을 함께 쓸 때의 Node 경고를 피하려고 완성된 명령 문자열 하나로 넘긴다.
  const quoted = args.map((arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg));
  return { command: ['code', ...quoted].join(' '), args: [], shell: true };
}

/** 저장소 루트를 기준으로 개발용 VS Code 창을 열고 `code`의 종료 코드로 종료한다. */
function main() {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const { command, args, shell } = createCodeInvocation(repository);
  const child = spawn(command, args, { stdio: 'inherit', shell });
  child.on('error', (error) => {
    console.error(`code 명령을 실행하지 못했습니다: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
