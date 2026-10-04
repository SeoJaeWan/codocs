import { describe, expect, it, vi } from 'vitest';
import {
  RenameAborted,
  parseApplyResponse,
  parsePlanResponse,
  parsePrepareRenameResponse,
  renameAbortReasons,
  renameApplyErrorCodes,
  renameChoiceReasons,
  renameDocument,
  renameFileStates,
  renameMessages,
  type RenameChoicePrompt,
  type RenameHost,
} from './index.js';

const orderPath = '.codocs\\order.yaml';
const refPath = '.codocs\\ref.yaml';
const orderUri = 'file:///fixture/.codocs/order.yaml';
const refUri = 'file:///fixture/.codocs/ref.yaml';
const twinA = {
  path: '.codocs\\twin-a.yaml',
  name: '쌍둥이',
  domains: ['alpha'],
};
const twinB = {
  path: '.codocs\\twin-b.yaml',
  name: '쌍둥이',
  domains: ['beta'],
};

/** 서버가 돌려주는 미리보기 응답을 만든다. 달라지는 조건만 인자로 받는다. */
function planResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    success: true,
    scanStatus: 'complete',
    status: 'ready',
    targetPath: orderPath,
    oldName: '주문',
    newName: '새주문',
    changes: [{ path: orderPath }, { path: refPath }],
    impacts: [],
    conflicts: [],
    invalidSelections: [],
    revisions: { [orderPath]: 'r1', [refPath]: 'r2' },
    fileUris: { [orderPath]: orderUri, [refPath]: refUri },
    ...overrides,
  };
}

/** 모호한 참조 하나가 선택을 기다린다는 영향을 만든다. */
function ambiguousImpact(index: number, reason = 'selection_required') {
  return {
    path: refPath,
    occurrenceIndex: index,
    text: '[[쌍둥이]]',
    reason,
    before: { status: 'ambiguous', candidates: [twinA, twinB] },
  };
}

/** 성공한 반영 응답을 만든다. */
function applyResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    status: 'ready',
    saved: true,
    changed: true,
    files: [
      { path: orderPath, state: 'changed', revision: 'n1' },
      { path: refPath, state: 'changed', revision: 'n2' },
    ],
    impacts: [],
    diagnostics: [],
    ...overrides,
  };
}

/** 호출을 관찰할 수 있는 host를 만든다. */
function createHost(overrides: Partial<RenameHost> = {}) {
  const host = {
    planRename: vi.fn<RenameHost['planRename']>(() =>
      Promise.resolve(planResponse()),
    ),
    applyRename: vi.fn<RenameHost['applyRename']>(() =>
      Promise.resolve(applyResponse()),
    ),
    findDirtyFiles: vi.fn<RenameHost['findDirtyFiles']>(() => []),
    choose: vi.fn<RenameHost['choose']>(() => Promise.resolve(undefined)),
    notify: vi.fn<RenameHost['notify']>(),
    isCancelled: vi.fn<RenameHost['isCancelled']>(() => false),
    ...overrides,
  };
  return host;
}

describe('renameDocument 기본 진행', () => {
  it('선택할 참조가 없으면 계산한 revision으로 바로 반영하고 바뀐 이름과 파일 수를 알린다', async () => {
    const host = createHost();

    await renameDocument(host);

    expect(host.planRename).toHaveBeenCalledTimes(1);
    expect(host.planRename).toHaveBeenCalledWith([]);
    expect(host.applyRename).toHaveBeenCalledWith([], {
      [orderPath]: 'r1',
      [refPath]: 'r2',
    });
    expect(host.choose).not.toHaveBeenCalled();
    expect(host.notify).toHaveBeenCalledWith(
      'information',
      renameMessages.applied('주문', '새주문', 2),
    );
  });

  it('바꿀 위치와 영향이 모두 없으면 반영하지 않고 바꿀 내용이 없다고 알린다', async () => {
    const host = createHost({
      planRename: vi.fn(() => Promise.resolve(planResponse({ changes: [] }))),
    });

    await renameDocument(host);

    expect(host.applyRename).not.toHaveBeenCalled();
    expect(host.notify).toHaveBeenCalledWith(
      'information',
      renameMessages.noChange,
    );
  });
});

