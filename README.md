# codosc

`.codocs` 지식 문서를 위한 모노레포의 개발 환경 골격이다. 현재 다섯 패키지는 빈 모듈이다. 파싱, 참조 해석, 파일 IO, Hover/LSP, VS Code activation, MCP 도구/stdio 기능은 구현하지 않았다. 이번 검사는 개발 규칙과 설치 계약을 검증하며 실제 IDE/MCP 연결, VSIX, npm 게시를 검증하지 않는다.

개발 런타임은 **Node 24.21.0**, 패키지 관리자는 **pnpm 10.34.5**다. `.node-version`, `packageManager`, 직접 의존성의 정확한 버전과 `pnpm-lock.yaml`을 함께 커밋한다. TypeScript 5.9.3은 typescript-eslint 8.70.0의 지원 범위(`<6.1`)에 맞춘다. ESLint 10.10.0, eslint-plugin-jsdoc 64.3.10, Prettier 3.9.6, Vitest 5.0.0, 개발 도구용 `@types/node` 22.19.3을 사용한다.

npm registry의 engine/peer 계약도 확인했다. ESLint는 Node `>=24`, JSDoc 플러그인은 `>=24.15.0`, Vitest는 `^24.0.0`을 허용한다. typescript-eslint는 ESLint `^10.0.0`과 TypeScript `>=4.8.4 <6.1.0`, JSDoc 플러그인은 ESLint `^10.0.0`, Vitest는 `@types/node ^22.0.0`을 지원한다. 선택한 버전은 이 교집합에 있고 frozen 설치와 실제 규칙 실행으로 함께 검증한다.

Windows x64에서 작업 전용 런타임을 준비한 예는 다음과 같다. 전역 nvm 또는 pnpm 버전을 전환하지 않는다. 다운로드한 Node는 공식 배포 체크섬으로 검증한다. 다른 OS/아키텍처는 해당 공식 배포 파일과 체크섬을 선택하고 별도로 검증해야 한다.

```powershell
New-Item -ItemType Directory -Path .workbench/runtime -Force | Out-Null
Invoke-WebRequest https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip -OutFile .workbench/runtime/node.zip
if ((Get-FileHash .workbench/runtime/node.zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541') { throw 'Node checksum mismatch' }
Expand-Archive .workbench/runtime/node.zip .workbench/runtime
Invoke-WebRequest https://registry.npmjs.org/pnpm/-/pnpm-10.34.5.tgz -OutFile .workbench/runtime/pnpm.tgz
$taskPnpmMetadata = Invoke-RestMethod https://registry.npmjs.org/pnpm/10.34.5
$taskPnpmHash = [Security.Cryptography.SHA512]::Create().ComputeHash([IO.File]::ReadAllBytes((Resolve-Path .workbench/runtime/pnpm.tgz)))
if (('sha512-' + [Convert]::ToBase64String($taskPnpmHash)) -ne $taskPnpmMetadata.dist.integrity) { throw 'pnpm integrity mismatch' }
tar -xzf .workbench/runtime/pnpm.tgz -C .workbench/runtime
$env:PATH = (Resolve-Path .workbench/runtime/node-v24.21.0-win-x64).Path + ';' + $env:PATH
node --version
node .workbench/runtime/package/bin/pnpm.cjs --version
node .workbench/runtime/package/bin/pnpm.cjs install --frozen-lockfile --store-dir .workbench/pnpm-store
```

Node/pnpm이 이미 작업에 격리되어 있으면 다음 루트 명령을 실행한다. 위 방식에서는 `pnpm` 대신 `node .workbench/runtime/package/bin/pnpm.cjs`를 사용한다.

```text
pnpm install --frozen-lockfile --store-dir .workbench/pnpm-store
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test --run
pnpm check:development
git diff --check
```

`typecheck`는 도구와 모든 패키지를 출력 없이 검사하고, `lint`는 타입 기반 Promise/API/이름/JSDoc/경계를 검사한다. `format:check`는 개발 파일의 서식을 검사한다. Prettier는 사용자 문서 저장 경로에 연결하지 않는다. `test --run`은 전체 테스트를 한 번 실행하고 `check:development`는 규칙과 설치 fixture를 집중 실행한다. esbuild의 설치 스크립트만 명시적으로 허용한다. `node_modules`, `dist`, coverage, tsbuildinfo, 런타임/store/fixture는 작업 안에서만 생성하며 커밋하지 않는다.

