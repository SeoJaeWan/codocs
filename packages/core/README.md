# core

IO 없는 .codocs YAML 파싱·원문 위치, Zod 문서 스키마 검증, 경로별 참조 색인과 이름 변경 수정안 계산을 제공한다. Node 내장 모듈과 IDE/LSP/MCP SDK에 직접 의존하지 않는다. 실제 프로젝트 선택·파일 IO·연결 경계·스캔 상태는 `@codosc/workspace`가 담당하며 core는 순수 함수·타입·상수를 제공한다. 필수 속성·자료형·ID·JSON 값을 검증한다. 파싱·스키마 성공이나 범위 조회는 저장·삭제 허용을 의미하지 않는다.

공개 진입점은 `@codosc/core`다. `src/index.ts`는 parser·diagnostics·validator·references·catalog를 재내보낸다. 직접 의존성은 정확히 고정한 `yaml@2.9.1`과 `zod@4.6.5`이며 lockfile에 기록한다. ESM JS와 선언 파일은 tsc로 `dist`에 생성한다. 추출 타입 선언은 Zod에 의존하고 `validateDocument`는 ZodError를 반환하지 않는다. strict, ES2022, NodeNext, 상대 `.js` import와 `types: []`를 유지한다.

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

공통 진단은 `Diagnostic`의 `code/severity/message`와 선택적인 `path/fieldPath/range`를 사용한다. 확인되지 않은 메타데이터는 생략한다. YAML 오류 코드는 `src/diagnostics/index.ts`의 `yamlDiagnosticCodes`에서 관리하며 각 코드의 발생 조건을 주석으로 설명한다. `YamlDiagnosticCode`와 `YamlDiagnostic.code`의 타입도 이 정의에서 도출한다. 공개 진입점에서 두 정의를 가져올 수 있다. `schemaDiagnosticCodes`는 `missingRequiredField` (`missing_required_field`), `invalidFieldType` (`invalid_field_type`), `invalidFieldValue` (`invalid_field_value`), `unknownField` (`unknown_field`)를 제공한다. `DiagnosticCode`는 core의 YAML·스키마·참조 문법·색인 코드 합집합이다. 공통 형식 `Diagnostic<Code extends string = DiagnosticCode>`는 각 계층이 자기 코드 타입을 지정할 수 있으며 `DiagnosticSeverity`는 `error/warning`이다. 문서 검증은 오류를 `errors`, 사용자 속성 경고를 `warnings`로 분리한다.

고정 진단 문구는 같은 모듈의 `yamlDiagnosticMessages`와 `schemaDiagnosticMessages`에서 관리하며 공개 진입점에서 가져올 수 있다. 구현과 테스트는 해당 상수를 함께 참조한다. YAML 문법 오류는 `yamlDiagnosticMessages.syntaxErrorPrefix` 뒤에 라이브러리 상세 메시지를 이어 붙이며, Zod가 생성하는 상세 메시지도 그대로 유지한다.

| 코드 상수                                    | 반환 코드                  | 발생 조건                                                                                      |
| -------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `yamlDiagnosticCodes.invalidYaml`            | `invalid_yaml`             | 비문자열 입력, YAML 문법 오류, 빈 문서 또는 최상위 값이 매핑이 아닌 경우                       |
| `yamlDiagnosticCodes.unsupportedYamlFeature` | `unsupported_yaml_feature` | 앵커·별칭·병합 키·사용자 태그·복수 문서·중복 키가 있는 경우. 중첩 매핑과 flow 표기 자체는 허용 |

`YamlParseResult`는 `success`로 분기한다. 성공에는 `source`, `data`, `fields`, `strings`, `diagnostics`와 AST에서 확인한 최상위 매핑의 `rootRange`가 있고 실패에는 `data/fields/strings/rootRange`가 없다. `rootRange`는 AST의 매핑 값 범위(`OffsetRange`)이며 문서 표시와 앞뒤 독립 주석을 제외한다. 블록 매핑의 같은 줄 주석·끝 개행은 포함할 수 있고 flow 매핑 뒤 주석은 제외한다. AST 범위가 없으면 임의로 원문 전체를 사용하지 않고 생략한다. `YamlDiagnostic`은 공통 `Diagnostic`을 확장하며 YAML 코드, `severity: 'error'`, 원인별 한국어 메시지, 선택적인 `path`, `offsetRange`와 외부 `range`를 제공한다. 위치를 확인할 수 없으면 두 범위 필드를 생략한다.

