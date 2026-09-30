import {
  catalogDiagnosticCodes,
  catalogFailureKinds,
  scanStatuses,
  type Document,
} from '@codocs/core';
import { link, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from 'vitest';
import {
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
} from '../diagnostics/index.js';
import { buildWorkspaceCatalog, toCatalogScan } from './index.js';
import { loadWorkspace, type WorkspaceScanResult } from '../loader/index.js';
import { workspaceDocumentStatuses } from '../loader/domain-values.js';
import { workspaceTargetKinds } from '../paths/domain-values.js';

let project: string;
beforeEach(
  /** 실제 원문을 task-local 고유 프로젝트에 준비한다. */ async () => {
    const fixtureParent = path.resolve('.workbench/fixtures');
    await mkdir(fixtureParent, { recursive: true });
    project = await mkdtemp(path.join(fixtureParent, 'indexing-'));
    await mkdir(path.join(project, '.codocs'));
  },
);
afterEach(
  /** 이 테스트의 검증된 fixture만 정리한다. */ async () => {
    await rm(project, { recursive: true, force: true });
  },
);
/** 발견 경로 표기를 임의로 보정하지 않는다. */
function discovered(name: string): string {
  return path.join('.codocs', name);
}
/** 실제 YAML 원문을 쓰고 절대 파일 경로를 반환한다. */
async function file(name: string, raw: string): Promise<string> {
  const target = path.join(project, discovered(name));
  await writeFile(target, raw);
  return target;
}
/** 실제 루트에서 새 관측을 읽는다. */
async function loadSuccessfulWorkspaceScan(): Promise<
  Extract<WorkspaceScanResult, { status: 'complete' | 'partial' }>
> {
  const result = await loadWorkspace({ cwd: project });
  if (result.status === scanStatuses.failed)
    throw new Error('실제 fixture 스캔 실패');
  return result;
}

describe('workspace 스캔의 core 색인 연결', /** 실제 IO와 중립 관측의 계약을 구분한다. */ () => {
  describe('스캔 문서의 Catalog 관측 변환', () => {
    it('검증된 문서를 변환하면 파싱 결과를 같은 관측으로 전달한다', async () => {
      await file(
        'valid.yaml',
        "id: valid\nname: 정상\ndefinition: '정의'\ndomains: [업무]\n",
      );
      const scan = await loadSuccessfulWorkspaceScan();
      const source = scan.documents[0];
      if (!source || source.status !== workspaceDocumentStatuses.valid)
        throw new Error('검증된 문서가 없습니다.');
      expectTypeOf(source.data).toEqualTypeOf<Document>();

      const result = toCatalogScan(scan);

      expect(result.observations[0]?.parsed).toBe(source.parsed);
      expect(result.observations[0]?.path).toBe(source.source.path);
    });

    /** @codocs [[작업 공간:작업 공간 색인 구성]]#L12 */
    it('필수 ID가 빠진 문서를 변환하면 확인된 파싱 데이터와 원문을 보존한다', async () => {
      const raw = "name: 오류\r\ndomains: [업무]\r\ndefinition: '[[정상]]'\r\n";
      await file('invalid.yaml', raw);
      const scan = await loadSuccessfulWorkspaceScan();
      const source = scan.documents[0];
      if (
        !source ||
        source.status !== workspaceDocumentStatuses.validationError
      )
        throw new Error('검증 오류 문서가 없습니다.');
      expectTypeOf(source.parsed.data).toEqualTypeOf<Record<string, unknown>>();

      const result = toCatalogScan(scan);

      expect(source.parsed.source).toBe(raw);
      expect(result.observations[0]?.parsed).toBe(source.parsed);
    });

    it('파싱에 실패한 문서를 변환하면 원문과 진단만 가진 관측을 반환한다', async () => {
      const raw = 'name: [\n';
      await file('parse.yaml', raw);
      const scan = await loadSuccessfulWorkspaceScan();
      const source = scan.documents[0];
      if (!source || source.status !== workspaceDocumentStatuses.parseError)
        throw new Error('파싱 오류 문서가 없습니다.');

      const result = toCatalogScan(scan);

      expect(result.observations[0]?.parsed).toEqual({
        success: false,
        source: raw,
        diagnostics: source.diagnostics,
      });
    });
  });

  describe('관측을 문서 참조로 색인', () => {
    it('문서 하나를 색인하면 발견 경로와 이름을 가진 문서를 반환한다', async () => {
      const raw =
        "id: valid\nname: 정상\ndefinition: '정의'\ndomains: [업무]\n";
      await file('valid.yaml', raw);
      const scan = await loadSuccessfulWorkspaceScan();

      const catalog = buildWorkspaceCatalog(scan);

      expect(catalog.documents.get(discovered('valid.yaml'))).toMatchObject({
        path: discovered('valid.yaml'),
        id: 'valid',
        name: '정상',
      });
    });

    it('ID가 없는 문서가 다른 문서를 참조하면 이름과 참조 위치를 연결한다', async () => {
      await file(
        'valid.yaml',
        "id: valid\nname: 정상\ndefinition: '정의'\ndomains: [업무]\n",
      );
      const raw =
        "name: 오류\r\ndomains: [업무]\r\ndefinition: '[[정상]]'\r\nexamples: ['[[정상]]', 42, '[[정상]]']\r\n";
      await file('invalid.yaml', raw);
      const scan = await loadSuccessfulWorkspaceScan();

      const catalog = buildWorkspaceCatalog(scan);
      const document = catalog.documents.get(discovered('invalid.yaml'));

      expect(document?.name).toBe('오류');
      expect(document?.id).toBeUndefined();
      expect(document?.occurrences).toHaveLength(3);
      expect(document?.references.map((item) => item.path)).toEqual([
        discovered('valid.yaml'),
      ]);
      expect(
        document?.occurrences.map((item) =>
          raw.slice(
            item.occurrence.offsetRange.start,
            item.occurrence.offsetRange.end,
          ),
        ),
      ).toEqual(['[[정상]]', '[[정상]]', '[[정상]]']);
    });

    it('파싱에 실패한 문서를 색인하면 참조 위치를 만들지 않는다', async () => {
      await file('parse.yaml', 'name: [\n');
      const scan = await loadSuccessfulWorkspaceScan();

      const catalog = buildWorkspaceCatalog(scan);

      expect(
        catalog.documents.get(discovered('parse.yaml'))?.occurrences,
      ).toEqual([]);
    });
  });
  it('잘못된 본문 자료형과 사용자 필드는 제외하고 정상 examples 원소만 추출한다', /** 타입을 추측하거나 문자열로 변환하지 않는다. */ async () => {
    await file(
      'a.yaml',
      'name: A\ndomains: [업무]\ndefinition: ["[[B]]"]\nexamples: [5, "[[B]]", { text: "[[B]]" }]\n',
    );
    await file(
      'b.yaml',
      "id: B\nname: B\ndefinition: '정의'\ndomains: [업무]\n",
    );
    await file('unknown.yaml', 'name: 추측\ncustom: "[[B]]"\n');
    await file(
      'knowledge.yaml',
      'name: 지식\ndomains: [업무]\ndefinition: ["[[B]]"]\n',
    );
    const catalog = buildWorkspaceCatalog(await loadSuccessfulWorkspaceScan());
    expect(
      catalog.documents.get(discovered('a.yaml'))?.occurrences,
    ).toHaveLength(1);
    expect(
      catalog.documents.get(discovered('unknown.yaml'))?.occurrences,
    ).toEqual([]);
    expect(
      catalog.documents.get(discovered('knowledge.yaml'))?.occurrences,
    ).toEqual([]);
  });
  it('스키마 오류 대상도 확인한 이름과 경로로 직접 연결하고 대상 오류를 반환한다', /** 다중 도메인 대상의 경로는 후보 하나다. */ async () => {
    await file(
      'source.yaml',
      "id: 출발\nname: 출발\ndefinition: '[[대상]]'\ndomains: [업무]\n",
    );
    await file(
      'target.yaml',
      'name: 대상\ndomains: [업무, 공통]\ndefinition: 본문\n',
    );
    const catalog = buildWorkspaceCatalog(await loadSuccessfulWorkspaceScan());
    const resolution = catalog.documents.get(discovered('source.yaml'))
      ?.occurrences[0]?.resolution;
    expect(resolution?.status).toBe('resolved');
    expect(resolution?.candidates).toHaveLength(1);
    expect(resolution?.target?.errors.length).toBeGreaterThan(0);
    expect(
      catalog.documents
        .get(discovered('target.yaml'))
        ?.referencedBy.map((d) => d.path),
    ).toEqual([discovered('source.yaml')]);
  });
  it('실제 hardlink의 ID가 같아도 발견 경로별 문서와 충돌 진단을 유지한다', /** 파일 ID와 실경로를 병합 키로 사용하지 않는다. */ async () => {
    const target = await file(
      'first.yaml',
      "id: same\nname: 공유\ndefinition: '정의'\ndomains: [업무]\n",
    );
    await link(target, path.join(project, discovered('second.yml')));
    const result = await loadSuccessfulWorkspaceScan();
    const catalog = buildWorkspaceCatalog(result);
    expect(result.documents).toHaveLength(2);
    expect(catalog.documents.size).toBe(2);
    expect([...catalog.idPaths.get('same')!].sort()).toEqual([
      discovered('first.yaml'),
      discovered('second.yml'),
    ]);
    for (const doc of catalog.documents.values())
      expect(
        doc.diagnostics.some(
          (d) => d.code === catalogDiagnosticCodes.duplicateId,
        ),
      ).toBe(true);
    const aliased = {
      ...result,
      documents: result.documents.map((d) => ({
        ...d,
        source: { ...d.source, realPath: target },
      })),
    };
    expect(buildWorkspaceCatalog(aliased).documents.size).toBe(2);
  });
  it('모호한 후보에는 역참조가 없고 같은 발견 문서의 자기 참조는 제외하며 순환은 유지한다', /** 확정 직접 연결과 모든 등장 기록을 구분한다. */ async () => {
    await file(
      'a.yaml',
      "id: A\nname: A\ndefinition: '[[B]] [[A]] [[중복]] [[B]]'\ndomains: [업무]\n",
    );
    await file(
      'b.yaml',
      "id: B\nname: B\ndefinition: '[[A]]'\ndomains: [업무]\n",
    );
    await file(
      'c.yaml',
      "id: c\nname: 중복\ndefinition: '정의'\ndomains: [업무]\n",
    );
    await file(
      'd.yaml',
      "id: d\nname: 중복\ndefinition: '정의'\ndomains: [공통]\n",
    );
    const catalog = buildWorkspaceCatalog(await loadSuccessfulWorkspaceScan());
    expect(
      catalog.documents
        .get(discovered('a.yaml'))
        ?.occurrences.map((d) => d.resolution.status),
    ).toEqual(['resolved', 'self', 'ambiguous', 'resolved']);
    expect(
      catalog.documents
        .get(discovered('a.yaml'))
        ?.references.map((d) => d.path),
    ).toEqual([discovered('b.yaml')]);
    expect(
      catalog.documents
        .get(discovered('b.yaml'))
        ?.references.map((d) => d.path),
    ).toEqual([discovered('a.yaml')]);
    expect(catalog.documents.get(discovered('c.yaml'))?.referencedBy).toEqual(
      [],
    );
    expect(catalog.documents.get(discovered('d.yaml'))?.referencedBy).toEqual(
      [],
    );
  });
  it('다중 도메인 문서가 다른 소속 도메인으로 자신을 참조해도 직접 연결을 만들지 않는다', /** 자기 참조 여부는 도메인이 아니라 발견 경로로 판정한다. */ async () => {
    await file(
      'self.yaml',
      'id: self\nname: 자신\ndomains: [업무, 공통]\ndefinition: "[[공통:자신]]"\n',
    );
    const catalog = buildWorkspaceCatalog(await loadSuccessfulWorkspaceScan());
    const document = catalog.documents.get(discovered('self.yaml'));
    expect(document?.occurrences[0]?.resolution.status).toBe('self');
    expect(
      document?.diagnostics.some(
        (d) => d.code === catalogDiagnosticCodes.selfReference,
      ),
    ).toBe(true);
    expect(document?.references).toEqual([]);
    expect(document?.referencedBy).toEqual([]);
  });
  describe('파일 변화 후 Catalog 연결 재계산', () => {
    it('이름 충돌 문서를 지우고 대상을 이동하면 이동한 경로로 참조를 연결한다', async () => {
      await file(
        'source.yaml',
        "id: 출발\nname: 출발\ndefinition: '[[대상]]'\ndomains: [업무]\n",
      );
      const target = await file(
        'target.yaml',
        "id: shared\nname: 대상\ndefinition: '정의'\ndomains: [업무]\n",
      );
      const duplicate = await file(
        'duplicate.yaml',
        "id: shared\nname: 대상\ndefinition: '정의'\ndomains: [업무]\n",
      );
      const first = buildWorkspaceCatalog(await loadSuccessfulWorkspaceScan());
      expect(
        first.documents.get(discovered('source.yaml'))?.occurrences[0]
          ?.resolution.status,
      ).toBe('ambiguous');
      await rm(duplicate);
      await rename(target, path.join(project, discovered('moved.yaml')));

      const result = buildWorkspaceCatalog(
        await loadSuccessfulWorkspaceScan(),
        first,
      );

      expect(result.documents.has(discovered('target.yaml'))).toBe(false);
      expect(
        result.documents
          .get(discovered('source.yaml'))
          ?.references.map((item) => item.path),
      ).toEqual([discovered('moved.yaml')]);
      expect(
        result.documents.get(discovered('moved.yaml'))?.diagnostics,
      ).toEqual([]);
    });

    it('대상 이름과 ID를 수정하면 이전 ID를 버리고 수정된 이름으로 연결한다', async () => {
      await file(
        'source.yaml',
        "id: 출발\nname: 출발\ndefinition: '[[대상]]'\ndomains: [업무]\n",
      );
      await file(
        'target.yaml',
        "id: shared\nname: 대상\ndefinition: '정의'\ndomains: [업무]\n",
      );
      const first = buildWorkspaceCatalog(await loadSuccessfulWorkspaceScan());
      await file(
        'target.yaml',
        "id: new-id\nname: 새이름\ndefinition: '정의'\ndomains: [공통]\n",
      );
      await file(
        'source.yaml',
        "id: 출발\nname: 출발\ndefinition: '[[공통:새이름]]'\ndomains: [업무]\n",
      );

      const result = buildWorkspaceCatalog(
        await loadSuccessfulWorkspaceScan(),
        first,
      );

      expect(result.idPaths.has('shared')).toBe(false);
      expect(
        result.documents.get(discovered('source.yaml'))?.references[0]?.name,
      ).toBe('새이름');
    });

    it('참조 대상을 삭제하면 이전 연결을 제거하고 대상 없음으로 판정한다', async () => {
      await file(
        'source.yaml',
        "id: 출발\nname: 출발\ndefinition: '[[대상]]'\ndomains: [업무]\n",
      );
      const target = await file(
        'target.yaml',
        "id: target\nname: 대상\ndefinition: '정의'\ndomains: [업무]\n",
      );
      const first = buildWorkspaceCatalog(await loadSuccessfulWorkspaceScan());
      await rm(target);

      const result = buildWorkspaceCatalog(
        await loadSuccessfulWorkspaceScan(),
        first,
      );

      expect(
        result.documents.get(discovered('source.yaml'))?.occurrences[0]
          ?.resolution.status,
      ).toBe('missing');
      expect(
        result.documents.get(discovered('source.yaml'))?.references,
      ).toEqual([]);
    });
  });

  describe('부분·실패 스캔의 관측과 이전 색인 보존', () => {
    it('부분 스캔의 폴더·파일·미확인 실패를 변환하면 확인한 범위와 진단을 유지한다', async () => {
      const initial = await loadSuccessfulWorkspaceScan();
      const diagnostics = [
        {
          code: workspaceDiagnosticCodes.readFailed,
          severity: 'error' as const,
          message: workspaceDiagnosticMessages.readFailed,
          ioCode: 'EACCES',
        },
      ];
      const input: WorkspaceScanResult = {
        ...initial,
        status: scanStatuses.partial,
        failures: [
          {
            kind: workspaceTargetKinds.directory,
            path: '.codocs',
            diagnostics,
          },
          {
            kind: workspaceTargetKinds.file,
            path: discovered('b.yaml'),
            diagnostics,
          },
          { kind: catalogFailureKinds.unknown, diagnostics },
        ],
      };

      const result = toCatalogScan(input);

      expect(result.failures).toEqual([
        { kind: 'folder', path: '.codocs', diagnostics },
        { kind: 'file', path: discovered('b.yaml'), diagnostics },
        { kind: 'unknown', diagnostics },
      ]);
    });

    /** @codocs [[작업 공간:불완전한 탐색에서 색인과 연결을 유지하는 절차]]#L12-L18 @codocs [[작업 공간:미확인 문서]]#L6-L8 */
    it('부분·실패 스캔 뒤 복구하면 이전 자료를 미확인으로 보존한 뒤 연결을 다시 확인한다', async () => {
      await file(
        'a.yaml',
        "id: A\nname: A\ndefinition: '[[B]]'\ndomains: [업무]\n",
      );
      await file(
        'b.yaml',
        "id: B\nname: B\ndefinition: '정의'\ndomains: [업무]\n",
      );
      const initial = await loadSuccessfulWorkspaceScan();
      const previous = buildWorkspaceCatalog(initial);
      const diagnostics = [
        {
          code: workspaceDiagnosticCodes.readFailed,
          severity: 'error' as const,
          message: workspaceDiagnosticMessages.readFailed,
          ioCode: 'EACCES',
        },
      ];
      const partial: WorkspaceScanResult = {
        ...initial,
        status: scanStatuses.partial,
        documents: initial.documents.filter(
          (d) => d.source.path === discovered('a.yaml'),
        ),
        failures: [
          {
            kind: workspaceTargetKinds.directory,
            path: '.codocs',
            diagnostics,
          },
          {
            kind: workspaceTargetKinds.file,
            path: discovered('b.yaml'),
            diagnostics,
          },
          { kind: catalogFailureKinds.unknown, diagnostics },
        ],
      };
      const updated = buildWorkspaceCatalog(partial, previous);
      expect(updated.documents.get(discovered('b.yaml'))?.confirmation).toBe(
        'unconfirmed',
      );
      expect(
        updated.documents.get(discovered('a.yaml'))?.occurrences[0]?.resolution
          .status,
      ).toBe('unconfirmed');
      expect(updated.documents.get(discovered('b.yaml'))?.referencedBy).toEqual(
        [],
      );
      const failed = buildWorkspaceCatalog(
        {
          ...partial,
          status: scanStatuses.failed,
          documents: initial.documents,
        },
        updated,
      );
      expect(failed.status).toBe('failed');
      expect(failed.documents.size).toBe(2);
      expect(failed.documents.get(discovered('b.yaml'))?.observation).toBe(
        updated.documents.get(discovered('b.yaml'))?.observation,
      );
      expect(failed.documents.get(discovered('b.yaml'))?.confirmation).toBe(
        'unconfirmed',
      );
      expect(failed.failures[0]?.diagnostics).toBe(diagnostics);
      const recovered = buildWorkspaceCatalog(
        await loadSuccessfulWorkspaceScan(),
        failed,
      );
      expect(recovered.status).toBe('complete');
      expect(
        recovered.documents
          .get(discovered('a.yaml'))
          ?.references.map((d) => d.path),
      ).toEqual([discovered('b.yaml')]);
    });
    it('확인한 실패 상대 경로가 없으면 절대 논리 경로를 폴더 삭제 범위로 추측하지 않는다', /** 확인되지 않은 범위는 unknown으로 전달한다. */ async () => {
      const result = await loadSuccessfulWorkspaceScan();
      const input: WorkspaceScanResult = {
        ...result,
        status: scanStatuses.failed,
        failures: [
          {
            kind: workspaceTargetKinds.directory,
            logicalPath: project,
            diagnostics: [],
          },
        ],
      };
      expect(toCatalogScan(input).failures).toEqual([
        { kind: 'unknown', diagnostics: [] },
      ]);
    });
  });
});
