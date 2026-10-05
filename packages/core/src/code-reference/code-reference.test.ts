import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogDocument } from '../catalog/index.js';
import {
  catalogConfirmations,
  scanStatuses,
} from '../catalog/domain-values.js';
import {
  extractCodeReferences,
  resolveCodeReference,
  codeReferenceDestinationKinds,
  codeReferenceStatuses,
  codeReferenceSyntaxes,
} from './index.js';

const source = '_codocs:\n  id: target\n  name: 대상\ndefinition: 본문\n';
const target: CatalogDocument = {
  path: '.codocs/target.yaml',
  id: 'target',
  name: '대상',
  confirmation: catalogConfirmations.confirmed,
  observation: {
    path: '.codocs/target.yaml',
    parsed: {
      success: true,
      source,
      data: { _codocs: { id: 'target', name: '대상' }, definition: '본문' },
      fields: [],
      strings: [],
      diagnostics: [],
    },
  },
  documentDiagnostics: [],
  diagnostics: [],
  occurrences: [],
  references: [],
  referencedBy: [],
  sectionReferencedBy: [],
};
const catalog: Catalog = {
  status: scanStatuses.complete,
  failures: [],
  documents: new Map([[target.path, target]]),
  idPaths: new Map([['target', new Set([target.path])]]),
  namePaths: new Map([['대상', new Set([target.path])]]),
};

