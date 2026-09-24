import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { classifyHoverState, observedLoading } from './ui-state.mjs';

const request = {
  windowId: 'session/window-1',
  generation: 2,
  target: 'normal0001',
  expectedBody: 'Expected body',
};
/** 시험 팝업과 창·세대 식별자를 결합한다. */
const state = (popup, overrides = {}) => ({
  windowId: request.windowId,
  generation: request.generation,
  popup,
  ...overrides,
});

describe('Loading 행 관측 시간', /** 전환을 실제로 본 구간만 계산한다. */ () => {
  it('Loading을 보지 않고 본문이 나타나면 시간을 만들지 않는다', /** 직접 본문이 나타난 경우를 검사한다. */ () => {
    assert.deepEqual(
      observedLoading([
        {
          kind: 'dom',
          entered: true,
          monotonicMs: 10,
          popup: { loading: false },
        },
      ]),
      { observed: false, durationMs: null, first: null },
    );
  });
  it('Loading이 계속 보이면 소멸 시간을 추정하지 않는다', /** 종료 전환이 없는 경우를 검사한다. */ () => {
    const loading = {
      kind: 'dom',
      entered: true,
      monotonicMs: 10,
      popup: { loading: true },
    };
    assert.deepEqual(observedLoading([loading]), {
      observed: true,
      durationMs: null,
      first: loading,
    });
  });
  it('Loading이 사라진 첫 전환까지만 재고 이후 본문 완료를 더하지 않는다', /** 완료 전에 Loading이 사라지는 경우를 검사한다. */ () => {
    const result = observedLoading([
      { kind: 'dom', entered: true, monotonicMs: 10, popup: { loading: true } },
      {
        kind: 'dom',
        entered: true,
        monotonicMs: 20,
        popup: { loading: false },
      },
      {
        kind: 'dom',
        entered: true,
        monotonicMs: 35,
        popup: { loading: false },
      },
    ]);
    assert.equal(result.durationMs, 10);
  });
});

describe('Hover DOM 완료 판정', /** 각 팝업 상태를 서로 독립적으로 검증한다. */ () => {
  for (const [name, popup, complete] of [
    [
      '기대 본문만 열린 상태',
      {
        open: true,
        body: 'Expected body',
        loading: false,
        target: request.target,
      },
      true,
    ],
    [
      'Loading만 있는 상태',
      { open: true, body: '', loading: true, target: request.target },
      false,
    ],
    [
      '본문과 Loading이 함께 있는 상태',
      {
        open: true,
        body: 'Expected body',
        loading: true,
        target: request.target,
      },
      false,
    ],
    [
      '빈 본문 상태',
      { open: true, body: '', loading: false, target: request.target },
      false,
    ],
    [
      '다른 본문 상태',
      {
        open: true,
        body: 'Other body',
        loading: false,
        target: request.target,
      },
      false,
    ],
    [
      '닫힌 팝업 상태',
      {
        open: false,
        body: 'Expected body',
        loading: false,
        target: request.target,
      },
      false,
    ],
    [
      '본문에 일반 Loading 문자가 있는 상태',
      {
        open: true,
        body: 'Expected body Loading details',
        loading: false,
        target: request.target,
      },
      true,
    ],
  ])
    it(`${name}를 관측하면 기대 완료 상태를 반환한다`, /** 입력 상태의 완료 여부를 검사한다. */ () => {
      assert.equal(
        classifyHoverState(state(popup), request).complete,
        complete,
      );
    });

  it('이전 요청 세대의 팝업을 관측하면 완료하지 않는다', /** 요청 세대가 다른 상태를 검사한다. */ () => {
    assert.equal(
      classifyHoverState(
        state(
          {
            open: true,
            body: 'Expected body',
            loading: false,
            target: request.target,
          },
          { generation: 1 },
        ),
        request,
      ).complete,
      false,
    );
  });
  it('다른 창의 팝업을 관측하면 완료하지 않는다', /** 창 식별자가 다른 상태를 검사한다. */ () => {
    assert.equal(
      classifyHoverState(
        state(
          {
            open: true,
            body: 'Expected body',
            loading: false,
            target: request.target,
          },
          { windowId: 'other/window' },
        ),
        request,
      ).complete,
      false,
    );
  });
  it('다른 대상의 팝업을 관측하면 완료하지 않는다', /** 대상 식별자가 다른 상태를 검사한다. */ () => {
    assert.equal(
      classifyHoverState(
        state({
          open: true,
          body: 'Expected body',
          loading: false,
          target: 'other',
        }),
        request,
      ).complete,
      false,
    );
  });
  it('본문 행과 정확한 Loading 행이 함께 있으면 완료하지 않는다', /** 행 구조의 정확한 진행 표시를 검사한다. */ () => {
    const popup = {
      open: true,
      target: request.target,
      rows: [
        { hasContents: true, contentsText: 'Loading...', body: 'Loading...' },
        {
          hasContents: true,
          contentsText: 'Expected body',
          body: 'Expected body',
        },
      ],
    };
    assert.equal(classifyHoverState(state(popup), request).complete, false);
  });
  it('본문 행에 Loading 문자가 포함돼도 완료한다', /** 부분 문자열을 진행 상태로 처리하지 않는다. */ () => {
    const popup = {
      open: true,
      target: request.target,
      rows: [
        {
          hasContents: true,
          contentsText: 'Expected body Loading detail',
          body: 'Expected body Loading detail',
        },
      ],
    };
    assert.equal(classifyHoverState(state(popup), request).complete, true);
  });
});
