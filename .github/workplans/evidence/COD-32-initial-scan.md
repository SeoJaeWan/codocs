# 최초 조회 중 변경 누락 — 현재 main 코드 검증

검증일: 2026-09-22. 기준 커밋: `b0d03a862424a14fca6a1f1a86034114d56cc717`.

## 결론

최초 문서 조회가 끝난 뒤 감시기를 만들기 때문에, 첫 조회 도중 발생한 변경이 초기 결과에서 빠지고 이후 자동 갱신도 일어나지 않는 구현 결함을 확인했다. 제품 코드의 호출 순서뿐 아니라 실제 파일과 공개 list/get/refresh API를 이용한 진단 시험으로 재현했다.

이 결함은 앞서 조사한 macOS 네이티브 감시 등록 지연과 구분된다. 이번에는 `CHOKIDAR_USEPOLLING=true`로 chokidar의 네이티브 이벤트 경로를 제외해도 재현했다. Windows에서 직접 실행한 결과는 아니다.

## 코드 근거

`packages/workspace/src/query/index.ts`:

- 494행: `await loadWorkspace(...)`로 전체 문서 읽기를 먼저 완료한다.
- 495–505행: 읽은 결과로 다음 색인과 원문 버전을 계산한다.
- 506–509행: 감시기가 없을 때 그제야 생성·시작하고 변경 알림을 구독한다.
- 510행: 구독 이후 알림을 받아야 `#dirty`가 true가 된다.
- 545–568행: `#dirty`가 true일 때만 다시 읽는다. 첫 읽기 때 감시가 없으면 이 경로가 실행되지 않는다.
- 582–584행: 이미 게시한 결과가 있으면 이후 조회는 그것을 재사용한다.

`packages/workspace/src/watcher/index.ts:102`는 `ignoreInitial: true`다. 뒤늦게 감시를 시작할 때 이미 존재하는 파일을 초기 추가 이벤트로 전달하지 않으므로, 감시기 자체의 초기 탐색이 오래된 색인을 자동으로 교정하지 않는다.

`.codocs/workspace/indexing/index-refresh.yaml:30`은 스캔 종료까지 감지한 변경을 재확인·반영하도록 요구하고, 46행은 초기 구성 중 변경을 시험하도록 요구한다. 문서에는 구체적 함수 호출 순서가 적혀 있지 않지만, 현재 최초 초기화 경로는 초기 구성 중 변경을 수집·반영하는 동작을 충족하지 못한다.

## 시험 방법과 결과

실제 readFile/readdir의 결과를 그대로 사용하되, 그 결과가 loader에 전달되는 경계에 시험용 hook을 두어 실제 디스크 변경 시점을 고정했다. 로더·파서·색인·조회 세션·감시기·refresh는 현재 main의 실제 구현을 사용했다. 감시기가 없다고 가장하거나 변경 이벤트를 버리는 mock은 사용하지 않았다. watcher.start와 loadWorkspace의 spy는 실제 호출을 통과시키며 횟수만 기록했다.

| 사례                         | 기대 결과           | 실제 결과           | 판정 |
| ---------------------------- | ------------------- | ------------------- | ---- |
| 변경 없는 첫 조회            | 저장한 본문 반환    | 저장한 본문 반환    | 통과 |
| 첫 파일 읽기 중 본문 수정    | 변경 후 본문 포함   | 변경 전 본문 반환   | 실패 |
| 첫 폴더 열거 중 새 문서 생성 | 문서 2개 반환       | 문서 1개 반환       | 실패 |
| 초기화 완료 뒤 본문 수정     | 변경 본문 자동 반영 | 변경 본문 자동 반영 | 통과 |

두 실패 사례의 변경 시점에서 watcher.start 호출 횟수는 모두 0이었다. 첫 조회 후 1초 대기와 재조회 뒤에도 loadWorkspace 호출은 1회뿐이며 결과는 그대로였다. 상태는 ready이고 응답의 success는 true, scanStatus는 complete였다. 수동 refresh를 호출하면 수정 본문 또는 새 문서가 정상 반영됐다.

새 진단 시험 4개 중 2개 통과·2개 실패(명세 기대값 기준), 종료 코드 1. 테스트 실행 시간 2.65초.

