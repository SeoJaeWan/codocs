# COD-63 — MCP write·validate·refresh를 section 모델에 맞게 개편

h2. 배경

새 section 문서 모델과 name 기반 주소를 도입하면 변경·검증·동기화 도구도 같은 모델을 사용해야 한다. 조회와 참조 구조가 확정된 뒤 MCP 관리 기능을 새 계약에 맞춘다.

h2. 범위

h3. codocs_write

* 새 문서 생성
* 문서 metadata 수정
* section 추가/수정
* 전체 문서 수정
* revision 충돌 처리 유지/정리

h3. codocs_validate

* duplicate id
* duplicate name
* missing parent
* parent cycle
* missing {{[[name]]}}
* missing {{[[name:section]]}}
* missing {{@codocs name:section}}
* section 구조 오류
* 새 모델에서 결정적으로 판정 가능한 오류를 중심으로 구성

h3. codocs_refresh

* documents
* sections
* parent/children
* document references/backlinks
* code references/backlinks
를 현재 파일 상태에서 재구축

h3. 정리

* 실사용 효용이 낮았던 {{codocs_duplicates}} 제거
* 새 모델과 중복되는 legacy 관리 로직 제거
* 사용자 가이드와 MCP 도구 문서 갱신

h2. 범위 밖

* 여러 문서를 한 요청에서 일괄 저장하는 batch write
* fuzzy/semantic search

h2. 검증

* 새 문서와 section을 MCP로 생성·수정할 수 있다.
* 모든 새 주소/관계 오류를 validate가 감지한다.
* refresh 후 현재 디스크 상태와 index가 일치한다.
* duplicates 도구와 전용 계약이 제거된다.
* typecheck, lint, test, format check를 통과한다.

h2. 완료 기준

* write/validate/refresh가 section 기반 모델과 동일한 주소·검증 계약을 사용한다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-63
