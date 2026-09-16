# core

`@codocs/core`는 파일 IO 없이 `.codocs` YAML을 파싱·검증하고 이름 참조·색인·조회 결과를 계산한다. 실제 프로젝트 선택, 파일 읽기와 저장은 `@codocs/workspace` 또는 후속 어댑터가 담당한다.

공개 진입점은 `src/index.ts` 하나다. 각 기능의 공개 타입과 함수는 이 파일을 통해 패키지 루트에서 재내보낸다. 내부 폴더 subpath를 직접 import하지 않는다.

## 기능과 사용처

| 기능·진입 파일                                | 역할                                                                     | 주요 제공 값                                         | 사용하는 곳                                         |
| --------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------- |
| [diagnostics](src/diagnostics/index.ts)       | 공통 진단의 코드·문구·심각도와 원문 좌표 계약을 정의한다.                | 공통 진단 코드·문구·위치 타입                        | core의 모든 기능, `workspace/diagnostics`           |
| [parser](src/parser/index.ts)                 | YAML 원문을 읽어 구조와 진단을 만들고 필드의 원문 위치를 찾는다.         | `parseYaml`, 필드·문자열 범위 조회, offset 좌표 변환 | workspace loader, validator, references, catalog    |
| [string-mapping](src/string-mapping/index.ts) | YAML escape·줄 접기를 해석한 문자열을 원문 위치에 대응시킨다.            | 해석 문자열과 YAML 원문 위치 연결                    | parser 내부의 `parseYaml`                           |
| [validator](src/validator/index.ts)           | 외부 문서의 구조와 값을 검증하고 원래 사용자 데이터를 보존한다.          | `validateDocument`, `Document`, `JsonValue`          | workspace loader, catalog                           |
| [references](src/references/index.ts)         | 본문과 예시에서 이름 참조의 등장 위치와 문법 오류를 추출한다.            | `extractReferences`, 참조 등장·문법 진단             | catalog                                             |
| [catalog](src/catalog/index.ts)               | 경로별 문서를 색인하고 참조 대상·충돌과 이름 변경 수정안을 계산한다.     | `buildCatalog`, `resolveReference`, `planRename`     | workspace indexing, 후속 LSP/MCP/UI와 rename writer |
| [query](src/query/index.ts)                   | Catalog를 목록·상세 조회 결과로 변환하고 ID 충돌과 참조 진단을 구성한다. | `projectCatalogList`, `projectCatalogGet`            | workspace 조회 세션, 후속 MCP 어댑터                |
| [matcher](src/matcher/index.ts)               | 코드 원문에서 현재·이전 문서 ID를 찾아 후보와 근거를 계산한다.           | `matchCode`, `matchIdentifier`, `tokenizeCode`       | 후속 IDE/LSP·MCP·코드 탐색 어댑터                   |

## 파일별 역할

- `src/index.ts`: 외부에 제공할 API와 타입을 패키지 루트에서 재내보낸다.
- `src/기능/index.ts`: 위 표의 기능을 구현하고 관련 타입을 정의한다.
- `src/기능/domain-values.ts`: 해당 기능의 상태·사유 값을 설명 있는 상수로 정의하고 타입을 도출한다. 문서 필드는 validator의 스키마 원본에서 도출한다.
- `src/기능/*.test.ts`: 입력·출력·분기·경계 조건을 검증하는 실행 가능한 예시다.

## 호출 흐름

```text
workspace loader
  ├─ parseYaml
  │    └─ collectStringMappings
  └─ validateDocument
       ↓
workspace indexing
  └─ buildCatalog
       ├─ validateDocument
       ├─ extractReferences
       │    └─ getStringRange
       └─ resolveReference

workspace query
  ├─ projectCatalogList
  └─ projectCatalogGet
       └─ 확정 직접 경로를 유효하고 유일한 ID로 투영

후속 어댑터
  ├─ query 결과에 scanStatus·page·cursor 연결
  └─ planRename
```

`planRename`의 결과는 저장할 위치와 해석값을 계산한 미리보기다. YAML 표기 보존, 쓰기 가능 여부, 최신 원문 확인, 다중 파일 저장과 복구는 후속 writer의 책임이다.

## 구현 연결

