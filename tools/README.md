# 개발 도구

| 위치                  | 역할                                                     |
| --------------------- | -------------------------------------------------------- |
| `build/build.mjs`     | 빌드·번들·타입 검사                                      |
| `build/check/`        | 빌드 결과와 배포 패키지 소비 검사, 해당 검사의 입력 코드 |
| `test/run.mjs`        | Vitest 로직 검사와 Node 도구 테스트 수집·실행            |
| `test/runtime/`       | 실제 프로세스·VS Code 다운로드·캐시·읽기 제한 준비       |
| `test/support/`       | 여러 패키지 테스트가 공유하는 보조 코드                  |
| `git/`                | 커밋 훅, 스테이징 서식 처리, 격리 복사본 검사            |
| `toolchain.mjs`       | 저장소 루트와 고정 Node·pnpm 실행 환경 확인              |
| `development-checks/` | 개발 규칙의 ESLint 구현과 회귀 검사                      |
| `performance/`        | 코어 조회·초기 준비·변경 반영 성능 측정                  |

각 도구의 테스트는 구현과 같은 폴더에 둔다. 패키지 전용 보조 코드와 mock은 해당 패키지의 `test-support`에서 관리한다.

- `pnpm test`: 제품 로직 및 도구 테스트. `--watch`를 붙이면 Vitest 로직 검사를 감시한다.
- `pnpm check`: package.json에서 타입·린트·서식·빌드·로직·개발 규칙·배포 검사를 순서대로 실행한다.
- `pnpm test:vscode`: [패키지 실행기](../packages/vscode/test-runner/run.mjs)에서 VSIX 설치와 실제 VS Code 기능을 검사한다. 시나리오는 [통합 테스트](../packages/vscode/src/integration/extension.test.cjs)에 있다.

VS Code 검사와 성능 측정은 커밋 훅에 포함하지 않는다. 실제 Hover 성능 측정은 [PR #33](https://github.com/SeoJaeWan/codocs/pull/33)의 후속 범위다.
