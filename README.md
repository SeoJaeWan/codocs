# codocs

`.codocs` YAML 문서를 읽고 검증하여 이름 참조와 경로별 색인을 제공하는 모노레포다. 현재 구현은 파싱·검증·프로젝트 탐색·색인, 이름 변경 수정안 계산과 MCP 조회 직접 handler까지 포함한다. 실제 MCP SDK/stdio와 LSP 연결, VS Code activation, watcher와 다중 파일 rename 저장은 후속 계층의 책임이다.

## 패키지 구성

| 패키지                                                          | 역할                                            | 사용하는 패키지·기능        |
| --------------------------------------------------------------- | ----------------------------------------------- | --------------------------- |
| [`@codocs/core`](packages/core/README.md)                       | IO 없는 YAML 파싱·검증·참조·색인 계산           | workspace와 후속 LSP/MCP/UI |
| [`@codocs/workspace`](packages/workspace/README.md)             | 프로젝트 선택, 경로 경계, 파일 탐색과 core 연결 | 후속 LSP/MCP/UI             |
| [`@codocs/language-server`](packages/language-server/README.md) | workspace/core를 LSP 요청에 연결할 경계         | VS Code 확장                |
| [`@codocs/vscode`](packages/vscode/README.md)                   | 언어 서버를 실행하고 VS Code와 연결할 경계      | VS Code 호스트              |
| [`@codocs/mcp`](packages/mcp/README.md)                         | 검증한 MCP 조회 입력을 workspace에 연결         | 후속 MCP SDK/stdio          |

내부 의존성 방향은 다음과 같다.

```text
vscode ──> language-server ──> workspace ──> core
                         └───────────────> core

mcp ──────────────────────> workspace ──> core
 └──────────────────────────────────────> core
```

모든 내부 패키지는 `private: true`, `workspace:*`와 제한된 package `exports`를 사용한다. 패키지 이름의 공개 루트만 import하며 상대 경로, subpath 또는 별칭을 통한 다른 패키지 내부 접근은 금지한다.

## 현재 데이터 흐름

```ts
import { buildWorkspaceCatalog, loadWorkspace } from '@codocs/workspace';
import { planRename, resolveReference } from '@codocs/core';
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

const query = createCodocsQueryHandlers({ project: '../app' });
const page = await query.codocsList({ domain: 'sample-sales' });
const details = await query.codocsGet({ ids: ['sample-order'] });
```

`loadWorkspace`가 실제 원문과 경로를 확인한다. core는 전달받은 값으로 결과를 계산할 뿐 파일을 읽거나 저장하지 않는다. `planRename`의 `ready` 상태도 저장 허용을 의미하지 않으며 후속 writer가 최신 원문, YAML 표기와 쓰기 가능 여부를 다시 확인해야 한다.

사용자가 작성하는 문서와 `[[이름]]` 문법은 [작성 가이드](docs/guide/README.md), 실행 가능한 가상 문서는 [`examples/.codocs`](examples/.codocs)에 있다.

## 문서와 테스트의 역할

우리 프로젝트의 개념과 사전 합의는 [프로젝트 지식 읽기 안내](.codocs/index.yaml)에서 찾는다.

기능 작업 전에 관련 정책을 읽고, 작업 중 확정한 발생 조건·판단 근거·예외를 해당 `.codocs` 문서에 함께 반영한다.

이번 도입에서는 Local Work Memory와의 중복을 허용한다. 이 프로젝트의 memory update는 [개발 도메인의 갱신 절차](.codocs/development/development.yaml)에 따라 `.codocs`까지 함께 확인·갱신한다. 백그라운드 자동 동기화는 제공하지 않는다.

문서는 코드와 같은 단위로 관리하되 역할을 나눈다.

- 루트 README는 패키지의 책임과 의존 관계, 개발 방법을 설명한다.
- 패키지 README는 기능별 공개 함수가 어디에서 사용되는지와 다른 기능과의 연결을 설명한다.
- `.codocs`는 프로젝트의 개념과 정책·절차·결정의 근거를 설명한다. 내용의 합의·적용 상태는 `status`로 표현하고, 개발 진행도와 PR·이슈 배정은 기록하지 않는다. 진행 상황을 위한 별도 `.codocs` 문서도 만들지 않는다.
- 구체적인 입력·출력과 분기 동작은 구현에 인접한 테스트가 실행 가능한 예시로 설명한다.
- 사용자 작성 규칙은 `docs/guide`, 실행 가능한 사용자 문서는 `examples`에 둔다.

구현 동작을 README에 다시 나열하지 않는다. 공개 책임이나 사용처가 달라지면 패키지 README를 수정하고, 함수 동작이 달라지면 인접 테스트를 수정한다.

## 소스와 테스트 컨벤션

기능을 추가할 때 다음 구조를 사용한다.

```text
src/feature/
├── index.ts
└── feature.test.ts
```

파일·폴더는 kebab-case이며 ESLint의 check-file 규칙으로 검사한다. `README.md` 같은 도구 관례와 `.test.ts` 같은 복합 확장자는 유지한다.

도메인 상태·사유는 기능별 `domain-values.ts`의 설명 있는 상수를 원본으로 삼고 타입을 도출한다. `codocs/no-raw-domain-value`가 타입 선언으로 확인되는 문맥의 직접 문자열을 검사한다. 구체적인 기준은 [.codocs 코드 컨벤션](.codocs/development/code-convention.yaml)을 따른다.

함수와 변수는 camelCase, 클래스와 타입은 PascalCase다. 공개 함수 반환 타입을 명시하고 선언 함수, 메서드와 변수에 할당한 함수에는 한국어 JSDoc을 작성한다. 외부 프로젝트 입력은 `unknown`으로 받고 구조와 의미를 확인한 뒤 내부 타입으로 사용한다.

TypeScript 소스는 strict, ES2022, NodeNext, 명시적인 ESM package type과 로컬 `.js` import를 사용한다. 모든 패키지는 `types: []`로 루트 도구용 Node 타입의 자동 유입을 막는다. build에서 test/spec는 제외한다.

## 개발 환경

- Node 24.21.0
- pnpm 10.34.5
- TypeScript 5.9.3
- ESLint 10.10.0
- Prettier 3.9.6
- Vitest 5.0.0
- esbuild 0.28.2

버전은 `.node-version`, root `package.json`과 `pnpm-lock.yaml`에 고정한다.

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
