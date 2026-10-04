# COD-59 — _codocs 메타데이터와 section 기반 문서 모델 도입

## 배경

현재 .codocs 문서는 `id`, `name`, `domains`, `definition` 등 시스템 필드와 사용자 내용이 같은 root에 존재한다. 또한 하나의 `definition` 본문을 중심으로 해 문서 내부의 의미 단위를 안정적으로 주소화하기 어렵다.

문서를 메타데이터와 이름 있는 section으로 분리해 문서·코드·MCP가 동일한 의미 주소를 사용할 수 있는 기반을 만든다.

## 목표 구조

```yaml
_codocs:
  id: refund
  name: 환불
  parent:
    - 결제

개요: |
  환불은 ...

환불정책: |
  ...

취소수수료: |
  ...
```

## 범위

- root의 예약 namespace로 `_codocs` 도입
- `_codocs.id`, `_codocs.name`, `_codocs.parent` 모델 정의
- `_codocs` 외 root key를 addressable section으로 해석
- 기존 `definition` 제거 및 migration
- `domains` 제거 여부와 migration 규칙 확정
- 프로젝트 전체 `name` uniqueness 규칙 정의
- `id` uniqueness 유지 여부와 내부 stable identity 역할 확정
- section key 규칙과 파싱/직렬화 계약 정의
- parent 대상 존재 여부 및 cycle 검증
- 공통 주소 형식 `name`, `name:section` 정의
- 기존 저장소 문서를 새 스키마로 migration

## 범위 밖

- `[[name:section]]` 링크 동작
- MCP list/get API 변경
- `@codocs name:section` 코드 참조

## 검증

- 새 스키마를 파싱·직렬화해도 의미와 section 경계가 보존된다.
- duplicate name/id, missing parent, parent cycle이 올바르게 진단된다.
- 모든 기존 .codocs 문서를 새 모델로 migration할 수 있다.
- typecheck, lint, test, format check를 통과한다.

## 완료 기준

- Codocs 문서는 `_codocs` metadata와 root section들로 구성된다.
- 문서와 section을 `name` / `name:section`으로 안정적으로 식별할 수 있다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-59
