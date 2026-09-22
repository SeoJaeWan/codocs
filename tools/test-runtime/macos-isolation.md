# macOS 포커스 격리의 현재 상태

현재 같은 사용자 GUI 세션에서 VS Code의 시작부터 정리까지 화면 노출과 포커스 이동을 막는 검증된 어댑터가 없다. `pnpm test:vscode`는 macOS에서 창을 만들기 전에 `preparation` 실패를 반환한다. 이것은 기능 검사 통과나 macOS 구현 완료가 아니다. Windows 전용 데스크톱 관측을 macOS 결과로 일반화하지 않는다.

검토한 접근과 제약:

| 접근                                           | 확인한 사실과 남는 문제                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open -g`, `LSUIElement`, accessory activation | 초기 활성화/메뉴 정책은 GUI 격리 경계가 아니다. [Electron activation policy](https://www.electronjs.org/docs/latest/api/app#appsetactivationpolicypolicy-macos)는 accessory 창의 활성화를 허용한다. 전체 실행의 무노출을 보장한다고 볼 근거가 없다.                           |
| prohibited activation policy                   | [Apple의 prohibited 정책](https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy-swift.enum/prohibited)은 창 생성과 활성화를 허용하지 않는다. VS Code의 실제 renderer/Extension Host 경로가 이 정책에서 동작함은 확인되지 않았다.                    |
| LaunchDaemon으로 GUI 세션 회피                 | [Apple 서비스 설계 문서](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html)는 daemon에 WindowServer 접근이 없어서 GUI 앱을 시작할 수 없다고 설명한다. 단순 daemon 이동을 해결책으로 취급하지 않는다. |
| 별도 로그인 GUI 세션 또는 macOS VM             | 사용자 작업 GUI와 경계를 나눌 후보다. 계정·세션/VM 준비, 호스트의 화면/전경 관측, 실패·취소 시 자식 정리를 포함한 추가 구현과 실제 증명이 필요하다. 현재 해결된 방법으로 보고하지 않는다.                                                                                     |

위 검토는 가능한 모든 Mac 기법의 불가능성을 증명하지 않는다. 다음 결정은 기존 Mac의 같은 세션에서 안전한 기법을 더 연구할지, 별도 테스트 계정/GUI 세션 또는 VM을 준비할지다. 사용자 계정 생성·로그인 전환·VM 설치를 자동으로 수행하지 않았다. 검증되지 않은 ordinary launch, 사후 hide, 포커스 복원 fallback은 없다.

어댑터 구현 후에는 같은 후보 SHA에서 `pnpm install --frozen-lockfile`, `pnpm test:run`, `pnpm test:vscode`, `node tools/vscode-tests/lifecycle.mjs`를 실행하고 기능·외부 포커스·잔여 프로세스 결과를 함께 수집해야 한다. 현재 Mac에서 `pnpm test:vscode`로 얻는 준비 실패만으로 수락 조건을 충족할 수 없다.
