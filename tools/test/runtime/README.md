# 공통 테스트 실행 도구

- `release-ci.mjs`: CI 실행에 사용할 고정 stable 버전과 같은 최종 공개 후보를 준비한다.
- `read-denial.cjs`: 실제 읽기 실패 fixture. Windows에서는 핸들 공유를 허용한 데이터 범위 잠금, Mac에서는 권한 제한을 사용하고 해제 시 복원한다. 읽기 거부와 감시 등록 실패를 구분한다.

VS Code 실제 UI 사례는 [extension.test.cjs](../../../packages/vscode/src/integration/extension.test.cjs), CI 전용 실행 진입점은 [ui/run.mjs](../../../packages/vscode/test-runner/ui/run.mjs)다. 공식 helper의 다운로드·CLI 설치·Host 실행을 순차 준비하고 실행별 경로와 실제 실패·취소·시간 제한의 정리를 소유한다. 자세한 계약은 [검증 안내](../../../packages/vscode/src/integration/verification.md)에 있다.
