# workspace

프로젝트 루트 선택, 연결 YAML 탐색·읽기, 논리 경로·실제 대상·읽기/쓰기 범위 판정을 담당하는 IO 경계다. 순수 검증과 진단 코드·고정 문구는 `@codosc/core` 공개 진입점만 소비한다. `src/projectRoot`는 루트 선택·확인, `src/paths`는 연결 경로 해석·범위 판정, `src/diagnostics`는 확인된 경로와 실제 시스템 오류 코드 전달, `src/loader`는 가지별 순환 중단·원문 읽기·core 파싱/검증 연결과 스캔 상태 분리, `src/indexing`은 스캔을 core 색인 관측으로 변환하는 연결을 담당한다.

공개 진입점은 `@codosc/workspace`이며 다른 패키지의 내부 경로·subpath import를 금지한다. package exports는 루트 `.`만 제공한다. Node와 TypeScript에서 `@codosc/workspace/src/index.js`, `@codosc/workspace/dist/index.js`, `@codosc/workspace/dist/loader/index.js` 접근을 거부한다. tsc는 core 다음에 ESM `dist/index.js`와 `dist/index.d.ts`를 생성한다. ES2022·NodeNext·type module·상대 `.js` import를 유지하고 Node IO를 사용하는 workspace에만 `types: [node]`를 활성화한다. 공개 반환 타입은 Node Stats 같은 FS 내부 타입을 노출하지 않는다.

```ts
import { resolveProjectRoot, resolveWorkspacePath } from '@codosc/workspace';

const selected = await resolveProjectRoot({ project: '../app' });
if (selected.success) {
  const checked = await resolveWorkspacePath(
    selected.root,
    '.codocs/공통/terms.yaml',
  );
  if (checked.success)
    console.log(checked.path, checked.realPath, checked.access);
  else console.log(checked.status, checked.diagnostics);
}
```

`resolveProjectRoot(options?: unknown): Promise<ProjectRootResult>`는 객체 옵션의 `cwd/project`를 검증한다. cwd 생략 시 호출 시점의 `process.cwd()`를 고정한다. project 생략 시 그 cwd를 루트로 선택하고 상대 project는 시작 cwd 기준으로 해석한다. 상위 `.codocs`나 Git을 탐색하지 않는다. 선택 루트의 디렉터리 여부·읽기/탐색 권한·실제 경로를 확인한 성공 결과는 `root`를 제공한다. 실패에는 진단과 확인한 논리 선택 경로만 있고 실제 루트는 없다. `.codocs` 부재는 루트 선택을 바꾸지 않는다. 옵션 접근자·Proxy 오류도 실패 진단으로 반환한다.

`resolveWorkspacePath(root: ProjectRoot, input: unknown): Promise<WorkspacePathResult>`는 프로젝트 상대 `.codocs/...` 경로 또는 선택 루트 아래의 논리 절대 경로를 받는다. `.codocs` 자체가 폴더 링크여도 동일하게 해석한다. 성공에는 논리 절대 `logicalPath`, 프로젝트 상대 `path`, 확인한 `realPath`, 대상 종류 `kind`, 마지막 경로의 `isSymbolicLink`, 가장 가까운 연결의 `scope`와 `access`가 있다. 대소문자·유니코드를 임의 변환하거나 같은 실제 대상의 논리 별칭을 합치지 않는다.

파일 링크는 해당 파일만 편입하고 폴더 링크는 그 하위를 편입한다. 연결 대상의 실제 외부 경로 직접 입력은 거부한다. `..`는 일반 하위 폴더 또는 연결 폴더 내부에서 부모로 돌아올 때만 허용하며 `.codocs` 또는 현재 연결 루트 밖으로 넘어가면 거부한다. 전체 입력을 먼저 정규화하여 `link/..`를 지우지 않는다. `.codocs/공통/하위/../terms.yaml`은 연결 루트 안에서 허용하지만 `.codocs/공통/../형제.yaml`은 거부한다. 파일 뒤의 폴더 탐색도 허용하지 않는다.