| 폴더 / 내부 패키지                                    | 책임                     | 허용 내부 의존성        |
| ----------------------------------------------------- | ------------------------ | ----------------------- |
| `packages/core` / `@codosc/core`                      | 순수 도메인 로직         | 없음                    |
| `packages/workspace` / `@codosc/workspace`            | 파일 IO와 인덱스 및 상태 | core                    |
| `packages/languageServer` / `@codosc/language-server` | LSP 어댑터               | workspace, core         |
| `packages/vscode` / `@codosc/vscode`                  | 언어 서버 실행 및 연결   | 직접 도메인 import 없음 |
| `packages/mcp` / `@codosc/mcp`                        | MCP 어댑터               | workspace, core         |

모든 내부 패키지는 `private: true`, `workspace:*`, 제한된 `exports`를 사용한다. 패키지 이름으로 공개 진입점을 import하고 상대 내부 경로, subpath, 별칭을 통한 내부 접근은 금지한다. 경계 규칙은 TypeScript 설정에 따라 해석한 실제 경로도 검사한다. core는 순수 라이브러리를 사용할 수 있지만 Node 내장/IO, VS Code, LSP/MCP SDK와 독립이다. 내부 공개 API와 npm 게시를 구분하며, 개발용 Node 24 요구를 공유/IDE 코드의 engines 제약으로 일괄 적용하지 않는다.

공통 TypeScript 설정은 strict, ES2022, NodeNext와 명시적인 ESM package type을 사용한다. 모든 패키지는 `types: []`로 root 도구용 Node 타입을 상속하지 않는다. 이 설정은 현재 코드에서 Node 전역/API를 실수로 사용하지 못하게 한다. 향후 workspace/어댑터에 런타임 타입을 추가할 때 해당 런타임 지원 하한과 API 사용을 별도로 검증해야 한다. esbuild target만으로 Node API 호환성을 보장할 수 없다.

함수/변수는 camelCase, 클래스/타입은 PascalCase다. 공개 함수 반환 타입을 명시하고 선언 함수, 메서드와 변수에 할당한 함수에는 한국어 JSDoc을 작성한다. 4줄 이내의 인라인 호출 콜백은 JSDoc 검사에서 제외한다. Promise는 await 또는 오류를 처리하는 연결로 소비하며 단순 `void`는 허용하지 않는다. 외부 프로젝트 입력은 `unknown`으로 받아 구조와 의미를 검증한 뒤 내부 타입으로 사용한다. lint는 의미 검증의 대체가 아니다.

기능을 추가할 때 `src/기능/index.ts`와 `src/기능/기능.test.ts`를 같은 폴더에 둔다. 패키지 README에는 실제 입력/출력 흐름, 경계와 공개 API, 오류/상태, 시험 범위를 갱신한다. 단순 re-export에는 형식적 테스트를 요구하지 않는다. 현재 테스트는 실제 ESLint 성공/실패 및 rule ID, 패키지 발견과 의존 방향, 별도 fixture에서 frozen 설치 성공과 불일치 manifest 거부, 소스 타입 진입점 해석과 금지 subpath의 TypeScript 거부를 검증한다. 실행 중인 Windows 명령 shim이 설치 과정에서 변경되지 않도록 설치 fixture는 활성 작업의 node_modules와 격리한다.

후속 빌드는 루트 `scripts.build`, `tools/build/`, 패키지별 `tsconfig.build.json`에 연결한다. core/workspace의 JS와 d.ts, MCP 실행 JS, 언어 서버/확장 번들 및 실제 JS/TS 소비자는 아직 제공하지 않는다. 초기 `exports.types`는 소스 진입점이며 `exports.import`는 후속 빌드의 `dist/index.js`를 가리킨다. 소스 path alias로 출력 소비자 검증을 우회하지 않는다. 가이드와 예시/배포 asset도 후속 범위다.

검증 환경은 Windows x64, 작업 전용 Node 24.21.0 / pnpm 10.34.5다. 다른 운영체제, VS Code 호스트와 실제 MCP 클라이언트는 아직 검증하지 않았다.
