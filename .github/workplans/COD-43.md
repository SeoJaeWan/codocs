# COD-43 — COD-42 후속 검토: 구현·문서 불일치, 미구현 계약 및 테스트 공백

선행 작업: [COD-42|https://seojaewan.atlassian.net/browse/COD-42], [PR #55|https://github.com/SeoJaeWan/codocs/pull/55].

목적: 링크 정비 과정에서 발견한 문제를 근거와 함께 검토한다. 10개 항목을 모두 확정된 버그로 취급하지 않으며, 정책 판단과 구현 범위를 합의한 뒤 필요한 세부 이슈를 분리한다. 완료 기준은 항목별 판정·우선순위·조치 또는 보류 사유를 기록하고 필요한 후속 범위를 결정하는 것이다.

h1. COD-42 후속 검토 목록

h2. 작업 결과와 이 목록의 의미

문서 중복 한 문장을 정리하고 5개 패키지에 명시적 링크 311개를 추가했다. Core 62개, 작업 공간 91개, MCP 45개, Language Server 58개, VS Code 55개다.
링크는 담당 구현과 실제로 확인한 테스트 조건을 연결한다. 문서의 모든 조항이나 모든 플랫폼을 빠짐없이 검증했다는 의미는 아니다.
아래 항목은 이번 작업에서 수정하지 않았다. 사용자와 검토한 뒤 후속 이슈를 하나로 묶거나 원인별로 나눈다. 이 이슈에서 후속 검토 항목을 추적한다. 세부 이슈 분할은 사용자와 검토 후 결정한다.
최종 기준 커밋: 09595828c88e29b1412707da06970973d293067f.
관련 결과 커밋과 검증 기록은 같은 폴더의 checkpoint.json, link-verification.json, mcp-verification.json에 보관했다.

h2. 재현한 동작과 문서의 불일치

h3. 1. Core: Windows 절대 경로가 변경 후보로 허용됨

* 문서 기준: .codocs/core/change-plan/document-change-plan.yaml:25는 절대 생성 경로를 거부한다.
* 구현 근거: packages/core/src/change-plan/index.ts:470의 경로 검사는 /로 시작하는 경로와 역슬래시를 검사하지만 C:/project/.codocs/new.yaml을 허용한다.
* 재현: 완전한 빈 색인과 유효한 문서를 넣어 빌드된 공개 planDocumentChange를 호출하면 해당 경로에 대해 status:candidate와 빈 진단을 반환했다.
* 테스트 상태: 인접 테스트의 절대 경로 거부 사례는 POSIX 경로를 사용한다.
* 후속 검토: 변경 후보 계산에서 Windows 절대 경로도 거부하도록 할지 문서와 구현을 대조하고 회귀 사례를 추가한다.
* 한계: 후보 계산 단계에서 재현한 문제다. 실제 저장 단계에서 외부 파일을 쓸 수 있다는 사실까지 입증한 것은 아니다.

h3. 2. Language Server: 작업 공간 제거 중 진행된 매칭이 이전 결과를 반환함

* 문서 기준: .codocs/language-server/document-sync.yaml:49는 소속 변경 시 결과를 무효화하도록 규정한다.
* 구현 근거: packages/language-server/src/server-session/index.ts:761–781은 비동기 매칭 뒤 문서의 객체·버전·텍스트를 확인하지만 작업 공간 소속은 다시 확인하지 않는다.
* 재현: 매칭 응답을 지연시킨 상태에서 작업 공간을 제거하고 문서 내용은 그대로 둔 뒤 기존 응답을 완료하면, 제거된 workspaceUri가 success:true로 반환됐다.
* 테스트 상태: server-session.test.ts:310에서 시작하는 기존 사례는 문서 내용·버전 변경을 다루며, 내용이 동일한 상태의 작업 공간 제거를 검증하지 않는다.
* 후속 검토: 비동기 응답의 작업 공간 수명·소속 확인과 회귀 테스트를 함께 검토한다.

h2. 문서에 있지만 대응 구현을 찾지 못한 계약

h3. 3. 작업 공간: 여러 문서의 이름 변경 반영·실패 복구

* 문서 기준: .codocs/workspace/storage/rename-application.yaml:11–20은 사전 확인, 원문 변경 처리, 부분 저장 복구, 파일별 실패 보고와 YAML 보존을 설명한다.
* 조사 결과: 현재 작업 공간 저장 구현은 문서 하나를 쓰며, 여러 파일의 이름 변경을 적용·복구하는 구현과 인접 테스트를 찾지 못했다.
* 후속 검토: 미구현 계약의 현재 상태와 후속 범위를 확인한다. 단일 파일 저장 테스트를 이 계약의 검증 근거로 삼지 않는다.
* 구분: 이름 변경 후보를 계산하는 기능과 여러 파일에 실제로 반영하는 기능은 별개다.

h3. 4. MCP: 저장에 따른 코드 연결 영향 안내

* 문서 기준: .codocs/mcp/write-impact.yaml의 영향 안내 계약.
* 구현 근거: packages/mcp/src/query/index.ts:189는 session.write에 바로 위임하고, server/index.ts:152–155는 결과를 실행·포장한다.
* 조사 결과: 저장 전후 코드 연결을 비교하는 계산, 영향 응답 구조와 관련 테스트를 찾지 못했다. 기존 역참조 API가 있다는 사실은 저장 영향 안내의 구현을 의미하지 않는다.
* 후속 검토: 기존에 분리된 후속 범위와 현재 문서 상태를 확인하고 별도 구현 여부를 결정한다.

h2. 테스트 검증 공백

h3. 5. Core: Unicode 정규화와 원문 위치 보존 사례

* 문서 기준: .codocs/core/duplicate-detection/duplicate-detection.yaml:25.
* 구현 근거: packages/core/src/duplicate-detection/segments.ts:183에서 normalize('NFC')를 호출한다.
* 조사 결과: 조합형·분해형 Unicode 문자열 쌍의 중복 판정과 각 원문 위치를 명시적으로 확인하는 검증문을 찾지 못했다.
* 상태: 추가 확인이 필요한 테스트 공백 후보다. 구현 오류로 확정하지 않는다.
* 후속 검토: 일반 공백 정규화 테스트와 구분해 해당 입력·원문 좌표 사례가 필요한지 확인한다.

h3. 6. 작업 공간: 후보 revision의 실제 해시 일치 검증

* 문서 기준: .codocs/workspace/change-plan/workspace-change-plan.yaml:25는 후보 UTF-8 바이트의 SHA-256을 요구한다.
* 테스트 근거: packages/workspace/src/change-plan/change-plan.test.ts:58에서 시작하는 사례의 최종 검증문은 83행에서 64자리 16진수 형식을 확인한다.
* 공백: baseRevision은 확인하지만 후보 바이트에서 독립적으로 계산한 해시와 candidate revision이 같은지는 확인하지 않는다.
* 후속 검토: 형식 검증을 실제 값의 일치 검증으로 보완할지 결정한다. 현재 revision 계산이 잘못됐다고 단정하지 않는다.

h3. 7. Language Server: 자동완성 미제공의 명시적 검증

* 계약: 현재 자동완성 기능을 제공하지 않는다.
* 테스트 근거: packages/language-server/src/server/server-process.test.ts:331의 기능 목록 검증은 부분 객체 비교이며 completionProvider의 부재를 명시적으로 확인하지 않는다.
* 후속 검토: 기능 미제공 계약을 별도 검증문으로 보호할지 결정한다. 자동완성 기능 추가 요청은 아니다.

h2. 정책 해석을 함께 결정할 항목

h3. 8. VS Code: 이동 명령 입력의 추가 속성 허용

* 문서 기준: .codocs/vscode/open-source.yaml:43은 source와 token만 허용한다고 설명한다.
* 구현 근거: packages/vscode/src/open-source/index.ts:120–128의 validSourceArgument는 유효한 sourceUri/token에 uri·destination 속성이 추가된 객체도 허용한다. 빌드된 코드 호출로 확인했다.
* 실제 이동: 173·192행에서는 서버가 확인한 응답을 사용하므로 추가 속성은 이동 대상을 정하지 않는다.
* 상태: 추가 필드를 거부해야 하는지, 무시하는 것이 계약에 맞는지 판단할 입력 정책의 모호함이다. 이동 대상 확인 우회가 재현된 것은 아니다.
* 후속 검토: 문서의 “허용”이 엄격한 속성 제한인지 입력 사용 범위 설명인지 사용자와 확인한다.

h2. 기존 문서·도구 기록 문제

h3. 9. 예시 참조가 실제 대상 없는 참조로 진단됨

* 위치: .codocs/core/references/reference-extraction.yaml:19의 예시 [[이름]].
* 관측: 프로젝트 경로를 명시한 MCP 문서 검증에서 reference_not_found 1건이 발생했다.
* 상태: 이번 작업 전부터 존재한 진단이며 원문은 변경하지 않았다.
* 후속 검토: 예시를 리터럴로 표현할지, 문서 작성 규칙 또는 참조 처리와 함께 검토한다.

h3. 10. 기존 PR 작업 계획 파일의 포맷 검사 실패

* 위치: .github/workplans/COD-42.md.
* 관측: 전체 prettier . --check는 이 파일 때문에 실패했지만 이번 변경 파일의 포맷 검사는 통과했다.
* 동일성 근거: 파일 blob 6149f672c86c00430b30153056d57a379249b44e는 시작 커밋·문서 정리 기준·최종 통합에서 동일하다.
* 후속 검토: 작업 계획 생성 형식과 저장소 포맷 기준을 확인한다. 자동화 결함인지까지는 아직 확정하지 않았다.

h2. 검증 결과와 한계

* 최종 커밋 훅의 타입 검사, Vitest 1,208개 통과·11개 건너뜀, Node 테스트 39개 통과.
* 전체 lint·build와 변경 소스 포맷 검사 통과. 전체 포맷 검사에는 위의 기존 실패가 남아 있다.
* 새 링크 311개가 실제 참조 해석기로 해석됐다. 소스 93개는 주석을 제외한 AST가 동일하다.
* 문서 변경은 합의한 저장 문장 1개 삭제뿐이다.
* MCP는 /tmp에서 클라이언트를 실행하되 --project로 통합 checkout을 지정했다. 문서 검증 탐색은 완료됐고 기존 진단 1건만 남았다.
* 중복 검사는 79개 문서에 대해 완료됐다. 조회 결과 구성 64행과 문서 검증 요청 26행의 정상 참조 안내 후보 1건만 남았으며 완전 일치 후보·남은 페이지는 없다.
* 실제 VS Code GUI 검사는 실행하지 않았고 Windows 전용 테스트는 macOS에서 건너뛰었다.
* 링크가 있다는 사실만으로 모든 규칙의 구현·테스트가 완전하다고 판단하지 않는다.
* 위 검증은 COD-42의 로컬 통합 완료 시점에 수행했다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-43
