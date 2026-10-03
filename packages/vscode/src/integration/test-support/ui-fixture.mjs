import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 실제 행 번호 11·12를 가진 열다섯 행 문서를 만든다. 다섯째 행부터 본문이며 마지막은 줄바꿈 뒤 빈 행이다. */
function rowsDocument(id, name) {
  const rows = Array.from(
    { length: 10 },
    (_, index) => `  ${name} row ${String(index + 5).padStart(2, '0')}`,
  );
  return `id: ${id}\nname: ${name}\ndomains: [test]\ndefinition: |\n${rows.join('\n')}\ndeprecatedAliases: []\n`;
}

/** 코드 파일의 둘째 행에 명시 표기를 둔 시험 원문을 만든다. */
function codeMarker(className, marker) {
  return `class ${className} {\n  // ${marker}\n}\n`;
}

/** 셋째 행에 한 줄 정의를 둔 시험 문서를 만든다. */
function inlineDocument(id, name, definition) {
  return `id: ${id}\nname: ${name}\ndefinition: ${definition}\ndomains: [test]\ndeprecatedAliases: []\n`;
}

/** UI가 책임지는 대표 경로·관계·진단만 제공한다. */
export function uiFiles() {
  return {
    'source %20 한글#.java':
      'class Probe {\n  zoneAuxiliary();\n  direct();\n}\n',
    '.codocs/zone %20 한글#.yaml':
      'id: zone\nname: Zone\ndefinition: Zone body [[Direct]]\ndomains: [test]\ndeprecatedAliases: []\n',
    '.codocs/direct.yaml':
      'id: direct\nname: Direct\ndefinition: Direct body\ndomains: [test]\ndeprecatedAliases: []\n',
    '.codocs/auxiliary.yaml':
      'id: auxiliary\nname: Auxiliary\ndefinition: Auxiliary body\ndomains: [test]\ndeprecatedAliases: []\n',
    '.codocs/referrer.yaml':
      'id: referrer\nname: Referrer\ndefinition: Backlink [[Zone]]\ndomains: [test]\ndeprecatedAliases: []\n',
    '.codocs/source %20 한글#.yaml':
      'id: source\nname: Source\ndefinition: Body [[Zone]]\ndomains: [test]\ndeprecatedAliases: []\n',
    '.codocs/ambiguous.yaml':
      'id: ambiguous\nname: Ambiguous\ndefinition: Body [[Twin]]\ndomains: [test]\ndeprecatedAliases: []\n',
    '.codocs/twin-a.yaml':
      'id: twin-a\nname: Twin\ndefinition: Twin A body\ndomains: [alpha]\ndeprecatedAliases: []\n',
    '.codocs/twin-b.yaml':
      'id: twin-b\nname: Twin\ndefinition: Twin B body\ndomains: [beta]\ndeprecatedAliases: []\n',
    '.codocs/old.yaml':
      'id: old\nname: Old\ndefinition: Old body\ndomains: [test]\ndeprecatedAliases: []\n',
    '.codocs/old-source.yaml':
      'id: old-source\nname: Old Source\ndefinition: Body [[Old]]\ndomains: [test]\ndeprecatedAliases: []\n',
    'nested/source.java': 'zone();\n',
    'nested/.codocs/zone.yaml':
      'id: zone\nname: Nested Zone\ndefinition: Nested workspace body\ndomains: [nested]\ndeprecatedAliases: []\n',
    // 코드 참조 이동: 기존 ID·이름·경로와 겹치지 않는 별도 문서와 코드만 사용한다.
    '.codocs/navigation-target.yaml': rowsDocument(
      'navigation-target',
      'Navigation Target',
    ),
    'navigation/explicit-whole.java': codeMarker(
      'ExplicitWhole',
      '@codocs [[Navigation Target]]',
    ),
    'navigation/explicit-row.java': codeMarker(
      'ExplicitRow',
      '@codocs [[Navigation Target]]#L11',
    ),
    'navigation/explicit-range.java': codeMarker(
      'ExplicitRange',
      '@codocs [[Navigation Target]]#L11-L12',
    ),
    '.codocs/dirty-nav-target.yaml': rowsDocument(
      'dirty-nav-target',
      'Dirty Nav Target',
    ),
    'navigation/dirty-range.java': codeMarker(
      'DirtyRange',
      '@codocs [[Dirty Nav Target]]#L11-L12',
    ),
    'navigation/invalid.java': codeMarker('Invalid', '@codocs [[Absent]]'),
    'navigation/recover.java': codeMarker(
      'Recover',
      '@codocs [[Recovered Nav Target]]',
    ),
    '.codocs/rejected-nav-target.yaml': rowsDocument(
      'rejected-nav-target',
      'Rejected Nav Target',
    ),
    'navigation/rejected-range.java': codeMarker(
      'RejectedRange',
      '@codocs [[Rejected Nav Target]]#L11-L12',
    ),
    '.codocs/reverse-single.yaml': inlineDocument(
      'reverse-single',
      'Reverse Single',
      'Reverse single row',
    ),
    'navigation/reverse-single.java': codeMarker(
      'ReverseSingle',
      '@codocs [[Reverse Single]]#L3',
    ),
    '.codocs/reverse-recreate.yaml': inlineDocument(
      'reverse-recreate',
      'Reverse Recreate',
      'Reverse recreate row',
    ),
    'navigation/recreate/reverse-recreate.java': codeMarker(
      'ReverseRecreate',
      '@codocs [[Reverse Recreate]]#L3',
    ),
    '.codocs/reverse-multiple.yaml': inlineDocument(
      'reverse-multiple',
      'Reverse Multiple',
      'Reverse multiple row',
    ),
    'navigation/reverse-multiple-impl.java': codeMarker(
      'ReverseMultipleImpl',
      '@codocs [[Reverse Multiple]]#L3',
    ),
    'navigation/reverse-multiple-test.java': codeMarker(
      'ReverseMultipleTest',
      '@codocs [[Reverse Multiple]]#L3',
    ),
    '.codocs/reverse-overlap.yaml': inlineDocument(
      'reverse-overlap',
      'Reverse Overlap',
      'Overlap row [[Direct]] tail',
    ),
    'navigation/reverse-overlap.java': codeMarker(
      'ReverseOverlap',
      '@codocs [[Reverse Overlap]]#L3',
    ),
    '.codocs/whole-single.yaml': inlineDocument(
      'whole-single',
      'Whole Single',
      'Whole single body',
    ),
    'navigation/whole-single.java': codeMarker(
      'WholeSingle',
      '@codocs [[Whole Single]]',
    ),
    '.codocs/whole-multiple.yaml': inlineDocument(
      'whole-multiple',
      'Whole Multiple',
      'Whole multiple body',
    ),
    'navigation/whole-multiple-impl.java': codeMarker(
      'WholeMultipleImpl',
      '@codocs [[Whole Multiple]]',
    ),
    'navigation/whole-multiple-test.java': codeMarker(
      'WholeMultipleTest',
      '@codocs [[Whole Multiple]]',
    ),
  };
}

/** job가 소유한 workspace를 만들거나 변경 파일을 기준 내용으로 복원한다. */
export async function createFixture(root) {
  for (const [relative, content] of Object.entries(uiFiles())) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}
