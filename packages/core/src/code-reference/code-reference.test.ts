import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogDocument } from '../catalog/index.js';
import {
  catalogConfirmations,
  scanStatuses,
} from '../catalog/domain-values.js';
import { parseYaml } from '../parser/index.js';
import {
  extractCodeReferences,
  getCodeReferencePartRanges,
  replaceCodeReferencePart,
  resolveCodeReference,
  codeReferenceDestinationKinds,
  codeReferenceStatuses,
  codeReferenceSyntaxes,
} from './index.js';

const source =
  '_codocs:\n  id: target\n  name: 대상\n업무:\n  본문: 내용\n"환불 정책":\n  본문: 내용\n';
const target: CatalogDocument = {
  path: '.codocs/target.yaml',
  id: 'target',
  name: '대상',
  confirmation: catalogConfirmations.confirmed,
  observation: {
    path: '.codocs/target.yaml',
    parsed: parseYaml(source, '.codocs/target.yaml'),
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
    const [marker] = extractCodeReferences(text);
    expect(marker).toMatchObject({
      text: '@codocs [[대상]]',
      name: '대상',
      syntax: codeReferenceSyntaxes.valid,
    });
    expect(marker).not.toHaveProperty('section');
  });
  it('섹션과 escaped 콜론이 있으면 이름과 섹션으로 나눈다', () => {
    const markers = extractCodeReferences('@codocs [[이름\\:설명:업무]]');
    expect(markers[0]).toMatchObject({ name: '이름:설명', section: '업무' });
  });
  it.each(['#L2', '#L2-L4', '#broken', '#'])(
    '닫힘 뒤 접미사 %s가 있으면 표기에 포함하지 않고 오류도 만들지 않는다',
    (suffix) => {
      const [marker] = extractCodeReferences('@codocs [[대상]]' + suffix);
      expect(marker).toMatchObject({
        text: '@codocs [[대상]]',
        offsetRange: { start: 0, end: 14 },
        name: '대상',
        syntax: codeReferenceSyntaxes.valid,
      });
    },
  );
  it.each(['\n', '\r\n'])(
    'Unicode와 %j 및 같은 행 복수 표기가 있으면 UTF-16 위치를 유지한다',
    (newline) => {
      const text =
        '🙂 @codocs [[대상]]' +
        newline +
        '@codocs [[대상]] @codocs [[대상:업무]]';
      const markers = extractCodeReferences(text);
      expect(markers.map((item) => item.offsetRange)).toEqual([
        { start: 3, end: 17 },
        { start: 17 + newline.length, end: 31 + newline.length },
        { start: 32 + newline.length, end: 49 + newline.length },
      ]);
      expect(markers.map((item) => item.range)).toEqual([
        { start: { line: 0, character: 3 }, end: { line: 0, character: 17 } },
        { start: { line: 1, character: 0 }, end: { line: 1, character: 14 } },
        { start: { line: 1, character: 15 }, end: { line: 1, character: 32 } },
      ]);
    },
  );
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
});
describe('resolveCodeReference: 저장 문서 후보와 섹션', () => {
  it('문서 전체를 참조하면 문서 대상과 문서 목적지를 확인한다', () => {
    const marker = extractCodeReferences('@codocs [[대상]]')[0]!;
    const result = resolveCodeReference(catalog, marker);
    expect(result).toMatchObject({
      status: codeReferenceStatuses.resolved,
      target: { path: target.path },
      destination: { kind: codeReferenceDestinationKinds.document },
    });
    expect(result).not.toHaveProperty('section');
  });
  it.each([
    ['업무', '업무', { line: 3, character: 0 }, { line: 3, character: 2 }],
    [
      '환불 정책',
      '"환불 정책"',
      { line: 5, character: 0 },
      { line: 5, character: 7 },
    ],
  ])(
    '섹션 %s를 참조하면 저장 문서의 섹션 키 위치를 목적지로 확인한다',
    (section, markerText, start, end) => {
      const marker = extractCodeReferences(`@codocs [[대상:${section}]]`)[0]!;
      expect(resolveCodeReference(catalog, marker)).toMatchObject({
        status: codeReferenceStatuses.resolved,
        target: { path: target.path },
        section,
        destination: {
          kind: codeReferenceDestinationKinds.section,
          section,
          markerText,
          range: { start, end },
        },
      });
    },
  );
  it('저장 문서에 없는 섹션을 참조하면 섹션 부재 상태로 후보를 남긴다', () => {
    const marker = extractCodeReferences('@codocs [[대상:없음]]')[0]!;
    const result = resolveCodeReference(catalog, marker);
    expect(result).toMatchObject({
      status: codeReferenceStatuses.missingSection,
      candidates: [{ path: target.path }],
    });
    expect(result).not.toHaveProperty('destination');
  });
  it('섹션을 적은 참조는 탐색이 불완전하면 미확인으로 둔다', () => {
    const marker = extractCodeReferences('@codocs [[대상:업무]]')[0]!;
    expect(
      resolveCodeReference(
        { ...catalog, status: scanStatuses.partial },
        marker,
      ),
    ).toMatchObject({ status: codeReferenceStatuses.unconfirmed });
  });
  it('문서가 없는 이름에 섹션을 적으면 문서 부재 상태로 둔다', () => {
    const marker = extractCodeReferences('@codocs [[없는문서:업무]]')[0]!;
    expect(resolveCodeReference(catalog, marker)).toMatchObject({
      status: codeReferenceStatuses.missing,
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
  it('문서 탐색이 partial이면 확인 후보 하나도 유일 대상으로 확정하지 않는다', () => {
    expect(
      resolveCodeReference(
        { ...catalog, status: scanStatuses.partial },
        extractCodeReferences('@codocs [[대상]]')[0]!,
      ),
    ).toMatchObject({ status: codeReferenceStatuses.unconfirmed });
  });
  it.each(['@codocs [[대상]]', '@codocs [[대상:업무]]'])(
    '같은 이름 후보 둘이 있으면 %s는 모든 후보를 제공하고 대상을 확정하지 않는다',
    (text) => {
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
        resolveCodeReference(duplicate, extractCodeReferences(text)[0]!),
      ).toMatchObject({
        status: codeReferenceStatuses.ambiguous,
        candidates: [{ path: second.path }, { path: target.path }],
      });
    },
  );
});

describe('코드 표기의 이름·섹션 부분 범위', () => {
  /** 파일 원문에서 첫 표기를 뽑는다. */
  function first(text: string): ReturnType<typeof extractCodeReferences>[0] {
    return extractCodeReferences(text)[0]!;
  }
  it('섹션이 없는 표기는 이름 부분 범위만 반환한다', () => {
    const text = 'x\n// @codocs [[환불]]#L2\n';
    const ranges = getCodeReferencePartRanges(first(text))!;

    expect(text.slice(ranges.name.start, ranges.name.end)).toBe('환불');
    expect(ranges.section).toBeUndefined();
  });
  it('이름과 섹션이 있는 표기는 파일 원문 기준의 두 범위를 반환한다', () => {
    const text = 'a\n// @codocs [[환불:환불정책]]';
    const ranges = getCodeReferencePartRanges(first(text))!;

    expect(text.slice(ranges.name.start, ranges.name.end)).toBe('환불');
    expect(text.slice(ranges.section!.start, ranges.section!.end)).toBe(
      '환불정책',
    );
  });
  it('이름 안의 escape된 콜론은 구분 콜론으로 보지 않고 범위에 포함한다', () => {
    const text = '@codocs [[a\\:b\:c\\:d]]';
    const ranges = getCodeReferencePartRanges(first(text))!;

    expect(text.slice(ranges.name.start, ranges.name.end)).toBe('a\\:b');
    expect(text.slice(ranges.section!.start, ranges.section!.end)).toBe(
      'c\\:d',
    );
  });
  it('문법 오류인 표기는 범위를 반환하지 않는다', () => {
    expect(getCodeReferencePartRanges(first('@codocs [[a'))).toBeUndefined();
    expect(
      getCodeReferencePartRanges(first('@codocs [[a:b:c]]')),
    ).toBeUndefined();
  });
  it('이름 부분만 바꾸고 섹션과 표기 뒤 글자는 그대로 둔다', () => {
    const marker = first('// @codocs [[환불:환불정책]]#L2');
    const edit = replaceCodeReferencePart(marker, 'name', '결제')!;

    expect(edit.oldText).toBe('환불');
    expect(edit.newText).toBe('결제');
    expect(
      marker.text.slice(0, edit.offsetRange.start - marker.offsetRange.start) +
        edit.newText +
        marker.text.slice(edit.offsetRange.end - marker.offsetRange.start),
    ).toBe('@codocs [[결제:환불정책]]');
  });
  it('새 값의 콜론은 escape하여 한 부분으로 적는다', () => {
    const marker = first('@codocs [[환불:환불정책]]');
    const edit = replaceCodeReferencePart(marker, 'section', 'a:b')!;

    expect(edit.newText).toBe('a\\:b');
  });
  it('섹션이 없는 표기의 섹션 부분 수정은 거부한다', () => {
    expect(
      replaceCodeReferencePart(first('@codocs [[환불]]'), 'section', '새'),
    ).toBeUndefined();
  });
  it.each(['', 'a]b', 'a\nb', 'x\\'])(
    '안전하게 적을 수 없는 새 값 %j는 거부한다',
    (value) => {
      expect(
        replaceCodeReferencePart(first('@codocs [[환불:섹션]]'), 'name', value),
      ).toBeUndefined();
    },
  );
});
