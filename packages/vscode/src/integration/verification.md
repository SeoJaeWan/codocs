# CI의 Windows·macOS 실제 UI 검사

CI가 한 번 확정한 동일 exact stable 버전과 동일 최종 후보 VSIX를 두 OS에 전달한다. 소스 빌드와 패키징은 UI 실행 전에 끝나 있어야 한다.

```sh
pnpm test:vscode --version <exact-stable> --vsix <absolute-candidate.vsix> --output <absolute-new-evidence-directory>
```

`CI=true`와 Windows/macOS가 필수다. `stable`, `insiders`, 상대 VSIX 경로, 이전 output 디렉터리는 거부한다. 선택적 `--timeout-ms`는 30000–1800000이고 기본 600000이다. 로컬 GUI 실행과 의도한 실패/timeout/cancel lifecycle suite는 지원하지 않는다.

공식 `@vscode/test-electron` helper가 job 전용 download 경로에 준비하고 CLI로 VSIX를 설치한 뒤, 공식 `runTests`로 빈 harness와 실제 설치 확장을 실행한다. 사용자 profile·extensions·workspace는 짧은 실행별 임시 디렉터리에 격리한다. 개발 확장은 테스트 entry만 제공하고 Codocs는 설치된 VSIX 경로에서만 로드되는지 검사한다. 설치 확인은 활성화 및 서버가 게시한 진단 응답까지이며 첫 Hover를 중복하지 않는다.

`installation.json`은 설치 확장 경로/버전·API 활성화·서버 응답을, `functional.json`은 renderer 입력을 사용하는 개별 사례 결과를 기록한다. `result.json`은 exact 버전·최종 VSIX SHA-256·OS·단계·통과/실패/취소/시간 초과·정리 상태를 기록한다. 성공은 exit 0과 passed/cleaned true로만 판정한다. 실패 때 screenshot, `process.log`, `vscode-logs/`를 보존하며 수집 오류가 원래 오류를 덮지 않는다. `worker.json`은 준비 단계 추적용이다.

CI는 runner의 종료 코드로 성공을 판정한다. 설치 응답, 아홉 대표 사례의 실제 마우스 입력·복원·정리 중 하나라도 실패하면 runner가 0이 아닌 코드로 끝나며, 양 OS job이 같은 pack artifact의 VSIX를 검증한다. ready PR의 `required-ci`는 모든 job이 성공해야 통과한다.

실제 실패·timeout·SIGINT/SIGTERM에서 소유 worker 트리를 공식 helper로 제한 시간 안에 정리한다. 정리 실패도 비정상 종료이며 임시 경로를 result에 남긴다. 각 UI 사례는 dirty fixture를 되돌리고 기준 파일을 복원하며 복원 실패도 검사 실패다. UI DOM·OS 입력·Output 로그 위치의 최종 수락은 정확한 후보의 양 OS GitHub 결과로만 확정한다.

대표 시나리오와 제거한 API assertions의 책임은 [coverage.md](coverage.md)에 있다. 인접 driver/CLI 테스트는 `pnpm test`에서 GUI 없이 실행한다. renderer/provider 알고리즘을 광범위하게 mock으로 재검사하지 않는다.