`FieldPath`는 문자열 매핑 키와 숫자 배열 인덱스의 배열이다. 점이 포함된 문자열도 실제 키로 취급한다. `getKeyRange`, `getValueRange`, `getPropertyRange`는 확인된 `OffsetRange` 또는 `undefined`를 반환한다. 값 범위는 따옴표와 블록 헤더를 포함하고 뒤의 주석을 제외한다. 속성 전체는 키부터 같은 줄·값 내부 주석과 블록 개행까지 포함하며 앞의 독립 주석은 제외한다. 빈 값에는 확인된 0 길이 값 범위가 있다. 배열 항목에는 값 범위만 있고 매핑 키와 속성 전체 범위가 없다. 복합 매핑 키처럼 `FieldPath`로 표현할 수 없는 위치에는 범위를 임의 생성하지 않는다.

일반 flow 속성의 전체 범위에는 주변 쉼표를 포함하지 않는다. 쉼표 뒤 같은 줄 주석까지 포함해야 하는 경우 연속 원문 범위에 해당 쉼표도 들어간다. 이 API는 주변 쉼표 편집, 실제 속성 삭제와 writer를 구현하지 않는다.

모든 offset은 0 기반 UTF-16이고 시작 포함·끝 제외다. `source.slice(start, end)`로 실제 원문을 조회한다. 원문의 CRLF·공백·주석·따옴표를 정규화하지 않는다. 이모지는 UTF-16 코드 단위로 센다. `offsetToPosition`은 LF 다음을 새 줄로 세어 0 기반 `line/character`를 반환하며 EOF를 허용한다. 범위 밖·비정수 offset에는 좌표가 없다. CRLF 내부 offset은 원문 코드 단위 위치다. EOF 문법 오류는 확인된 0 길이 삽입 위치를 제공한다.

`examples/.codocs/terms.yaml`과 `knowledge.yaml`은 파일마다 하나의 매핑이며 가상 프로젝트의 ID·참조·본문을 유지한다. 예제 읽기는 tools의 Node subprocess에서 수행하고 core는 문자열만 받는다. core의 참조 해석은 순수 계산이며 실제 rename writer, Hover/LSP와 외부 MCP 연결은 이번 구현 범위가 아니다. 작성 계약은 루트의 `docs/guide/README.md`에 있다.

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

workspace 전용 경로·IO·순환 진단 코드와 고정 문구는 `@codosc/workspace`가 소유하고 공개한다. core는 workspace 코드에 의존하지 않으며 공통 진단 형식만 제공한다. 실제 파일 확인·읽기·경로 해석은 workspace에서 수행한다.

## 해석 문자열의 원문 매핑과 본문 참조 추출

`parseYaml` 성공 결과의 `strings: readonly StringSourceMapping[]`는 문자열 값마다 `fieldPath/value/sourceRanges`를 제공한다. `sourceRanges`의 인덱스는 해석 문자열의 UTF-16 코드 단위 offset이며 각 항목은 그 문자를 만든 실제 YAML 원문 구간이다. Unicode escape 하나가 이모지를 만들면 두 코드 단위 모두 같은 escape 구간을 가리킨다. 줄 접기가 만든 공백·개행은 기여한 실제 개행 구간을 가리키고, YAML이 EOF에 생성한 마지막 개행은 EOF의 0 길이 구간을 가리킨다. AST/CST 객체나 YAML 내부 타입을 공개하지 않는다.

`getStringMapping(parsed, fieldPath)`는 매핑의 복사본 또는 `undefined`를 반환한다. `getStringRange(parsed, fieldPath, { start, end })`는 비어 있지 않은 해석 문자열 범위를 실제 원문 범위로 계산한다. 범위 밖·비정수·역방향·빈 범위와 실패·비문자열 값에는 `undefined`다. 기존 `fields/getKeyRange/getValueRange/getPropertyRange`의 의미는 변경하지 않는다. 매핑은 공개 AST/CST의 스칼라 토큰과 해석값 일치 검증으로 얻으며 원문 검색이나 해석 offset의 단순 가산을 사용하지 않는다. 따옴표·Unicode escape·여러 줄 plain/quoted·literal/folded 블록·들여쓰기·chomping과 LF/CRLF를 처리한다.

