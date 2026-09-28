/** 저장 결과 객체에만 연결하는 내부 원문이다. 공개 응답의 필드로 직렬화하지 않는다. */
export interface SavedChangeContext {
  path: string;
  baseRevision?: string;
  before?: {
    raw: string;
    revision: string;
    name: string;
    domains: readonly string[];
  };
  after: { raw: string; name: string; domains: readonly string[] };
}
const contexts = new WeakMap<object, SavedChangeContext>();
/** 실제 파일 반영이 확인된 결과에 비교 자료를 연결한다. */
export function retainSavedChangeContext(
  result: object,
  context: SavedChangeContext,
): void {
  contexts.set(result, context);
}
/** 같은 저장 호출의 결과에서만 비교 자료를 한 번 소비한다. */
export function takeSavedChangeContext(
  result: object,
): SavedChangeContext | undefined {
  const context = contexts.get(result);
  contexts.delete(result);
  return context;
}
