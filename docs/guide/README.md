# .codocs 작성 가이드

`@codosc/core`는 문자열을 받아 단일 YAML 문서와 최상위 매핑을 해석하고 원문·위치·진단을 제공한다. 파일 읽기는 호출자의 책임이다. 스키마 검증, 참조 해석, Hover/LSP, VS Code activation, MCP 도구/stdio와 사용자 문서 저장 기능은 구현하지 않았다.

가상 프로젝트 예시는 `examples/.codocs`에 있다. 예시의 업무 사실은 모두 가상이다. 각 파일은 최상위 배열이 아닌 하나의 매핑이다. term 필드는 `type/id/name/definition/domain`, knowledge 필드는 `type/id/title/body/domains`다. ID는 `^[a-z0-9]+(?:-[a-z0-9]+)*$`에 맞춰 작성한다. 필수 속성·자료형·ID 형식의 판정은 후속 COD-6 스키마 검증의 책임이며 현재 파서는 이를 검사하거나 누락 값을 보충하지 않는다.

```yaml
# 가상 프로젝트 예시이며 실제 업무 사실이 아니다.
type: term
id: sample-order
name: 가상 주문
definition: 가상 고객의 구매 요청이며 [[sample-fulfillment]] 절차를 따른다.
domain: sample-sales
examples:
  - '가상 주문 SAMPLE-001을 생성한다.'
```

단일 `---`, 주석, 따옴표, 블록 문자열, 중첩 배열·매핑과 flow 구조를 허용한다. 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 키는 `unsupported_yaml_feature`, 일반 문법 오류와 빈 파일·주석만 있는 파일·최상위 배열/스칼라는 `invalid_yaml`로 실패한다. 실패 결과에는 원문·진단만 있고 `data/fields/rootRange`가 없다. 진단은 공통 `code/severity/message`를 사용하며 파서의 심각도는 `error`다. 호출자가 전달한 파일 경로는 `path`로 제공하고 확인되지 않은 `path/fieldPath/range`는 생략한다. 확인된 진단에는 원문 `offsetRange`도 제공한다.

```ts
import { parseYaml, getValueRange } from '@codosc/core';

const parsed = parseYaml('id: sample-order\n', 'terms.yaml');
if (parsed.success) {
  const range = getValueRange(parsed, ['id']);
  if (range) console.log(parsed.source.slice(range.start, range.end));
} else {
  console.log(parsed.diagnostics);
}
```

성공 결과의 `rootRange`는 AST에서 확인한 최상위 매핑의 값 범위다. 문서 표시와 앞뒤 독립 주석은 제외하며, 블록 매핑의 같은 줄 주석·끝 개행은 포함할 수 있다. flow 매핑 뒤 주석은 제외한다. AST 위치를 확인할 수 없으면 범위를 생략하고 원문 전체로 대체하지 않는다. 이 범위는 후속 검증에서 최상위 누락 속성의 부모 위치로 사용할 수 있다.

공개 `getKeyRange/getValueRange/getPropertyRange`는 문자열 키·숫자 배열 인덱스의 경로로 키·값·속성 전체 범위를 조회하며 확인할 수 없는 위치는 `undefined`다. 모든 원문 범위는 0 기반 UTF-16, 시작 포함·끝 제외다. `offsetToPosition`과 진단의 외부 좌표는 0 기반 `line/character`다. 원문의 공백·주석·따옴표·줄바꿈을 정규화하지 않는다. 파싱 성공은 스키마 검증 성공이나 저장 허용이 아니며 위치 조회는 필수 속성 삭제를 허용하지 않는다.

참조는 `definition`, `examples`, `body` 본문에서 `[[id]]`로 표시한다. 예제의 `sample-order`와 `sample-fulfillment` 및 서로의 참조·본문은 파싱 후에도 유지된다. 현재 파서는 이 참조를 일반 문자열로 전달한다. 후속 검증은 구조와 의미, 중복 ID 및 없는 참조를 확인해야 하며 실패 원문에서 ID·참조를 임의 검색하지 않는다.

개발 Prettier 검사는 저장소의 가상 예시에만 적용한다. 사용자 .codocs 저장 시 문서 전체를 재포맷하는 동작은 제공하지 않는다. 가이드와 예시는 MCP 및 VS Code의 dist asset에 복사한다. `pnpm check:build`는 dist와 pack에서 추출한 원문 일치 및 소스 없는 소비자의 공개 파서 실행을 확인하지만 도구 API와 VSIX 배포 기능은 아직 없다.
