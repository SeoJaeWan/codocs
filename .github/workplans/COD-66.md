# COD-66 — 코드 참조 수집 제외 경로(.codocsignore) 지원

## 배경

코드 참조는 Git이 추적하는 모든 파일에서 `@codocs [[…]]` 표기를 수집한다. `.gitignore`는 추적 중인 파일을 제외하지 못하므로, 테스트 fixture·사용 설명 문서·과거 계획서에 적은 예시 표기도 실제 참조로 해석된다. COD-63에서 코드 참조 오류를 error로 표시하고 전체 validate에 포함하면서 codocs 저장소의 전체 검사에 예시 표기로 인한 오류 299건이 상시 나타난다. 사용자 프로젝트도 문서·테스트에 예시를 적으면 같은 문제가 생긴다.

## 범위

### .codocsignore

- 프로젝트 루트의 `.codocsignore`를 `.gitignore` 문법으로 읽는다.
- 일치하는 경로는 Git 추적 여부와 관계없이 코드 참조 수집에서 제외한다.
- 수집·감시·write 참조 보호·validate·refresh·편집기 진단이 같은 규칙을 쓴다.
- `.codocsignore`가 바뀌면 수집 정책을 다시 계산한다.

### 저장소 적용

- codocs 저장소에 `.codocsignore`를 추가해 테스트·계획서·changeset·가이드·README·examples의 예시 표기를 제외한다.

### 문서

- 코드 참조의 "코드 파일 수집" 규칙, 사용자 가이드, README를 갱신한다.

## 범위 밖

- `.codocs` 문서 자체의 제외
- 하위 폴더별 `.codocsignore`

## 검증

- 추적 중인 파일도 `.codocsignore`로 제외된다.
- 제외한 경로에서는 코드 참조 진단과 연결이 나오지 않는다.
- 제외 규칙 변경이 감시와 다음 수집에 반영된다.
- codocs 저장소 전체 validate에 예시 표기로 인한 코드 참조 오류가 남지 않는다.
- typecheck, lint, test, format check를 통과한다.

## 완료 기준

- 추적 중인 파일의 예시 표기를 코드 참조에서 제외할 수 있고, 전체 검사 결과가 실제 오류만 보여준다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-66
