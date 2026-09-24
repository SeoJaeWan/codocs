# codocs

Codocs는 `.codocs` YAML에 프로젝트의 용어·동작·정책을 기록하고, 문서 간 참조와 코드 식별자 매칭으로 관련 지식을 찾는 도구다.

문서를 처음 작성한다면 [작성 가이드](docs/guide/README.md)와 [가상 프로젝트 예시](examples/.codocs)부터 확인한다.

현재 이 저장소는 파싱·검증·파일 탐색·색인·코드 매칭, 변경 후보 계산과 MCP stdio 조회 서버를 제공한다. LSP·VS Code 확장도 로컬 빌드로 실행할 수 있다. 공개 게시 및 지원 OS 전체의 검증은 별도 단계다.

## 시작하기

[.node-version](.node-version)의 Node 버전을 활성화하고 [package.json](package.json)에 지정된 pnpm을 설치한 뒤 저장소 루트에서 실행한다.

```sh
pnpm install --frozen-lockfile
pnpm build
```

빌드한 MCP 서버를 stdio 클라이언트에서 실행할 때는 다음 명령을 설정한다. `--project`를 생략하면 서버 시작 시점의 작업 디렉터리가 프로젝트다. 상대 경로는 그 디렉터리를 기준으로 해석한다.

```sh
node packages/mcp/dist/cli.js --project ./my-project
```

현재 서버가 제공하는 도구는 `codocs_list`, `codocs_get`, `codocs_refresh`다.

현재 API는 모노레포 내부 패키지에서 사용한다. 공개 npm 패키지나 설치 가능한 VS Code 확장을 전제로 하지 않는다. 패키지의 책임과 계약은 아래 소개 문서에서 확인한다. 공개 API는 각 패키지의 `src/index.ts`에서 확인하고 패키지 루트에서 import한다. 구체적인 입력·출력과 사용 사례는 해당 코드의 JSDoc·타입·인접 테스트에서 확인한다.

## 패키지

| 패키지                                                                  | 역할                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------- |
| [@codocs/core](.codocs/core/core.yaml)                                  | IO 없는 파싱·검증·참조·색인·매칭·변경 후보 계산 |
| [@codocs/workspace](.codocs/workspace/workspace.yaml)                   | 프로젝트 선택, 파일 탐색·원문 버전과 Core 연결  |
| [@codocs/mcp](.codocs/mcp/mcp.yaml)                                     | MCP 입력 계약, 조회 handler와 stdio 서버        |
| [@codocs/language-server](.codocs/language-server/language-server.yaml) | LSP 연동을 위한 패키지                          |
| [@codocs/vscode](.codocs/vscode/vscode.yaml)                            | VS Code 확장 연동을 위한 패키지                 |

## 개발하기

`pnpm install`은 `prepare` 스크립트로 Husky의 커밋 전 검사 훅을 설치한다. 기존 체크아웃에서는 `pnpm prepare`로 설치할 수 있다. 훅 명령은 `.husky/pre-commit`, 파일별 검사 설정은 `package.json`의 `lint-staged`에서 관리한다.

커밋할 때 lint-staged가 스테이징된 코드에 ESLint 자동 수정과 Prettier를 적용한다. 오류·경고 또는 서식 처리 실패가 남으면 커밋을 중단한다. 부분 스테이징의 미스테이징 변경은 복원하며, 자동 수정 단계 실패·취소에는 원래 상태를 복원한다.

이후 자동 수정된 인덱스를 독립 복사본으로 만들고 frozen install, 타입·린트·로직 검사를 실행한다. 검사 중 인덱스·HEAD가 바뀌면 커밋을 중단한다. 미스테이징·미추적 파일은 유지하고 성공한 복사본은 정리한다. 실패한 복사본과 트리 해시는 `.workbench/commit-check`의 결과에서 확인한다. 실제 VS Code 검사와 성능 검사는 커밋 훅에서 실행하지 않는다.

