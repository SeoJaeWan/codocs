import {
  catalogDiagnosticCodes,
  catalogFailureKinds,
  resolveReference,
  scanStatuses,
  type Document,
} from '@codocs/core';
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
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
  buildWorkspaceCatalog,
  loadWorkspace,
  toCatalogScan,
  workspaceDiagnosticCodes,
  workspaceDiagnosticMessages,
  type WorkspaceScanResult,
} from '../index.js';
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
/** 문서 fixture의 확인 가능한 속성이다. */
function term(
  name: string,
  definition = '정의',
  id = name,
  domain = '업무',
): string {
  return `id: ${id}\nname: ${name}\ndefinition: '${definition}'\ndomains: [${domain}]\n`;
}
/** 실제 루트에서 새 관측을 읽는다. */
async function scan(): Promise<
  Extract<WorkspaceScanResult, { status: 'complete' | 'partial' }>
> {
  const result = await loadWorkspace({ cwd: project });
  if (result.status === scanStatuses.failed)
    throw new Error('실제 fixture 스캔 실패');
  return result;
}

describe('workspace 스캔의 core 색인 연결', /** 실제 IO와 중립 관측의 계약을 구분한다. */ () => {
  it('검증 성공과 스키마 오류는 미검증 parsed를 보존하고 파싱 실패에는 추측 모델이 없다', /** 상태별 공개 데이터와 원문 위치를 확인한다. */ async () => {
    await file('valid.yaml', term('정상', '정의', 'valid'));
    const raw =
      "name: 오류\r\ndomains: [업무]\r\ndefinition: '[[정상]]'\r\nexamples: ['[[정상]]', 42, '[[정상]]']\r\n";
    await file('invalid.yaml', raw);
    await file('parse.yaml', 'name: [\n');
    const result = await scan();
    const valid = result.documents.find(
      (d) => d.status === workspaceDocumentStatuses.valid,
    );
    const invalid = result.documents.find(
      (d) => d.status === workspaceDocumentStatuses.validationError,
    );
    const failed = result.documents.find(
      (d) => d.status === workspaceDocumentStatuses.parseError,
    );
    if (
      !valid ||
      valid.status !== workspaceDocumentStatuses.valid ||
      !invalid ||
      invalid.status !== workspaceDocumentStatuses.validationError ||
      !failed ||
      failed.status !== workspaceDocumentStatuses.parseError
    )
      throw new Error('상태별 fixture 없음');
    expectTypeOf(valid.data).toEqualTypeOf<Document>();
    expectTypeOf(invalid.parsed.data).toEqualTypeOf<Record<string, unknown>>();
    expect(valid.parsed.success).toBe(true);
    expectTypeOf(failed.diagnostics).toMatchTypeOf<
      readonly import('@codocs/core').YamlDiagnostic[]
    >();
    expect(invalid.parsed.source).toBe(raw);
    expect(invalid.parsed.data.examples).toEqual(['[[정상]]', 42, '[[정상]]']);
    expect(invalid).not.toHaveProperty('data');
    expect(failed).not.toHaveProperty('data');
    expect(failed).not.toHaveProperty('parsed');
    const input = toCatalogScan(result);
    expect(
      input.observations.find((d) => d.path === invalid.source.path)?.parsed,
    ).toBe(invalid.parsed);
    expect(
      input.observations.find((d) => d.path === failed.source.path)?.parsed,
    ).toEqual({
      success: false,
      source: failed.raw,
      diagnostics: failed.diagnostics,
    });
    const catalog = buildWorkspaceCatalog(result);
    const document = catalog.documents.get(invalid.source.path);
    expect(document?.name).toBe('오류');
    expect(document?.id).toBeUndefined();
    expect(document?.occurrences).toHaveLength(3);
    expect(document?.references.map((d) => d.path)).toEqual([
      valid.source.path,
    ]);
    expect(
      document?.occurrences.map((d) =>
        raw.slice(d.occurrence.offsetRange.start, d.occurrence.offsetRange.end),
      ),
    ).toEqual(['[[정상]]', '[[정상]]', '[[정상]]']);
    expect(catalog.documents.get(failed.source.path)?.occurrences).toEqual([]);
  });
  it('잘못된 본문 자료형과 사용자 필드는 제외하고 정상 examples 원소만 추출한다', /** 타입을 추측하거나 문자열로 변환하지 않는다. */ async () => {
    await file(
      'a.yaml',
      'name: A\ndomains: [업무]\ndefinition: ["[[B]]"]\nexamples: [5, "[[B]]", { text: "[[B]]" }]\n',
    );
    await file('b.yaml', term('B'));
    await file('unknown.yaml', 'name: 추측\ncustom: "[[B]]"\n');
    await file(
      'knowledge.yaml',
      'name: 지식\ndomains: [업무]\ndefinition: ["[[B]]"]\n',
    );
    const catalog = buildWorkspaceCatalog(await scan());
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
    await file('source.yaml', term('출발', '[[대상]]'));
    await file(
      'target.yaml',
      'name: 대상\ndomains: [업무, 공통]\ndefinition: 본문\n',
    );
    const catalog = buildWorkspaceCatalog(await scan());
    const resolution = resolveReference(catalog, { name: '대상' });
    expect(resolution.status).toBe('resolved');
    expect(resolution.candidates).toHaveLength(1);
    expect(resolution.target?.errors.length).toBeGreaterThan(0);
    expect(
      catalog.documents
        .get(discovered('target.yaml'))
        ?.referencedBy.map((d) => d.path),
    ).toEqual([discovered('source.yaml')]);
    expect(
      resolveReference(catalog, { name: '대상', domain: '공통' }).target?.path,
    ).toBe(discovered('target.yaml'));
  });
  it('실제 hardlink의 ID가 같아도 발견 경로별 문서와 충돌 진단을 유지한다', /** 파일 ID와 실경로를 병합 키로 사용하지 않는다. */ async () => {
    const target = await file('first.yaml', term('공유', '정의', 'same'));
    await link(target, path.join(project, discovered('second.yml')));
    const result = await scan();
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
    await file('a.yaml', term('A', '[[B]] [[A]] [[중복]] [[B]]'));
    await file('b.yaml', term('B', '[[A]]'));
    await file('c.yaml', term('중복', '정의', 'c', '업무'));
    await file('d.yaml', term('중복', '정의', 'd', '공통'));
    const catalog = buildWorkspaceCatalog(await scan());
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
    const catalog = buildWorkspaceCatalog(await scan());
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
  it('실제 파일 변경·이동·삭제와 충돌 해소 후 이전 연결과 진단을 재계산한다', /** complete 관측으로 오래된 키와 연결을 교체한다. */ async () => {
    const source = await file('source.yaml', term('출발', '[[대상]]'));
    const target = await file('target.yaml', term('대상', '정의', 'shared'));
    const duplicate = await file(
      'duplicate.yaml',
      term('대상', '정의', 'shared'),
    );
    const first = buildWorkspaceCatalog(await scan());
    expect(
      first.documents.get(discovered('source.yaml'))?.occurrences[0]?.resolution
        .status,
    ).toBe('ambiguous');
    await rm(duplicate);
    await rename(target, path.join(project, discovered('moved.yaml')));
    const second = buildWorkspaceCatalog(await scan(), first);
    expect(second.documents.has(discovered('target.yaml'))).toBe(false);
    expect(
      second.documents
        .get(discovered('source.yaml'))
        ?.references.map((d) => d.path),
    ).toEqual([discovered('moved.yaml')]);
    expect(second.documents.get(discovered('moved.yaml'))?.diagnostics).toEqual(
      [],
    );
    await file('moved.yaml', term('새이름', '정의', 'new-id', '공통'));
    await file('source.yaml', term('출발', '[[공통:새이름]]'));
    const third = buildWorkspaceCatalog(await scan(), second);
    expect(third.idPaths.has('shared')).toBe(false);
    expect(
      third.documents.get(discovered('source.yaml'))?.references[0]?.name,
    ).toBe('새이름');
    await rm(path.join(project, discovered('moved.yaml')));
    const fourth = buildWorkspaceCatalog(await scan(), third);
    expect(
      fourth.documents.get(discovered('source.yaml'))?.occurrences[0]
        ?.resolution.status,
    ).toBe('missing');
    expect(await readFile(source, 'utf8')).toBe(
      term('출발', '[[공통:새이름]]'),
    );
  });
  it('순수 partial·failed 입력은 실패 범위와 IO 진단을 전달하고 복구까지 이전 자료를 미확인으로 보존한다', /** 순수 상태 전달 검증이며 OS 실패 시험이 아니다. */ async () => {
    await file('a.yaml', term('A', '[[B]]'));
    await file('b.yaml', term('B'));
    const initial = await scan();
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
        { kind: workspaceTargetKinds.directory, path: '.codocs', diagnostics },
        {
          kind: workspaceTargetKinds.file,
          path: discovered('b.yaml'),
          diagnostics,
        },
        { kind: catalogFailureKinds.unknown, diagnostics },
      ],
    };
    expect(toCatalogScan(partial).failures).toEqual([
      { kind: 'folder', path: '.codocs', diagnostics },
      { kind: 'file', path: discovered('b.yaml'), diagnostics },
      { kind: 'unknown', diagnostics },
    ]);
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
    expect(resolveReference(updated, { name: '신규 미탐색' }).status).toBe(
      'unconfirmed',
    );
    const failed = buildWorkspaceCatalog(
      { ...partial, status: scanStatuses.failed, documents: initial.documents },
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
    const recovered = buildWorkspaceCatalog(await scan(), failed);
    expect(recovered.status).toBe('complete');
    expect(
      recovered.documents
        .get(discovered('a.yaml'))
        ?.references.map((d) => d.path),
    ).toEqual([discovered('b.yaml')]);
  });
  it('확인한 실패 상대 경로가 없으면 절대 논리 경로를 폴더 삭제 범위로 추측하지 않는다', /** 확인되지 않은 범위는 unknown으로 전달한다. */ async () => {
    const result = await scan();
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
