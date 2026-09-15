# core

`@codosc/core`는 파일 IO 없이 `.codocs` YAML을 파싱·검증하고 이름 참조와 색인을 계산한다. 실제 프로젝트 선택, 파일 읽기와 저장은 `@codosc/workspace` 또는 후속 어댑터가 담당한다.

공개 진입점은 `src/index.ts` 하나다. 각 기능의 공개 타입과 함수는 이 파일을 통해 패키지 루트에서 재내보낸다. 내부 폴더 subpath를 직접 import하지 않는다.

## 기능과 사용처

| 기능                                        | 제공 값                                              | 이 기능을 사용하는 곳                               |
| ------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| [diagnostics](src/diagnostics/index.ts)     | 공통 진단 코드·문구·위치 타입                        | core의 모든 기능, `workspace/diagnostics`           |
| [parser](src/parser/index.ts)               | `parseYaml`, 필드·문자열 범위 조회, offset 좌표 변환 | workspace loader, validator, references, catalog    |
| [stringMapping](src/stringMapping/index.ts) | 해석 문자열과 YAML 원문 위치 연결                    | parser 내부의 `parseYaml`                           |
| [validator](src/validator/index.ts)         | `validateDocument`, `Document`, `JsonValue`          | workspace loader, catalog                           |
| [references](src/references/index.ts)       | `extractReferences`, 참조 등장·문법 진단             | catalog                                             |
| [catalog](src/catalog/index.ts)             | `buildCatalog`, `resolveReference`, `planRename`     | workspace indexing, 후속 LSP/MCP/UI와 rename writer |

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

후속 어댑터
  ├─ resolveReference
  └─ planRename
```

`planRename`의 결과는 저장할 위치와 해석값을 계산한 미리보기다. YAML 표기 보존, 쓰기 가능 여부, 최신 원문 확인, 다중 파일 저장과 복구는 후속 writer의 책임이다.

## 구현 연결

parser는 `yaml`의 구조·위치·토큰 정보를 사용하고, stringMapping은 해석한 문자열과 실제 원문 구간의 대응을 계산한다.
validator는 Zod 스키마에서 `Document` 타입을 추출한다. 두 기능 모두 파일을 직접 읽지 않으며 loader가 전달한 입력을 처리한다.

문자열·Unicode escape·LF/CRLF·파싱 실패의 원문 위치는 parser와 stringMapping의 인접 테스트에서 확인한다.
검증 결과·선택 속성·잘못된 입력의 보존은 validator의 인접 테스트에서 확인한다.

## 패키지 계약

- Node 내장 모듈과 IDE/LSP/MCP SDK에 의존하지 않는다.
- 직접 의존성은 정확히 고정한 `yaml@2.9.1`과 `zod@4.6.5`다.
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
