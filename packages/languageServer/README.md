# languageServer

LSP 요청/응답을 workspace/core로 연결할 어댑터다. 허용 의존성은 `@codosc/workspace`, `@codosc/core` 공개 진입점이며 vscode에 역방향 의존하지 않는다. 현재 빈 모듈이므로 Hover, 진단, 서버 시작, 공개 함수, 오류·프로세스 상태 전이는 없다.

`@codosc/language-server`는 private 내부 패키지다. ESM TypeScript source를 esbuild로 CJS `dist/index.cjs`에 번들한다. 타입 선언 `dist/index.d.ts`는 별도 tsc 검사/emit으로 생성한다. package type module 및 .cjs 확장자로 실행 형식을 명시한다. ESM core/workspace 소비가 CJS bundle에서 실제 로드되는 후보를 시험했다.

IDE target은 node20.19다. VS Code 1.100.0의 [고정 Node 설정](https://github.com/microsoft/vscode/blob/1.100.0/.nvmrc)이 20.19.0이므로 문법 하한 후보로 선택했다. 공유 TypeScript는 ES2022/NodeNext이며 types: []로 호스트 전역 타입을 자동 추가하지 않는다. 현재 소스에는 Node 런타임 API가 없다. target은 API를 polyfill하지 않으며 Node 20 및 VS Code 1.100.0의 실제 호환성을 검증한 결과가 아니다.

기능과 test는 `src/기능/`에 함께 둔다. build에서 test/spec를 제외한다. 실제 CJS require/ESM import, d.ts 소비자와 의도적 tsc 오류 대비 독립 esbuild 성공을 시험한다. 서버 bundle/map은 vscode의 `dist/server/`에도 배치된다. 시험한 환경은 Windows x64 / Node 24.21.0 / pnpm 10.34.5다. 실제 LSP 연결/IDE 기능 및 npm 단독 설치 시험은 없다.
