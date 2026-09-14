# core

IO 없는 .codocs YAML 파싱·원문 위치와 Zod 문서 스키마 검증을 제공한다. Node 내장 모듈과 IDE/LSP/MCP SDK에 직접 의존하지 않는다. 필수 속성·자료형·ID·JSON 값은 검증하며 참조 의미는 후속 계층의 책임이다. 파싱·스키마 성공이나 범위 조회는 저장·삭제 허용을 의미하지 않는다.

공개 진입점은 `@codosc/core`다. `src/index.ts`는 parser·diagnostics·validator를 재내보낸다. 직접 의존성은 정확히 고정한 `yaml@2.9.1`과 `zod@4.6.5`이며 lockfile에 기록한다. ESM JS와 선언 파일은 tsc로 `dist`에 생성한다. 추출 타입 선언은 Zod에 의존하고 `validateDocument`는 ZodError를 반환하지 않는다. strict, ES2022, NodeNext, 상대 `.js` import와 `types: []`를 유지한다.

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

`parseYaml(input: unknown, path?: string)`는 문자열을 검사하고 Document/CST 토큰으로 원문 위치와 금지 구문을 확인한 후 데이터를 변환한다. 단일 문서와 최상위 매핑만 성공한다. 단일 `---`, 주석, 따옴표, 블록 문자열, 중첩 배열·객체와 flow 구조는 허용한다. 앵커, 별칭, 병합 키, 사용자 태그, 복수 문서와 중복 키는 `unsupported_yaml_feature`이며 일반 문법 오류와 비매핑은 `invalid_yaml`이다. 뒤의 중복 키 전체를 지목한다. 실패는 원문·진단만 제공하고 복구 AST에서 정상 데이터를 선택하지 않는다. 비문자열 입력에는 원문과 위치가 없다. `path`는 진단 메타데이터일 뿐 파일을 읽지 않는다. 파서 진단은 항상 `severity: 'error'`다.

공통 진단은 `Diagnostic`의 `code/severity/message`와 선택적인 `path/fieldPath/range`를 사용한다. 확인되지 않은 메타데이터는 생략한다. YAML 오류 코드는 `src/diagnostics/index.ts`의 `yamlDiagnosticCodes`에서 관리하며 각 코드의 발생 조건을 주석으로 설명한다. `YamlDiagnosticCode`와 `YamlDiagnostic.code`의 타입도 이 정의에서 도출한다. 공개 진입점에서 두 정의를 가져올 수 있다. `schemaDiagnosticCodes`는 `missingRequiredField` (`missing_required_field`), `invalidFieldType` (`invalid_field_type`), `invalidFieldValue` (`invalid_field_value`), `unknownField` (`unknown_field`)를 제공한다. `DiagnosticCode`는 YAML·스키마·workspace 코드의 합집합이며 `DiagnosticSeverity`는 `error/warning`이다. 문서 검증은 오류를 `errors`, 사용자 속성 경고를 `warnings`로 분리한다.

고정 진단 문구는 같은 모듈의 `yamlDiagnosticMessages`와 `schemaDiagnosticMessages`에서 관리하며 공개 진입점에서 가져올 수 있다. 구현과 테스트는 해당 상수를 함께 참조한다. YAML 문법 오류는 `yamlDiagnosticMessages.syntaxErrorPrefix` 뒤에 라이브러리 상세 메시지를 이어 붙이며, Zod가 생성하는 상세 메시지도 그대로 유지한다.

| 코드 상수                                    | 반환 코드                  | 발생 조건                                                                                      |
| -------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `yamlDiagnosticCodes.invalidYaml`            | `invalid_yaml`             | 비문자열 입력, YAML 문법 오류, 빈 문서 또는 최상위 값이 매핑이 아닌 경우                       |
| `yamlDiagnosticCodes.unsupportedYamlFeature` | `unsupported_yaml_feature` | 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 키가 있는 경우. 중첩 매핑과 flow 표기 자체는 허용 |

`YamlParseResult`는 `success`로 분기한다. 성공에는 `source`, `data`, `fields`, `diagnostics`와 AST에서 확인한 최상위 매핑의 `rootRange`가 있고 실패에는 `data/fields/rootRange`가 없다. `rootRange`는 AST의 매핑 값 범위(`OffsetRange`)이며 문서 표시와 앞뒤 독립 주석을 제외한다. 블록 매핑의 같은 줄 주석·끝 개행은 포함할 수 있고 flow 매핑 뒤 주석은 제외한다. AST 범위가 없으면 임의로 원문 전체를 사용하지 않고 생략한다. `YamlDiagnostic`은 공통 `Diagnostic`을 확장하며 YAML 코드, `severity: 'error'`, 원인별 한국어 메시지, 선택적인 `path`, `offsetRange`와 외부 `range`를 제공한다. 위치를 확인할 수 없으면 두 범위 필드를 생략한다.

