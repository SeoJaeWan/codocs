# codosc

`.codocs` 지식 문서를 위한 모노레포다. `@codosc/core`는 IO 없는 단일 YAML 매핑 파서와 원문 위치 API를 제공한다. 나머지 네 패키지는 빈 모듈이며 스키마 검증, 참조 해석, 파일 IO, Hover/LSP, VS Code activation, MCP 도구/stdio 기능은 구현하지 않았다. 검사는 파서·원문 위치와 개발·설치·빌드 계약을 검증하며 실제 IDE/MCP 연결, VSIX, npm 게시는 검증하지 않는다.

```ts
import { parseYaml, getValueRange, offsetToPosition } from '@codosc/core';

const parsed = parseYaml('id: sample-order\n', 'terms.yaml');
if (parsed.success) {
  const range = getValueRange(parsed, ['id']);
  if (range) {
    console.log(parsed.source.slice(range.start, range.end)); // sample-order
    console.log(offsetToPosition(parsed.source, range.start)); // { line: 0, character: 4 }
  }
} else {
  console.log(parsed.diagnostics);
}
```

`parseYaml(input: unknown, filePath?: string)`는 문자열을 해석하며 파일을 읽지 않는다. 성공 결과의 `source/data/fields/diagnostics`와 실패 결과의 원문·진단을 구분한다. 단일 `---`, 주석, 블록 문자열, 중첩 배열·매핑과 flow 구조는 허용하고 최상위 배열·스칼라 및 빈 문서는 거부한다. 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 키는 `unsupported_yaml_feature`, 일반 문법 오류와 비매핑은 `invalid_yaml`이다. 실패에는 `data/fields`가 없다.

`getKeyRange/getValueRange/getPropertyRange`는 문자열 키·숫자 배열 인덱스의 경로로 키·값·속성 전체의 확인된 범위 또는 `undefined`를 반환한다. 원문은 정규화하지 않고 내부 범위는 0 기반 UTF-16, 시작 포함·끝 제외다. 외부 좌표는 0 기반 `line/character`다. 파싱 성공과 위치 조회는 스키마 유효성이나 저장·삭제 허용을 뜻하지 않는다. 상세 계약은 [core README](packages/core/README.md), 단일 문서 작성 예시는 [작성 가이드](docs/guide/README.md)에 있다.

