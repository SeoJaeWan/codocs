import { describe, expect, it } from 'vitest';
import { renameChangeKinds, type RenameChange } from '../catalog/index.js';
import { parseYaml } from '../parser/index.js';
import { applyRenameChanges } from './index.js';

const path = '.codocs/refund.yaml';

/** 키 위치(따옴표 포함)를 원문에서 찾아 키 수정안을 만든다. */
function keyChange(
  source: string,
  rawKey: string,
  oldText: string,
  newText: string,
): RenameChange {
  const start = source.indexOf(rawKey);
  return {
    path,
    fieldPath: [oldText],
    offsetRange: { start, end: start + rawKey.length },
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    oldText,
    newText,
    targetPath: path,
    candidates: [],
    kind: renameChangeKinds.key,
  };
}

/** 원문을 파싱해 수정안을 적용한다. */
function apply(source: string, changes: readonly RenameChange[]) {
  const parsed = parseYaml(source, path);
  if (!parsed.success) throw new Error('테스트 입력 원문이 파싱되지 않았다');
  return applyRenameChanges(parsed, changes);
}

const head = '_codocs:\n  id: refund\n  name: 환불\n';

describe('applyRenameChanges: 섹션 키 이름 변경', () => {
  describe('키의 따옴표 형식 유지', () => {
    it.each([
      {
        title: 'plain 키는 plain으로 바꾼다',
        rawKey: '환불정책',
        source: `${head}환불정책: 본문\n`,
        newText: '환불 규정',
        expected: `${head}환불 규정: 본문\n`,
      },
      {
        title: '작은따옴표 키는 작은따옴표로 바꾼다',
        rawKey: "'환불정책'",
        source: `${head}'환불정책': 본문\n`,
        newText: '환불 규정',
        expected: `${head}'환불 규정': 본문\n`,
      },
      {
        title: '큰따옴표 키는 큰따옴표로 바꾼다',
        rawKey: '"환불정책"',
        source: `${head}"환불정책": 본문\n`,
        newText: '환불 규정',
        expected: `${head}"환불 규정": 본문\n`,
      },
      {
        title:
          '작은따옴표 키의 새 이름에 작은따옴표가 있으면 두 개로 escape한다',
        rawKey: "'환불정책'",
        source: `${head}'환불정책': 본문\n`,
        newText: "it's",
        expected: `${head}'it''s': 본문\n`,
      },
      {
        title:
          '큰따옴표 키의 새 이름에 따옴표·역슬래시·개행이 있으면 escape한다',
        rawKey: '"환불정책"',
        source: `${head}"환불정책": 본문\n`,
        newText: 'a"b\\c\nd',
        expected: `${head}"a\\"b\\\\c\\nd": 본문\n`,
      },
      {
        title: '따옴표 키는 plain으로는 안전하지 않은 새 이름도 그대로 쓴다',
        rawKey: '"환불정책"',
        source: `${head}"환불정책": 본문\n`,
        newText: 'a: b # c',
        expected: `${head}"a: b # c": 본문\n`,
      },
      {
        title: '콜론이 있는 따옴표 키 이름도 바꾼다',
        rawKey: '"가:나"',
        source: `${head}"가:나": 본문\n`,
        newText: '다',
        oldText: '가:나',
        expected: `${head}"다": 본문\n`,
      },
    ])('$title', ({ source, rawKey, newText, expected, oldText }) => {
      const result = apply(source, [
        keyChange(source, rawKey, oldText ?? '환불정책', newText),
      ]);

      expect(result).toEqual({ success: true, raw: expected });
    });
  });

  describe('바꾸지 않는 원문의 보존', () => {
    it('다른 키·값·주석·CRLF·키 순서를 그대로 두고 키 이름만 바꾼다', () => {
      const source =
        "# 앞 주석\r\n_codocs:\r\n  id: refund\r\n  name: 환불\r\n앞: |\r\n  블록\r\n'환불정책': 본문 # 값 주석\r\n뒤: 값\r\n";
      const result = apply(source, [
        keyChange(source, "'환불정책'", '환불정책', '환불 규정'),
      ]);

      expect(result).toEqual({
        success: true,
        raw: source.replace("'환불정책'", "'환불 규정'"),
      });
    });

    it('블록 값의 키도 키 줄만 바꾼다', () => {
      const source = `${head}환불정책:\n  하위: 값\n  목록:\n    - a\n`;
      const result = apply(source, [
        keyChange(source, '환불정책', '환불정책', '환불 규정'),
      ]);

      expect(result).toEqual({
        success: true,
        raw: `${head}환불 규정:\n  하위: 값\n  목록:\n    - a\n`,
      });
    });

    it('flow 매핑 최상위의 따옴표 키도 바꾼다', () => {
      const source =
        '{"_codocs": {"id": "refund", "name": "환불"}, "환불정책": "본문"}';
      const result = apply(source, [
        keyChange(source, '"환불정책"', '환불정책', '환불 규정'),
      ]);

      expect(result).toEqual({
        success: true,
        raw: source.replace('"환불정책"', '"환불 규정"'),
      });
    });

    it('같은 문서의 참조 수정안과 함께 적용해도 키·참조만 바뀐다', () => {
      const source = `${head}환불정책: 본문\n예외: "[[환불:환불정책]] 참고"\n`;
      const referenceStart = source.indexOf('환불정책]]');
      const result = apply(source, [
        keyChange(source, '환불정책', '환불정책', '환불 규정'),
        {
          path,
          fieldPath: ['예외'],
          offsetRange: { start: referenceStart, end: referenceStart + 4 },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          oldText: '환불정책',
          newText: '환불 규정',
          targetPath: path,
          candidates: [],
          occurrenceIndex: 0,
        },
      ]);

      expect(result).toEqual({
        success: true,
        raw: `${head}환불 규정: 본문\n예외: "[[환불:환불 규정]] 참고"\n`,
      });
    });

    it('적용한 결과를 다시 파싱하면 값은 그대로이고 키 순서가 유지된다', () => {
      const source = `${head}앞: 1\n환불정책: 본문\n뒤: 2\n`;
      const result = apply(source, [
        keyChange(source, '환불정책', '환불정책', '환불 규정'),
      ]);
      if (!result.success) throw new Error('적용에 실패했다');
      const reparsed = parseYaml(result.raw, path);

      expect(reparsed.success && Object.keys(reparsed.data)).toEqual([
        '_codocs',
        '앞',
        '환불 규정',
        '뒤',
      ]);
    });
  });

  describe('쓸 수 없는 키 수정안의 거부', () => {
    it.each([
      { title: '": "가 있는 이름', newText: 'a: b' },
      { title: '" #"가 있는 이름', newText: 'a #b' },
      { title: '불리언처럼 읽히는 이름', newText: 'true' },
      { title: 'null처럼 읽히는 이름', newText: 'null' },
      { title: '숫자처럼 읽히는 이름', newText: '123' },
      { title: '앞 공백이 있는 이름', newText: ' 앞공백' },
      { title: '뒤 공백이 있는 이름', newText: '뒤공백 ' },
      { title: '개행이 있는 이름', newText: '두\n줄' },
      { title: 'YAML 지시자로 시작하는 이름', newText: '- 목록' },
      { title: '따옴표로 시작하는 이름', newText: '"인용' },
      { title: '플로 구분자가 있는 이름', newText: 'a, b: [c]' },
    ])(
      'plain 키는 $title이면 따옴표로 승격하지 않고 실패한다',
      ({ newText }) => {
        const source = `${head}환불정책: 본문\n`;
        const result = apply(source, [
          keyChange(source, '환불정책', '환불정책', newText),
        ]);

        expect(result).toEqual({ success: false });
      },
    );

    it('이미 있는 키와 같은 이름이면 실패한다', () => {
      const source = `${head}환불정책: 본문\n다른: 값\n`;
      const result = apply(source, [
        keyChange(source, '환불정책', '환불정책', '다른'),
      ]);

      expect(result).toEqual({ success: false });
    });

    it.each([
      {
        title: '키 범위가 실제 키와 맞지 않으면',
        make: (source: string) => ({
          ...keyChange(source, '환불정책', '환불정책', '새'),
          offsetRange: {
            start: source.indexOf('환불정책') + 1,
            end: source.indexOf('환불정책') + 4,
          },
        }),
      },
      {
        title: '따옴표를 뺀 범위이면',
        make: (source: string) =>
          keyChange(source, '환불정책', '환불정책', '새'),
        quoted: true,
      },
      {
        title: '이전 이름이 실제 키와 다르면',
        make: (source: string) =>
          keyChange(source, '환불정책', '다른이름', '새'),
      },
      {
        title: '중첩 경로이면',
        make: (source: string) => ({
          ...keyChange(source, '환불정책', '환불정책', '새'),
          fieldPath: ['환불정책', '하위'],
        }),
      },
    ])('$title 파일을 바꾸지 않고 실패한다', ({ make, quoted }) => {
      const source = quoted
        ? `${head}"환불정책": 본문\n`
        : `${head}환불정책: 본문\n`;
      const result = apply(source, [make(source)]);

      expect(result).toEqual({ success: false });
    });

    it('같은 키를 두 번 바꾸는 수정안은 실패한다', () => {
      const source = `${head}환불정책: 본문\n`;
      const change = keyChange(source, '환불정책', '환불정책', '새');
      const result = apply(source, [change, change]);

      expect(result).toEqual({ success: false });
    });
  });
});
