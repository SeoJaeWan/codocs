# COD-17 — 코드 자동완성 구현 보류와 제품 범위 정리

## 결정과 목적

2026-09-21 사용자 합의에 따라 코드 자동완성 구현을 보류한다. Codocs는 개발자가 코드를 읽고 이해할 때 용어·개념·규칙과 관련 원문을 연결하는 것을 핵심 목표로 삼는다. AI가 작성한 코드를 이해하고 검토하는 흐름과 AI의 지식 조회도 이 목적에 포함한다.

자동완성은 코드 작성 편의에 속하며, 후보 표기·교체 범위·버전·IDE 연동의 구현과 유지 비용에 비해 현재 목표에 더하는 효용이 충분한지 확인되지 않았다. 기능을 구현 완료한 것으로 처리하지 않으며 재개 일정도 정하지 않는다.

## 이번 PR의 범위

- `.codocs/development/product.yaml`에 코드 이해 중심의 제품 목적과 기능 판단 기준을 명시한다.
- `.codocs/language-server/completion.yaml`을 현재 제공 범위에서 자동완성을 제외하는 결정과 재검토 기준으로 갱신한다.
- IDE·언어 서버 소개, 문서 동기화, 서버 연결에서 자동완성을 현재 제공 기능으로 설명하는 문구를 정리한다.
- 배포의 성능 판정 대상에서 자동완성을 제외한다. Hover·MCP 조회와 나머지 성능 목표는 유지한다.
- 내부 패키지 README는 만들지 않으며 계약은 관련 `.codocs`에서 관리한다.

자동완성용 LSP completion 응답, ID 후보의 표기 변환·삽입·교체 범위 처리와 전용 단위·프로세스·Extension Host 테스트는 이번 작업에서 구현하지 않는다. 기존 자동완성 구현·검증 항목은 현재 완료 기준에서 제외한다.

## 유지하는 작업과 재개 판단

- PR #13의 Hover와 문서 연결, 현재·이전 ID 매칭, 진단·원문 이동, MCP 지식 조회는 각 담당 작업에서 계속 진행한다. 이 PR에서 해당 기능을 추가 구현하거나 작업 범위를 바꾸지 않는다.
- COD-15의 문서 동기화·좌표 변환·오래된 결과 방지 등 공통 기반은 유지한다. 자동완성 보류를 이유로 기존 검증을 제거하지 않는다.
- 이번 PR은 자동완성 구현을 기다리는 작업계획에서 제품 범위 결정을 기록하는 문서 변경으로 전환한다. PR 반영은 문서 결정의 반영이며 자동완성 기능의 완성을 뜻하지 않는다.
- 실제 필요성이 확인되어 재개하면 현재 ID 기반 후보, 표기·범위·최신성, 복수 후보 선택과 실제 IDE 검증을 포함한 계약과 테스트 계획을 다시 확정한다. 이전 논의만으로 미결정 동작을 확정하지 않는다.

## 검증과 완료 기준

- 변경한 YAML의 파싱·스키마, 프로젝트의 ID·이름 충돌과 문서 참조 연결을 검사한다.
- 변경 문서의 포맷과 diff를 확인하고 자동완성이 현재 제공 기능·완료 조건으로 남아 있지 않은지 대조한다.
- PR 제목·본문과 `.codocs`의 제품 범위 결정이 일치해야 한다.
- 문서 변경 검증을 자동완성의 구현·기능·성능 검증으로 보고하지 않는다. 실행한 검사와 결과는 PR에 기록한다.

## 현재 계약과 과거 추적 근거

현재 계약의 기준 원문은 저장소의 `.codocs`다. Wiki는 현재 계약을 소유하지 않으며 과거 revision은 최초 작업계획의 참고 근거로만 남긴다.

- `.codocs/development/product.yaml` — 제품 목적과 범위 판단
- `.codocs/language-server/completion.yaml` — 자동완성 제공 범위와 재검토 기준
- `.codocs/language-server/ide-support.yaml` — 코드 이해를 위한 IDE 표현
- `.codocs/language-server/document-sync.yaml` — 공통 문서 동기화·버전·좌표
- `.codocs/development/release.yaml` — 현재 기능의 배포·성능 판정
- `.codocs/development/documentation-convention.yaml` — 문서 역할과 갱신 기준

과거 Wiki 참고: Codocs 영어 용어 매칭과 VS Code 동작 (`codocs-ide-matching`).

```json
{
  "type": "wiki",
  "project_id": "seojaewan/codosc",
  "wiki_id": "01a0997d-0425-7e2a-9a7c-380db665ffad",
  "revision": "01a0997d-0425-79ae-bce6-e554aa653abf"
}
```

## 추적

- PR: https://github.com/SeoJaeWan/codocs/pull/14
- Jira: https://seojaewan.atlassian.net/browse/COD-17
