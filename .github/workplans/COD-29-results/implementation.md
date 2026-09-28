# COD-29 제품 구현과 설치 검증

TASK-001의 명시 표기·검색 정책·source token, TASK-002의 저장 영향 안내를 TASK-003의 IDE 표현과 연결한다. 승인된 첫 행 Inlay Hint와 명시 숫자 행 이동을 유지한다.

제품 검증 결과는 실제 OS·VS Code 버전·설치한 tgz/VSIX byte hash별로 기록한다. 원문 parser·index 단위 시험과 macOS 시제품만으로 제품 종단 또는 Windows 통과를 주장하지 않는다. Windows의 같은 후보 검증이 남으면 전체 AC-009는 잠정 결과다.

## 구현

- 정상 명시 span을 직접 문서 링크로 연결하고 잘못된 span은 기존 ID 설명 대신 구별 가능한 밑줄·이유를 제공한다.
- 문서 행 역참조는 정확한 출현 합집합과 경로·행·열별 개별 링크를 제공한다. 완료 단일 연결은 직접 이동하고 기존 YAML 이름 링크의 정확한 영역은 유지한다.
- 문서 전체 출현만 첫 행 앞 Inlay Hint에 집계한다. 완료 1곳은 IDE 이동 제스처, 복수는 개별 tooltip 링크, 완료 0곳은 제거한다. collecting/incomplete는 완료 단일·부재와 구분하며 원문·dirty·행 수와 editor 설정을 보존한다.
- 출처 소유 client와 opaque token의 서버·버전·현재 표기·파일 정체를 확인한다. dirty 대상은 현재 buffer의 명시 숫자 시작·끝 행을 모두 확인하고 정확한 marker 이동은 현재 text도 확인한다.
- 한국어 담당 `.codocs`, 영문·국문 README, 작성·갱신 가이드와 언어 공통 예시를 동기화했다. 미결이던 상단 표시는 승인된 Inlay Hint로 기록했다.

## 같은 후보의 실제 설치 검증

실행 시 stable을 한 번 조회하여 `1.139.1`로 고정했다. 최소 버전은 `1.100.0`이다. 아래 실제 실행은 모두 같은 후보 `candidate-pKuklE`의 tgz·VSIX를 사용했다.

| 실행 환경                                    | 검사                                               | 결과                                           |
| -------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| macOS arm64 / Node 24.21.0 / VS Code 1.100.0 | 설치한 tgz·VSIX 기능 63개                          | 통과, 전용 실행 디렉터리 정리, 잔류 프로세스 0 |
| 같은 환경 / VS Code 1.100.0                  | 시작 실패·기능 실패·시간 초과·취소의 lifecycle 4개 | 통과, 각 잔류 프로세스 0                       |
| macOS arm64 / Node 24.21.0 / VS Code 1.139.1 | 설치한 tgz·VSIX 기능 63개                          | 통과, 전용 실행 디렉터리 정리, 잔류 프로세스 0 |
| 같은 환경 / VS Code 1.139.1                  | 같은 lifecycle 4개                                 | 통과, 각 잔류 프로세스 0                       |
| VS Code 없이 독립 설치 MCP / Node 24.21.0    | 저장 영향·검색 정책·실패 보존 14개                 | 통과, EOF 종료·fixture 정리 확인               |
| Windows / 두 VS Code 버전                    | 같은 후보의 기능·lifecycle                         | 미실행, 전체 AC-009 잠정                       |

제품 설치 검사는 명시 Unicode/CRLF span·오류 이유, dirty 행 11~12 선택과 끝 행 부재 거부, 같은 행의 정확한 열·겹친 역참조·YAML 우선, 실제 Inlay 화면 2→1→0·off/on·일반 클릭 이동 없음·Meta/Ctrl 이동 제스처, 불완전 확인 1곳·0곳과 복구, Git 추적·ignore·재포함·검색 경계 및 오래된 토큰 거부를 포함한다. Inlay 화면은 전용 renderer의 DOM·실제 입력·스크린샷으로 관측했다. 기존 ID/YAML 사례는 provider/API 관측이며 화면 렌더링 전체를 검사했다고 주장하지 않는다.

독립 MCP는 저장 전 출현을 유지한 구간 내부·앞·뒤·삭제·문서 전체·이름·도메인·반복 원문의 possible impact, 검증된 무변경, 계산·수집·색인·저장 실패 보존을 확인했다. 비 Git 정책과 살아 있는 MCP에서 Git 추적 제거·ignore 변경 뒤 재수집도 검사했다. 저장 영향 결과에 전후 전체 원문을 추가하지 않는다.

- tgz SHA-256: `55b5d3adf5ce247850e344de7736a65959f3f136f6060bd83226002c6a1bf32a`
- VSIX SHA-256: `cc2fe4fe9a8736e215ae49398cdaab2e5b46bb67c974f95f6def2e484acbde08`

`pnpm release:verify`도 같은 두 파일로 통과했다. 패키징 후의 변경은 설치 시험 harness·관측 문서·결과 기록에 한정되며 제품 source는 후보 receipt와 같다. 파일 hash와 이 차이를 별도 증거로 검증한다. 초기 실패 실행도 보존하며 최종 통과 결과로 덮어쓰지 않는다.

## 검증 경계

전체 `pnpm check`와 정상 pre-commit hook의 최종 결과는 worker Task Result에 정확한 commit/tree와 함께 기록한다. 소유 범위 밖 producer·workflow·hook·lockfile·사용자 MCP 설정과 PR의 base·draft·본문은 변경하지 않았다. TASK-001과 TASK-002는 직렬 ancestor이며 별도 병합이 없다.

Windows는 이 macOS worker에서 검증하지 않았다. 후속 delivery가 같은 후보와 고정 버전을 기존 Windows/macOS CI matrix에 연결해 실제 Windows 증거를 확보하기 전까지 전체 AC-009와 최종 승인 상태는 잠정이다. Linux 지원 결과로도 확장하지 않는다.
