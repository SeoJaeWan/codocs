# codocs

Codocs는 `.codocs` YAML에 프로젝트의 용어·동작·정책을 기록하고, 문서 간 참조와 코드 식별자 매칭으로 관련 지식을 찾는 도구다.

문서를 처음 작성한다면 [작성 가이드](docs/guide/README.md)와 [가상 프로젝트 예시](examples/.codocs)부터 확인한다.

현재 이 저장소는 파싱·검증·파일 탐색·색인·코드 매칭, 변경 후보 계산과 MCP 조회 handler를 제공한다. MCP stdio 서버와 LSP·VS Code 확장을 로컬 빌드로 실행할 수 있다. 공개 게시 및 지원 OS 전체의 검증은 별도 단계다.

## 시작하기

[.node-version](.node-version)의 Node 버전을 활성화하고 [package.json](package.json)에 지정된 pnpm을 설치한 뒤 저장소 루트에서 실행한다.

```sh
pnpm install --frozen-lockfile
pnpm build
```

현재 API는 모노레포 내부 패키지에서 사용한다. 공개 npm 패키지나 설치 가능한 VS Code 확장을 전제로 하지 않는다. 패키지의 책임과 계약은 아래 소개 문서에서 확인한다. 공개 API는 각 패키지의 `src/index.ts`에서 확인하고 패키지 루트에서 import한다. 구체적인 입력·출력과 사용 사례는 해당 코드의 JSDoc·타입·인접 테스트에서 확인한다.

## 패키지

| 패키지                                                                  | 역할                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| [@codocs/core](.codocs/core/core.yaml)                                  | IO 없는 파싱·검증·참조·색인·매칭·변경 후보 계산   |
| [@codocs/workspace](.codocs/workspace/workspace.yaml)                   | 프로젝트 선택, 파일 탐색·원문 버전과 Core 연결    |
| [@codocs/mcp](.codocs/mcp/mcp.yaml)                                     | MCP 조회 입력과 workspace 결과를 연결하는 handler |
| [@codocs/language-server](.codocs/language-server/language-server.yaml) | LSP 연동을 위한 패키지                            |
| [@codocs/vscode](.codocs/vscode/vscode.yaml)                            | VS Code 확장 연동을 위한 패키지                   |

## 개발하기

`pnpm install`은 `prepare` 스크립트로 Husky의 커밋 전 검사 훅을 설치한다. 기존 체크아웃에서는 `pnpm prepare`로 설치할 수 있다. 훅 명령은 `.husky/pre-commit`, 파일별 검사 설정은 `package.json`의 `lint-staged`에서 관리한다.

커밋할 때 lint-staged가 스테이징된 코드에 ESLint 자동 수정과 Prettier를 적용한다. 오류·경고 또는 서식 처리 실패가 남으면 커밋을 중단한다. 부분 스테이징의 미스테이징 변경은 복원하며, 자동 수정 단계 실패·취소에는 원래 상태를 복원한다.

이후 자동 수정된 인덱스를 독립 복사본으로 만들고 frozen install, 기능 단일 실행, 실제 VS Code 검사를 순서대로 실행한다. 모든 검사가 성공하고 검사 중 인덱스·HEAD가 바뀌지 않아야 커밋을 허용한다. 기능 검사 실패 시 성공한 자동 수정은 인덱스에 남고 사용자 미스테이징·미추적 파일은 유지한다. 취소는 실행 중인 단계의 복원·정리가 끝난 뒤 실패로 처리하므로 즉시 끝나지 않을 수 있다.

`pnpm check:commit`은 훅 전체를, `pnpm check:staged`는 자동 수정만 실행한다. 복사본은 Windows 경로 길이 제한을 피하는 고유 OS 임시 경로에 만든다. 검사 트리 해시·VS Code 로그는 `.workbench/commit-check/<실행 ID>`에 보존하고 성공한 복사본은 정리한다. 실패한 복사본 경로는 결과 JSON에 남긴다. CI 환경 계약과 성능은 훅에서 실행하지 않는다. 전체 타입·설치·패키지 소비 검사는 `pnpm check`로 별도 실행한다. Mac은 GUI 격리 어댑터가 미구현이므로 실제 VS Code 검사와 새 커밋 훅이 준비 실패한다.

