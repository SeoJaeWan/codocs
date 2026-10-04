import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 섹션 문서의 `_codocs` 메타데이터 블록을 만든다. 세 행을 차지하며 parent를 주면 두 행이 더해진다. */
function meta(id, name, parent) {
  const parents = parent ? `  parent:\n    - ${parent}\n` : '';
  return `_codocs:\n  id: ${id}\n  name: ${name}\n${parents}`;
}

/** 실제 행 번호 11·12를 가진 열네 행 문서를 만든다. 다섯째 행부터 본문이며 마지막은 줄바꿈 뒤 빈 행이다. */
function rowsDocument(id, name) {
  const rows = Array.from(
    { length: 10 },
    (_, index) => `  ${name} row ${String(index + 5).padStart(2, '0')}`,
  );
  return `${meta(id, name)}body: |\n${rows.join('\n')}\n`;
}

/** 코드 파일의 둘째 행에 명시 표기를 둔 시험 원문을 만든다. */
function codeMarker(className, marker) {
  return `class ${className} {\n  // ${marker}\n}\n`;
}

/** 넷째 행에 한 줄 섹션 본문을 둔 시험 문서를 만든다. */
function inlineDocument(id, name, definition) {
  return `${meta(id, name)}body: ${definition}\n`;
}

/** UI가 책임지는 대표 경로·관계·진단만 제공한다. */
export function uiFiles() {
  return {
    '.codocs/zone %20 한글#.yaml': inlineDocument(
      'zone',
      'Zone',
      'Zone body [[Direct]]',
    ),
    '.codocs/direct.yaml': inlineDocument('direct', 'Direct', 'Direct body'),
    '.codocs/auxiliary.yaml': inlineDocument(
      'auxiliary',
      'Auxiliary',
      'Auxiliary body',
    ),
    '.codocs/source %20 한글#.yaml': inlineDocument(
      'source',
      'Source',
      'Body [[Zone]]',
    ),
    '.codocs/ambiguous.yaml': inlineDocument(
      'ambiguous',
      'Ambiguous',
      'Body [[Twin]]',
    ),
    '.codocs/twin-a.yaml': inlineDocument('twin-a', 'Twin', 'Twin A body'),
    '.codocs/twin-b.yaml': inlineDocument('twin-b', 'Twin', 'Twin B body'),
    '.codocs/old.yaml': inlineDocument('old', 'Old', 'Old body'),
    '.codocs/old-source.yaml': inlineDocument(
      'old-source',
      'Old Source',
      'Body [[Old]]',
    ),
    'nested/.codocs/source.yaml': inlineDocument(
      'nested-source',
      'Nested Source',
      'Body [[Zone]]',
    ),
    'nested/.codocs/zone.yaml': inlineDocument(
      'zone',
      'Zone',
      'Nested workspace body',
    ),
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
      '@codocs [[Reverse Single]]#L4',
    ),
    '.codocs/reverse-recreate.yaml': inlineDocument(
      'reverse-recreate',
      'Reverse Recreate',
      'Reverse recreate row',
    ),
    'navigation/recreate/reverse-recreate.java': codeMarker(
      'ReverseRecreate',
      '@codocs [[Reverse Recreate]]#L4',
    ),
    '.codocs/reverse-multiple.yaml': inlineDocument(
      'reverse-multiple',
      'Reverse Multiple',
      'Reverse multiple row',
    ),
    'navigation/reverse-multiple-impl.java': codeMarker(
      'ReverseMultipleImpl',
      '@codocs [[Reverse Multiple]]#L4',
    ),
    'navigation/reverse-multiple-test.java': codeMarker(
      'ReverseMultipleTest',
      '@codocs [[Reverse Multiple]]#L4',
    ),
    '.codocs/reverse-overlap.yaml': inlineDocument(
      'reverse-overlap',
      'Reverse Overlap',
      'Overlap row [[Direct]] tail',
    ),
    'navigation/reverse-overlap.java': codeMarker(
      'ReverseOverlap',
      '@codocs [[Reverse Overlap]]#L4',
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
    // 이름 변경: 기존 ID·이름·참조와 겹치지 않는 별도 문서만 사용한다.
    '.codocs/rename-target.yaml': inlineDocument(
      'rename-target',
      'Rename Target',
      'Rename target body',
    ),
    '.codocs/rename-ref.yaml': inlineDocument(
      'rename-ref',
      'Rename Ref',
      'Rename ref body [[Rename Target]]',
    ),
    '.codocs/rename-twin-a.yaml': inlineDocument(
      'rename-twin-a',
      'Rename Twin',
      'Rename twin A body',
    ),
    '.codocs/rename-twin-b.yaml': inlineDocument(
      'rename-twin-b',
      'Rename Twin',
      'Rename twin B body',
    ),
    '.codocs/rename-twin-ref.yaml': inlineDocument(
      'rename-twin-ref',
      'Rename Twin Ref',
      'Rename twin body [[Rename Twin]]',
    ),
    // 상위 문서 이름 변경: 부모 이름을 parent에 적은 별도 문서만 사용한다.
    '.codocs/rename-parent-target.yaml': inlineDocument(
      'rename-parent-target',
      'Rename Parent Target',
      'Rename parent target body',
    ),
    '.codocs/rename-parent-child.yaml': `${meta(
      'rename-parent-child',
      'Rename Parent Child',
      'Rename Parent Target',
    )}body: Rename parent child body\n`,
    // 어느 섹션에서든 참조가 링크·진단이 되며 도메인 한정 표기는 대상 없음이다.
    '.codocs/section-refs.yaml': `${meta('section-refs', 'Section Refs')}overview: Plain overview\nnotes: |\n  Notes see [[Direct]] and [[test:Direct]]\n`,
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
    // 사례마다 복원할 때 내용이 같은 파일은 다시 쓰지 않는다. 다시 쓰면 감시자가 색인 갱신을 시작해 다음 사례와 겹친다.
    if ((await currentContent(file)) === content) continue;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

/** 파일의 현재 원문을 읽고 없으면 undefined를 반환한다. */
async function currentContent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
