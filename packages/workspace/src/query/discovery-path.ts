import path from 'node:path';
import { isWin32PathModule, type PathModule } from '../paths/project-path.js';

/**
 * 조회·저장 입력의 경로를 발견 경로 표기(`/`)로 통일한다. 대소문자·Unicode·링크 뒤 ..는 보존한다.
 * `\`는 Windows 경로 규칙에서만 구분자이므로 posix 규칙에서는 파일 이름의 문자로 그대로 둔다.
 * @param pathModule 경로 규칙이다. 기본값은 실행 중인 OS다.
 */
export function discoveryPath(
  input: string,
  pathModule: PathModule = path,
): string {
  return isWin32PathModule(pathModule) ? input.replaceAll('\\', '/') : input;
}
