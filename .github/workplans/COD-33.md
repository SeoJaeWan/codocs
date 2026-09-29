# COD-33 — Windows에서 원문 열기·YAML 참조 링크 이동 실패

h2. 현상

Windows에서 Codocs의 링크 이동이 동작하지 않는다. 링크를 눌러도 대상 문서가 열리지 않고 현재 편집기에 그대로 머무르며, 오류 안내나 Codocs 출력 로그도 남지 않는다.

- 코드 Hover의 _원문 열기_ 링크를 클릭해도 원본 YAML 문서가 열리지 않는다.
- {{.codocs}} YAML 본문의 {{[[문서 이름]]}} 참조를 Ctrl+클릭해도 대상 문서로 이동하지 않는다.

Hover 내용 표시와 참조 링크 인식(Ctrl+클릭 안내)은 정상이다.

h2. 재현 환경

- Windows 11, VS Code 1.139.1, Codocs 0.0.1
- 작업 공간: 이 저장소 ({{D:\dev\codosc}})

h2. 재현 절차

# {{packages/core/src/matcher/index.ts}}의 {{matchIdentifier}}에 마우스를 올려 Hover를 표시한다.

# Hover 하단의 *원문 열기*를 클릭한다. → {{identifier-matching.yaml}}이 열리지 않는다.

# {{.codocs/core/matcher/identifier-matching.yaml}}을 열고 {{[[문서 검증]]}}을 Ctrl+클릭한다. → {{document-validation.yaml}}로 이동하지 않는다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-33