`FieldPath`는 문자열 매핑 키와 숫자 배열 인덱스의 배열이다. 점이 포함된 문자열도 실제 키로 취급한다. `getKeyRange`, `getValueRange`, `getPropertyRange`는 확인된 `OffsetRange` 또는 `undefined`를 반환한다. 값 범위는 따옴표와 블록 헤더를 포함하고 뒤의 주석을 제외한다. 속성 전체는 키부터 같은 줄·값 내부 주석과 블록 개행까지 포함하며 앞의 독립 주석은 제외한다. 빈 값에는 확인된 0 길이 값 범위가 있다. 배열 항목에는 값 범위만 있고 매핑 키와 속성 전체 범위가 없다. 복합 매핑 키처럼 `FieldPath`로 표현할 수 없는 위치에는 범위를 임의 생성하지 않는다.

일반 flow 속성의 전체 범위에는 주변 쉼표를 포함하지 않는다. 쉼표 뒤 같은 줄 주석까지 포함해야 하는 경우 연속 원문 범위에 해당 쉼표도 들어간다. 이 API는 주변 쉼표 편집, 실제 속성 삭제와 writer를 구현하지 않는다.

모든 offset은 0 기반 UTF-16이고 시작 포함·끝 제외다. `source.slice(start, end)`로 실제 원문을 조회한다. 원문의 CRLF·공백·주석·따옴표를 정규화하지 않는다. 이모지는 UTF-16 코드 단위로 센다. `offsetToPosition`은 LF 다음을 새 줄로 세어 0 기반 `line/character`를 반환하며 EOF를 허용한다. 범위 밖·비정수 offset에는 좌표가 없다. CRLF 내부 offset은 원문 코드 단위 위치다. EOF 문법 오류는 확인된 0 길이 삽입 위치를 제공한다.

`examples/.codocs/terms.yaml`과 `knowledge.yaml`은 파일마다 하나의 매핑이며 가상 프로젝트의 ID·참조·본문을 유지한다. 예제 읽기는 tools의 Node subprocess에서 수행하고 core는 문자열만 받는다. 현재 참조 해석, 파일 IO·writer, Hover/LSP, VS Code activation과 MCP 도구/stdio는 구현하지 않았다. 작성 계약은 루트의 `docs/guide/README.md`에 있다.

`pnpm test --run packages/core/src`로 기능 테스트를 실행한다. 테스트 이름과 설명문은 “[조건/행동]하면 [관찰 가능한 결과]한다” 형태로 작성한다. 기준 규칙은 Local Work Memory의 「Codocs 개발 환경과 코드·테스트 컨벤션」 (`codocs-development-conventions`)이 소유한다. 오류 테스트의 코드 비교·기대값은 `yamlDiagnosticCodes`와 `schemaDiagnosticCodes`를 사용한다. 외부에 반환하는 코드 문자열의 호환성은 별도 빌드 계약 테스트에서 명시적인 문자열 기대값으로 확인한다. 정상·금지 6종·잘린 YAML·비매핑, 실제 문자열 값과 끝 개행, LF·CRLF·한글·이모지·EOF 좌표, 중첩·flow의 세 가지 원문 slice를 고정 기대값으로 검증한다. `pnpm check:development`는 source 전체를 복사한 frozen 재설치 및 불일치 거부, 공개 진입점과 개발 규칙을 검증한다. `pnpm check:build`는 source 없는 JS·`types: []` 선언 소비자, 소비자 내부에 명시적으로 복사한 yaml·Zod 의존성, 실제 core API 실행과 CJS bundle을 검증한다. 원본 예제와 MCP/vscode dist·pack에서 추출한 예제의 parser→validator 성공, 전체 데이터의 고정 기대값, ID 위치와 원문 일치 및 guide 원문 일치도 검사한다. build는 test/spec를 제외한다. 이번 전체 기능·개발·빌드·typecheck·lint·변경 파일 서식 검증은 macOS arm64 / Node 24.21.0 / pnpm 10.34.5 / yaml 2.9.1 / Zod 4.6.5에서 수행한다. 루트 format:check는 변경하지 않은 `.github/workplans/COD-4.md`의 기존 서식 실패 한 건만 남는다. 기존 Windows x64 빌드 검증과 구분하며 VS Code/Node 20 호스트, 실제 MCP 클라이언트·npm 단독 설치·게시·VSIX는 시험하지 않았다.

`validateDocument({ data, path?, source?, fields?, rootRange? })`는 조회·생성 후보·수정 후보의 전체 데이터를 검사한다. 수정 시 호출자가 기존 데이터와 변경을 병합해야 한다. 데이터만 넘겨도 검사할 수 있고 확인된 원문 위치가 없으면 진단의 `range`를 생략한다. 성공 결과는 `success: true`, Zod 스키마에서 추출한 `Term | Knowledge` 데이터, `errors: []`, 별도 `warnings`를 제공한다. 실패에는 `data`가 없다. 성공 데이터는 원래 객체를 참조하며 데이터·원문·위치를 변경하지 않는다.

```ts
import { parseYaml, validateDocument } from '@codosc/core';

const parsed = parseYaml(source, path); // source와 path는 호출자가 준비한다.
if (parsed.success) {
  const validated = validateDocument({
    data: parsed.data,
    source: parsed.source,
    fields: parsed.fields,
    ...(parsed.rootRange ? { rootRange: parsed.rootRange } : {}),
    path,
  });
  if (validated.success) console.log(validated.data, validated.warnings);
  else console.log(validated.errors, validated.warnings);
}
```