성공의 `access.read/write: true`는 현 시점 연결 범위 정책이며 OS 파일 읽기/쓰기 성공을 보장하지 않는다. 조회는 루트·대상을 확인하지만 파일 원문 읽기·폴더 열거·실제 저장은 수행하지 않는다. 루트는 각 경로 확인 시 다시 검증하며 실제 writer는 쓰기 시 링크 대상을 다시 확인해야 한다. 링크 유지 저장·대상 교체 충돌·watcher·색인·공유 대상 잠금은 후속 작업이다.

실패 `status`는 `denied`(입력 또는 범위 거부), `missing`(유효한 루트의 `.codocs` 자체 부재), `unavailable`(깨진 링크·잘못된 대상·대상 확인 실패)이다. 존재하는 깨진 `.codocs` 링크를 부재로 반환하지 않는다. 확인하지 못한 원문·실경로·ID·좌표는 만들지 않는다. 진단은 workspace의 `workspaceDiagnosticCodes/workspaceDiagnosticMessages`와 선택적인 실제 `ioCode`를 사용한다. 로더는 `.codocs` 부재를 정상 빈 프로젝트로, 실제 루트/IO 오류를 실패로 분리한다.

기능과 test는 `src/기능/`에 함께 두며 build에서 test/spec를 제외한다. `pnpm exec vitest run packages/workspace/src/projectRoot packages/workspace/src/paths`는 테스트마다 고유한 실제 임시 파일·폴더·링크를 만들고 자기 fixture만 정리한다. 루트 선택·잘못된 루트·체인·별칭·범위 탈출·깨진 링크·실제 권한 실패·정책과 OS 권한 구분을 확인한다. `pnpm typecheck`는 공개 선언을 순차로 준비한다. 이번 경로·로더 검증 환경은 macOS arm64 / Node 24.21.0 / pnpm 10.34.5다. Windows 정션·다른 OS/Node 버전은 미검증이며 기존 Windows x64 진입점/빌드 검증과 구분한다.

`loadWorkspace(options?: unknown): Promise<WorkspaceScanResult>`는 `resolveProjectRoot`와 같은 옵션을 받아 선택 루트의 `.codocs` 아래 `.yaml/.yml`을 탐색한다. 파일·폴더 링크를 통해 연결한 외부 대상도 읽는다. 각 폴더 진입 때 확인한 실제 경로와 0이 아닌 현재 폴더의 bigint device/inode를 현재 가지의 조상 목록에 추가하고 돌아올 때 제거한다. 실제 경로가 같거나 확인한 폴더 식별 정보가 같으면 현재 가지의 조상으로 판정한다. 0이거나 제공되지 않은 식별 정보만으로 두 폴더를 같다고 판단하지 않는다. 폴더 식별 정보는 해당 대상 확인의 관찰값이며 영구 ID·파일 병합·전역 중복 제거에 사용하지 않는다.

자기·부모·다단계 연결이 현재 가지의 조상으로 돌아오면 `skippedCycles`에 경로와 경고 진단을 남긴다. 다른 가지에서 같은 실제 폴더에 도달하면 다시 탐색한다. 같은 실제 파일의 링크 별칭과 hardlink도 발견 경로마다 읽으며 ID 중복 진단·저장 차단은 후속 계층에 전달한다. 대표 별칭이나 전역 파일 중복 제거는 제공하지 않는다.

```ts
import { loadWorkspace } from '@codosc/workspace';

const scan = await loadWorkspace({ project: '../app' });
console.log(scan.status, scan.failures, scan.skippedCycles);
for (const document of scan.documents) {
  console.log(document.source.path, document.source.realPath, document.raw);
  if (document.status === 'valid') console.log(document.data.id);
  else console.log(document.status, document.diagnostics);
}
```

`documents`의 `WorkspaceDocumentResult`는 실제로 읽은 `raw` UTF-8 원문, `source.path` 프로젝트 상대 경로, `source.logicalPath` 논리 절대 경로, 확인한 `source.realPath`, 연결 `scope/access`, 실제 core 진단을 보존한다. CRLF·한글·공백과 사용자 YAML 표기를 재포맷하지 않는다. `status: valid`에서만 검증 성공한 `data: Term | Knowledge`를 제공한다. `valid/validationError`에는 별도 `parsed: Extract<YamlParseResult, { success: true }>`도 제공한다. `parsed.data`는 검증되지 않은 `Record<string, unknown>`이며 `source/fields/strings/rootRange` 원문 매핑을 재사용한다. 이를 검증 성공 데이터로 취급하지 않는다. `validationError/parseError`에 `data`는 없고, `parseError`에는 `parsed`도 없다. 파싱 실패의 진단은 YAML 진단으로 좁혀진다. 파싱 실패 원문에서 종류·이름·참조를 추측하지 않는다. core 파싱의 `fields/rootRange`와 원문·경로를 스키마 검증에 전달하여 실제 오류·경고 좌표를 유지한다. 경고만 있는 문서는 `valid`이며 사용자 속성도 보존한다.