```sh
pnpm test              # 기능 테스트 watch
pnpm test:run          # 기능 테스트 단일 실행
pnpm test:vscode       # 현재 빌드의 실제 VS Code API 기능 검사
pnpm test:ui           # test:vscode로 위임 (화면 입력 검사는 아님)
pnpm check:development # 개발 규칙·설치 계약 검사
pnpm check:build       # 빌드·배포 패키지 소비 검사
pnpm check             # 전체 검사
```

기능 테스트는 빌드 없이 소스를 직접 검사한다. `check:build`는 필요한 빌드와 패키징을 수행한다. 설치 검사는 임시 프로젝트와 store를 사용하며 첫 설치에 네트워크가 필요하다. 별도 프로젝트 환경변수나 미리 채운 store는 필요하지 않다.

개발할 기능의 계약은 [프로젝트 지식 읽기 안내](.codocs/index.yaml)에서 찾는다. 패키지 간 책임은 [실행 구조](.codocs/development/runtime-architecture.yaml), 코드·테스트·문서 작성 기준은 [개발 안내](.codocs/development/development.yaml), 도구와 빌드 기준은 [개발 환경](.codocs/development/development-environment.yaml)에서 확인한다.

## 실제 VS Code 검사

`pnpm test:vscode`는 현재 소스를 빌드하고 `@vscode/test-electron` 3.1.0으로 VS Code 1.100.0을 자동 준비한다. VSIX나 설치 경로 옵션이 필요하지 않다. 첫 다운로드는 네트워크를 사용하며 `.workbench/vscode-cache`의 버전·OS·아키텍처별 잠금과 파일 내용 해시로 캐시를 재사용한다. 프로필·확장·작업 공간은 실행마다 분리하고 종료 후 삭제한다.

Windows는 별도 데스크톱에서 준비·실행하고 Job Object로 모든 시험 자식을 종료한다. 사용자 창을 숨기거나 포커스를 복원하지 않는다. 외부 foreground/input desktop 표본, 정리 결과, 기능별 결과와 VS Code 로그는 `.workbench/vscode-tests/<실행 ID>`에 남긴다. 빌드·다운로드·fixture·Extension Host·정리 실패는 단계와 함께 비정상 종료한다.

`node tools/vscode-tests/lifecycle.mjs`는 실제 VS Code의 시작 실패·기능 실패·시간 제한·준비 후 취소 경로와 자식 정리를 별도로 검사한다. 기능 검사의 대응 범위와 API/화면 관측 구분은 [이전 대응표](tools/vscode-tests/coverage.md), 공유 실행 계약은 [실행기 안내](tools/test-runtime/README.md)에 있다.

**macOS 격리 실행은 아직 구현·검증되지 않았다.** 현재 Mac에서 명령을 실행하면 창을 열기 전에 준비 실패와 증거 경로를 반환한다. [macOS 검토와 필요한 환경 결정](tools/test-runtime/macos-isolation.md)을 확인한다. Mac 로컬 기능·포커스 수락은 같은 최종 후보 SHA에서 안전한 어댑터 구현 후 사용자 Mac 결과를 받아야 완료된다. Windows 통과나 준비 실패를 Mac 통과로 집계하지 않는다.

## OS 환경 계약과 Mac 인수

CI는 동일 이벤트 SHA를 Windows와 macOS native runner에서 체크아웃하여 `pnpm test:environment`만 실행한다. 필수 링크·권한 준비 실패는 실패로 기록하며 로컬 기능·VS Code·성능 검사는 중복 실행하지 않는다. 두 OS의 같은 SHA가 모두 통과해야 OS 환경 검증 완료다.

[Mac 실행 명령과 결과 수집](tools/ui-tests/verification.md)을 따라 전달된 정확한 SHA에서 로컬 기능과 코어 성능을 확인한다. Windows 결과·사용자 Mac 결과·CI 결과는 각각 기록하며, Mac GUI 격리 미구현과 기존 화면 인수 미검증을 통과로 처리하지 않는다.
