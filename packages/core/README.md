# core

IO 없는 .codocs YAML 파싱과 원문 위치 API를 제공한다. Node 내장 모듈과 IDE/LSP/MCP SDK에 직접 의존하지 않는다. 필수 속성, 자료형, ID 형식, 비유한 수와 참조 의미의 검증은 후속 스키마 검증의 책임이다. 파싱 성공이나 범위 조회는 저장·삭제 허용을 의미하지 않는다.

공개 진입점은 `@codosc/core`다. `src/index.ts`는 `src/parser/index.ts`와 `src/diagnostics/index.ts`를 재내보낸다. 직접 의존성은 정확히 고정한 `yaml@2.9.1`이며 lockfile에 기록한다. ESM JS와 외부 라이브러리 타입을 노출하지 않는 선언 파일은 tsc로 `dist`에 생성한다. strict, ES2022, NodeNext, 상대 `.js` import와 `types: []`를 유지한다.

```ts
import {
  parseYaml,
  getKeyRange,
  getValueRange,
  getPropertyRange,
  offsetToPosition,
} from '@codosc/core';

const parsed = parseYaml('name: "용어" # 설명\n', 'terms.yaml');
if (parsed.success) {
  console.log(parsed.data); // { name: '용어' }
  const path = ['name'];
  console.log(getKeyRange(parsed, path)); // { start: 0, end: 4 }
  console.log(getValueRange(parsed, path)); // { start: 6, end: 10 }
  console.log(getPropertyRange(parsed, path)); // { start: 0, end: 16 }
  console.log(offsetToPosition(parsed.source, 6)); // { line: 0, character: 6 }
}
```

`parseYaml(input: unknown, filePath?: string)`는 문자열을 검사하고 Document/CST 토큰으로 원문 위치와 금지 구문을 확인한 후 데이터를 변환한다. 단일 문서와 최상위 매핑만 성공한다. 단일 `---`, 주석, 따옴표, 블록 문자열, 중첩 배열·객체와 flow 구조는 허용한다. 앵커, 별칭, 병합 키, 사용자 태그, 복수 문서와 중복 키는 `unsupported_yaml_feature`이며 일반 문법 오류와 비매핑은 `invalid_yaml`이다. 뒤의 중복 키 전체를 지목한다. 실패는 원문·진단만 제공하고 복구 AST에서 정상 데이터를 선택하지 않는다. 비문자열 입력에는 원문과 위치가 없다. `filePath`는 진단 메타데이터일 뿐 파일을 읽지 않는다.

오류 코드는 `src/diagnostics/index.ts`의 `yamlDiagnosticCodes`에서 관리하며 각 코드의 발생 조건을 주석으로 설명한다. `YamlDiagnosticCode`와 `YamlDiagnostic.code`의 타입도 이 정의에서 도출한다. 공개 진입점에서 두 정의를 가져올 수 있다.

| 코드 상수                                    | 반환 코드                  | 발생 조건                                                                                      |
| -------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `yamlDiagnosticCodes.invalidYaml`            | `invalid_yaml`             | 비문자열 입력, YAML 문법 오류, 빈 문서 또는 최상위 값이 매핑이 아닌 경우                       |
| `yamlDiagnosticCodes.unsupportedYamlFeature` | `unsupported_yaml_feature` | 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 키가 있는 경우. 중첩 매핑과 flow 표기 자체는 허용 |

`YamlParseResult`는 `success`로 분기한다. 성공에는 `source`, `data`, `fields`, `diagnostics`가 있고 실패에는 `data`와 `fields`가 없다. `YamlDiagnostic`은 코드, 원인별 한국어 메시지, 파일 경로, `offsetRange` 및 외부 `range`를 제공한다. 위치를 확인할 수 없으면 두 범위는 `undefined`다.

`FieldPath`는 문자열 매핑 키와 숫자 배열 인덱스의 배열이다. 점이 포함된 문자열도 실제 키로 취급한다. `getKeyRange`, `getValueRange`, `getPropertyRange`는 확인된 `OffsetRange` 또는 `undefined`를 반환한다. 값 범위는 따옴표와 블록 헤더를 포함하고 뒤의 주석을 제외한다. 속성 전체는 키부터 같은 줄·값 내부 주석과 블록 개행까지 포함하며 앞의 독립 주석은 제외한다. 빈 값에는 확인된 0 길이 값 범위가 있다. 배열 항목에는 값 범위만 있고 매핑 키와 속성 전체 범위가 없다. 복합 매핑 키처럼 `FieldPath`로 표현할 수 없는 위치에는 범위를 임의 생성하지 않는다.

일반 flow 속성의 전체 범위에는 주변 쉼표를 포함하지 않는다. 쉼표 뒤 같은 줄 주석까지 포함해야 하는 경우 연속 원문 범위에 해당 쉼표도 들어간다. 이 API는 주변 쉼표 편집, 실제 속성 삭제와 writer를 구현하지 않는다.

모든 offset은 0 기반 UTF-16이고 시작 포함·끝 제외다. `source.slice(start, end)`로 실제 원문을 조회한다. 원문의 CRLF·공백·주석·따옴표를 정규화하지 않는다. 이모지는 UTF-16 코드 단위로 센다. `offsetToPosition`은 LF 다음을 새 줄로 세어 0 기반 `line/character`를 반환하며 EOF를 허용한다. 범위 밖·비정수 offset에는 좌표가 없다. CRLF 내부 offset은 원문 코드 단위 위치다. EOF 문법 오류는 확인된 0 길이 삽입 위치를 제공한다.

`examples/.codocs/terms.yaml`과 `knowledge.yaml`은 파일마다 하나의 매핑이며 가상 프로젝트의 ID·참조·본문을 유지한다. 예제 읽기는 tools의 Node subprocess에서 수행하고 core는 문자열만 받는다. 현재 스키마 검증, 참조 해석, 파일 IO·writer, Hover/LSP, VS Code activation과 MCP 도구/stdio는 구현하지 않았다. 작성 계약은 루트의 `docs/guide/README.md`에 있다.

`pnpm test --run packages/core/src/parser`로 기능 테스트를 실행한다. 테스트 이름과 설명문은 “[조건/행동]하면 [관찰 가능한 결과]한다” 형태로 작성한다. 기준 규칙은 Local Work Memory의 「Codocs 개발 환경과 코드·테스트 컨벤션」 (`codocs-development-conventions`)이 소유한다. 오류 테스트의 코드 비교·기대값은 `yamlDiagnosticCodes`를 사용한다. 외부에 반환하는 코드 문자열의 호환성은 별도 빌드 계약 테스트에서 명시적인 문자열 기대값으로 확인한다. 정상·금지 6종·잘린 YAML·비매핑, 실제 문자열 값과 끝 개행, LF·CRLF·한글·이모지·EOF 좌표, 중첩·flow의 세 가지 원문 slice를 고정 기대값으로 검증한다. `pnpm check:development`는 source 전체를 복사한 frozen 재설치 및 불일치 거부, 공개 진입점과 개발 규칙을 검증한다. `pnpm check:build`는 source 없는 JS·`types: []` 선언 소비자, 소비자 내부에 명시적으로 준비한 yaml 의존성, 실제 core API 실행과 CJS bundle을 검증한다. 원본 예제와 MCP/vscode dist·pack에서 추출한 예제의 파싱 성공, 전체 데이터의 고정 기대값, ID 위치와 원문 일치 및 guide 원문 일치도 검사한다. build는 test/spec를 제외한다. 검증 환경은 Windows x64 / Node 24.21.0 / pnpm 10.34.5다.
