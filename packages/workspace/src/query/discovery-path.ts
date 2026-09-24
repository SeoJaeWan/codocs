import path from 'node:path';

/** Windows의 두 구분자만 발견 경로 표기로 통일한다. 대소문자·Unicode·링크 뒤 ..는 보존한다. */
export function discoveryPath(input: string, separator = path.sep): string {
  return separator === '\\' ? input.replaceAll('/', separator) : input;
}