추출 타입 `Term`, `Knowledge`, 사용자 값 타입 `JsonValue`도 공개한다. Zod 스키마 객체와 ZodError는 공개 API에서 반환하지 않는다. term 필수 속성은 `type: term/id/name/definition/domain`이며 선택 `examples: string[]`, `deprecatedAliases: { name: string; message?: string }[]`는 빈 배열을 허용한다. knowledge 필수 속성은 `type: knowledge/id/title/body/domains`이고 `domains`는 하나 이상의 문자열이다. 선택 `kind`는 `policy/procedure/decision/discussion`, `status`는 `proposed/confirmed/deprecated`다. status 생략에 기본값이나 경고를 추가하지 않는다.

문자열은 빈 값과 공백뿐인 값을 거부하지만 대소문자·공백·개행을 그대로 유지한다. ID는 `^[a-z0-9]+(?:-[a-z0-9]+)*$` 전체 일치만 허용한다. 알려진 속성의 null이나 틀린 원소는 오류다. 사용자 속성은 문자열·유한 숫자·boolean·null·배열·문자열 키 객체로 구성한 재귀 JSON 값을 유지하며 `unknown_field` 경고를 제공한다. 사용자 객체 내부의 키는 업무 필드로 해석하지 않는다. `aliases`도 사용자 속성일 뿐 매칭 의미는 없다. 비유한 수·명시적 undefined·순환·희소 배열·함수·클래스 객체·접근자·symbol 키는 JSON 성공 값으로 변환하거나 제거하지 않는다. 같은 객체의 재사용은 순환으로 거부하지 않는다.

스키마 오류의 심각도는 `error`, 경고는 `warning`이며 경고만 있으면 성공이다. 누락은 `missing_required_field`, 자료형은 `invalid_field_type`, 빈 문자열·ID·enum·배열 길이·비유한 수와 비JSON 값은 `invalid_field_value`다. 값 오류와 잘못된 원소는 해당 값 범위, 사용자 속성 경고는 키 범위, 필수 누락은 확인된 직접 부모 값 범위 또는 최상위 `rootRange`를 사용한다. 부모 위치를 확인할 수 없으면 범위를 생략하며 원문 전체로 대체하지 않는다. 모든 외부 좌표는 0 기반 UTF-16 시작 포함·끝 제외다.

독립 소비자는 실제 파일을 읽어 parser→validator를 실행하고 별도 객체·병합 수정 후보도 검사한다. 성공/실패의 입력 보존, 경고만 있는 성공, status 생략과 aliases 보존, 네 가지 외부 코드 리터럴·path/severity·UTF-16 범위를 고정 기대값으로 확인한다. `types: []`와 strict/exactOptionalPropertyTypes의 dist d.ts 소비자는 success 분기 및 Term/Knowledge 필드 타입을 사용하며 실패 data 접근·잘못된 필드 타입·내부 스키마 공개 접근을 거부한다. Node/TS 내부 subpath 거부와 실제 CJS bundle의 parser·validator 성공/오류 실행도 확인한다. frozen 설치 fixture는 복사한 core source를 빌드한 뒤 공개 JS·선언 validator를 소비한다. 테스트 생성물과 의존성은 작업 전용 `.workbench/fixtures`·node_modules·store에 격리한다.

선언 소비의 `types: []`는 Node 전역 타입 자동 추가를 차단한다. Zod 4.6.5의 외부 선언은 `URL` 전역 타입을 참조하므로 이번 `skipLibCheck: false` 독립 소비자는 `lib: [ES2022, DOM]`으로 검증한다. `lib: [ES2022]`만 사용하는 저장소와 frozen fixture의 core emit은 공통 `skipLibCheck: true`를 사용한다. DOM 없이 외부 선언까지 검사하는 소비자의 성공은 보장하지 않는다. Zod 추출 선택 필드 타입에는 undefined가 포함되지만 validator는 명시적인 undefined 입력을 허용하지 않는다.

`workspaceDiagnosticCodes`, `workspaceDiagnosticMessages`, `WorkspaceDiagnosticCode`는 workspace의 루트·경로·IO·순환 진단을 위한 공개 정의다. `invalidProjectRoot`, `projectRootUnavailable`, `invalidWorkspacePath`, `pathOutsideWorkspace`, `pathUnavailable`, `notDirectory`, `readFailed`, `circularDirectoryLink`는 각각 입력/디렉터리 검증, 루트 접근, 경로 입력, 연결 범위 탈출, 실제 대상 확인, 폴더 요구, 읽기/열거 실패, 현재 가지의 조상 연결 조건을 표현한다. core는 이 정의를 제공하며 실제 파일 확인·읽기·경로 해석은 workspace에서 수행한다. workspace는 확인하지 못한 원문·실경로·ID·좌표를 만들지 않고 실제 시스템 오류 코드만 별도로 보존한다.
