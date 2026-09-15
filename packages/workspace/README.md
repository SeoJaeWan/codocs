# workspace

`@codosc/workspace`는 사용자가 선택한 프로젝트의 `.codocs` 범위를 확인하고 실제 YAML 파일을 읽어 `@codosc/core`의 파싱·검증·색인 계산에 연결한다.

공개 진입점은 `src/index.ts` 하나다. 다른 패키지는 `@codosc/workspace` 루트만 import하고 내부 기능 폴더에 직접 접근하지 않는다.

## 기능과 사용처

| 기능                                    | 제공 값                                       | 이 기능을 사용하는 곳      |
| --------------------------------------- | --------------------------------------------- | -------------------------- |
| [diagnostics](src/diagnostics/index.ts) | workspace 진단과 IO 코드 추출                 | projectRoot, paths, loader |
| [projectRoot](src/projectRoot/index.ts) | `resolveProjectRoot`, 선택 루트 모델          | paths, loader              |
| [paths](src/paths/index.ts)             | `resolveWorkspacePath`, 링크 범위와 접근 정책 | loader, 후속 writer        |
| [loader](src/loader/index.ts)           | `loadWorkspace`, 문서·실패·순환 스캔 결과     | indexing, 후속 MCP/LSP     |
| [indexing](src/indexing/index.ts)       | `toCatalogScan`, `buildWorkspaceCatalog`      | 후속 검색·참조·rename 기능 |

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
```

경로는 프로젝트 상대 발견 경로, 논리 절대 경로와 확인한 실제 경로를 구분한다. 같은 실제 파일에 여러 논리 경로로 도달하면 경로별 문서로 유지한다. ID나 실제 경로를 기준으로 자동 병합하지 않는다.

## 상태를 사용하는 방법

- `complete`: 확인 대상 탐색을 마쳤다. `.codocs` 부재와 문서 내용 오류만 있는 경우도 포함한다.
- `partial`: 일부 파일이나 하위 폴더를 확인하지 못했으며 정상 문서는 함께 제공한다.
- `failed`: 프로젝트 루트 또는 `.codocs` 자체를 탐색할 수 없다.

`partial`의 미관측 경로는 삭제 증거가 아니다. indexing은 이전 문서를 `unconfirmed`로 보존한다. `failed`도 이전 색인을 버리지 않는다.

경로 결과의 `access.read/write`는 Codocs가 허용한 범위만 뜻한다. OS 권한과 저장 시점의 링크 상태는 writer가 다시 확인해야 한다.

## 패키지 계약

- 내부 의존성은 `@codosc/core`의 공개 진입점만 허용한다.
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
pnpm exec vitest run tools/buildChecks -t workspace
```

build 검사는 실제 tarball의 공개 루트로 loader와 선언 파일을 소비하고 내부 subpath 접근을 거부하는지 확인한다.