describe('renameDocument 저장하지 않은 파일 확인', () => {
  it('영향받는 파일에 저장하지 않은 수정이 있으면 시작 전에 중단하고 파일 경로를 안내한다', async () => {
    const host = createHost({ findDirtyFiles: vi.fn(() => [refUri]) });

    const failure = await renameDocument(host).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RenameAborted);
    expect((failure as RenameAborted).reason).toBe(
      renameAbortReasons.dirtyFiles,
    );
    expect((failure as RenameAborted).message).toBe(
      renameMessages.dirtyFiles(['.codocs/ref.yaml']),
    );
    expect(host.findDirtyFiles).toHaveBeenCalledWith([orderUri, refUri]);
    expect(host.choose).not.toHaveBeenCalled();
    expect(host.applyRename).not.toHaveBeenCalled();
  });

  it('참조를 고른 뒤 새로 영향받게 된 파일에 저장하지 않은 수정이 있으면 반영하지 않는다', async () => {
    const host = createHost({
      planRename: vi
        .fn()
        .mockResolvedValueOnce(
          planResponse({ impacts: [ambiguousImpact(0)], status: 'unresolved' }),
        )
        .mockResolvedValueOnce(
          planResponse({
            fileUris: {
              [orderPath]: orderUri,
              [refPath]: refUri,
              [twinA.path]: 'file:///fixture/.codocs/twin-a.yaml',
            },
          }),
        ),
      choose: vi.fn(() => Promise.resolve(twinA.path)),
      findDirtyFiles: vi.fn((uris: readonly string[]) =>
        uris.filter((uri) => uri.endsWith('twin-a.yaml')),
      ),
    });

    const failure = await renameDocument(host).catch((error: unknown) => error);

    expect((failure as RenameAborted).reason).toBe(
      renameAbortReasons.dirtyFiles,
    );
    expect((failure as RenameAborted).message).toBe(
      renameMessages.dirtyFiles(['.codocs/twin-a.yaml']),
    );
    expect(host.applyRename).not.toHaveBeenCalled();
  });

  it('선택을 마친 뒤 반영 직전에 저장하지 않은 수정이 생기면 반영하지 않는다', async () => {
    const dirty = vi
      .fn<RenameHost['findDirtyFiles']>()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([orderUri]);
    const host = createHost({ findDirtyFiles: dirty });

    const failure = await renameDocument(host).catch((error: unknown) => error);

    expect((failure as RenameAborted).reason).toBe(
      renameAbortReasons.dirtyFiles,
    );
    expect(host.applyRename).not.toHaveBeenCalled();
  });
});