```ts
import { parseYaml, extractReferences } from '@codosc/core';

const parsed = parseYaml('type: knowledge\nbody: "[[판매:주문]] [[주문]]"\n');
const extracted = extractReferences(parsed, 'knowledge.yaml');
for (const occurrence of extracted.occurrences) {
  if (occurrence.syntax === 'valid') {
    console.log(occurrence.name, occurrence.domain); // 주문, 판매 / 주문, undefined
  }
  console.log(occurrence.fieldPath, occurrence.offsetRange, occurrence.range);
}
console.log(extracted.diagnostics);
```

`extractReferences(parsed: YamlParseResult, path?: string): ReferenceExtraction`는 파싱 성공의 `type`을 먼저 확인한다. term의 문자열 `definition`과 배열 `examples`의 문자열 원소, knowledge의 문자열 `body`에서만 추출한다. 본문 외 필드·잘못된 종류·자료형·배열 원소는 변환이나 종류 추측 없이 제외한다. 정상 원소는 유지하며 스키마 실패나 ID 누락으로 정상 본문을 버리지 않는다. 파싱 실패는 빈 등장·진단을 반환한다. 입력·원문·렌더링을 변경하거나 파일을 읽고 저장하지 않는다.

문법은 YAML 해석 문자열에서 판정한다. `[[` 바로 앞 연속 백슬래시 개수가 홀수면 리터럴이고 짝수면 참조다. 첫 비이스케이프 콜론은 도메인 구분자이며 구성 내부 콜론은 `\:`로 작성한다. `[[이름]]`과 `[[도메인:이름]]`의 이름·도메인은 trim·대소문자 보정·ID 패턴 제한 없이 유지한다. escape 콜론만 해석 이름에서 콜론으로 바꾸며 실제 `text`와 원문은 그대로다. 빈 이름·도메인, 대괄호가 남은 구성, 추가 비이스케이프 콜론과 미완성은 오류다. 닫히기 전에 새 비리터럴 `[[`가 나타나면 앞 구간을 오류로 기록하고 새 시작에서 복구한다.

`ReferenceOccurrence`는 `syntax: 'valid' | 'invalid'`로 분기한다. 각 등장에는 `text/fieldPath/decodedRange/offsetRange/range`가 있고 정상 문법에만 `name`과 선택 `domain`이 있다. 반복과 무효 등장도 모두 보존한다. `decodedRange`는 해석 문자열, `offsetRange/range`는 실제 YAML 원문 기준이며 모두 0 기반 UTF-16 시작 포함·끝 제외다. `ReferenceDiagnostic`은 실제 오류 등장 범위와 `severity: 'error'`, 선택 `path`를 제공한다. `referenceDiagnosticCodes.invalidReference` (`invalid_reference`)와 `referenceDiagnosticMessages.invalidReference`가 코드·고정 문구를 소유하며 `DiagnosticCode`에도 참조 문법 코드를 포함한다. 이름 후보 검색·ID 충돌·확정 연결·역참조는 이 추출 API가 해석하지 않는다.

인접 `parser/stringMapping.test.ts`와 `references/references.test.ts`는 실제 해석값·원문 slice·고정 offset/좌표, 백슬래시 홀짝·콜론·중첩 복구·반복 위치, mixed examples·파싱 실패와 입력 불변을 검증한다. 이번 task의 환경은 Windows x64 / Node 24.21.0 / pnpm 10.34.5이며 과거 macOS 검증과 별개다. IO·실제 IDE/MCP·rename writer를 검증한 것으로 간주하지 않는다.

