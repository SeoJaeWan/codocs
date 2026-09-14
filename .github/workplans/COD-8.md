# COD-8 — 이름 기반 문서 참조와 순수 이름 변경 계획

## 범위와 현재 합의

이 문서는 main 기반 COD-8의 현재 합의다. PR #5의 이전 ID 기반 참조 작업안을 대체하며 예전 feature 브랜치를 merge하지 않는다. ID는 전역 유일 식별 값이고 참조 키가 아니다. 계산 API와 실제 로더/스캔 연결, 공개 배포 소비자와 이름 기반 예제/문서를 이번 범위로 한다. UI·Hover·LSP/MCP 연결·watcher·실제 rename·다중 파일 writer/복구는 제외한다. 기존 validateDocument, MCP ID get/list, 단일 codocs_write 계약은 변경하지 않는다. Jira/PR/Memory의 외부 상태를 이 파일 변경으로 수정하지 않는다.

## 요구사항 및 불변 조건

- REQ-001 / INV-001: 프로젝트 상대 발견 경로별 문서를 보관한다. 동일 ID/realPath의 다른 발견 경로를 합치지 않는다. 전역 ID 충돌은 모든 경로에 진단한다.
- REQ-002 / INV-002: term.name/knowledge.title은 통합 이름 공간이다. 같은 도메인의 중복은 종류와 무관하게 오류이며 다른 도메인의 동명은 허용한다. knowledge.domains 각각으로 검색하되 같은 발견 경로는 후보 하나다.
- REQ-003 / INV-007: `[[이름]]`은 전체, `[[도메인:이름]]`은 지정 도메인의 term.name/knowledge.title 통합 이름 공간에서 정확 비교한다. 작성 문서 도메인 우선·trim·대소문자 보정·ID 패턴 제한이 없다. 후보 0/1/복수를 구분하고 확인한 종류·이름·도메인·ID·경로·대상 오류를 반환한다.
- REQ-004 / INV-003: type을 확인한 term.definition/examples 문자열 원소, knowledge.body만 추출한다. 자료형 오류는 변환/종류 추측 없이 제외하고 정상 원소는 유지한다. 스키마 오류·ID 누락/충돌에서도 확인 가능한 이름과 참조를 보존한다. YAML 파싱 실패에서는 아무 문서 정보/참조도 추측하지 않는다.
- REQ-005: YAML 해석 문자열에서 시작 직전 백슬래시 홀수는 리터럴, 짝수는 참조다. 첫 비이스케이프 콜론이 도메인 구분자이고 구성 내부 콜론은 `\:`다. 빈/잘못된 구성/미완성은 invalid_reference이며 닫히기 전 새 시작에서 앞 오류를 기록하고 복구한다. 원문/렌더링은 변환하지 않는다.
- REQ-006: 모든 반복 등장에 fieldPath와 실제 YAML UTF-16 offset/좌표를 보존한다. 따옴표·Unicode escape·접힌/여러 줄·LF/CRLF의 해석 offset을 단순 가산하거나 raw 검색으로 위치를 추측하지 않는다.
- REQ-007: references/referencedBy는 확정 직접 연결만 포함한다. 발견 경로별 중복 제거·경로 오름차순이며 확인한 이름·ID·경로를 제공한다. 오류/없음/모호함/자기 참조/미확인 등장과 진단은 남기되 후보에 역참조를 만들지 않는다. 확정 대상의 스키마 오류는 연결을 유지하며 경고한다. 전이 연결은 없다.
- REQ-008 / INV-005 / INV-006: 같은 발견 문서의 자기 참조는 다른 소속 도메인 표기에서도 오류·연결 제외다. 다른 문서 A↔B는 허용한다. 미확정 후보에는 역참조를 등록하지 않는다. ID 누락·충돌 때문에 확인 가능한 경로별 연결을 버리지 않는다.
- REQ-009: 파일 이동·삭제 및 ID·이름·도메인·본문 변경, 충돌 해소 후 색인·직접/역참조·진단을 재계산한다. 입력/원문은 변경하지 않는다.
- REQ-010 / INV-004: complete의 확인된 부재만 삭제 근거다. partial은 확인한 문서를 갱신하고 실패 범위 및 모든 미관측 이전 경로를 보수적으로 unconfirmed로 보존한다. failed는 이전 자료와 실패 상태를 유지한다. 미탐색 신규 후보 가능성 때문에 불확실한 검색의 후보 0/1개도 부재/정상으로 확정하지 않는다.
- REQ-011 / INV-008: 이름 변경은 경로·필드·실제 위치·기존/새 참조 해석값·후보·충돌·미해결 영향을 가진 순수 계획이다. 파일을 저장하지 않는다. 확정 대상과 사용자가 선택한 모호 후보를 유지하고 다른 후보 선택도 존중한다. 기존 도메인을 유지하고 새 무도메인 표기가 모호하면 도메인을 명시한다. 다중 도메인은 선택을 받고 미선택은 미해결, 리터럴은 제외, 새 이름 충돌은 차단한다.
- AC-013: 소스 없는 공개 JS/d.ts 및 실제 tarball 소비자가 core/workspace 공개 루트만으로 추출·색인·갱신·rename 계획·오류/미확인 상태·진단 코드 합집합 좁히기를 실행한다. 내부 subpath는 Node와 TypeScript에서 거부한다.