describe('renameDocument 모호한 참조 선택', () => {
  it.each(['selection_required', 'changed_resolution'])(
    '모호한 참조가 %s로 보고되면 후보의 이름·도메인·경로를 담은 목록을 연다',
    async (reason) => {
      const prompts: RenameChoicePrompt[] = [];
      const host = createHost({
        planRename: vi.fn(() =>
          Promise.resolve(
            planResponse({
              status: 'unresolved',
              impacts: [ambiguousImpact(0, reason), ambiguousImpact(1, reason)],
            }),
          ),
        ),
        choose: vi.fn((prompt: RenameChoicePrompt) => {
          prompts.push(prompt);
          return Promise.resolve(undefined);
        }),
      });

      await renameDocument(host);

      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toEqual({
        title: renameMessages.chooseTitle('.codocs/ref.yaml', '[[쌍둥이]]'),
        placeHolder: renameMessages.choosePlaceHolder,
        choices: [
          {
            id: twinA.path,
            label: '쌍둥이',
            description: 'alpha',
            detail: '.codocs/twin-a.yaml',
          },
          {
            id: twinB.path,
            label: '쌍둥이',
            description: 'beta',
            detail: '.codocs/twin-b.yaml',
          },
        ],
      });
    },
  );

  it('후보가 없던 참조가 이름 변경으로 확정되는 영향은 목록 없이 바꾸지 않은 참조로 알린다', async () => {
    const host = createHost({
      planRename: vi.fn(() =>
        Promise.resolve(
          planResponse({
            status: 'unresolved',
            impacts: [
              {
                ...ambiguousImpact(0, 'changed_resolution'),
                before: { status: 'not_found', candidates: [] },
              },
            ],
          }),
        ),
      ),
    });

    await renameDocument(host);

    expect(host.choose).not.toHaveBeenCalled();
    expect(host.applyRename).toHaveBeenCalledWith([], expect.anything());
  });

  it('후보를 고르면 고른 문서를 선택으로 다시 계산하고 같은 선택과 새 revision으로 반영한다', async () => {
    const selection = {
      sourcePath: refPath,
      occurrenceIndex: 0,
      targetPath: twinA.path,
    };
    const host = createHost({
      planRename: vi
        .fn()
        .mockResolvedValueOnce(
          planResponse({ status: 'unresolved', impacts: [ambiguousImpact(0)] }),
        )
        .mockResolvedValueOnce(
          planResponse({ revisions: { [refPath]: 'r9' } }),
        ),
      choose: vi.fn(() => Promise.resolve(twinA.path)),
    });

    await renameDocument(host);

    expect(host.planRename).toHaveBeenNthCalledWith(2, [selection]);
    expect(host.applyRename).toHaveBeenCalledWith([selection], {
      [refPath]: 'r9',
    });
  });

  it('목록을 고르지 않고 닫으면 그 참조를 선택 없이 반영하고 바꾸지 않은 참조 수를 알린다', async () => {
    const host = createHost({
      planRename: vi.fn(() =>
        Promise.resolve(
          planResponse({ status: 'unresolved', impacts: [ambiguousImpact(0)] }),
        ),
      ),
      applyRename: vi.fn(() =>
        Promise.resolve(applyResponse({ impacts: [ambiguousImpact(0)] })),
      ),
      choose: vi.fn(() => Promise.resolve(undefined)),
    });

    await renameDocument(host);

    expect(host.planRename).toHaveBeenCalledTimes(1);
    expect(host.applyRename).toHaveBeenCalledWith([], expect.anything());
    expect(host.notify).toHaveBeenCalledWith(
      'warning',
      `${renameMessages.applied('주문', '새주문', 2)} ${renameMessages.leftUnchanged(1)}`,
    );
  });

  it('한 참조의 목록을 닫아도 나머지 참조의 목록은 이어서 열고 고른 참조만 선택한다', async () => {
    const host = createHost({
      planRename: vi.fn(() =>
        Promise.resolve(
          planResponse({
            status: 'unresolved',
            impacts: [ambiguousImpact(0), ambiguousImpact(1)],
          }),
        ),
      ),
      choose: vi
        .fn<RenameHost['choose']>()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(twinB.path),
    });

    await renameDocument(host);

    expect(host.choose).toHaveBeenCalledTimes(2);
    expect(host.applyRename).toHaveBeenCalledWith(
      [{ sourcePath: refPath, occurrenceIndex: 1, targetPath: twinB.path }],
      expect.anything(),
    );
  });

  it('고른 문서가 여러 도메인에 속해 도메인이 필요하면 도메인 목록을 이어서 열고 고른 도메인을 선택에 담는다', async () => {
    const both = {
      path: '.codocs\\both.yaml',
      name: '양쪽',
      domains: ['alpha', 'beta'],
    };
    const prompts: RenameChoicePrompt[] = [];
    const host = createHost({
      planRename: vi
        .fn()
        .mockResolvedValueOnce(
          planResponse({
            status: 'unresolved',
            impacts: [
              {
                ...ambiguousImpact(0),
                before: { status: 'ambiguous', candidates: [both, twinB] },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          planResponse({
            status: 'unresolved',
            impacts: [
              {
                ...ambiguousImpact(0, renameChoiceReasons.domainRequired),
                before: { status: 'ambiguous', candidates: [both, twinB] },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(planResponse()),
      choose: vi.fn((prompt: RenameChoicePrompt) => {
        prompts.push(prompt);
        return Promise.resolve(
          prompt.choices.some((choice) => choice.id === both.path)
            ? both.path
            : 'beta',
        );
      }),
    });

    await renameDocument(host);

    expect(prompts[1]).toEqual({
      title: renameMessages.chooseDomainTitle('.codocs/ref.yaml', '[[쌍둥이]]'),
      placeHolder: renameMessages.choosePlaceHolder,
      choices: [
        { id: 'alpha', label: 'alpha' },
        { id: 'beta', label: 'beta' },
      ],
    });
    expect(host.applyRename).toHaveBeenCalledWith(
      [
        {
          sourcePath: refPath,
          occurrenceIndex: 0,
          targetPath: both.path,
          domain: 'beta',
        },
      ],
      expect.anything(),
    );
  });

  it('편집기가 이름 바꾸기를 취소하면 반영하지 않는다', async () => {
    const host = createHost({
      isCancelled: vi.fn(() => true),
    });

    const failure = await renameDocument(host).catch((error: unknown) => error);

    expect((failure as RenameAborted).reason).toBe(
      renameAbortReasons.cancelled,
    );
    expect(host.applyRename).not.toHaveBeenCalled();
  });
});

describe('renameDocument 진행할 수 없는 상태', () => {
  it.each([
    ['name_conflict', '같은 도메인에 새 이름과 같은 문서가 있습니다.'],
    ['unconfirmed', '프로젝트 탐색이 끝나지 않아 이름을 바꿀 수 없습니다.'],
    ['invalid_name', '새 이름이 비어 있습니다.'],
  ])(
    '미리보기가 %s 이유로 blocked이면 반영하지 않고 이유를 안내한다',
    async (blockingReason, reason) => {
      const host = createHost({
        planRename: vi.fn(() =>
          Promise.resolve(
            planResponse({ status: 'blocked', blockingReason, changes: [] }),
          ),
        ),
      });

      const failure = await renameDocument(host).catch(
        (error: unknown) => error,
      );

      expect((failure as RenameAborted).reason).toBe(
        renameAbortReasons.blocked,
      );
      expect((failure as RenameAborted).message).toContain(reason);
      expect(host.applyRename).not.toHaveBeenCalled();
    },
  );

  it('서버가 미리보기 계산에 실패하면 반영하지 않고 서버의 안내를 전달한다', async () => {
    const host = createHost({
      planRename: vi.fn(() =>
        Promise.resolve({
          success: false,
          error: { code: 'index_not_ready', message: '색인을 준비 중입니다.' },
        }),
      ),
    });

    const failure = await renameDocument(host).catch((error: unknown) => error);

    expect((failure as RenameAborted).reason).toBe(
      renameAbortReasons.planFailed,
    );
    expect((failure as RenameAborted).message).toBe(
      renameMessages.planFailed('색인을 준비 중입니다.'),
    );
    expect(host.applyRename).not.toHaveBeenCalled();
  });
});

describe('renameDocument 반영 결과 알림', () => {
  it.each([
    renameApplyErrorCodes.affectedFilesChanged,
    renameApplyErrorCodes.revisionConflict,
  ])(
    '서버가 %s로 반영을 거절하면 파일이 바뀌지 않았고 다시 시작하라고 알린다',
    async (code) => {
      const host = createHost({
        applyRename: vi.fn(() =>
          Promise.resolve({
            success: false,
            saved: false,
            changed: false,
            files: [],
            error: { code, message: '거절' },
          }),
        ),
      });

      await renameDocument(host);

      expect(host.notify).toHaveBeenCalledWith(
        'error',
        renameMessages.applyFailed({ code }, []),
      );
      expect(renameMessages.applyFailed({ code }, [])).toContain('다시 시작');
    },
  );

  it('쓰는 도중 실패하면 파일마다 바뀜·복구됨·복구 실패 상태를 알린다', async () => {
    const files = [
      { path: orderPath, state: renameFileStates.restored },
      { path: refPath, state: renameFileStates.restoreFailed },
    ];
    const host = createHost({
      applyRename: vi.fn(() =>
        Promise.resolve({
          success: false,
          files,
          error: { code: renameApplyErrorCodes.restoreFailed, message: '실패' },
        }),
      ),
    });

    await renameDocument(host);

    const [level, message] = vi.mocked(host.notify).mock.calls[0]!;
    expect(level).toBe('error');
    expect(message).toContain(`${orderPath}(복구됨)`);
    expect(message).toContain(`${refPath}(복구 실패)`);
  });
});

describe('서버 응답 확인', () => {
  it('이름 바꾸기 시작 위치 응답에서 범위와 현재 이름과 대상 경로를 읽는다', () => {
    const value = {
      range: {
        start: { line: 1, character: 6 },
        end: { line: 1, character: 8 },
      },
      placeholder: '주문',
      targetPath: orderPath,
    };

    expect(parsePrepareRenameResponse(value)).toEqual(value);
  });

  it('시작할 수 없는 위치의 null 응답은 undefined로 읽는다', () => {
    expect(parsePrepareRenameResponse(null)).toBeUndefined();
  });

  it('필드가 빠진 미리보기 응답은 확인할 수 없다는 실패로 읽는다', () => {
    expect(parsePlanResponse({ success: true, status: 'ready' })).toEqual({
      failure: '서버 응답을 확인할 수 없습니다.',
    });
  });

  it('형식이 맞지 않는 반영 응답은 실패한 결과로 읽는다', () => {
    expect(parseApplyResponse('x')).toEqual({
      success: false,
      files: [],
      impactCount: 0,
      error: {},
    });
  });
});
