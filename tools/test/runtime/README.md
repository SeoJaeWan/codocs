# 공통 테스트 실행 도구

- `process.mjs`: 현재 OS에서 시험 Node 작업을 실행하고 정상·실패·시간 제한·취소 시 자식을 정리한다. Windows는 taskkill /T, macOS는 전용 프로세스 그룹을 사용한다. 창 표시와 포커스 이동을 허용한다.
- `process-worker.mjs`: 작업 완료 뒤에도 루트 프로세스를 유지하여 감독기가 자식을 정리할 수 있게 한다. 감독기 연결이 끊어져도 정리를 요청한다.
- `vscode.mjs`: 고정 버전 VS Code 다운로드·OS별 실행 경로·캐시 무결성 검사.
- `cache-lock.mjs`: 다운로드·빌드 캐시의 동시 사용 제어.
- `read-denial.cjs`: 실제 읽기 실패 fixture. Windows에서는 핸들 공유를 허용한 데이터 범위 잠금, Mac에서는 권한 제한을 사용하고 해제 시 복원한다. 읽기 거부와 감시 등록 실패를 구분한다.

VS Code 기능 사례는 [extension.test.cjs](../../../packages/vscode/src/integration/extension.test.cjs), 실행 진입점은 [run.mjs](../../../packages/vscode/test-runner/run.mjs)다. 실제 화면 렌더링과 포커스 격리는 검증 대상이 아니다.
