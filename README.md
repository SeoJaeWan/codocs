# codocs

`.codocs` YAML 문서를 읽고 검증하여 이름 참조와 경로별 색인을 제공하는 모노레포다. 현재 구현은 파싱·검증·프로젝트 탐색·색인, 단일 문서 변경 후보와 이름 변경 수정안 계산, MCP 조회 직접 handler까지 포함한다. 실제 MCP SDK/stdio와 LSP 연결, VS Code activation, watcher와 파일 저장은 후속 계층의 책임이다.

## 패키지 구성

| 패키지                                                          | 역할                                             | 사용하는 패키지·기능        |
| --------------------------------------------------------------- | ------------------------------------------------ | --------------------------- |
| [`@codocs/core`](packages/core/README.md)                       | IO 없는 YAML 파싱·검증·참조·색인·변경 후보 계산  | workspace와 후속 LSP/MCP/UI |
| [`@codocs/workspace`](packages/workspace/README.md)             | 프로젝트 선택, 파일 탐색·바이트 버전과 core 연결 | 후속 LSP/MCP/UI             |
| [`@codocs/language-server`](packages/language-server/README.md) | workspace/core를 LSP 요청에 연결할 경계          | VS Code 확장                |
| [`@codocs/vscode`](packages/vscode/README.md)                   | 언어 서버를 실행하고 VS Code와 연결할 경계       | VS Code 호스트              |
| [`@codocs/mcp`](packages/mcp/README.md)                         | 검증한 MCP 조회 입력을 workspace에 연결          | 후속 MCP SDK/stdio          |

내부 의존성 방향은 다음과 같다.

```text
vscode ──> language-server ──> workspace ──> core
                         └───────────────> core

mcp ──────────────────────> workspace ──> core
 └──────────────────────────────────────> core
```

패키지는 공개 루트에서 import한다. 세부 모듈 접근 기준은 [코드 컨벤션](.codocs/development/code-convention.yaml)에서 확인한다.

## 현재 데이터 흐름

```ts
import {
  buildWorkspaceCatalog,
  loadWorkspace,
  planWorkspaceChange,
} from '@codocs/workspace';
import { changePlanStatuses, planRename, resolveReference } from '@codocs/core';
import { createCodocsQueryHandlers } from '@codocs/mcp';

const scan = await loadWorkspace({ project: '../app' });
const catalog = buildWorkspaceCatalog(scan);

const reference = resolveReference(catalog, {
  name: '가상 주문',
  domain: 'sample-sales',
});

const preview = planRename(catalog, {
  targetPath: '.codocs/order.yaml',
  newName: '가상 판매 주문',
});

const source = scan.documents.find(
  (item) => item.source.path === '.codocs/order.yaml',
);
if (source) {
  const change = planWorkspaceChange(
    {
      mode: 'update',
      id: 'sample-order',
      revision: source.revision,
      set: { id: 'sample-purchase' },
    },
    scan,
    catalog,
  );
  if (change.status === changePlanStatuses.candidate) {
    console.log(change.raw, change.baseRevision, change.revision);
  }
}

const query = createCodocsQueryHandlers({ project: '../app' });
const page = await query.codocsList({ domain: 'sample-sales' });
const details = await query.codocsGet({ ids: ['sample-order'] });
```

`loadWorkspace`가 실제 원문과 경로를 확인하고 읽은 바이트의 revision을 전달한다. `planWorkspaceChange`는 같은 스캔에서 오류·검증된 무변경·검증된 YAML 후보를 구분한다. 후보는 저장 결과가 아니며 파일은 바뀌지 않는다. core의 `planDocumentChange`는 전달받은 값만으로 계산한다. 변경·저장 규칙은 [저장](.codocs/workspace/storage.yaml), revision의 의미는 [원문 버전](.codocs/workspace/revision.yaml)에서 확인한다. `planRename`의 `ready` 상태 역시 후속 writer가 최신 원문, YAML 표기와 쓰기 가능 여부를 다시 확인해야 한다.

사용자가 작성하는 문서와 `[[이름]]` 문법은 [작성 가이드](docs/guide/README.md), 실행 가능한 가상 문서는 [`examples/.codocs`](examples/.codocs)에 있다.

## 개발 참여

패키지별 공개 진입점과 사용 방법은 위 패키지 README에서 확인한다.
개발할 기능의 용어와 정책은 [프로젝트 지식 읽기 안내](.codocs/index.yaml), 코드·테스트·파일 배치 기준은 [개발 안내](.codocs/development/development.yaml)에서 확인한다.

## 개발 환경

Node 버전은 [.node-version](.node-version), pnpm과 개발 도구 버전은 [package.json](package.json)과 [pnpm-lock.yaml](pnpm-lock.yaml)에서 확인한다.

`.node-version`의 Node 버전을 활성화하고 지정된 pnpm을 설치한 뒤 실행한다. 별도 프로젝트 환경변수나 미리 채운 store는 필요하지 않다.

```sh
pnpm install --frozen-lockfile
pnpm test             # 기능 테스트 watch
pnpm test:run         # 기능 테스트 단일 실행
pnpm check:development # 개발 규칙·설치 계약
pnpm check:build      # 실제 빌드·배포 패키지 소비
pnpm check            # 타입·lint·서식·빌드·기능·개발·소비 검사를 순차 실행
```

기능 테스트는 패키지 소스를 직접 사용하므로 빌드 없이 실행하고 변경을 감지한다. 개발·빌드 검사는 별도 설정으로 실행한다. 설치 검사는 실행별 임시 프로젝트와 store를 준비하며 첫 설치에는 네트워크가 필요하다. 이후 offline 재설치도 확인하고 임시 데이터를 정리한다.

`typecheck`는 패키지 의존 순서대로 선언을 준비해 검사한다. `build`는 core/workspace/MCP의 ESM JS와 선언, language-server/vscode의 CJS 번들을 만든다. `check:build`는 필요한 빌드와 패키징을 직접 수행하고 소스 없는 별도 소비자에서 공개 package root와 선언 파일, 내부 subpath 접근 차단을 확인한다.

생성된 `node_modules`, `dist`, coverage, tsbuildinfo, 런타임·store·fixture는 커밋하지 않는다.
