# OS별 동작 분리와 VS Code UI 테스트 정리

## 배경

작업 전 CI는 Windows·macOS에서 기능 테스트(`pnpm test`)와 설치한 VSIX의 실제 화면 테스트(`pnpm test:vscode`)를 함께 실행했다.

2026-09-29 UI 테스트 도입 이후 CI 57회(재실행 시도 포함)를 집계한 결과:

- 기능 테스트 실패 7회는 모두 한쪽 OS에서만 발생했다. 원인은 경로 구분자(`.codocs\b.yaml` ≠ `.codocs/b.yaml`), 줄바꿈 차이로 밀린 문자 위치, Windows 파일 잠금, macOS 파일 감시 시점이었다.
- UI 테스트 실패 3회는 모두 두 OS에서 함께 발생했다. 2회는 테스트 유지보수였고, 1회(여러 workspace 폴더의 하위 .codocs 충돌)는 제품 버그였지만 기능 테스트로 재현해 고쳤다.

OS 차이는 기능 테스트에서 드러났고, OS별 실제 화면 테스트는 OS 차이를 잡지 않았다. 반면 UI 테스트는 OS마다 60~90초, 자체 화면 드라이버 약 1,100줄, 2주간 18개 커밋의 유지 비용이 든다.

OS별로 다른 동작이 코드 곳곳에 흩어져 있어 차이를 Windows CI에서야 발견한다. 예를 들어 프로젝트 경로는 안쪽에서 OS 구분자로 다녔고(`discoveryPath`), 화면 표시·변경 계획에서 쓰는 곳마다 `/`로 바꿨다. MCP 결과는 이미 `/`로 바꿔 돌려주고 있었으며, 이제 프로젝트 경로는 안쪽에서도 모든 OS에서 `/`다.

## 목표

OS별로 다른 동작을 platform 또는 경로 모듈(`path.win32`·`path.posix`)을 입력으로 받는 공용 로직으로 분리하고, 한 OS에서 platform을 주입해 두 OS의 결과를 비교 검증한다. 그 결과로 `pnpm test:vscode`와 OS별 CI 없이도 제품 동작을 믿을 수 있게 한다.

## 범위

### OS별 동작 분리

- 경로 구분자·줄바꿈·파일 잠금·파일 감시 등 OS에 따라 달라지는 로직을 찾아 목록으로 정리한다.
- 프로젝트 경로는 모든 OS에서 `/` 형태로 다루고, OS 경로와의 변환은 platform을 주입받는 공용 함수(`toProjectPath`·`toOsPath`)로 모은다.
- OS별 분기가 있는 로직은 `platform`·경로 모듈을 입력으로 받고 기본값은 현재 OS로 한다. 소비하는 쪽은 `process.platform`을 직접 읽지 않고 이를 넘긴다.
- 분리한 기능은 platform을 바꿔 주입하는 기능 테스트로 두 OS의 결과를 한 번에 비교한다. 특정 OS에서만 도는 테스트는 두지 않는다.

### CI와 VS Code UI 테스트 정리

- CI는 Ubuntu에서만 실행한다. `static`·`pack`·`test` job을 병렬로 두고 Windows·macOS job은 없앤다. Ubuntu는 실행 환경이며 Linux 지원 검증이 아니다.
- `pnpm test:vscode`, 실행기(`packages/vscode/test-runner`), `packages/vscode/src/integration`, `@vscode/test-electron` 의존성, 관련 문서를 제거한다.
- 설치한 VSIX의 활성화와 실제 Hover 링크 표시·클릭을 자동으로 검증하는 검사는 없어진다. 사용자가 이를 받아들였다(2026-10-12). VSIX는 구성과 manifest만 확인한다.

## 범위 밖

- 새 기능 추가
- PR #84(문서·구현·테스트 정합성)의 문서 조건과 테스트 대조
- 권한(chmod) 조건으로 건너뛰는 테스트의 정리
- 감시 시점에 의존하는 테스트의 불안정성 정리(별도 테스트 정리 작업)

## 검증

- OS별 동작 목록과 각 항목의 처리 결과(분리한 기능, platform 주입 비교 테스트)를 남긴다.
- typecheck, lint, test, format check와 Ubuntu CI를 통과한다.
- Ubuntu CI에서 platform 조건으로 건너뛰는 테스트가 없다(권한 조건 제외).

## 완료 기준

- OS에 따라 달라지는 동작이 platform을 입력으로 받는 기능에 모여 있고, 두 OS의 결과가 한 OS의 테스트로 비교된다.
- `pnpm test:vscode`와 UI 테스트 실행기·`integration`·`@vscode/test-electron`이 없고, CI에 OS별 job이 없다.
- 설치한 VSIX의 활성화를 더는 검증하지 않는다는 점이 문서에 맞게 적혀 있다.
