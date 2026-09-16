# COD-7 경로와 실제 파일 식별 조사

상태: 레퍼런스 코드 조사와 로컬 실험 기록. 아래 초기 설계 제안의 실제 파일별 병합·대표 경로 선정은 이후 논의에서 채택하지 않았다. 현재 확정 정책은 [COD-7 작업계획](./COD-7.md)의 “폴더 순환과 중복 문서 처리” 절을 따른다. 현재 탐색 가지의 실제 폴더 재방문만 중단하고, 문서는 경로별로 로딩하여 기존 중복 ID 처리에 맡긴다. 구현 코드는 변경하지 않았다.

## 조사 범위

- Contextive: `382d6d071a91a10c89c4872c146a6eda0836ba35`
- DomainLang: `6693671bfd0ae471c04052223b06ebfc59a4c30d`
- 해당 커밋의 경로 해석, 탐색, import 순환 처리, 경계 검사, 관련 테스트 소스를 읽었다. 두 프로젝트의 테스트를 실행하거나 의존 라이브러리 내부까지 전부 감사한 것은 아니다.

## Contextive에서 확인한 구현

- [PathResolver.fs](https://github.com/dev-cycles/contextive/blob/382d6d071a91a10c89c4872c146a6eda0836ba35/src/language-server/Contextive.LanguageServer/PathResolver.fs): 상대 경로를 workspace에 결합하고 경로 구분자를 정리한다. 이 함수는 실제 파일의 동일성을 확인하지 않는다.
- [FileScanner.fs](https://github.com/dev-cycles/contextive/blob/382d6d071a91a10c89c4872c146a6eda0836ba35/src/language-server/Contextive.LanguageServer/FileScanner.fs): Microsoft 파일 glob 라이브러리에 탐색을 위임한다.
- [GlossaryManager.fs](https://github.com/dev-cycles/contextive/blob/382d6d071a91a10c89c4872c146a6eda0836ba35/src/language-server/Contextive.LanguageServer/GlossaryManager.fs): glossary를 경로 문자열 기반 Map에 보관한다.
- [Glossary.fs](https://github.com/dev-cycles/contextive/blob/382d6d071a91a10c89c4872c146a6eda0836ba35/src/language-server/Contextive.LanguageServer/Glossary.fs): 읽은 import 경로 문자열을 기록하고 동일 문자열의 재방문을 막는다. 경로 별칭이 같은 실제 파일인지 판별하는 처리는 이 코드에서 확인하지 못했다.
- [PathExtensions.fs](https://github.com/dev-cycles/contextive/blob/382d6d071a91a10c89c4872c146a6eda0836ba35/src/language-server/Contextive.LanguageServer.Tests/Helpers/PathExtensions.fs)의 OS별 대소문자 비교는 테스트 helper다. 이를 제품의 파일 식별 정책으로 해석해서는 안 된다.

## DomainLang에서 확인한 구현

- [import-resolver.ts](https://github.com/DomainLang/DomainLang/blob/6693671bfd0ae471c04052223b06ebfc59a4c30d/dsl/domain-lang/packages/language/src/services/import-resolver.ts): 경로 해석을 별도 서비스로 분리하고 로컬 파일 경로를 URI로 반환한다.
- [import-graph.ts](https://github.com/DomainLang/DomainLang/blob/6693671bfd0ae471c04052223b06ebfc59a4c30d/dsl/domain-lang/packages/language/src/services/import-graph.ts): URI 문자열의 visited Set으로 import 재방문을 막는다.
- [workspace-manager.ts](https://github.com/DomainLang/DomainLang/blob/6693671bfd0ae471c04052223b06ebfc59a4c30d/dsl/domain-lang/packages/language/src/services/workspace-manager.ts)의 validateLocalPath는 realpathSync 후 path.relative로 manifest의 로컬 의존성·별칭 경계를 검사한다. realpath 실패 시 양쪽을 문자열 normalize로 대체한다. 모든 import 경로에 같은 실경로 검사가 적용된다고 일반화할 수 없다.
- [import-security.test.ts](https://github.com/DomainLang/DomainLang/blob/6693671bfd0ae471c04052223b06ebfc59a4c30d/dsl/domain-lang/packages/language/test/validating/import-security.test.ts): 다른 디렉터리에 있는 동일 파일명은 다른 URI로 구분해야 한다는 회귀 테스트가 있다. 실제 파일 별칭 동일성 검증과는 다른 문제다.

경로 해석의 중앙화와 방문 집합은 참고할 수 있다. 두 프로젝트의 확인된 코드만으로 대소문자·심볼릭 링크·하드링크의 실제 파일 동일성 문제가 모두 해결됐다고 볼 수 없다. DomainLang의 외부 경로 제한 정책은 외부 파일·폴더 링크 읽기·쓰기를 허용한 Codocs의 결정과도 다르다.

## 실제 파일 실험

현재 macOS / Node v22.22.0의 임시 디렉터리에 파일, 심볼릭 링크, 하드링크, 폴더 순환 링크를 만들고 Node assert로 확인했다.

| 경우                             | 관찰 결과                                                      |
| -------------------------------- | -------------------------------------------------------------- |
| 원본 파일과 심볼릭 링크          | stat의 dev/ino가 같음                                          |
| 원본 파일과 하드링크             | realpath는 다르지만 dev/ino는 같음                             |
| Order.yaml과 order.yaml          | 이번 파일 시스템에서는 같은 dev/ino로 해석됨                   |
| 부모를 가리키는 폴더 링크        | 대상 폴더의 dev/ino와 같음                                     |
| 임시 파일을 rename하여 원본 교체 | 경로는 유지되지만 dev/ino가 바뀜                               |
| 위 교체 후 별칭                  | 심볼릭 링크는 새 파일을 가리키고 하드링크는 이전 파일을 유지함 |

원시 결과: `/tmp/codocs-identity-probe-SyucnS/results.json`. 임시 경로는 정리될 수 있으므로 관찰 결과를 이 문서에 보존한다. 다른 파일 시스템에서 같은 결과가 나온다고 보장하는 시험은 아니다.

## 초기 Codocs 설계 제안 — 확정 계약 아님

1. 경로 문자열, 현재 실제 파일, YAML 업무 ID를 분리한다. source.path는 사용자에게 보이는 프로젝트 상대 경로이며, realPath는 접근 대상 경로다. 현재 실제 파일의 식별은 별도 계층이 담당한다. YAML id가 같다는 이유로 서로 다른 파일을 합치지 않는다.
2. workspace의 한 resolver가 경로 결합, 링크 해석, 대상 종류 및 식별 정보 확인을 담당한다. 로더·watcher·저장 계층이 각각 다른 경로 비교 규칙을 만들지 않는다. 대소문자나 유니코드를 임의 변환하여 파일을 합치지 않는다.
3. 로컬 파일의 현재 동일성 판단에 stat의 bigint dev/ino를 활용하고 realpath를 함께 보관한다. 이는 영구 문서 ID나 모든 파일 시스템에 통하는 유일 키가 아니다. 식별 정보의 신뢰성을 확인할 수 없는 환경에서 보장하지 못하는 것을 진단으로 드러내며 무조건 같다고 추정하지 않는다. 구체적인 fallback 계약은 추가 설계가 필요하다.
4. 탐색은 폴더와 링크의 그래프로 취급한다. 현재 탐색 중인 대상 재방문은 순환으로 처리하고, 이미 처리한 실제 대상의 재방문은 중복 처리로 구분한다. 대상은 한 번 처리하되 발견한 링크 연결 관계는 보존한다. 순환에서 생기는 무한한 별칭 경로를 모두 열거하지 않는다.
5. 허용 범위는 `.codocs`에서 실제로 연결된 대상과 연결 관계로 판단한다. 외부 대상이 허용되어도 임의의 외부 절대 경로나 파일 링크 대상의 형제 파일까지 자동 허용되는 것은 아니다.
6. 재스캔·변경 감지 시 경로와 현재 파일의 연결을 갱신한다. 파일 식별 정보는 원자적 교체 저장이나 삭제·재생성으로 바뀔 수 있으므로 영구 키로 저장하지 않는다.
7. 쓰기는 읽었을 때의 대상과 내용 버전을 확인하고 변경 충돌을 처리해야 한다. 프로젝트별 잠금만으로는 서로 다른 프로젝트가 공유 파일을 수정하는 일을 조정할 수 없다. 실제 대상 수준의 조정과 교체 저장 시 식별 변화까지 고려해야 한다. 저장 직전 검사 하나로 모든 경쟁 조건이 해결되는 것은 아니다.

## 다음에 구체화할 항목

- 여러 접근 경로가 있는 문서의 대표 source.path 선택 및 별칭 조회 계약
- 식별 정보가 불충분한 파일 시스템의 처리 방식
- 하드링크 공유 관계와 원자적 저장의 양립 여부 및 저장 계약
- 공유 대상의 잠금 및 외부 편집 충돌 감지 방식

이번 결정의 출발점은 OS별 예외 목록이 아니라 “경로는 파일에 도달하는 이름이며, 현재 실제 파일 및 업무 문서의 정체성과 구분한다”는 원칙이다.

## 기술 근거

- [Node 파일 시스템 지침](https://nodejs.org/en/learn/manipulating-files/working-with-different-filesystems): OS만으로 파일 시스템의 대소문자·유니코드 특성을 가정하지 않는다.
- [Node realpath](https://nodejs.org/api/fs.html#fsrealpathpath-options-callback): 정규 경로의 유일성은 보장되지 않으며 대소문자 변환을 수행하지 않는다.
- [Node Stats](https://nodejs.org/api/fs.html#class-fsstats): dev/ino 및 bigint 형태의 파일 메타데이터를 제공한다.