같은 polling 조건으로 실행한 기존 `packages/workspace/src/query/query.test.ts`의 39개는 모두 통과했다(3.41초). 기존 조회 테스트는 최초 읽기 경계에서 변경을 끼워 넣는 두 사례를 검증하지 않고 있어, 이번 누락을 잡지 못했다. 이 결과는 전체 기본 테스트 실행의 통과를 의미하지 않는다.

## 이력

git blame상 해당 초기화 순서는 `1cab1c5c2ac218aa4a0c2f54dcc1f1111c306223`에서 도입됐다.

- 날짜: 2026-09-18 14:17:39 +09:00.
- 제목: `feat(workspace): add watcher signals and shared query refresh`.
- PR #13 이전부터 존재한 코드다.

## 재현 절차와 보존 범위

이 PR은 계획과 이미 실행한 진단 근거를 보존한다. 제품 수정이나 정규 회귀 테스트 편입은 구현 단계에서 진행한다. 아래 진단 원문은 정규 테스트가 아니라 실패를 확인한 독립 실험 자료다.

기준 커밋을 별도 checkout하고 Node.js 24.21.0과 pnpm 10.34.5로 의존성을 설치한다. 저장소 루트에 `.workbench/initial-scan-review-20260922` 디렉터리를 만들고 다음 두 원문을 각각 명시된 이름으로 저장한다. 경로는 저장소 기준 상대 경로다.

```sh
pnpm exec vitest run --config .workbench/initial-scan-review-20260922/vitest.config.mts
CHOKIDAR_USEPOLLING=true pnpm test:run packages/workspace/src/query/query.test.ts
```

두 번째 명령의 환경 변수 표기는 POSIX 셸 기준이다. Windows PowerShell에서는 `$env:CHOKIDAR_USEPOLLING = 'true'`를 설정한 뒤 같은 pnpm 명령을 실행한다. Windows에서 직접 실행했다는 의미는 아니다.

첫 명령은 기준 구현에서 종료 코드 1과 두 실패를 기대한다. 함께 보관한 [JSON](COD-32-initial-scan.json)은 기존 실행의 원본 관측값이며, 재실행 결과는 `.workbench/initial-scan-review-20260922/evidence.json`에 저장된다. 1초 대기는 기존 구현이 이후에도 자동 갱신하지 않는지 관찰하기 위한 것으로, 수정의 성능 합격 기준이 아니다.

### vitest.config.mts

```ts
import base from '../../vitest.config.ts';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['.workbench/initial-scan-review-20260922/initial-scan.test.ts'],
    fileParallelism: false,
  },
});
```

### initial-scan.test.ts

