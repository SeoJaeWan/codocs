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
| [revision](src/revision/index.ts)         | 한 번 읽은 원본 바이트의 버전과 UTF-8 원문을 연결한다.                  | `calculateRevision`, `decodeWorkspaceBytes`   | loader, 후속 writer               |
| [change-plan](src/change-plan/index.ts)   | 스캔 관측을 core 변경 계획에 연결하고 후보 바이트의 버전을 계산한다.    | `planWorkspaceChange`                         | 후속 저장 어댑터                  |

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

## 사용 경계

`loadWorkspace`로 탐색한 결과를 `buildWorkspaceCatalog`에 연결한다. `createWorkspaceQuerySession`은 list/get마다 파일을 다시 읽고 이전 색인과 연결한다.
응답의 scanStatus·confirmation과 경로·버전 의미는 [작업 공간 문서 안내](../../.codocs/workspace/workspace.yaml), 페이지 연속성과 재조회는 [목록 페이지 조회](../../.codocs/workspace/list-pagination.yaml)에서 확인한다.

```ts
import { loadWorkspace, planWorkspaceChange } from '@codocs/workspace';
import { changePlanStatuses } from '@codocs/core';

const scan = await loadWorkspace({ project: '../app' });
const source = scan.documents.find(
  (item) => item.source.path === '.codocs/order.yaml',
);
if (source) {
  const result = planWorkspaceChange(
    {
      mode: 'update',
      id: 'sample-order',
      revision: source.revision,
      set: { id: 'sample-purchase' },
    },
    scan,
  );
  if (result.status === changePlanStatuses.candidate) {
    console.log(result.raw, result.baseRevision, result.revision);
  }
}
```

`decodeWorkspaceBytes(bytes)`는 같은 바이트의 `raw`·`revision`·`utf8Lossless`를 반환하고 `calculateRevision(bytes)`는 SHA-256 revision을 계산한다. `planWorkspaceChange`는 스캔에서 읽은 원문과 revision으로 후보를 계산한다. 후보의 revision은 저장된 파일 버전이 아니며, 최신 디스크 확인과 파일 반영은 후속 저장 단계의 책임이다. 자세한 경계는 [원문 버전](../../.codocs/workspace/revision.yaml)과 [저장](../../.codocs/workspace/storage.yaml)에서 확인한다.

파일을 읽고 색인을 계산하지만 저장·watcher·잠금·rename 실행은 제공하지 않는다.

## 검증

각 기능 테스트는 해당 `src/기능` 폴더에 구현과 함께 두며 입력·출력과 경계 조건의 실행 가능한 예시 역할을 한다.

```text
pnpm exec vitest run packages/workspace/src
pnpm typecheck
pnpm lint
pnpm check:build
```

build 검사는 실제 tarball의 공개 루트로 loader와 선언 파일을 소비하고 내부 subpath 접근을 거부하는지 확인한다.
