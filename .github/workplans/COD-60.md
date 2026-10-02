# COD-60 — [[name]] / [[name:section]] 문서 참조 지원

h2. 배경

section 기반 문서 모델에서는 문서 전체뿐 아니라 특정 의미 단위를 직접 참조할 수 있어야 한다. 기존 {{[[이름]]}} 참조를 확장해 동일한 주소 체계를 사용한다.

h2. 범위

* {{[[name]]}} 문서 참조 유지/재정의
* {{[[name:section]]}} section 참조 추가
* section 본문에서 참조 추출
* name 및 name:section resolver
* 존재하지 않는 문서/section 참조 diagnostics
* VS Code 문서 링크 및 대상 이동
* 문서 간 direct reference와 backlink index
* escape 규칙 및 잘못된 표기 처리
* 문서/section 이름 변경 시 참조 영향 처리 방침 정의
* 사용자 가이드와 계약 문서 갱신

h2. 범위 밖

* 코드의 {{@codocs}} 참조
* MCP 조회 API 재설계
* fuzzy/semantic search

h2. 검증

* {{[[환불]]}}은 해당 문서를 연다.
* {{[[환불:환불정책]]}}은 해당 section으로 이동한다.
* 잘못된 문서/section 주소는 정확한 위치에 진단된다.
* backlink가 정확한 source section을 가리킨다.
* typecheck, lint, test, format check를 통과한다.

h2. 완료 기준

* 문서와 section 모두 같은 {{name[:section]}} 주소 체계로 참조할 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-60
