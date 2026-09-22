# 공식 VS Code 검사로 이전

기본 `pnpm test:ui`는 `pnpm test:vscode`와 같은 공식 Extension Host 기능 검사를 실행한다. VSIX나 수동 VS Code 설치 경로가 필요하지 않다.

[기존 화면 사례의 기능 대응표](../vscode-tests/coverage.md)와 [실행·격리·증거 계약](../test-runtime/README.md)을 확인한다. API 결과를 화면 렌더링·실제 마우스 제스처 검사로 보고하지 않는다. 기존 Playwright 소스는 비교용으로 남기며 직접 실행은 지원하는 검증 진입점이 아니다.

Windows 결과는 해당 실행 디렉터리의 `functional.json`과 외부 `isolation.json`을 함께 판단한다. macOS는 현재 검증된 안전한 어댑터가 없어 GUI 실행 전 준비 실패를 반환하며 미검증이다.
