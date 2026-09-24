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

`.workbench/vscode-lifecycle`은 의도한 시작 실패·기능 실패·시간 제한·취소의 결과를 보관한다. 한 OS의 기능·정리 통과는 다른 OS의 실행 결과를 대신하지 않는다. 화면 픽셀·마우스 제스처는 자동 검증 범위에 포함하지 않는다.
