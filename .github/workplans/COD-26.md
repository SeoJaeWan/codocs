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
- codocs_guide는 배포된 가이드 원문을 읽으며 프로젝트 색인 준비와 독립적으로 동작한다. 색인 초기화·전체 갱신·실패 상태에서도 작성법과 복구 안내를 제공하고 색인 완료를 기다리지 않는다.
- 용어→정책→절차4개 YAML 예시, 현재 이름 분리·ID 유지·정책 원문 소유·폐기·참조 이스케이프 예시 작성.
- get→revision set/unset→validate, 순환 문서 A→B→A 작성, 오류/충돌/색인복구 후속 행동 가이드.
- revision 충돌 후 최신 문서를 재조회하고 변경 내용을 재검토한 뒤 새 revision으로 수정하는 절차와 동시 수정의 보장 범위를 안내한다. revision만 바꿔 기존 요청을 무조건 재전송하지 않는다. 현재 쓰기 정책의 프로세스 간 잠금·대기열 미제공과 revision 확인·파일 교체 사이의 경쟁 가능성을 설명하며, 충돌 응답이 없다는 사실만으로 동시 수정의 덮어쓰기가 방지된다고 안내하지 않는다.
- 가이드·예시를 빌드/패키지 산출물에 포함하고 사용자 폴더 규칙을 강제하지 않음.
- guide 구현 완료 시 루트 README의 제공 도구 목록을 codocs_list·codocs_get·codocs_refresh·codocs_validate·codocs_write·codocs_guide 여섯 도구로 갱신하고 각 도구의 역할을 안내한다.

h2. 검증 시나리오와 기대 결과

- guide 생략/각 topic/잘못된 topic을 확인하고, 색인 초기화·전체 갱신·실패 상태에서도 색인 완료를 기다리지 않고 가이드를 제공하는지 검증한다.
- 정상 예시 전체가 실제 파서/스키마/참조 검증을 통과하고 가상 정책임을 표시한다.
- 실제 배포 패키지에 가이드와 예시 전체가 포함되는지 확인한다. 저장소 밖의 소비자 환경에 설치한 MCP 패키지에서 guide의 모든 topic을 실제 호출하고, 저장소 원문이나 작업 디렉터리에 의존하지 않고 배포된 가이드를 제공하는지 검증한다.
- 배포된 YAML 예시 전체를 실제 파서·스키마·참조 검증으로 확인한다. 기존 두 예시의 고정 목록에 한정하지 않고 새로 추가한 예시도 모두 검사한다.
- refresh 파일/항목/진단 집계와 중복 호출·실패 복구·커서 만료를 MCP로 검증한다.
- 가이드의 명령·속성·응답과 구현 계약을 대조하고 저장 성공 후 create 재시도를 안내하지 않는다.
- 가이드의 get → 최신 revision을 사용한 set/unset 수정 → validate 절차를 실제 MCP 호출과 파일 반영 결과로 검증한다.
- 순환 문서는 A 생성 → A를 참조하는 B 생성 → 최신 A를 조회한 뒤 B 참조를 추가하는 수정 순서로 작성하고, 최종 A→B→A 관계를 실제 MCP 호출과 참조 검증으로 확인한다.
- 저장 후 최초 색인 갱신과 추가 복구가 실제로 실패한 경우 saved:true·indexUpdated:false를 확인하고 refresh로 복구하는 후속 절차를 MCP로 검증한다. 처리 지연만으로 실패를 판단하거나 이미 저장된 create를 재시도하도록 안내하지 않는다.

h2. 완료 기준과 산출물

- 하나의 가이드 원문이 일반 배포와 MCP에 사용되고 패키지 누락이 없다.
- AI가 근거 없는 내용을 confirmed로 쓰지 않도록 설명하며 자동 강제 보장을 하지 않는다.
- 구현·테스트·공개 함수 JSDoc·해당 기능의 `.codocs` 담당 문서를 함께 갱신한다.
- pnpm check에 포함된 타입·린트·서식 검사와 테스트·빌드·패키지 소비 검사 결과 및 관련 Vitest 결과를 기록한다. 별도 format:check 스크립트는 추가하지 않고 현재 pnpm format과 pnpm check를 유지한다. 실제 IO·프로세스·IDE 시나리오를 mock만으로 통과 처리하지 않는다.

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
