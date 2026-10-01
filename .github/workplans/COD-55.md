# COD-55 — 배포 전 MCP·VS Code 확장을 직접 실행하는 스크립트와 「직접 실행하기」 문서

h2. 배경

배포 전에 변경을 직접 써 보려면 지금은 VS Code 확장만 문서의 OS별 긴 {{code ...}} 명령을 복사해 실행할 수 있고, MCP 서버는 직접 실행하는 절차가 없다. PR → CI → 배포까지 가야 실제로 써 볼 수 있으면 확인이 늦고 배포 안정성이 낮아진다(COD-43 작업 중 확인).

개발 빌드({{pnpm build}})와 배포 파일({{release:pack}})은 동작이 같다. VSIX는 개발 빌드의 {{dist}}를 그대로 담고, MCP는 배포 시 esbuild로 한 번 더 번들하지만 같은 소스를 묶을 뿐이며 가이드 경로·버전도 같은 대상으로 해석된다. 따라서 직접 실행은 개발 빌드를 대상으로 하고, 번들 자체의 문제는 {{release:verify}}가 맡는다.

h2. 범위

* 루트 package.json에 사람이 직접 실행하는 스크립트를 추가한다(이름은 이 이슈에서 정한다. 예: {{dev:vscode}}, {{dev:mcp}}).
** VS Code: VS Code CLI의 {{--extensionDevelopmentPath}}로 개발용 창을 연다. {{--user-data-dir}}·{{--extensions-dir}}은 {{.workbench/}} 아래로 분리한다.
** MCP: 공식 MCP Inspector로 {{packages/mcp/dist/cli.js --project .}}를 실행해 도구 목록을 보고 직접 호출한다. Inspector는 devDependency로 버전을 고정한다.
* 스크립트는 공식 도구의 CLI를 그대로 호출하며 별도 JS 실행 스크립트를 만들지 않는다.
* macOS(sh)와 Windows(cmd)에서 같은 스크립트가 동작해야 한다. 셸 변수({{$PWD}} 등) 없이 상대 경로만으로 동작하는지 확인한다.
* 스크립트에 빌드를 포함할지({{pnpm build &&}})는 이 이슈에서 정한다.
* 문서
** 「VS Code에서 직접 실행하기」를 「직접 실행하기」로 바꾸고 MCP 실행을 추가한다. OS별 긴 명령은 스크립트 사용법으로 대체한다.
** 「개발 환경」의 스크립트 목록에 새 스크립트를 추가한다.

h2. 검증

* macOS·Windows에서 각 스크립트로 개발용 VS Code 창과 MCP Inspector가 열린다.
* 개발용 창에서 코드 호버·원문 이동이 동작하고, Inspector에서 MCP 도구를 호출할 수 있다.
* 커밋 훅의 타입 검사, lint, 테스트, 포맷 검사를 통과한다.

h2. 완료 기준

* 배포 전에 MCP와 VS Code 확장을 {{pnpm}} 명령 한 줄로 직접 실행해 볼 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-55
