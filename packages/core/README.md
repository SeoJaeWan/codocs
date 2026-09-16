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

목록·상세의 필터·충돌·원문·연결 계산은 [조회 투영](../../.codocs/core/query-projection.yaml)에서 정의한다. `projectCatalogList`와 `projectCatalogGet`이 이 계산의 공개 진입점이다.
`projectCatalogGet`의 `revisions` 입력으로 IO 계층에서 확인한 원문 버전을 전달할 수 있다.

`matcher`는 `Catalog`와 코드 원문을 받아 현재 `id` 및 `deprecatedAliases[].id`를 코드 표기와 비교한다. `code`, `text`, `identifier` 중 하나를 요청 객체로 전달하거나 카탈로그와 원문을 별도 인자로 전달할 수 있다. 결과는 문서별 후보와 현재·이전 ID, exact·singular 비교 종류, UTF-16 offset 범위, 연속 토큰 수, 이전 ID의 선택 `message`를 근거로 보존한다. `name`은 문서 링크에만 사용하고 코드 매칭하지 않는다. 토큰은 ASCII 영문자·숫자와 camel/Pascal 경계를 사용하고 공백·구두점·비영어 문자에서 끊는다. 단수·복수 차이는 마지막 토큰에만 `pluralize`를 적용한다.

문자열·Unicode escape·LF/CRLF·파싱 실패의 원문 위치는 parser와 string-mapping의 인접 테스트에서 확인한다.
검증 결과·선택 속성·잘못된 입력의 보존은 validator의 인접 테스트에서 확인한다.

## 사용 경계

Node IO와 IDE/LSP/MCP SDK 없이 계산하며 AST/CST와 Zod 스키마 객체를 공개하지 않는다.
형식·진단·참조 처리의 조건은 [Core 문서 안내](../../.codocs/core/core.yaml), 모듈과 타입 작성 기준은 [코드 컨벤션](../../.codocs/development/code-convention.yaml)에서 확인한다.

## 검증

각 기능 테스트는 해당 `src/기능` 폴더에 구현과 함께 두며 입력·출력과 경계 조건의 실행 가능한 예시 역할을 한다.

```text
pnpm exec vitest run packages/core/src
pnpm typecheck
pnpm lint
pnpm check:build
```

`check:build`는 소스가 없는 별도 소비자에서 패키지 루트의 ESM JS와 strict 선언 파일을 사용하고, 내부 subpath 접근을 거부하는지 확인한다.
