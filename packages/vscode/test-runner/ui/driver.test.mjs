import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { linkModifier, RendererDriver } from './driver.mjs';

test('panel anchor click sends real mouse move, press and release without decoding href', /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => {
  const calls = [];
  const href =
    'command:codocs.openSource?%5B%7B%22sourceUri%22%3A%22file%3A%2F%2FC%3A%2Fa%2520%23%ED%95%9C%22%7D%5D';
  const driver = new RendererDriver(
    /** 입력 계약의 성공·실패 관측을 검증한다. */ async (method, params) => {
      calls.push({ method, params });
      return {
        result: {
          value: {
            anchors: [
              { label: '원문 열기', href, visible: true, x: 20, y: 30 },
            ],
          },
        },
      };
    },
    'win32',
  );
  assert.equal((await driver.clickAnchor('원문 열기', href)).href, href);
  assert.deepEqual(
    calls.slice(1).map((call) => call.params.type),
    ['mouseMoved', 'mousePressed', 'mouseReleased'],
  );
  assert.deepEqual(
    calls.slice(1).map((call) => call.method),
    Array(3).fill('Input.dispatchMouseEvent'),
  );
  assert.equal(calls[2].params.buttons, 1);
  assert.equal(calls[3].params.buttons, 0);
});

test('anchor lookup refuses ambiguous or replaced rendered anchors', /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => {
  const anchor = { label: 'target', href: 'command:opaque-old', visible: true };
  const driver = new RendererDriver(
    /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => ({
      result: { value: { anchors: [anchor, anchor] } },
    }),
    'win32',
  );
  await assert.rejects(driver.clickAnchor('target'), /got 2/u);
  await assert.rejects(
    driver.clickAnchor('target', 'command:opaque-new'),
    /got 0/u,
  );
});

for (const platform of ['win32', 'darwin']) {
  test(`${platform} YAML gesture keeps the modifier until the mouse release`, /** OS 입력 순서와 수정 키 해제를 검증한다. */ async () => {
    const calls = [];
    const driver = new RendererDriver(
      /** 실제 전송 순서를 수집한다. */ async (method, params) => {
        calls.push({ method, params });
      },
      platform,
    );
    driver.dismiss = /** 이전 화면 상태를 준비한다. */ async () => {};
    driver.evaluate = /** 화면에 보이는 링크 좌표를 제공한다. */ async () => ({
      x: 40,
      y: 50,
    });
    await driver.yamlLink('[[Zone]]');
    assert.deepEqual(
      calls.map((call) => call.params.type),
      [
        'keyDown',
        'mouseMoved',
        'mouseMoved',
        'mousePressed',
        'mouseReleased',
        'keyUp',
      ],
    );
    assert.ok(
      calls
        .slice(0, 5)
        .every(
          (call) => call.params.modifiers === linkModifier(platform).modifiers,
        ),
    );
    assert.equal(calls.at(-1).params.modifiers, 0);
  });
  test(`${platform} YAML click holds its OS modifier through press/release and releases it on failure`, /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => {
    const calls = [];
    const driver = new RendererDriver(
      /** 입력 계약의 성공·실패 관측을 검증한다. */ async (method, params) => {
        calls.push({ method, params });
        if (params.type === 'mousePressed') throw new Error('input lost');
      },
      platform,
    );
    driver.dismiss =
      /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => {};
    driver.evaluate =
      /** 입력 계약의 성공·실패 관측을 검증한다. */ async () => ({
        x: 40,
        y: 50,
      });
    await assert.rejects(driver.yamlLink('[[Zone]]'), /input lost/u);
    const modifier = linkModifier(platform);
    assert.equal(calls[0].params.key, modifier.key);
    assert.equal(calls[0].params.modifiers, modifier.modifiers);
    assert.equal(calls[2].params.modifiers, modifier.modifiers);
    assert.equal(calls.at(-1).params.type, 'keyUp');
    assert.equal(calls.at(-1).params.modifiers, 0);
  });
}

test('unsupported gestures fail instead of selecting a platform default', () => {
  assert.throws(() => linkModifier('linux'), /Unsupported/u);
});

test('clipped anchor receives real wheel input before a single click of the retained href', /** 실제 화면 관측과 입력 순서를 확인한다. */ async () => {
  const calls = [];
  let observations = 0;
  const href = 'command:opaque-retained';
  const driver = new RendererDriver(
    /** 실제 화면 관측과 입력 순서를 확인한다. */ async (method, params) => {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate')
        return {
          result: {
            value: {
              anchors: [
                {
                  label: 'Referrer',
                  href,
                  visible: ++observations > 1,
                  x: 20,
                  y: 30,
                  scroll: { x: 20, y: 10, deltaY: 100 },
                },
              ],
            },
          },
        };
    },
    'darwin',
  );
  assert.equal((await driver.clickAnchor('Referrer', href)).href, href);
  assert.deepEqual(
    calls
      .filter((call) => call.method === 'Input.dispatchMouseEvent')
      .map((call) => call.params.type),
    ['mouseWheel', 'mouseMoved', 'mousePressed', 'mouseReleased'],
  );
});