`pnpm exec vitest run tools/buildChecks -t workspace`는 core/workspace의 실제 tarball을 소스 없는 별도 소비자에 offline frozen 설치하고 `@codosc/workspace` 공개 로더를 실행한다. workspace가 core 공개 진입점의 parser→validator에 읽은 원문과 확인한 경로·위치를 전달하는지, 내용 오류가 스캔 누락과 구분되는지, 경고만 있는 성공과 사용자 값이 유지되는지 검사한다. 소비자의 공개 d.ts는 상태로 좁힌 검증 데이터와 IO 진단을 제공하며 Node/TS workspace 내부 subpath를 거부한다. 기존 core parser·schema JS/d.ts 검사는 `pnpm check:build`에서 그대로 실행한다. 이 workspace 배포 소비 검증 환경은 macOS arm64 / Node 24.21.0 / pnpm 10.34.5이며 다른 OS·Windows 정션은 미검증이다. 실제 저장·링크 교체 시 재검증·외부 watcher·색인·공유 대상 잠금은 후속 계층의 작업이다.

## 경로별 색인·갱신·이름 변경 계산

`buildCatalog(scan: CatalogScan, previous?: Catalog): Catalog`는 로더가 제공한 `observations: { path, realPath?, parsed }[]`와 `status: complete | partial | failed`, 선택 `failures`를 받는다. `path`는 호출자가 준비한 프로젝트 상대 발견 경로이며 슬래시·대소문자·실경로를 정규화하지 않는다. 같은 ID나 realPath라도 발견 경로가 다르면 별도 문서다. 동일 경로의 재관측은 마지막 관측으로 갱신한다. core는 파일을 읽거나 실패 원문에서 데이터를 추측하지 않는다.

`documents`는 발견 경로별 `CatalogDocument`다. `idPaths`, `namePaths`, `domainNamePaths`는 각각 ID→경로 집합, 전체 이름→경로 집합, 도메인→이름→경로 집합이다. 콜론을 연결 키로 사용하지 않는다. term.name과 knowledge.title은 통합 이름 공간이며 같은 도메인 중복은 모든 경로에 `duplicate_name`, ID 중복은 `duplicate_id`다. 다른 도메인의 동명은 허용하며 knowledge의 여러 도메인과 반복 도메인은 같은 경로 후보 하나다. 자료형·빈 값 오류 필드는 색인하지 않지만 ID 형식 오류·누락이나 다른 필드 오류가 확인 가능한 이름과 정상 본문을 버리지는 않는다.

```ts
import {
  buildCatalog,
  parseYaml,
  planRename,
  resolveReference,
} from '@codosc/core';

const catalog = buildCatalog({
  status: 'complete',
  observations: loadedFiles.map(({ relativePath, source, realPath }) => ({
    path: relativePath,
    realPath,
    parsed: parseYaml(source, relativePath),
  })),
});
const result = resolveReference(catalog, { name: '주문', domain: '판매' });
const plan = planRename(catalog, {
  targetPath: '.codocs/order.yaml',
  newName: '판매주문',
});
```

`resolveReference(catalog, { name, domain? }, sourcePath?)`는 정확 비교한다. 무도메인은 전체 이름 공간이고 작성 문서의 도메인을 우선하지 않는다. 반환 `status`는 `missing/ambiguous/self/unconfirmed/resolved`이며 `candidates`는 경로 오름차순의 확인 가능한 종류·이름·ID·도메인·경로·오류·확인 상태를 제공한다. 단일 대상에는 `target`이 있다. 본문 문법 오류는 `CatalogOccurrence.resolution.status: invalid`다. 문서의 `occurrences`는 TASK-001의 등장 객체·fieldPath·해석/실제 원문 UTF-16 범위를 그대로 유지한다. `documentDiagnostics`는 파싱·스키마·색인 오류이며 `diagnostics`는 여기에 문법·참조 의미 진단을 합친다. 대상의 문서 오류는 후보의 `errors`와 `reference_target_error` 경고로 보이지만 확인된 이름/경로의 직접 연결을 버리지 않는다.

`references/referencedBy`는 확정 직접 연결만 경로별 중복 제거하고 경로 오름차순으로 제공한다. 반복 등장 위치는 모두 남는다. 부재·모호함·미확인·자기 참조는 역참조를 만들지 않는다. 다중 소속 도메인의 같은 발견 문서도 자기 참조이며 다른 문서 A↔B는 허용한다. 전이 연결·본문 확장은 없다.

