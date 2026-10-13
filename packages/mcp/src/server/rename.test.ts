import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  callWrapped,
  openInProcessProject,
  type InProcessProject,
} from '../../test-support/in-process.js';

let opened: InProcessProject | undefined;

afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

interface Candidate {
  path: string;
  name?: string;
}

/** 이 파일의 테스트가 읽는 이름 변경 응답 필드만 가진 형태다. */
interface Reply {
  success: boolean;
  status: string;
  changes: unknown[];
  impacts: {
    path: string;
    occurrenceIndex: number;
    reason: string;
    before: { candidates: Candidate[] };
  }[];
  revisions: Record<string, string>;
}

/** 이름 변경 도구를 호출하고 전송 포장과 JSON 본문의 일치를 확인한 뒤 본문을 꺼낸다. */
async function rename(args: Record<string, unknown>): Promise<Reply> {
  const { response, body } = await callWrapped(
    opened!.client,
    'codocs_rename',
    args,
  );
  expect(response.isError).toBe(!body.success);
  return body as unknown as Reply;
}

/** 문서 원문을 만든다. */
function doc(id: string, name: string, body: string): string {
  return `_codocs:\n  id: ${id}\n  name: '${name}'\ndefinition: |\n  ${body}\n`;
}

const order = doc('order', '주문', '주문의 의미다.');
const referrer = doc('ref', '참조', '[[주문]]을 쓰고 [[주문]]을 다시 쓴다.');
const files = {
  '.codocs/order.yaml': order,
  '.codocs/other.yaml': doc('other-order', '주문', '다른 주문이다.'),
  '.codocs/ref.yaml': referrer,
};
const input = { id: 'order', newName: '새주문' };

describe('codocs_rename의 preview와 apply 값 전달', () => {
  it('원래 모호한 참조의 preview는 변경 이유와 후보의 이름·경로만 응답에 담는다', async () => {
    opened = await openInProcessProject('mcp-rename-', files);

    const result = await rename({ mode: 'preview', ...input });

    expect(result.status).toBe('unresolved');
    expect(result.impacts).toHaveLength(2);
    const first = result.impacts[0]!;
    expect(first.reason).toBe('changed_resolution');
    expect(first.before.candidates.map((item) => item.name)).toEqual([
      '주문',
      '주문',
    ]);
    expect(first.before.candidates.every((item) => item.path)).toBe(true);
    expect(first.before.candidates[0]).not.toHaveProperty('domains');
  });

  it('preview가 준 sourcePath·occurrenceIndex·후보 경로를 선택으로 apply에 보내면 선택한 참조만 고친다', async () => {
    opened = await openInProcessProject('mcp-rename-', files);
    const preview = await rename({ mode: 'preview', ...input });
    const first = preview.impacts[0]!;
    const picked = first.before.candidates.find((item) =>
      item.path.endsWith('order.yaml'),
    );

    const result = await rename({
      mode: 'apply',
      ...input,
      selections: [
        {
          sourcePath: first.path,
          occurrenceIndex: first.occurrenceIndex,
          targetPath: picked!.path,
        },
      ],
      revisions: preview.revisions,
    });

    expect(result).toMatchObject({ success: true, status: 'unresolved' });
    expect(
      await readFile(path.join(opened.project, '.codocs/ref.yaml'), 'utf8'),
    ).toContain('[[새주문]]을 쓰고 [[주문]]을');
  });
});
