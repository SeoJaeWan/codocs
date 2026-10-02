# COD-58 — 코드 식별자 기반 Codocs Hover 제거

h2. 배경

현재 Codocs는 코드 식별자와 문서 ID가 일치하면 자동으로 문서를 매칭해 Hover를 제공한다. 실제 사용에서는 모든 변수·함수·타입 이름이 도메인 개념을 의미하지 않아, 구현 복잡도와 탐색 비용 대비 효용이 낮았다.

앞으로 코드와 문서의 연결은 암묵적인 식별자 매칭보다 명시적인 {{@codocs name:section}} 참조를 중심으로 한다.

h2. 범위

* Language Server의 코드 식별자 Hover provider 제거
* 식별자 추출·문서 ID 매칭·candidate ranking 로직 제거
* deprecated alias 및 collision 처리를 포함한 식별자 Hover 전용 로직 정리
* 식별자 Hover에 의존하는 VS Code UI 테스트와 통합 테스트 제거 또는 수정
* README와 사용자 가이드에서 식별자 Hover 설명 제거
* 식별자 Hover 제거로 불필요해지는 코드 경로와 공개 계약 정리

h2. 범위 밖

* {{@codocs}} 명시적 코드 참조 재설계
* {{[[ ]]}} 문서 참조 변경
* .codocs 문서 스키마 변경

h2. 검증

* 일반 코드 식별자에 Codocs Hover가 나타나지 않는다.
* 문서 편집, {{[[ ]]}} 문서 링크, MCP 기능은 기존 범위에서 회귀하지 않는다.
* 제거된 식별자 Hover 전용 코드와 테스트가 남아 있지 않다.
* typecheck, lint, test, format check를 통과한다.

h2. 완료 기준

* 코드 식별자 이름만으로 Codocs 문서가 자동 연결되지 않는다.
* 명시적 참조 기능과 문서 편집 기능은 독립적으로 유지된다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-58