개발 런타임은 **Node 24.21.0**, 패키지 관리자는 **pnpm 10.34.5**다. `.node-version`, `packageManager`, 직접 의존성의 정확한 버전과 `pnpm-lock.yaml`을 함께 커밋한다. TypeScript 5.9.3은 typescript-eslint 8.70.0의 지원 범위(`<6.1`)에 맞춘다. ESLint 10.10.0, eslint-plugin-jsdoc 64.3.10, Prettier 3.9.6, Vitest 5.0.0, esbuild 0.28.2, 개발 도구용 `@types/node` 22.19.3을 사용한다.

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
pnpm build
pnpm bundle
pnpm check:build
git diff --check
```

`typecheck`는 의존 순서대로 실제 d.ts를 준비한 뒤 도구와 모든 패키지/test를 noEmit으로 검사하고, `lint`는 타입 기반 Promise/API/이름/JSDoc/경계를 검사한다. `format:check`는 개발 파일의 서식을 검사한다. Prettier는 사용자 문서 저장 경로에 연결하지 않는다. `test --run`은 전체 테스트를 한 번 실행하고 `check:development`는 규칙과 설치 fixture를 집중 실행한다. esbuild의 설치 스크립트만 명시적으로 허용한다. `node_modules`, `dist`, coverage, tsbuildinfo, 런타임/store/fixture는 작업 안에서만 생성하며 커밋하지 않는다.

| 폴더 / 내부 패키지                                    | 책임                     | 허용 내부 의존성        |
| ----------------------------------------------------- | ------------------------ | ----------------------- |
| `packages/core` / `@codosc/core`                      | 순수 도메인 로직         | 없음                    |
| `packages/workspace` / `@codosc/workspace`            | 파일 IO와 인덱스 및 상태 | core                    |
| `packages/languageServer` / `@codosc/language-server` | LSP 어댑터               | workspace, core         |
| `packages/vscode` / `@codosc/vscode`                  | 언어 서버 실행 및 연결   | 직접 도메인 import 없음 |
| `packages/mcp` / `@codosc/mcp`                        | MCP 어댑터               | workspace, core         |

모든 내부 패키지는 `private: true`, `workspace:*`, 제한된 `exports`를 사용한다. 패키지 이름으로 공개 진입점을 import하고 상대 내부 경로, subpath, 별칭을 통한 내부 접근은 금지한다. 경계 규칙은 TypeScript 설정에 따라 해석한 실제 경로도 검사한다. core는 순수 라이브러리를 사용할 수 있지만 Node 내장/IO, VS Code, LSP/MCP SDK와 독립이다. 내부 공개 API와 npm 게시를 구분하며, 개발용 Node 24 요구를 공유/IDE 코드의 engines 제약으로 일괄 적용하지 않는다.

strict 공통 설정과 ES2022/NodeNext 런타임 설정을 분리한다. TypeScript source는 명시적인 ESM package type과 로컬 .js import를 사용한다. 모든 패키지는 `types: []`로 root 도구용 Node 타입을 상속하지 않는다. 이 설정은 호스트 전역 타입을 자동 추가하지 않는다. 현재 core는 순수 YAML 라이브러리 API를 사용하며 호스트 의존성은 lint로 금지한다. 향후 workspace/어댑터에 런타임 타입을 추가할 때 해당 런타임 지원 하한과 API 사용을 별도로 검증해야 한다. esbuild target만으로 Node API 호환성을 보장할 수 없다.

함수/변수는 camelCase, 클래스/타입은 PascalCase다. 공개 함수 반환 타입을 명시하고 선언 함수, 메서드와 변수에 할당한 함수에는 한국어 JSDoc을 작성한다. 4줄 이내의 인라인 호출 콜백은 JSDoc 검사에서 제외한다. Promise는 await 또는 오류를 처리하는 연결로 소비하며 단순 `void`는 허용하지 않는다. 외부 프로젝트 입력은 `unknown`으로 받아 구조와 의미를 검증한 뒤 내부 타입으로 사용한다. lint는 의미 검증의 대체가 아니다.

기능을 추가할 때 `src/기능/index.ts`와 `src/기능/기능.test.ts`를 같은 폴더에 둔다. 패키지 README에는 실제 입력/출력 흐름, 경계와 공개 API, 오류/상태, 시험 범위를 갱신한다. 단순 re-export에는 형식적 테스트를 요구하지 않는다. 현재 테스트는 파싱·금지 구문·원문 범위·좌표, 실제 ESLint 성공/실패 및 rule ID, 패키지 발견과 의존 방향, parser source 전체를 복사한 별도 fixture에서 frozen 설치 성공과 불일치 manifest 거부, 빌드 선언 타입 진입점 해석과 금지 subpath의 TypeScript 거부를 검증한다. 실행 중인 Windows 명령 shim이 설치 과정에서 변경되지 않도록 설치 fixture는 활성 작업의 node_modules와 격리한다.

루트 `build`는 이전 package dist를 지우고 core/workspace/MCP를 tsc로 JS+d.ts emit한 뒤 언어 서버와 확장을 esbuild CJS로 번들한다. 두 IDE 패키지의 d.ts는 tsc로 별도 생성한다. `exports.types`는 모두 실제 `dist/index.d.ts`이고 core/workspace/MCP의 import는 `dist/index.js`, 언어 서버/확장의 import 및 require는 `dist/index.cjs`다. build에서 test/spec는 제외하고 source alias나 TS loader를 사용하지 않는다.

`bundle`은 독립적으로 이전 출력을 지우며 의존 ESM JS는 tsc --noCheck로 transpile하고 IDE는 esbuild로 번들한다. 이 명령은 타입 검사를 수행하지 않는다. 전체 검증은 반드시 `typecheck`와 `build` 결과를 따로 확인한다. `typecheck`는 JS/IDE bundle 없이 실행 가능하며 실제 package d.ts를 먼저 준비해 출력 없는 설치에서도 package exports를 해석한다. 개별 package build는 의존 출력을 전제로 하므로 루트 명령이 재현성 기준이다.

IDE target node20.19는 VS Code 1.100.0의 [고정 Node 설정](https://github.com/microsoft/vscode/blob/1.100.0/.nvmrc) 20.19.0에 근거한 문법 하한 후보다. 공유 TypeScript ES2022는 그보다 낮은 문법 수준을 사용한다. esbuild target은 Node API를 polyfill하지 않는다. core source에는 호스트 API가 없고 VS Code 1.100.0/Node 20의 실제 시험은 수행하지 않았다. vscode 모듈은 호스트 제공 external이며 서버 bundle/map은 확장의 `dist/server/`에 복사한다.

`docs/guide`는 파서 계약과 미구현 기능을 표시한 작성 가이드이며 `examples/.codocs`는 파일마다 하나의 최상위 매핑인 가상 업무 사실 YAML이다. 두 파일의 ID·참조·본문은 실제 공개 파서로 검증한다. build는 MCP와 vscode의 dist에 두 폴더를 복사하고 package files에 dist/README를 포함한다. MCP guide 도구는 구현하지 않는다. 개발 서식 검사는 저장소 가상 예시에 적용하며 사용자 .codocs 저장 시 전체 재포맷 기능은 없다.

`check:build`는 이전 dist 없이 실제 빌드를 실행하고 한글/공백 경로의 별도 소비자에 manifest와 dist 및 명시적인 yaml 의존성을 준비한다. 실제 Node subprocess의 package 이름 ESM import/CJS require와 파서 API 실행, `types: []` TypeScript d.ts 해석 trace, TS/Node 내부 subpath 거부, tsc 타입 오류와 같은 source의 독립 bundle 성공, 실제 test 출력 제외, core를 포함한 CJS bundle 소비, vscode external을 검증한다. MCP/vscode의 dist와 실제 pack에서 추출한 guide/example 원문 일치 및 예제 파싱도 확인한다. 기존 개발 규칙의 Promise/JSDoc/공개 타입/경계 성공·실패 검출도 유지한다. private workspace 의존성의 로컬 소비 성공은 npm 단독 설치 성공을 뜻하지 않는다.

검증 환경은 Windows x64, 작업 전용 Node 24.21.0 / pnpm 10.34.5다. 다른 운영체제, VS Code 호스트와 실제 MCP 클라이언트는 아직 검증하지 않았다.