스캔 `status`는 문서 유효성과 별개다. `complete`는 확인 대상의 탐색 완료이며 `.codocs` 부재·빈 프로젝트·읽은 내용 오류만 있는 경우도 포함한다. 확인한 순환 연결은 의도적으로 건너뛰므로 자체적으로 부분 완료를 만들지 않는다. 하위 폴더 열거·파일 읽기 실패와 깨진 하위 링크는 `partial`이며 정상 문서는 계속 읽는다. 루트가 유효하지 않거나 읽을 수 없거나 `.codocs` 자체를 확인·탐색할 수 없으면 `failed`다. `complete/partial`은 확인한 `root`를 제공하고 `failed`의 루트는 선택에 성공한 경우에만 있다.

공개 `WorkspaceScanResult`는 `documents`, `failures`, `skippedCycles`, 합산 `diagnostics`와 위 스캔 상태를 제공한다. 문서는 `WorkspaceDocumentResult`의 `status`로 좁힌 뒤에만 `data`를 읽는다. `WorkspaceDocumentSource`는 확인한 세 경로를, `WorkspaceScanFailure`는 미확인 범위를, `WorkspaceSkippedCycle`은 의도적으로 건너뛴 연결을 표현한다. `WorkspaceDocumentDiagnostic`은 core YAML·스키마 진단이며 `WorkspaceScanDiagnostic`은 여기에 `WorkspaceDiagnostic`을 더한 합집합이다. IO 진단의 `code`로 좁히면 선택적 `ioCode`를 읽을 수 있다.

`failures`의 `WorkspaceScanFailure`는 확인하지 못한 파일·폴더 범위와 실제 IO 진단을 보관한다. 확인한 `path/logicalPath/realPath`만 제공하므로 대상 확인 실패에는 실제 경로가 없을 수 있다. 읽지 못한 원문·ID·좌표를 만들지 않는다. 부분 완료에서 누락된 경로는 삭제 증거가 아니며 후속 색인은 `failures` 범위를 보존해야 한다. workspace 진단 코드·고정 문구와 `WorkspaceDiagnosticCode`는 workspace diagnostics에서 관리하고 `@codosc/workspace` 공개 진입점으로 제공한다. 공통 형식 `Diagnostic<WorkspaceDiagnosticCode>`는 core에서 받아 사용한다.

`toCatalogScan(scan: WorkspaceScanResult): CatalogScan`은 추가 IO 없이 발견 경로별 관측과 스캔 상태·실패 범위를 변환한다. 성공 파싱 모델은 객체와 문자열 원문 매핑 그대로 재사용하고, 파싱 실패에는 원문과 YAML 진단만 전달한다. 확인한 상대 `path`가 있는 `file/directory` 실패만 core의 `file/folder`로 대응한다. 경로가 없거나 종류가 미확인이면 `unknown`이며 절대 논리 경로를 상대 실패 범위로 추측하지 않는다. IO 진단 코드·문구·`ioCode`를 바꾸지 않고, 의도적인 순환 건너뜀은 실패로 만들지 않는다.

`buildWorkspaceCatalog(scan: WorkspaceScanResult, previous?: Catalog): Catalog`은 변환한 관측을 core `buildCatalog`에 연결한다. 이전 색인은 반드시 같은 프로젝트의 것이어야 한다. ID나 실경로가 같아도 발견 경로별 문서를 합치지 않는다. ID 누락·충돌·스키마 오류에서도 확인 가능한 이름과 정상 문자열 본문은 유지하며, 직접/역참조·등장 위치·진단은 core에서 계산한다. 목록은 확정 연결만 포함하므로 모호함·자기 참조·미확인 자료에 역참조를 만들지 않는다. `complete`의 확인된 부재만 삭제 근거이며 `partial`은 새 관측을 갱신하고 모든 누락 이전 경로를 보수적으로 미확인 상태로 보존한다. `failed`는 새 관측을 채택하지 않고 이전 자료와 실패 상태를 유지한다. 미탐색 신규 후보 가능성 때문에 불확실한 검색을 성공이나 부재로 확정하지 않는다. 입력·원문은 변경하지 않는다.

