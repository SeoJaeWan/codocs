import {
  mkdir,
  mkdtemp,
  readFile,
  rename as renameFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWorkspaceCatalog } from '../indexing/index.js';
import { loadWorkspace } from '../loader/index.js';
import { prepareWorkspaceRename } from '../rename/index.js';
import { applyWorkspaceRename } from './index.js';
import { rmWithRetry } from '../../../../tools/test/support/retrying-fs.js';

let root: string;
const refundPath = path.join('.codocs', 'refund.yaml');
const paymentPath = path.join('.codocs', 'payment.yaml');
const refund = '_codocs:\n  id: refund\n  name: 환불\n"환불정책": 본문\n';
const payment =
  '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불정책]]"\n';
const request = {
  targetPath: refundPath,
  section: '환불정책',
  newName: '환불 규정',
};

/** .codocs 파일의 현재 내용을 읽는다. */
async function read(name: string): Promise<string> {
  return readFile(path.join(root, '.codocs', name), 'utf8');
}

/** 현재 디스크를 스캔하고 미리보기에서 받은 revision과 함께 반영 입력을 만든다. */
async function previewed() {
  const scan = await loadWorkspace({ cwd: root });
  const catalog = buildWorkspaceCatalog(scan);
  const { preview } = prepareWorkspaceRename(request, scan, catalog);
  return { scan, catalog, input: { ...request, revisions: preview.revisions } };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codocs-section-apply-'));
  await mkdir(path.join(root, '.codocs'));
  await writeFile(path.join(root, '.codocs', 'refund.yaml'), refund);
  await writeFile(path.join(root, '.codocs', 'payment.yaml'), payment);
});

afterEach(async () => {
  await rmWithRetry(root, { recursive: true, force: true });
});

describe('applyWorkspaceRename: 섹션 이름 변경 반영', () => {
  it('키 파일과 참조 파일을 바꾸고 따옴표 키 형식을 유지한다', async () => {
    const { scan, catalog, input } = await previewed();
    const result = await applyWorkspaceRename(input, scan, catalog);

    expect(result).toMatchObject({
      success: true,
      status: 'ready',
      files: [
        { path: paymentPath, state: 'changed' },
        { path: refundPath, state: 'changed' },
      ],
    });
    expect(await read('refund.yaml')).toBe(
      '_codocs:\n  id: refund\n  name: 환불\n"환불 규정": 본문\n',
    );
    expect(await read('payment.yaml')).toBe(
      '_codocs:\n  id: payment\n  name: 결제\n취소: "[[환불:환불 규정]]"\n',
    );
  });

  it('두 번째 파일 교체가 실패하면 첫 파일을 원래 내용으로 복구한다', async () => {
    const { scan, catalog, input } = await previewed();
    const result = await applyWorkspaceRename(input, scan, catalog, {
      operations: {
        rename: async (from, to) => {
          if (to.endsWith('refund.yaml'))
            throw Object.assign(new Error('EIO'), { code: 'EIO' });
          await renameFile(from, to);
        },
      },
    });

    expect(result).toMatchObject({
      success: false,
      saved: false,
      changed: false,
      files: [
        { path: paymentPath, state: 'restored' },
        { path: refundPath, state: 'unchanged' },
      ],
    });
    expect(await read('refund.yaml')).toBe(refund);
    expect(await read('payment.yaml')).toBe(payment);
  });

  it('섹션이 충돌하면 rename_blocked로 거절하고 파일을 바꾸지 않는다', async () => {
    await writeFile(
      path.join(root, '.codocs', 'refund.yaml'),
      `${refund}"환불 규정": 이미 있음\n`,
    );
    const { scan, catalog, input } = await previewed();
    const result = await applyWorkspaceRename(input, scan, catalog);

    expect(result).toMatchObject({
      success: false,
      saved: false,
      files: [],
      diagnostics: [{ code: 'rename_blocked' }],
      preview: {
        blockingReason: 'section_conflict',
        targetSection: '환불정책',
      },
    });
    expect(await read('payment.yaml')).toBe(payment);
  });
});