```sh
pnpm test             # 로직·실행 도구 테스트 단일 실행
pnpm test --watch     # 로직 테스트 변경 감지
pnpm test:vscode      # 현재 OS의 실제 VS Code 기능 검사 (창 표시)
pnpm check            # 타입·린트·서식·빌드·테스트·패키지 소비 검사
pnpm format           # 서식 자동 수정
pnpm bench --help     # 성능 측정 옵션
```

로직 테스트는 소스를 직접 사용한다. 일반 파일·링크·감시는 현재 OS의 실제 임시 파일 시스템으로 확인한다. EACCES/EPERM, 이벤트 순서, 종료 지연처럼 재현 제어가 필요한 경우만 test-support의 mock을 사용한다. Windows에서 실제 파일 symlink를 만드는 검사는 해당 권한 또는 개발자 모드가 필요하며, 준비 실패를 mock이나 skip으로 숨기지 않는다. `pnpm check`의 설치·패키지 소비 검사는 임시 프로젝트와 store를 사용하며 첫 설치에 네트워크가 필요하다.

개발할 기능의 계약은 [프로젝트 지식 읽기 안내](.codocs/index.yaml)에서 찾는다. 패키지 간 책임은 [실행 구조](.codocs/development/runtime-architecture.yaml), 코드·테스트·문서 작성 기준은 [개발 안내](.codocs/development/development.yaml), 도구와 빌드 기준은 [개발 환경](.codocs/development/development-environment.yaml)에서 확인한다.

## 실제 VS Code 검사

기능 시나리오는 [extension.test.cjs](packages/vscode/src/integration/extension.test.cjs) 한 파일에 있다. [index.cjs](packages/vscode/src/integration/index.cjs)가 실제 Extension Host에서 사례별 작업 공간을 복원하고 결과를 기록한다. 일반 Vitest 단위 테스트와는 별도 실행 환경이다.

`pnpm test:vscode`는 현재 소스를 빌드하고 `@vscode/vsce`로 VSIX를 생성·설치한 뒤, `@vscode/test-electron`의 고정 버전 VS Code에서 전체 기능 사례를 한 번 실행한다. 패키징·설치·활성화 검증과 반복 장애 후 수동 복구 검사를 같은 명령에서 수행한다. Windows·Mac 모두 실제 창이 표시될 수 있으며 포커스 이동을 차단하지 않는다. 개인 VS Code와 분리한 프로필·확장·작업 공간을 사용하고 종료 후 정리한다. 다운로드 캐시는 `.workbench/vscode-cache`, 실행별 결과와 로그는 `.workbench/vscode-tests`에 보관한다. 실제 provider·명령 API를 검사하며 픽셀·마우스 자동화 검사는 아니다.

도구의 위치와 역할은 [tools 구조 안내](tools/README.md)에 정리한다. `pnpm check`는 package.json에서 검사 순서를 조합하고, 테스트 실행·커밋·빌드 도구는 각각 `tools/test`, `tools/git`, `tools/build`에 둔다.

`node packages/vscode/test-runner/lifecycle.mjs`는 시작 실패·기능 실패·시간 제한·취소 시 프로세스 정리를 확인한다. 시나리오 대응은 [기능 대응표](packages/vscode/src/integration/coverage.md), 실행 방법은 [검증 안내](packages/vscode/src/integration/verification.md)에 있다.

## CI

[Tests workflow](.github/workflows/test.yml)는 Windows와 Mac에서 로컬과 동일한 `pnpm check`, `pnpm test:vscode` 및 실행기 정리 검사를 수행한다. CI 전용 기능 테스트나 환경별 mock 전환은 없다. 실제 OS 전용 기능 사례만 해당 OS에서 실행하며, 오류 주입 사례는 양쪽에서 동일하게 실행한다. 각 OS의 VS Code 결과·로그를 artifact로 보관한다. 한 OS의 통과를 다른 OS의 통과로 대신하지 않는다.
