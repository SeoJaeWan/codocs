# vscode

VS Code에서 언어 서버를 실행하고 연결할 확장 경계다. core/workspace 도메인 함수를 직접 호출하지 않는다. 현재 빈 모듈만 있으며 activation, 서버 실행, 확장 명령과 IDE 기능은 구현하지 않았다.

내부 패키지의 소스 import는 금지한다. 언어 서버 실행 파일의 배치와 VS Code용 번들 진입점은 후속 빌드 작업에서 결정한다. 현재 `@codosc/vscode`는 private 개발 패키지이며 npm 게시와 VSIX 배포가 구성되지 않았다.

기능은 `src/기능/index.ts`, `src/기능/기능.test.ts`에 함께 둔다. README에는 확장 생명주기, 프로세스 오류 및 상태, 실제 VS Code/VSIX 시험 범위를 기록한다. 개발 검사 통과를 실제 IDE 시험 완료로 표시하지 않는다. 개발용 Node 24 제약을 확장 호스트 지원 요구로 일괄 적용하지 않는다.
