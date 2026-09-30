/** 중복 검사 입력의 종류다. 초안은 생성·수정 요청 원본을 그대로 담는다. */
export type ClassifiedDuplicateInput =
  | { kind: 'all' }
  | { kind: 'page'; cursor: string }
  | { kind: 'draft'; request: unknown }
  | { kind: 'invalid' };

/** 공개 unknown 입력을 전체 검사·페이지 요청·초안 검사로 구분한다. getter와 prototype 값은 실행하지 않는다. */
export function classifyDuplicateInput(
  input: unknown,
): ClassifiedDuplicateInput {
  if (input === undefined || input === null) return { kind: 'all' };
  if (typeof input !== 'object' || Array.isArray(input))
    return { kind: 'invalid' };
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(input);
  } catch {
    return { kind: 'invalid' };
  }
  if (keys.length === 0) return { kind: 'all' };
  const cursor = Object.getOwnPropertyDescriptor(input, 'cursor');
  if (cursor) {
    return keys.length === 1 &&
      'value' in cursor &&
      typeof cursor.value === 'string'
      ? { kind: 'page', cursor: cursor.value }
      : { kind: 'invalid' };
  }
  const mode = Object.getOwnPropertyDescriptor(input, 'mode');
  if (mode) return { kind: 'draft', request: input };
  return { kind: 'invalid' };
}
