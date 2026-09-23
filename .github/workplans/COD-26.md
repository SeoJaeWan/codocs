# COD-26 — [23] MCP refresh·guide와 배포용 작성 가이드·예시 완성

h2. 목표

AI와 사용자가 동일한 가이드로 작성·검증·복구할 수 있도록 도구와 배포 문서를 완성한다.

h2. 작업 순서와 선행 조건

권장 순서 23/25 · 3단계 · 상위 COD-3

- [COD-22|https://seojaewan.atlassian.net/browse/COD-22] — MCP list·get·validate 도구와 부분 오류 반환 구현
- [COD-25|https://seojaewan.atlassian.net/browse/COD-25] — MCP write 실행·후보 안내·저장 후 색인 복구 통합

h2. 구현 범위

- refresh 무인자·전체 재구성·집계·모든 cursor 만료·준비/실패/진행 상태를 MCP에 연결.
- guide topic6종·기본 overview+주제목록을 일반 docs/guide와 같은 원문으로 제공.
- 용어→정책→절차4개 YAML 예시, 현재 이름 분리·ID 유지·정책 원문 소유·폐기·참조 이스케이프 예시 작성.
- get→revision set/unset→validate, 순환 문서 A→B→A 작성, 오류/충돌/잠금대기/색인복구 후속 행동 가이드.
- 가이드·예시를 빌드/패키지 산출물에 포함하고 사용자 폴더 규칙을 강제하지 않음.

h2. 검증 시나리오와 기대 결과

- guide 생략/각 topic/잘못된 topic과 색인 준비 중 사용을 확인한다.
- 정상 예시 전체가 실제 파서/스키마/참조 검증을 통과하고 가상 정책임을 표시한다.
- refresh 파일/항목/진단 집계와 중복 호출·실패 복구·커서 만료를 MCP로 검증한다.
- 가이드의 명령·속성·응답과 구현 계약을 대조하고 저장 성공 후 create 재시도를 안내하지 않는다.

h2. 완료 기준과 산출물

- 하나의 가이드 원문이 일반 배포와 MCP에 사용되고 패키지 누락이 없다.
- AI가 근거 없는 내용을 confirmed로 쓰지 않도록 설명하며 자동 강제 보장을 하지 않는다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- typecheck/lint/format:check 및 관련 Vitest·빌드 결과를 기록한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

h2. 구현 중 확인할 사항

- 실제 패키지 내 가이드 로딩·예시 배치 경로를 검증한다.

## 문서 기준

현재 계약의 기준 원문은 로컬 `.codocs`다. 문서 역할과 갱신은 [문서 컨벤션](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/development/documentation-convention.yaml)을 따른다.

구현·테스트·공개 함수 JSDoc와 해당 기능의 `.codocs` 담당 문서를 함께 갱신한다. 내부 패키지·기능별 README는 만들지 않으며, 루트 README와 사용자 가이드는 사용자 안내에 영향이 있을 때 갱신한다.

과거 Wiki revision은 당시 결정·계획의 참고 근거이며 현재 계약을 소유하지 않는다. 구현 범위·진행·검증 증거는 이슈와 PR에서 추적한다.

### 과거 Wiki와 추적 근거

- Codocs 파일 감지와 색인 복구 (codocs-index-lifecycle)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-8466-7f3b-b7ae-bcbc54e1d66e","revision":"01a09980-8466-7222-97c6-4a9d5bbf97cf"}}}
- Codocs AI·사용자 작성 가이드와 연결 예시 (codocs-authoring-guide)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a09980-9c28-77c5-8d9e-c40ee45b15fa","revision":"01a09980-9c28-7850-b43c-595bf0d6ebad"}}}
- Codocs YAML 문서 형식과 식별자 (codocs-document-schema)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-ca16-74c4-92f7-3f2c8dcc6199","revision":"01a0997a-ca16-7c4a-b028-963afd1e9393"}}}
- Codocs 참조와 원문 소유 원칙 (codocs-references)
  ** 조회 참조: {{{"type":"wiki","project_id":"seojaewan/codosc","wiki_id":"01a0997a-cdbc-7c02-ad2e-ebeee3599e54","revision":"01a0997a-cdbc-7d95-a0ea-d4db05c9a7f5"}}}

2026-09-13 최초 계획을 바탕으로 현재 로컬 `.codocs` 계약에 따라 진행하는 실행 작업이다. 아직 구현·성능·호환성 검증을 완료한 상태가 아니다.

## Jira

- https://seojaewan.atlassian.net/browse/COD-26
