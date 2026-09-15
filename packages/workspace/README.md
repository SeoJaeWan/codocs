# workspace

`@codocs/workspace`는 사용자가 선택한 프로젝트의 `.codocs` 범위를 확인하고 실제 YAML 파일을 읽어 `@codocs/core`의 파싱·검증·색인 계산에 연결한다.

공개 진입점은 `src/index.ts` 하나다. 다른 패키지는 `@codocs/workspace` 루트만 import하고 내부 기능 폴더에 직접 접근하지 않는다.

## 기능과 사용처

| 기능·진입 파일                            | 역할                                                                    | 주요 제공 값                                  | 사용하는 곳                       |
| ----------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- | --------------------------------- |
| [diagnostics](src/diagnostics/index.ts)   | 경로·파일 IO 실패를 일관된 진단으로 만들고 실제 시스템 코드를 보존한다. | workspace 진단과 IO 코드 추출                 | project-root, paths, loader       |
| [project-root](src/project-root/index.ts) | 입력으로 프로젝트 루트와 지식 폴더 위치를 확정한다.                     | `resolveProjectRoot`, 선택 루트 모델          | paths, loader                     |
| [paths](src/paths/index.ts)               | 논리 경로와 링크의 실제 대상을 확인하고 허용된 접근 범위를 판단한다.    | `resolveWorkspacePath`, 링크 범위와 접근 정책 | loader, 후속 writer               |
| [loader](src/loader/index.ts)             | 지식 폴더를 탐색하고 원문을 읽어 문서 결과와 읽기 실패 범위를 구분한다. | `loadWorkspace`, 문서·실패·순환 스캔 결과     | indexing, 후속 MCP/LSP            |
| [indexing](src/indexing/index.ts)         | 스캔 관측을 core 색인 입력으로 변환하고 이전 관측과 연결한다.           | `toCatalogScan`, `buildWorkspaceCatalog`      | workspace query, 참조·rename 처리 |
| [query](src/query/index.ts)               | 조회마다 스캔·색인을 갱신하고 revision·페이지·커서 수명을 관리한다.     | 실제 scan 기반 list/get/refresh 조회 세션     | MCP 조회 어댑터                   |

## 파일별 역할

- `src/index.ts`: 외부에 제공할 API와 타입을 패키지 루트에서 재내보낸다.
- `src/기능/index.ts`: 위 표의 기능을 구현하고 관련 타입을 정의한다.
- `src/기능/domain-values.ts`: 해당 기능의 상태·사유 값을 설명 있는 상수로 정의하고 타입을 도출한다. 문서 필드는 validator의 스키마 원본에서 도출한다.
- `src/기능/*.test.ts`: 입력·출력·분기·경계 조건을 검증하는 실행 가능한 예시다.

## 호출 흐름

```text
loadWorkspace
  ├─ resolveProjectRoot
  ├─ resolveWorkspacePath
  ├─ core.parseYaml
  └─ core.validateDocument
       ↓
toCatalogScan
       ↓
core.buildCatalog
       ↓
Catalog
       ↓
WorkspaceQuerySession.list/get
```

경로는 프로젝트 상대 발견 경로, 논리 절대 경로와 확인한 실제 경로를 구분한다. 같은 실제 파일에 여러 논리 경로로 도달하면 경로별 문서로 유지한다. ID나 실제 경로를 기준으로 자동 병합하지 않는다.

## 상태를 사용하는 방법

- `complete`: 확인 대상 탐색을 마쳤다. `.codocs` 부재와 문서 내용 오류만 있는 경우도 포함한다.
- `partial`: 일부 파일이나 하위 폴더를 확인하지 못했으며 정상 문서는 함께 제공한다.
- `failed`: 프로젝트 루트 또는 `.codocs` 자체를 탐색할 수 없다.

`partial`의 미관측 경로는 삭제 증거가 아니다. indexing은 이전 문서를 `unconfirmed`로 보존한다. `failed`도 이전 색인을 버리지 않는다.

`createWorkspaceQuerySession`은 list/get마다 실제 파일을 다시 읽고 이전 Catalog와 revision을 연결한다. list는 ID 오름차순으로 50개씩 반환하며, 자체 포함 HMAC 커서는 같은 process와 필터·목록 projection에서만 유효하다. 본문만 바뀌면 커서를 유지하지만 표시 값·오류·충돌·포함 여부가 바뀌거나 `refresh()`를 호출하면 `cursor_expired`로 거부한다.

partial의 이전 문서는 마지막 원문 revision과 `unconfirmed` 진단을 유지한다. 색인 밖 ID도 확정 `not_found`로 바꾸지 않는다. failed 조회는 원인을 `success:false`로 반환하고 내부에 보존한 이전 문서를 노출하지 않는다.

경로 결과의 `access.read/write`는 Codocs가 허용한 범위만 뜻한다. OS 권한과 저장 시점의 링크 상태는 writer가 다시 확인해야 한다.

## 패키지 계약

- 내부 의존성은 `@codocs/core`의 공개 진입점만 허용한다.
- ESM JS와 선언 파일을 `dist`에 생성한다.
- strict, ES2022, NodeNext, 상대 `.js` import와 `types: []`를 유지한다.
- 읽지 못한 원문, 실제 경로, ID나 좌표를 추측하지 않는다.
- 파일을 읽고 색인을 계산하지만 저장, watcher, 공유 대상 잠금과 rename 실행은 제공하지 않는다.

## 검증

각 기능 테스트는 해당 `src/기능` 폴더에 구현과 함께 두며 입력·출력과 경계 조건의 실행 가능한 예시 역할을 한다.

```text
pnpm exec vitest run packages/workspace/src
pnpm typecheck
pnpm lint
pnpm check:build
```

build 검사는 실제 tarball의 공개 루트로 loader와 선언 파일을 소비하고 내부 subpath 접근을 거부하는지 확인한다.