선행 계산/로더 시험의 acceptance는 AC-001–AC-004의 이름 공간·전체 검색·경로 후보·부분 정보, AC-005–AC-007의 정상 원소 추출·escape/복구·실제 위치, AC-008–AC-012의 반복/직접 연결·자기 참조/순환·재색인·partial/failed·rename 수정안을 확인한다. AC-013 배포 시험과 최종 전체 비교는 이와 별개이며 최종 acceptance는 INT-001이 봉인한다.

## 구현 경계와 공개 계약

DEC-001은 core/references에 문법·위치, core/catalog에 색인·충돌·해석·직접/역참조·rename 계산, workspace에 로더·스캔 연결을 둔다. 실제 IO 의존성이 계산 계층에 발견되면 경계를 재검토한다. DEC-002는 파싱 성공 데이터와 원문 문자열 매핑을 로더에서 재사용 가능하게 보존한다. 메모리 실측에 따라 표현은 조정할 수 있다. DEC-007은 대상 경로·필드·실제 위치·후보를 가진 수정 계획이며 후속 writer의 원문 보존 계약과 통합할 때 표현을 재검토할 수 있다. 이 배치/표현 제안은 승인된 구현 방향이며 공개 계약 보존 하에서 함수명/내부 표현을 선택한다.

DEC-003은 YAML 해석 문자열/원문 매핑을 parser 책임으로 두며 지원 표기의 정확 매핑을 입증하지 못하면 재설계한다. DEC-004는 경로 문서와 ID/도메인 이름/전체 이름의 경로 집합을 분리하며 규모 측정 후 최적화할 수 있다. DEC-005는 등장/해석 기록과 확정 연결 목록을 분리하며 실제 소비 API에 따라 표현을 조정할 수 있다. DEC-006은 이전 색인·새 관측·실패 범위로 갱신을 계산하며 비용 측정의 병목에 따라 알고리즘을 조정할 수 있다.

- `@codosc/core`: parseYaml, extractReferences, buildCatalog, resolveReference, planRename 및 공개 진단 상수/타입.
- `@codosc/workspace`: loadWorkspace, toCatalogScan, buildWorkspaceCatalog 및 공개 스캔/IO 진단 상수/타입.
- valid/validationError 문서는 성공 parsed 모델을 재사용하며 valid에만 검증 data를 제공한다. parseError에는 parsed/data가 없으며 YAML 진단만 있다.
- Catalog는 Readonly 컬렉션 계약이다. 이름·후보·진단/등장 기록과 확정 연결 목록을 구분한다. core는 IO·입력 변경·AST/FS 내부 타입 공개를 하지 않는다.
- RenamePlan의 ready/unresolved/blocked는 저장 허용이 아니다. oldText/newText는 해석값이며 YAML 따옴표·escape·folded layout을 그대로 바꿀 raw patch가 아니다.

## 후속 rename 실행 합의 — 이번 완료 범위가 아님

사용자는 기존 참조 동시 변경을 선택적으로 끌 수 있고 모호 후보와 필요한 도메인을 선택한다. 실제 writer는 쓰기 불가 대상이 하나라도 있으면 전체 저장을 사전에 중단한다. 미리보기 뒤 원문이 바뀌면 최신 문서를 다시 읽어 최신 미리보기부터 재시작한다. 중간 저장 실패에서는 복구를 시도하고 복구 성공/실패 및 실제 파일 상태를 사용자에게 안내한다. 다중 파일 원자성을 보장하지 않는다. 이 합의는 후속 요구를 보존한 것이며 writer/복구 구현 완료 또는 현재 plan의 저장 허가가 아니다.

## 검증과 배포 증거

각 task는 고유한 표준 worktree와 격리 Node 24.21.0 / pnpm 10.34.5 런타임·store·cache·tmp·fixture를 사용한다. dependency/manifest/lockfile을 변경하지 않는다. 기능은 한국어 인접 행동 시험, JSDoc/README와 함께 구현한다.

TASK-004의 `tools/buildChecks -t '이름 참조'`는 기존 링크 fixture와 독립적인 소스 없는 JS·strict d.ts·실제 tarball 검사를 실행한다. tarball은 링크 없이 추출하고 고정 yaml/Zod 의존성을 명시적으로 복사한다. 이는 npm 설치/게시 성공이나 OS symlink 권한 검증이 아니다. strict/exactOptionalPropertyTypes/NodeNext/types: []/skipLibCheck: false와 외부 Zod URL 선언을 위한 ES2022+DOM을 사용한다. 소스/배포 guide·example 원문 일치와 실제 name/title 참조 해석도 검사한다.

업데이트 전 고정 이름 기반 예제 검사는 옛 `[[sample-fulfillment]]` 기대 불일치로 실패해야 한다. 업데이트 후 두 예제는 parser→validator→catalog에서 서로 확정 연결/역참조 하나를 가진다. 새 공개 소비 시험은 모두 실제 통과해야 한다. 기존 Windows workspace 타르볼 파일 symlink EPERM 한 건을 삭제·skip·완화하지 않고 정확한 기존 실패 집합과 비교한다. 이전 COD-4 문서의 서식 실패도 범위 밖이며 숨기지 않는다. 전체 회귀/최종 acceptance는 INT-001에서 봉인한다. provisional continuation이 허용되더라도 acceptance 통과를 뜻하지 않는다.

실제 IDE/MCP·VSIX·npm 게시·후속 writer·watcher와 제품 성능 목표의 완료를 이번 순수/로더/배포 시험으로 주장하지 않는다. push·PR 수정·사용자 브랜치 merge·worktree cleanup은 별도 수동 인계다.
