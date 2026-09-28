# Windows·Mac 공통 검증

저장소의 고정 Node·pnpm 버전을 사용한다. 로컬에서는 현재 OS에서 실행하고 CI는 Windows·Mac 각각에서 같은 명령을 실행한다.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:vscode
node packages/vscode/test-runner/lifecycle.mjs
```

`test:vscode`는 현재 소스를 빌드하고 고정된 `@vscode/vsce`로 VSIX를 패키징·설치한 뒤 실제 VS Code 창을 연다. 제품은 설치된 확장 경로에서 로드하며 별도의 빈 개발 확장은 테스트 진입점만 제공한다. 전체 기능 사례를 한 번 실행하므로 개발용·설치용 검사를 중복하지 않는다. 개인 프로필과 별개의 임시 프로필·확장·작업 공간을 사용한다. 커밋 훅에서는 실행하지 않는다.

기능 시나리오는 [extension.test.cjs](extension.test.cjs), 준비·반복 실행은 [index.cjs](index.cjs), 실행기는 [test-runner](../../test-runner)에 있다. 공통 실행 도구는 [test-runtime](../../../../tools/test/runtime)에 있다.

`.workbench/vscode-tests/<실행 ID>/result.json`은 실행 OS·HEAD·작업 트리 diff·단계·정리 결과를 기록한다. `codocs.vsix`와 `installation.json`은 검사한 패키지·해시·설치 결과이고, `functional.json`은 설치된 확장 경로와 개별 시나리오의 결과이며 `logs/`와 `process.log`에 VS Code·서버 로그를 보관한다. 실패한 검사를 통과로 보고하거나 실행하지 않은 OS를 통과로 추정하지 않는다.

`.workbench/vscode-lifecycle`은 의도한 시작 실패·기능 실패·시간 제한·취소의 결과를 보관한다. 한 OS의 기능·정리 통과는 다른 OS의 실행 결과를 대신하지 않는다. 일반 식별자 기능은 provider API 관측이다. 명시 코드 참조의 whole-code-inlay 사례는 private 프로필의 renderer DOM·스크린샷으로 표시·설정 off/on·일반 클릭 보존·단일 Meta/Ctrl 이동 제스처를 실제 관측하며 code-ui-*.json/png에 기록한다. 실행하지 않은 화면 제스처는 검증됐다고 추정하지 않는다.

## COD-29의 같은 후보 설치 검사

실행 시 `--resolve-version stable`을 한 번 호출하고 받은 정확한 버전을 고정한다. 최소 1.100.0과 고정 stable의 기능·lifecycle은 같은 tgz/VSIX를 전달한다. byte hash와 source receipt를 함께 기록하고 Windows/macOS 결과를 따로 판정한다.

```sh
pnpm release:pack
pnpm release:verify <candidate-tgz> <candidate-vsix>
node packages/vscode/test-runner/installed-mcp.mjs <same-candidate-tgz>
node packages/vscode/test-runner/run.mjs --vscode-version <exact-version> --vsix <same-candidate-vsix> --mcp-tgz <same-candidate-tgz>
node packages/vscode/test-runner/lifecycle.mjs --vscode-version <exact-version> --vsix <same-candidate-vsix>
```

standalone installed MCP는 VS Code 없이 explicit project/cwd를 사용한다. 행 안/앞/뒤 변경·삭제·문서 전체·이름/도메인·반복 대응·계산 제한과 수집/저장/색인 실패를 실행하고 실제 saved·revision·indexUpdated와 안내 상태를 따로 검증한다. 설치 consumer·fixtures·자식을 종료 후 정리하고 result.json에 증거를 남긴다.
