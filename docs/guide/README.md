# .codocs 작성 가이드

`@codosc/core`는 문자열을 받아 단일 YAML 문서와 최상위 매핑을 해석하고 원문·위치·진단을 제공한다. Zod 스키마 검증과 이름 참조 추출·색인·수정안 계산도 제공한다. 실제 파일 읽기·탐색과 색인 연결은 `@codosc/workspace`가 담당한다. Hover/LSP, VS Code activation, MCP 도구/stdio 연결과 실제 rename·다중 파일 저장/복구·watcher는 이번 계산 API 범위가 아니다.

가상 프로젝트 예시는 `examples/.codocs`에 있다. 예시의 업무 사실은 모두 가상이다. 각 파일은 최상위 배열이 아닌 하나의 매핑이다. term 필드는 `type/id/name/definition/domain`, knowledge 필드는 `type/id/title/body/domains`다. ID는 `^[a-z0-9]+(?:-[a-z0-9]+)*$`에 맞춰 작성한다. `validateDocument`는 필수 속성·자료형·ID 형식을 검사한다. 파서는 이를 검사하거나 누락 값을 보충하지 않는다.

```yaml
# 가상 프로젝트 예시이며 실제 업무 사실이 아니다.
type: term
id: sample-order
name: 가상 주문
definition: 가상 고객의 구매 요청이며 [[가상 주문 처리]] 절차를 따른다.
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

성공 결과의 `rootRange`는 AST에서 확인한 최상위 매핑의 값 범위다. 문서 표시와 앞뒤 독립 주석은 제외하며, 블록 매핑의 같은 줄 주석·끝 개행은 포함할 수 있다. flow 매핑 뒤 주석은 제외한다. AST 위치를 확인할 수 없으면 범위를 생략하고 원문 전체로 대체하지 않는다. 이 범위는 검증에서 최상위 누락 속성의 부모 위치로 사용한다.

공개 `getKeyRange/getValueRange/getPropertyRange`는 문자열 키·숫자 배열 인덱스의 경로로 키·값·속성 전체 범위를 조회하며 확인할 수 없는 위치는 `undefined`다. 모든 원문 범위는 0 기반 UTF-16, 시작 포함·끝 제외다. `offsetToPosition`과 진단의 외부 좌표는 0 기반 `line/character`다. 원문의 공백·주석·따옴표·줄바꿈을 정규화하지 않는다. 파싱 성공은 스키마 검증 성공이나 저장 허용이 아니며 위치 조회는 필수 속성 삭제를 허용하지 않는다.

## 이름 참조 작성

ID는 전역 유일 식별 값이며 참조 키가 아니다. `[[이름]]`은 전체 문서에서, `[[도메인:이름]]`은 지정 도메인에서 term.name/knowledge.title을 정확 비교한다. 두 종류는 통합 이름 공간이며 knowledge의 여러 도메인은 같은 발견 문서 후보 하나다. 작성 문서의 도메인 우선, trim, 대소문자 보정, ID 문자 패턴 검사는 없다. 따라서 `[[ 주문]]`은 `[[주문]]`과 다른 이름이고 `[[주문]]`은 다른 도메인에 동명이 있으면 모호하다. `deprecatedAliases`와 사용자 `aliases`는 참조 이름이 아니다.

추출은 type을 확인한 term.definition, term.examples의 문자열 원소, knowledge.body에서만 수행한다. 이름·ID·사용자 속성·다른 종류의 필드를 본문으로 추측하지 않는다. 자료형이 틀린 필드는 변환하지 않고 제외하되 정상 배열 원소는 유지한다. 스키마 오류·ID 누락/충돌에서도 확인 가능한 이름과 정상 본문을 유지한다. YAML 파싱 실패에서는 문서 정보와 참조를 추출하지 않는다.

문법은 YAML 해석 문자열 기준이다. `[[` 직전 연속 백슬래시가 홀수면 리터럴, 짝수면 참조다. 첫 비이스케이프 콜론은 도메인 구분자이며 이름/도메인 내부 콜론은 `\:`로 작성한다. YAML 단일 따옴표·블록 문자열은 백슬래시를 그대로 두지만 이중 따옴표에서는 백슬래시를 다시 escape해야 한다.

```yaml
type: knowledge
id: sample-writing
title: 가상 작성 예
body: |
  [[가상 주문]]
  [[sample-sales:가상 주문 처리]]
  \[[가상 주문]]는 연결 없는 리터럴이다.
  [[판매\:동부:주문\:확인]]은 도메인 판매:동부, 이름 주문:확인이다.
domains: [sample-sales]
```

동일 해석 문자열의 리터럴을 이중 따옴표로 쓰면 `body: "\\[[가상 주문]]"`이다. 빈 이름·도메인, 추가 비이스케이프 콜론, 남은 대괄호와 미완성 구문은 `invalid_reference`다. 원문 등장에는 반복·무효 구문도 위치와 함께 남고 메타데이터가 확인되지 않으면 추측하지 않는다. 실제 YAML UTF-16 offset/좌표와 해석 문자열 범위는 다를 수 있다.

## 후보·진단·불완전 스캔

`buildCatalog`와 `buildWorkspaceCatalog`는 문서를 프로젝트 상대 발견 경로별로 보관한다. 같은 ID나 실제 경로가 같아도 다른 발견 경로를 합치지 않는다. `duplicate_id`는 충돌의 모든 경로에, 같은 도메인의 이름 충돌은 종류와 무관하게 `duplicate_name`으로 진단한다. 다른 도메인의 동명은 허용한다. 예제의 ID는 sample-order/sample-fulfillment지만 참조는 실제 이름 `[[가상 주문]]`/`[[가상 주문 처리]]`다.

`resolveReference`는 missing/resolved/ambiguous와 자기 참조 self, 불확실한 unconfirmed를 구분한다. 확인 가능한 종류·이름·도메인·ID·경로·대상 오류를 candidates에 제공한다. 확정 오류 대상에는 연결을 유지하며 `reference_target_error` 경고를 제공한다. 같은 발견 문서의 자기 참조는 다중 도메인에서도 연결하지 않는다. 다른 문서 A↔B는 허용한다. 직접/역참조 references/referencedBy는 확정 직접 연결만 경로별 중복 제거·경로 오름차순이고 전이 연결/본문 확장은 없다. 부재·모호함·자기 참조·문법 오류·미확인은 등장/진단만 남기며 후보에 역참조를 만들지 않는다.

complete는 내용 유효성과 별개의 탐색 상태이며 확인된 부재만 삭제 근거다. partial은 새 관측을 갱신하고 실패 파일/폴더 및 모든 미관측 이전 경로를 보수적으로 unconfirmed로 유지한다. failed는 새 관측을 채택하지 않고 이전 자료와 실패 상태를 보존한다. 미탐색 신규 후보가 존재할 수 있으므로 불완전 색인의 후보 0/1개도 missing/resolved로 확정하지 않는다. 완전한 재탐색에서만 삭제·충돌·연결을 다시 확정한다.

## 이름 변경 미리보기와 저장 경계

`planRename(catalog, { targetPath, newName, updateReferences?, selections? })`는 파일을 저장하지 않는 순수 수정안이다. changes의 대상 경로·필드·실제 위치·oldText/newText·후보, conflicts, 미해결 impacts를 반환한다. 텍스트는 해석값이지 YAML raw patch가 아니며 ready/unresolved/blocked는 저장 허용 판정이 아니다.

참조 동시 변경은 기본 true이며 false도 받을 수 있다. 확정 대상과 사용자가 선택한 모호 후보를 유지하고 다른 후보를 선택한 결정도 존중한다. 기존 명시 도메인을 유지하며 새 무도메인 표기가 모호하면 도메인을 명시한다. 다중 도메인 후보는 selections.domain 선택을 받고 미선택은 미해결로 남긴다. 리터럴은 제외하며 새 이름의 같은 도메인 충돌은 전체 계획을 차단한다.

후속 writer 합의는 선택적 기존 참조 변경·후보/도메인 선택, 쓰기 불가 대상이 하나라도 있으면 전체 사전 중단, 원문이 변경되면 최신 미리보기부터 재시작, 중간 저장 실패 시 복구 시도와 실제 파일 상태 안내다. 다중 파일 원자성을 보장하지 않으며 이번 작업에서 writer/복구를 완료한 것으로 표시하지 않는다. 기존 validateDocument·MCP ID get/list·단일 codocs_write 계약은 유지한다.

개발 Prettier 검사는 저장소의 가상 예시에만 적용한다. 사용자 .codocs 저장 시 문서 전체를 재포맷하는 동작은 제공하지 않는다. 가이드와 예시는 MCP 및 VS Code의 dist asset에 복사한다. `pnpm check:build`는 dist와 pack에서 추출한 원문 일치 및 소스 없는 소비자의 공개 parser→validator→catalog 실행을 확인하지만 도구 API와 VSIX 배포 기능의 검증은 아니다.

문서 스키마의 term 선택 필드는 `examples: string[]`와 `deprecatedAliases: { name: string; message?: string }[]`이며 빈 선택 배열을 허용한다. knowledge의 `domains`는 문자열 하나 이상이어야 한다. knowledge 선택 `kind`는 `policy/procedure/decision/discussion`, `status`는 `proposed/confirmed/deprecated`다. status를 생략하면 그대로 생략하고 기본값이나 경고를 추가하지 않는다. 모든 문서 문자열은 빈 값·공백뿐인 값이 될 수 없으며 원래 대소문자와 공백을 유지한다. 알려진 속성의 null과 틀린 배열 원소는 오류다.

`validateDocument({ data, path?, source?, fields?, rootRange? })`에 전체 데이터를 넘긴다. 조회·생성·수정 후보 모두 같은 검사이며 수정 데이터의 병합은 호출자 책임이다. parser 성공 결과의 source·fields·rootRange를 함께 넘기면 값·원소 오류는 값 위치, 미등록 속성 경고는 키 위치, 필수 누락은 확인된 직접 부모 위치를 사용한다. 위치가 없으면 범위를 생략하고 데이터만 검사한다.

성공에는 `success: true`, `data: Term | Knowledge`, `errors: []`, `warnings`가 있고 실패에는 `success: false`, `errors`, `warnings`만 있다. 입력과 원문·범위를 변경하지 않는다. `missing_required_field/invalid_field_type/invalid_field_value`는 error, `unknown_field`는 warning이며 경고만 있으면 성공이다. 검사 성공은 저장 허용 판정이 아니다.

사용자 속성은 재귀 JSON 문자열·유한 숫자·boolean·null·배열·문자열 키 객체를 보존하고 미등록 키를 경고한다. 사용자 JSON 객체 내부는 업무 필드로 해석하지 않는다. `aliases`는 사용자 속성이며 이름 매칭 의미가 없다. `.nan/.inf`, undefined, 순환 등 비JSON 값을 제거하거나 변환하지 않고 실패한다. Zod 4.6.5를 정확히 고정하며 추출 타입 `Term/Knowledge/JsonValue`도 제공한다. 검증 결과는 ZodError를 반환하지 않는다.

가상 예제 원본, MCP/VS Code dist와 실제 pack에서 추출한 예제는 파일을 읽어 parser→validator 성공과 전체 데이터·ID 위치·원문 일치를 검사한다. 배포 guide도 원본과 동일해야 한다. 독립 ESM 소비자의 파일/객체 후보·입력 보존·진단 코드와 위치, `types: []`의 dist d.ts success 분기·Term/Knowledge 필드 타입, CJS bundle과 frozen 설치 fixture의 validator 실행을 검증한다. 이번 전체 기능·개발·빌드·typecheck·lint·변경 파일 서식 검증 환경은 macOS arm64 / Node 24.21.0 / pnpm 10.34.5 / yaml 2.9.1 / Zod 4.6.5다. 루트 format:check에는 변경하지 않은 `.github/workplans/COD-4.md`의 기존 서식 실패 한 건이 남는다. 실제 VS Code/Node 20 호스트·MCP 클라이언트·npm 단독 설치/게시·VSIX 시험은 포함하지 않는다.

선언 소비의 `types: []`는 Node 전역 타입 자동 추가를 차단한다. Zod 4.6.5의 외부 선언은 `URL` 전역 타입을 참조하므로 이번 `skipLibCheck: false` 독립 소비자는 `lib: [ES2022, DOM]`으로 검증한다. `lib: [ES2022]`만 사용하는 저장소와 frozen fixture의 core emit은 공통 `skipLibCheck: true`를 사용한다. DOM 없이 외부 선언까지 검사하는 소비자의 성공은 보장하지 않는다. Zod 추출 선택 필드 타입에는 undefined가 포함되지만 validator는 명시적인 undefined 입력을 허용하지 않는다.

COD-8의 소스 없는 공개 소비 시험은 `pnpm exec vitest run tools/buildChecks -t '이름 참조'`로 독립 실행한다. Windows x64 / Node 24.21.0 / pnpm 10.34.5에서 JS 값·strict NodeNext d.ts 상태 분기·고정 진단 코드 합집합·내부 subpath 거부와 실제 tarball을 링크 없이 추출한 소비자를 검사한다. 실제 보통 파일의 원문 보존·로딩·수정/이동/삭제 재색인은 확인하되 partial/failed 계산은 결정적인 입력으로 별도 검사한다. tarball은 고정 yaml/Zod 의존성을 명시적으로 복사하며 npm 설치/게시나 OS symlink·권한 실패를 대체하지 않는다. 기존 workspace tarball 파일 symlink EPERM 한 건은 별도 기존 회귀 집합으로 유지한다.
