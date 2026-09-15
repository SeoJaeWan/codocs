# vscode

VS Code에서 언어 서버를 실행하고 연결할 확장 경계다. core/workspace 도메인 함수를 직접 import하지 않는다. 현재 빈 모듈이므로 activation, 명령, 서버 실행/연결, 공개 함수, 확장 생명주기·오류 및 상태 흐름이 없다.

`@codocs/vscode`는 private 개발 패키지다. esbuild는 CJS `dist/index.cjs`를 생성하고 vscode 모듈을 호스트 제공 external로 유지한다. package main/import/require가 이 파일을 가리키며 type module에서 .cjs로 실행 형식을 명시한다. d.ts는 별도 tsc 검사/emit으로 만든다. 언어 서버 CJS bundle/map은 `dist/server/`에 복사한다. 실행 연결 코드는 후속 범위다.

node20.19 target은 VS Code 1.100.0의 [고정 Node 설정](https://github.com/microsoft/vscode/blob/1.100.0/.nvmrc)에 근거한 문법 하한 후보다. ES2022/NodeNext와 types: []를 사용하며 현재 소스에는 호스트 API가 없다. esbuild target이 Node API를 보완하지 않는다. 개발 Node 24 요구를 확장 호스트 engines 요구로 일괄 적용하지 않는다. 실제 VS Code 1.100.0 호환성 시험은 아직 없다.

가이드와 가상 예시는 `dist/docs/guide`, `dist/examples/.codocs`에 배치하고 package files에 dist를 포함한다. 사용자 문서 저장 시 전체 재포맷 동작은 없다. 기능과 test는 `src/기능/`에 함께 두며 build에서 test/spec를 제외한다.

실제 CJS require/ESM import, 소스 없는 TS d.ts 소비자, vscode external 및 packed asset 포함을 시험했다. 시험 환경은 Windows x64 / Node 24.21.0 / pnpm 10.34.5다. 모듈 로드는 VSIX activation/IDE 기능 시험의 대체가 아니다. VSIX 배포와 npm 단독 설치·게시를 구성하거나 검증하지 않았다.

## 현재 파일 역할

`src/index.ts`는 후속 연동을 위한 패키지 진입점이다. 현재 빈 모듈이며 실제 VS Code activation과 명령 등록은 구현하지 않았다.