```ts
import { buildWorkspaceCatalog, loadWorkspace } from '@codosc/workspace';
import { resolveReference } from '@codosc/core';

const first = buildWorkspaceCatalog(await loadWorkspace({ project: '../app' }));
const updated = buildWorkspaceCatalog(
  await loadWorkspace({ project: '../app' }),
  first,
);
console.log(updated.status, resolveReference(updated, { name: '용어' }));
```

`pnpm exec vitest run packages/workspace/src/indexing`은 Windows x64 / Node 24.21.0 / pnpm 10.34.5의 고유한 실제 임시 프로젝트에서 파싱 모델 보존·정상 원소 추출·스키마 오류 대상 연결·hardlink 발견 경로·파일 수정/이동/삭제와 충돌 해소를 확인한다. 같은 실경로 입력의 별칭 보존, partial/failed 실패 범위 전달과 복구는 결정적인 순수 스캔 입력으로 따로 확인한다. 이 순수 시험은 OS 권한 실패나 파일 symlink 시험을 대체하지 않는다. 로더의 기존 접근 정책은 변경하지 않으며 Windows 기존 실패 집합도 별도 비교한다. 계산 연결만 제공하고 watcher·UI·LSP/MCP 연결·rename 실행·다중 파일 저장/복구는 제공하지 않는다.

`pnpm exec vitest run packages/workspace`는 고유한 실제 임시 프로젝트에서 loader·경로·루트 검사를 수행한다. macOS arm64 / Node 24.21.0 / pnpm 10.34.5에서 실제 파일·폴더 링크, 순환·공유 폴더 재방문, 혼합 내용 오류·경고, 실제 파일 읽기·폴더 열거·루트·`.codocs` 권한 실패를 확인했다.

`pnpm exec vitest run tools/buildChecks -t workspace`는 이전 dist를 지우고 순차 빌드한 core/workspace tarball을 별도 소비자에 offline frozen 설치한다. 최초 lockfile 준비는 fixture 전용 cache에서 고정 의존성의 registry metadata를 조회하므로 registry 접근이 필요하다. private core 패키지 의존성은 같은 실제 core tarball에 고정하며 npm 게시 성공을 검사하는 것은 아니다. 소비자는 `src` 없이 `@codosc/workspace`만 import하며 고유한 실제 임시 프로젝트의 UTF-8·CRLF 원문, 한글·공백 경로, 외부 파일·폴더 링크와 두 논리 가지의 같은 문서, 순환 경고, 파싱/스키마 오류와 경고 성공을 확인한다. 깨진 링크는 `partial`, 내용 오류만 있으면 `complete`, `.codocs` 부재는 정상 0개, 잘못된 루트는 `failed`임을 확인한다. 실패 범위에는 확인하지 못한 원문·실경로를 넣지 않는 계약도 검사한다.

같은 소스 없는 소비자는 `types: []`, strict/exactOptionalPropertyTypes, NodeNext, ES2022, `skipLibCheck: false`, `lib: [ES2022, DOM]`으로 공개 d.ts를 해석한다. DOM은 core에서 추출한 Zod 선언의 `URL` 참조에 필요하다. 상태별 루트·문서 데이터와 Term/Knowledge 필드·IO 코드 타입을 좁히며 오류 문서의 data 접근과 Node/TS 내부 subpath 접근을 거부한다. 이 배포 소비 검증도 macOS arm64 / Node 24.21.0 / pnpm 10.34.5에서 수행했다. 전체 교차 검증은 `pnpm exec vitest run`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`로 별도 실행하며, 이 공개 소비 검사의 성공만으로 다른 OS·실제 저장·watcher·색인·잠금의 완료를 주장하지 않는다.
