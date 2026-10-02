# COD-64 — 여러 Codocs 문서 및 section 일괄 변경 지원

h2. 배경

여러 문서를 함께 변경해야 하는 작업에서는 문서별 write를 반복하면 중간 상태에서 참조 오류가 발생하고 검증도 반복된다. 새 section/write 모델을 기반으로 여러 변경을 최종 상태 기준으로 한 번 검증하고 저장할 수 있게 한다.

h2. 범위

* 여러 문서의 create/update를 한 요청으로 처리
* 문서 metadata와 section 변경을 같은 batch에 포함
* 모든 변경을 적용한 가상 최종 상태에서 한 번 validate
* 오류가 남으면 저장하지 않는다
* 각 문서 revision 충돌 확인
* 저장 결과를 문서별 saved/changed/revision으로 반환
* 부분 저장 실패 시 실제 저장 상태와 실패 대상을 명확히 반환
* 삭제/이동 지원 여부는 당시 write API 계약에 맞춰 결정

h2. 범위 밖

* semantic search
* 자동 문서 병합
* 중복 의미 판정

h2. 검증

* 새 문서 생성과 기존 문서/section 수정을 한 요청에서 처리한다.
* batch 내부 참조는 최종 상태 기준으로 정상 해석된다.
* 한 변경이라도 검증에 실패하면 저장 전 전체 요청을 거부한다.
* revision 충돌 시 충돌 문서를 명확히 반환한다.
* typecheck, lint, test, format check를 통과한다.

h2. 완료 기준

* AI가 여러 문서와 section에 걸친 변경을 한 번의 MCP 요청으로 검증하고 저장할 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-64