describe('extractCodeReferences: 일반 텍스트의 명시 참조', () => {
  it.each([
    ['주석', '// @codocs [[대상]]'],
    ['문자열', '"@codocs [[대상]]"'],
    ['일반 본문', '메모 @codocs [[대상]]'],
    ['예제', '`@codocs [[대상]]`'],
  ])('%s에 표기가 있으면 전체 이름 참조를 추출한다', (_kind, text) => {
    expect(extractCodeReferences(text)).toEqual([
      expect.objectContaining({
        text: '@codocs [[대상]]',
        name: '대상',
        syntax: codeReferenceSyntaxes.valid,
        destination: { kind: codeReferenceDestinationKinds.document },
      }),
    ]);
  });
  it('섹션과 escaped 콜론이 있으면 이름과 섹션으로 나눈다', () => {
    const markers = extractCodeReferences('@codocs [[이름\\:설명:업무]]#L2-L4');
    expect(markers[0]).toMatchObject({
      name: '이름:설명',
      section: '업무',
      destination: {
        kind: codeReferenceDestinationKinds.rows,
        startLine: 2,
        endLine: 4,
      },
    });
  });
  it.each(['\n', '\r\n'])(
    'Unicode와 %j 및 같은 행 복수 표기가 있으면 UTF-16 위치를 유지한다',
    (newline) => {
      const text =
        '🙂 @codocs [[대상]]' +
        newline +
        '@codocs [[대상]]#L2 @codocs [[대상]]#L3-L4';
      const markers = extractCodeReferences(text);
      expect(markers.map((item) => item.offsetRange)).toEqual([
        { start: 3, end: 17 },
        { start: 17 + newline.length, end: 34 + newline.length },
        { start: 35 + newline.length, end: 55 + newline.length },
      ]);
      expect(markers.map((item) => item.range)).toEqual([
        { start: { line: 0, character: 3 }, end: { line: 0, character: 17 } },
        { start: { line: 1, character: 0 }, end: { line: 1, character: 17 } },
        { start: { line: 1, character: 18 }, end: { line: 1, character: 38 } },
      ]);
    },
  );
  it.each([
    '#L0',
    '#L-1',
    '#L2-Lx',
    '#L2-3',
    '#L1.5',
    '#L9007199254740992',
    '#broken',
  ])('즉시 접미사 %s가 무효이면 전체 span을 보존한다', (suffix) => {
    const text = '@codocs [[대상]]' + suffix;
    expect(extractCodeReferences(text)[0]).toMatchObject({
      text,
      offsetRange: { start: 0, end: text.length },
      rowError: codeReferenceStatuses.invalidRows,
    });
  });
  it('범위가 역전되면 전체 표기와 별도 범위 오류를 보존한다', () => {
    expect(extractCodeReferences('@codocs [[대상]]#L4-L2')[0]).toMatchObject({
      text: '@codocs [[대상]]#L4-L2',
      rowError: codeReferenceStatuses.reversedRows,
    });
  });
  it.each([
    '@codocs [[]]',
    '@codocs [[업무:]]',
    '@codocs [[a:b:c]]',
    '@codocs [[대상',
  ])('이름 문법 %s가 무효이면 전체 span을 보존한다', (text) => {
    expect(extractCodeReferences(text)[0]).toMatchObject({
      text,
      syntax: codeReferenceSyntaxes.invalid,
      offsetRange: { start: 0, end: text.length },
    });
  });
  it('행 suffix 앞에 공백이 있으면 문서 전체 표기로 유지한다', () => {
    expect(extractCodeReferences('@codocs [[대상]] #L2')[0]).toMatchObject({
      text: '@codocs [[대상]]',
      destination: { kind: codeReferenceDestinationKinds.document },
    });
  });
});
describe('resolveCodeReference: 저장 문서 후보와 실제 행', () => {
  it('자기 문서 이름을 일반 텍스트에서 참조하면 정상 대상을 확인한다', () => {
    const marker = extractCodeReferences('@codocs [[대상]]#L4')[0]!;
    expect(resolveCodeReference(catalog, marker)).toMatchObject({
      status: codeReferenceStatuses.resolved,
      target: { path: target.path },
      destination: {
        kind: codeReferenceDestinationKinds.rows,
        startLine: 4,
        endLine: 4,
      },
    });
  });
  it('섹션을 적은 코드 참조는 문서가 있어도 후보를 찾지 않는다', () => {
    const marker = extractCodeReferences('@codocs [[대상:업무]]#L4')[0]!;
    expect(resolveCodeReference(catalog, marker)).toMatchObject({
      status: codeReferenceStatuses.missing,
      candidates: [],
    });
  });
  it('섹션을 적은 코드 참조는 탐색이 불완전하면 미확인으로 둔다', () => {
    const marker = extractCodeReferences('@codocs [[대상:업무]]')[0]!;
    expect(
      resolveCodeReference(
        { ...catalog, status: scanStatuses.partial },
        marker,
      ),
    ).toMatchObject({
      status: codeReferenceStatuses.unconfirmed,
      candidates: [],
    });
  });
  it('ID만 같은 이름을 참조하면 이름 대상으로 확정하지 않는다', () => {
    expect(
      resolveCodeReference(
        catalog,
        extractCodeReferences('@codocs [[target]]')[0]!,
      ),
    ).toMatchObject({ status: codeReferenceStatuses.missing, candidates: [] });
  });
  it('저장 원문 마지막 행을 넘으면 범위를 보정하지 않는다', () => {
    expect(
      resolveCodeReference(
        catalog,
        extractCodeReferences('@codocs [[대상]]#L6')[0]!,
      ),
    ).toMatchObject({ status: codeReferenceStatuses.outOfBounds });
  });
  it('문서 탐색이 partial이면 확인 후보 하나도 유일 대상으로 확정하지 않는다', () => {
    expect(
      resolveCodeReference(
        { ...catalog, status: scanStatuses.partial },
        extractCodeReferences('@codocs [[대상]]')[0]!,
      ),
    ).toMatchObject({ status: codeReferenceStatuses.unconfirmed });
  });
  it('같은 이름 후보 둘이 있으면 모든 후보를 제공하고 대상을 확정하지 않는다', () => {
    const second = { ...target, path: '.codocs/second.yaml' };
    const duplicate = {
      ...catalog,
      documents: new Map([
        [target.path, target],
        [second.path, second],
      ]),
      namePaths: new Map([['대상', new Set([target.path, second.path])]]),
    };
    expect(
      resolveCodeReference(
        duplicate,
        extractCodeReferences('@codocs [[대상]]')[0]!,
      ),
    ).toMatchObject({
      status: codeReferenceStatuses.ambiguous,
      candidates: [{ path: second.path }, { path: target.path }],
    });
  });
});