```ts
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const hooks = vi.hoisted(() => ({
  afterRead: undefined as undefined | ((filename: unknown) => Promise<void>),
  afterReaddir: undefined as undefined | ((filename: unknown) => Promise<void>),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readFile: async (...args: any[]) => {
      const bytes = await (original.readFile as any)(...args);
      await hooks.afterRead?.(args[0]);
      return bytes;
    },
    readdir: async (...args: any[]) => {
      const entries = await (original.readdir as any)(...args);
      await hooks.afterReaddir?.(args[0]);
      return entries;
    },
  };
});
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import {
  createWorkspaceQuerySession,
  type WorkspaceQuerySession,
} from '../../packages/workspace/src/query/index.ts';
import { WorkspaceWatcher } from '../../packages/workspace/src/watcher/index.ts';
import * as loader from '../../packages/workspace/src/loader/index.ts';

const actualFs =
  await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const evidence: unknown[] = [];
let project: string;
let codocs: string;
let session: WorkspaceQuerySession | undefined;
let starts: ReturnType<typeof vi.spyOn>;
let loads: ReturnType<typeof vi.spyOn>;
const yaml = (id: string, definition: string) =>
  `id: ${id}\nname: ${id}\ndomains: [업무]\ndefinition: ${definition}\n`;
const definition = async () => {
  const result = await session!.get(['alpha']);
  if (!result.success) throw new Error(JSON.stringify(result));
  return result;
};

beforeEach(async () => {
  vi.stubEnv('CHOKIDAR_USEPOLLING', 'true');
  await mkdir(path.resolve('.workbench/fixtures'), { recursive: true });
  project = await mkdtemp(
    path.resolve('.workbench/fixtures/initial-scan-review-'),
  );
  codocs = path.join(project, '.codocs');
  await mkdir(codocs);
  await writeFile(path.join(codocs, 'alpha.yaml'), yaml('alpha', '변경 전'));
  starts = vi.spyOn(WorkspaceWatcher.prototype, 'start');
  loads = vi.spyOn(loader, 'loadWorkspace');
  session = createWorkspaceQuerySession({ cwd: project });
});
afterEach(async () => {
  hooks.afterRead = undefined;
  hooks.afterReaddir = undefined;
  await session?.close();
  session = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
});
afterAll(async () => {
  await actualFs.writeFile(
    path.resolve('.workbench/initial-scan-review-20260922/evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
});

describe('현재 main의 초기 조회와 감시 연결 계약 확인', () => {
  it('대조군: 변경 없는 최초 조회는 실제 파일 내용을 반환한다', async () => {
    const result = await definition();
    evidence.push({
      case: 'unchanged-initial-read',
      result,
      starts: starts.mock.calls.length,
      loads: loads.mock.calls.length,
    });
    expect(JSON.stringify(result)).toContain('변경 전');
    expect(starts).toHaveBeenCalledTimes(1);
  });

  it('명세: 최초 파일 읽기 도중 바뀐 내용까지 초기 결과에 반영한다', async () => {
    const target = path.join(codocs, 'alpha.yaml');
    let startsAtMutation = -1;
    hooks.afterRead = async (filename) => {
      if (String(filename) !== target) return;
      hooks.afterRead = undefined;
      startsAtMutation = starts.mock.calls.length;
      await writeFile(target, yaml('alpha', '변경 후'));
    };
    const initial = await definition();
    const loadsAfterInitial = loads.mock.calls.length;
    await delay(1000);
    const afterWait = await definition();
    const disk = await actualFs.readFile(target, 'utf8');
    const beforeRefresh = {
      loads: loads.mock.calls.length,
      readiness: session!.readiness,
    };
    await session!.refresh();
    const afterRefresh = await definition();
    evidence.push({
      case: 'edit-during-first-read',
      startsAtMutation,
      loadsAfterInitial,
      initial,
      afterWait,
      disk,
      beforeRefresh,
      afterRefresh,
    });
    expect(disk).toContain('변경 후');
    expect(JSON.stringify(afterRefresh)).toContain('변경 후');
    expect(JSON.stringify(initial)).toContain('변경 후');
  });

  it('명세: 최초 디렉터리 조회 도중 생성된 문서까지 초기 목록에 반영한다', async () => {
    let startsAtMutation = -1;
    hooks.afterReaddir = async (filename) => {
      if (String(filename) !== codocs) return;
      hooks.afterReaddir = undefined;
      startsAtMutation = starts.mock.calls.length;
      await writeFile(path.join(codocs, 'beta.yaml'), yaml('beta', '새 문서'));
    };
    const initial = await session!.list();
    await delay(1000);
    const afterWait = await session!.list();
    const disk = await actualFs.readdir(codocs);
    const beforeRefresh = {
      loads: loads.mock.calls.length,
      readiness: session!.readiness,
    };
    await session!.refresh();
    const afterRefresh = await session!.list();
    evidence.push({
      case: 'create-during-first-directory-read',
      startsAtMutation,
      initial,
      afterWait,
      disk,
      beforeRefresh,
      afterRefresh,
    });
    expect(disk).toContain('beta.yaml');
    expect(afterRefresh).toMatchObject({ success: true, totalCount: 2 });
    expect(initial).toMatchObject({ success: true, totalCount: 2 });
  });

  it('대조군: 최초 조회가 끝난 뒤의 변경은 기존 감시로 반영한다', async () => {
    await definition();
    await writeFile(
      path.join(codocs, 'alpha.yaml'),
      yaml('alpha', '감시 후 변경'),
    );
    await vi.waitFor(
      async () => {
        expect(JSON.stringify(await definition())).toContain('감시 후 변경');
      },
      { timeout: 5000, interval: 25 },
    );
    evidence.push({
      case: 'edit-after-initialization',
      result: await definition(),
      starts: starts.mock.calls.length,
      loads: loads.mock.calls.length,
    });
  });
});
```
