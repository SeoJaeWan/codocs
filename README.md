# codocs

Codocs는 `.codocs` YAML에 프로젝트의 용어·동작·정책을 기록하고, 문서 간 참조와 코드 식별자 매칭으로 관련 지식을 찾는 도구다.

문서를 처음 작성한다면 [작성 가이드](docs/guide/README.md)와 [가상 프로젝트 예시](examples/.codocs)부터 확인한다.

현재 이 저장소는 파싱·검증·파일 탐색·색인·코드 매칭, 변경 후보 계산과 MCP 조회 handler를 제공한다. 실행 가능한 MCP stdio 서버, LSP·VS Code 연동, 파일 감시와 저장 기능은 아직 제공하지 않는다.

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

```sh
pnpm test              # 기능 테스트 watch
pnpm test:run          # 기능 테스트 단일 실행
pnpm check:development # 개발 규칙·설치 계약 검사
pnpm check:build       # 빌드·배포 패키지 소비 검사
pnpm check             # 전체 검사
```

기능 테스트는 빌드 없이 소스를 직접 검사한다. `check:build`는 필요한 빌드와 패키징을 수행한다. 설치 검사는 임시 프로젝트와 store를 사용하며 첫 설치에 네트워크가 필요하다. 별도 프로젝트 환경변수나 미리 채운 store는 필요하지 않다.

개발할 기능의 계약은 [프로젝트 지식 읽기 안내](.codocs/index.yaml)에서 찾는다. 패키지 간 책임은 [실행 구조](.codocs/development/runtime-architecture.yaml), 코드·테스트·문서 작성 기준은 [개발 안내](.codocs/development/development.yaml), 도구와 빌드 기준은 [개발 환경](.codocs/development/development-environment.yaml)에서 확인한다.