complete 재관측만 이전 미관측 문서를 제거한다. partial은 확인한 문서를 갱신하고 **모든 미관측 이전 경로를 보수적으로 unconfirmed로 보존**한다. 실패 파일·폴더 밖 경로도 partial의 부재만으로 삭제하지 않는다. failed는 새 관측을 무시하고 이전 색인을 미확인 상태로 보존한다. `failures`에는 IO 계층의 file/folder/unknown 범위와 선택 `Diagnostic<string>[]`를 유지한다. 스캔 실패와 문서 오류는 별도다. partial/failed는 미발견 신규 후보 가능성이 있으므로 현재 후보가 0개 또는 1개여도 모든 이름 검색을 unconfirmed로 반환하며 확정 연결 목록은 비운다. 이후 complete에서 확인·연결·충돌을 재계산한다. 입력 관측·원문·이전 Catalog는 변경하지 않는다. 반환 컬렉션의 Readonly 계약도 소비자가 지켜야 한다.

`planRename(catalog, { targetPath, newName, updateReferences?, selections? }): RenamePlan`은 저장하지 않는 순수 수정안이다. `changes`에는 이름 필드 및 각 참조의 발견 경로·fieldPath·실제 offset/좌표·oldText/newText·targetPath·후보·선택 occurrenceIndex가 있다. oldText/newText는 **해석값**이며 YAML 따옴표·escape·folded 레이아웃을 그대로 교체할 raw patch가 아니다. writer가 원문 보존과 저장 안전성을 별도 구현해야 한다.

참조 동시 변경은 기본 true이며 false면 이름 필드만 계획하고 미해결 영향을 남긴다. 확정 대상과 `selections: { sourcePath, occurrenceIndex, targetPath, domain? }[]`로 선택한 모호 후보를 유지하며 다른 후보 선택도 존중한다. 기존 명시 도메인은 바꾸지 않는다. 새 무도메인 표기가 모호하면 단일 소속 도메인을 명시하고, 다중 도메인이면 사용자 domain 선택이 없을 때 미해결이다. 콜론은 참조 내부에서 escape하고 새 표기의 문법 round trip이 불가능하면 미해결로 남긴다. 리터럴은 제외한다. 같은 도메인의 새 이름 충돌은 종류와 무관하게 `conflicts`로 반환하고 전체 변경을 차단한다. 불완전 색인도 충돌 부재를 확정하지 않아 차단한다.

`status: ready | unresolved | blocked`는 저장 허용이 아니다. `impacts`는 무선택 모호 후보가 이름 변경 후 다른 단일 후보가 되는 경우도 이전/이후 후보와 실제 등장 위치로 보고한다. 미선택·잘못된 선택·도메인 미선택·참조 변경 비활성화 등을 자동 결정하지 않는다. `invalidSelections`는 존재하지 않는 등장·리터럴·중복 선택을 보고하며 이런 선택은 차단한다. `catalogDiagnosticCodes/catalogDiagnosticMessages`는 색인 코드·고정 한국어 문구를 소유하고 `DiagnosticCode`에도 코드 합집합을 추가한다. `CatalogDiagnostic`은 확인한 offsetRange와 충돌의 relatedPaths·domain도 제공한다.

인접 `catalog/catalog.test.ts`는 경로/이름/ID 충돌, 정상 부분 정보, 전체 정확 검색, 반복·순환·자기 참조, 갱신·부분/실패/회복과 rename 선택·충돌·실제 위치·입력 불변을 검증한다. TASK-001의 parser/references 테스트도 그대로 수행한다. 1,000개 합성 문서의 구축/갱신·등장/연결 수 측정은 task-local `.workbench` 보고서에 남기며 제품의 2초/500ms·실제 IDE/MCP 목표를 달성했다는 근거가 아니다. 이번 계산 API 검증 환경은 Windows x64 / Node 24.21.0 / pnpm 10.34.5다. 실제 로더 연결·배포 소비는 후속 단계이며 UI·실제 rename·다중 파일 writer/복구·watcher·LSP/MCP 연결은 구현하지 않는다.