test('Hover waits for provider readiness without nested timeout failure or repeating clicks', /** 실제 화면 관측과 입력 순서를 확인한다. */ async () => {
  const calls = [];
  let states = 0;
  const driver = new RendererDriver(
    /** 실제 화면 관측과 입력 순서를 확인한다. */ async (method, params) =>
      calls.push({ method, params }),
    'win32',
  );
  driver.dismiss = /** 실제 화면 관측과 입력 순서를 확인한다. */ async () => {};
  driver.evaluate = /** 실제 화면 관측과 입력 순서를 확인한다. */ async (fn) =>
    fn.name === 'textPoint'
      ? { x: 30, y: 40 }
      : ++states > 2
        ? { body: 'Ready body', loading: false, anchors: [] }
        : null;
  assert.equal((await driver.hover('zone', 'Ready body')).body, 'Ready body');
  assert.deepEqual(
    calls.map((call) => call.params.type),
    ['mouseMoved', 'mouseMoved'],
  );
});

test('renderer observes opaque data-href and clips anchor hit point to the Hover viewport', /** 실제 DOM 속성과 가려진 앵커 좌표를 검증한다. */ async () => {
  const href = 'command:codocs.openSource?opaque%2520';
  const rect = {
    left: 20,
    right: 60,
    top: 30,
    bottom: 45,
    width: 40,
    height: 15,
  };
  const popup = {
    parentElement: null,
    /** 실제 Hover viewport를 준비한다. */
    getBoundingClientRect: () => ({
      left: 0,
      right: 100,
      top: 0,
      bottom: 40,
      width: 100,
      height: 40,
    }),
    /** 렌더러의 본문과 앵커를 공급한다. */
    querySelectorAll: (selector) =>
      selector === '.hover-row'
        ? [
            {
              innerText: 'Ready',
              /** 완료한 본문을 공급한다. */
              querySelector: () => ({
                textContent: 'Ready',
              }),
            },
          ]
        : [node],
  };
  const node = {
    parentElement: popup,
    textContent: '원문 열기',
    /** 일부가 가려진 앵커를 준비한다. */
    getBoundingClientRect: () => rect,
    /** 렌더러가 보존한 링크 속성만 공급한다. */
    getAttribute: (key) =>
      ({
        href: '',
        'data-href': href,
        title: 'Execute command codocs.openSource',
      })[key],
    /** 실제 포인터가 앵커에 닿는지 공급한다. */
    closest: () => node,
  };
  const driver = new RendererDriver(
    /** 실제 renderer 관측 함수를 격리 DOM에서 실행한다. */ async (
      method,
      params,
    ) => ({
      result: {
        value: runInNewContext(params.expression, {
          innerWidth: 100,
          innerHeight: 100,
          /** Hover의 실제 clipping 속성을 공급한다. */
          getComputedStyle: () => ({
            visibility: 'visible',
            overflow: 'hidden',
            overflowX: '',
            overflowY: '',
          }),
          document: {
            /** 표시 중인 Hover만 공급한다. */
            querySelectorAll: () => [popup],
            /** 현재 앵커의 hit target을 공급한다. */
            elementFromPoint: () => node,
          },
        }),
      },
    }),
    'win32',
  );
  let hover;
  driver.click = /** 클릭 전에 실제 관측 결과만 수집한다. */ async (anchor) => {
    hover = anchor;
  };
  await driver.clickAnchor('원문 열기', href);
  assert.equal(hover.href, href);
  assert.equal(hover.visible, true);
  assert.equal(hover.y, 35);
});

test('fresh Hover contents do not satisfy readiness while native DocumentLink still has the pre-edit href', /** 독립 native 링크가 바뀌기 전에는 클릭 준비를 완료하지 않는다. */ async () => {
  const calls = [];
  let observations = 0;
  const oldHref = 'command:codocs.openSource?opaque-old';
  const newHref = 'command:codocs.openSource?opaque-new';
  const driver = new RendererDriver(
    /** 준비 중 실제 포인터 입력만 수집한다. */ async (method, params) =>
      calls.push({ method, params }),
    'win32',
  );
  driver.dismiss = /** 직전 Hover 준비를 격리한다. */ async () => {};
  driver.evaluate =
    /** fresh Hover와 지연된 native 링크의 서로 다른 관측을 공급한다. */ async (
      fn,
    ) =>
      fn.name === 'textPoint'
        ? { x: 30, y: 40 }
        : {
            body: 'Direct body',
            loading: false,
            anchors: [
              {
                label: 'Direct',
                title: 'Hover provider',
                href: 'command:codocs.openSource?opaque-fresh-hover',
              },
              {
                label: 'Execute command',
                title: 'Execute command codocs.openSource',
                href: ++observations < 3 ? oldHref : newHref,
              },
            ],
          };
  const state = await driver.hover('[[Direct]]', 'Direct', 0, {
    previousHref: oldHref,
  });
  assert.equal(observations, 3);
  assert.equal(state.anchors[1].href, newHref);
  assert.ok(calls.every((call) => call.params.type === 'mouseMoved'));
});