parser는 `yaml`의 구조·위치·토큰 정보를 사용하고, string-mapping은 해석한 문자열과 실제 원문 구간의 대응을 계산한다.
validator는 Zod 스키마에서 `Document` 타입을 추출한다. 두 기능 모두 파일을 직접 읽지 않으며 loader가 전달한 입력을 처리한다.

query는 Catalog와 호출자 입력을 바꾸지 않고 목록과 상세 결과를 만든다. 목록 필터는 한 파일에서 `domain`·`kind`·`status`를 모두 만족해야 하며, 중복 ID는 대표 문서를 고르지 않고 정렬한 모든 경로만 제공한다. 상세 조회는 첫 등장 순서로 중복 제거한 1~20개 ID를 독립적으로 처리한다. JSON으로 표현할 수 없는 오류 문서는 값을 바꾸는 대신 전체 `rawYaml`을 반환한다.

`matcher`는 `Catalog`와 코드 원문을 받아 현재 `id` 및 `deprecatedAliases[].id`를 코드 표기와 비교한다. `code`, `text`, `identifier` 중 하나를 요청 객체로 전달하거나 카탈로그와 원문을 별도 인자로 전달할 수 있다. 결과의 `candidates`에는 문서별 경로·문서 링크용 `name`·도메인·확인 상태와 모든 `evidence`가 들어가며, 각 근거는 현재·이전 ID, exact·singular 비교 종류, 원문 UTF-16 offset 범위, 토큰 수와 이전 ID의 선택적 `message`를 보존한다. 결과 최상위에도 근거와 진단·실패·`partial`·`status`를 제공하므로 부분 색인에서 확인한 후보를 버리지 않는다. `name`은 문서 링크용 값이며 코드 매칭에 사용하지 않는다. 토큰은 ASCII 영문자·숫자 식별자와 camel/Pascal 경계를 사용하고 공백·구두점·비영어 문자에서 끊는다. 단수·복수 차이는 마지막 토큰에만 `pluralize` 보조 규칙을 적용한다.

`references`와 `referencedBy`는 Catalog가 확정한 직접 경로 가운데 유효한 ID가 전역에서 유일한 문서만 ID 오름차순으로 제공한다. 대상 없음에는 경로를 만들지 않고, 모호한 대상에는 모든 후보 경로를, ID 누락·오류·중복에는 확정한 한 경로와 원인을 진단으로 제공한다. 본문과 참조 목록에는 응답 크기에 따른 절단이나 요약을 적용하지 않는다.

원문 revision은 IO 계층이 계산한다. `projectCatalogGet`의 `revisions` 선택 입력으로 같은 시점의 경로별 값을 전달할 수 있으며 core는 revision 상태를 보관하지 않는다.

문자열·Unicode escape·LF/CRLF·파싱 실패의 원문 위치는 parser와 string-mapping의 인접 테스트에서 확인한다.
검증 결과·선택 속성·잘못된 입력의 보존은 validator의 인접 테스트에서 확인한다.

## 패키지 계약

- Node 내장 모듈과 IDE/LSP/MCP SDK에 의존하지 않는다.
- 직접 의존성은 정확히 고정한 `pluralize@8.0.0`, `yaml@2.9.1`, `zod@4.6.5`다.
- ESM JS와 선언 파일을 `dist`에 생성한다.
- strict, ES2022, NodeNext, 상대 `.js` import와 `types: []`를 유지한다.
- AST/CST와 Zod 스키마 객체는 공개하지 않는다.
- 위치는 0 기반 UTF-16, 시작 포함·끝 제외다. 확인하지 못한 위치는 추측하지 않는다.
- 파싱·검증·색인·rename 계획의 성공은 파일 저장 허용을 의미하지 않는다.

## 검증

각 기능 테스트는 해당 `src/기능` 폴더에 구현과 함께 두며 입력·출력과 경계 조건의 실행 가능한 예시 역할을 한다.

```text
pnpm exec vitest run packages/core/src
pnpm typecheck
pnpm lint
pnpm check:build
```

`check:build`는 소스가 없는 별도 소비자에서 패키지 루트의 ESM JS와 strict 선언 파일을 사용하고, 내부 subpath 접근을 거부하는지 확인한다.
