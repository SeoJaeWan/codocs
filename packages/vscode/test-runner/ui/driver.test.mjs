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

test('fresh Hover contents and a changed opaque href do not satisfy readiness while native target label is still Old', /** 독립 native 링크의 실제 대상 표시가 바뀌기 전에는 준비를 완료하지 않는다. */ async () => {
  const calls = [];
  let observations = 0;
  const oldHref = 'command:codocs.openSource?opaque-renewed-old';
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
                label:
                  ++observations < 3
                    ? '원문 열기: Old (.codocs/old.yaml)'
                    : '원문 열기: Direct (.codocs/direct.yaml)',
                title: 'Execute command codocs.openSource',
                href: observations < 3 ? oldHref : newHref,
              },
            ],
          };
  const state = await driver.hover('[[Direct]]', 'Direct', 0, {
    providerLabel: 'Direct',
    nativeLabel: '원문 열기: Direct (.codocs/direct.yaml)',
  });
  assert.equal(observations, 3);
  assert.equal(state.anchors[1].href, newHref);
  assert.ok(calls.every((call) => call.params.type === 'mouseMoved'));
});

test('native-only tooltip without a loading row waits for the exact provider anchor', /** native와 provider의 독립 렌더링 완료를 검증한다. */ async () => {
  const calls = [];
  let observations = 0;
  const driver = new RendererDriver(
    /** 실제 준비 입력만 수집한다. */ async (method, params) =>
      calls.push({ method, params }),
    'darwin',
  );
  driver.dismiss = /** 이전 Hover 준비를 격리한다. */ async () => {};
  driver.evaluate =
    /** native 안내가 먼저 뜨고 provider 후보는 나중에 렌더링된다. */ async (
      fn,
    ) =>
      fn.name === 'textPoint'
        ? { x: 30, y: 40 }
        : {
            body: '원문 열기: Zone (.codocs/zone %20 한글#.yaml)',
            loading: false,
            anchors: [
              {
                label: '원문 열기: Zone (.codocs/zone %20 한글#.yaml)',
                title: 'Execute command codocs.openSource',
                href: 'command:codocs.openSource?opaque-native',
              },
              ...(++observations < 3
                ? []
                : [
                    {
                      label: 'Zone',
                      title: 'Hover provider',
                      href: 'command:codocs.openSource?opaque-provider',
                    },
                  ]),
            ],
          };
  const state = await driver.hover('[[Zone]]', 'Zone', 0, {
    providerLabel: 'Zone',
    nativeLabel: '원문 열기: Zone (.codocs/zone %20 한글#.yaml)',
  });
  assert.equal(observations, 3);
  assert.equal(state.anchors[1].label, 'Zone');
  assert.ok(calls.every((call) => call.params.type === 'mouseMoved'));
});

for (const platform of ['win32', 'darwin']) {
  for (const [name, gesture, text] of [
    [
      'Inlay label',
      /** 렌더링된 Inlay label을 클릭한다. */ (driver) =>
        driver.inlayLink('문서 전체에 연결된 코드 · 1곳'),
      '문서 전체에 연결된 코드 · 1곳',
    ],
    [
      'non-link text',
      /** 링크로 감지되지 않는 문자를 클릭한다. */ (driver) =>
        driver.modifierClick('@codocs [[Absent]]'),
      '@codocs [[Absent]]',
    ],
  ]) {
    test(`${platform} ${name} click locates the rendered text, holds the modifier through press/release without waiting for link detection`, /** OS 입력 순서와 수정 키 유지를 검증한다. */ async () => {
      const calls = [];
      const lookups = [];
      const driver = new RendererDriver(
        /** 실제 전송 순서를 수집한다. */ async (method, params) => {
          calls.push({ method, params });
        },
        platform,
      );
      driver.dismiss = /** 이전 화면 상태를 준비한다. */ async () => {};
      driver.evaluate =
        /** 표시된 문자 좌표만 공급하며 링크 감지 조회는 없다. */ async (
          fn,
          argument,
        ) => {
          lookups.push({ name: fn.name, argument });
          return { x: 40, y: 50 };
        };
      await gesture(driver);
      assert.deepEqual(lookups, [
        { name: 'textPoint', argument: { text, occurrence: 0 } },
      ]);
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
      const modifier = linkModifier(platform);
      assert.equal(calls[0].params.key, modifier.key);
      assert.ok(
        calls
          .slice(0, 5)
          .every((call) => call.params.modifiers === modifier.modifiers),
      );
      assert.ok(
        calls
          .slice(1, 5)
          .every((call) => call.params.x === 40 && call.params.y === 50),
      );
      assert.equal(calls.at(-1).params.modifiers, 0);
    });
  }
  test(`${platform} Inlay label click releases its modifier when the press fails`, /** 입력 실패에서도 수정 키를 해제하는지 검증한다. */ async () => {
    const calls = [];
    const driver = new RendererDriver(
      /** 클릭 입력 실패를 재현한다. */ async (method, params) => {
        calls.push({ method, params });
        if (params.type === 'mousePressed') throw new Error('input lost');
      },
      platform,
    );
    driver.dismiss = /** 이전 화면 상태를 준비한다. */ async () => {};
    driver.evaluate = /** 표시된 문자 좌표를 공급한다. */ async () => ({
      x: 40,
      y: 50,
    });
    await assert.rejects(driver.inlayLink('label'), /input lost/u);
    assert.equal(calls.at(-1).params.type, 'keyUp');
    assert.equal(calls.at(-1).params.modifiers, 0);
  });
}

test('text input is delivered as real renderer input', /** 입력 문자의 전송을 검증한다. */ async () => {
  const calls = [];
  const driver = new RendererDriver(
    /** 전송 내용을 수집한다. */ async (method, params) => {
      calls.push({ method, params });
    },
    'win32',
  );
  await driver.insertText('새 이름');
  assert.deepEqual(calls, [
    { method: 'Input.insertText', params: { text: '새 이름' } },
  ]);
});

test('quick input choice clicks the single row containing the text with real mouse events', /** 선택 목록 항목 클릭 입력을 검증한다. */ async () => {
  const calls = [];
  const driver = new RendererDriver(
    /** 클릭 입력을 수집한다. */ async (method, params) => {
      calls.push({ method, params });
    },
    'win32',
  );
  driver.evaluate = /** 표시된 선택 목록 항목을 공급한다. */ async () => [
    { text: 'Twin alpha', x: 10, y: 20, visible: true },
    { text: 'Twin beta', x: 10, y: 40, visible: true },
  ];
  assert.equal((await driver.chooseQuickInput('beta')).y, 40);
  assert.deepEqual(
    calls.map((call) => call.params.type),
    ['mouseMoved', 'mousePressed', 'mouseReleased'],
  );
  assert.ok(calls.every((call) => call.params.y === 40));
});

test('quick input choice refuses a text that matches several rows', /** 모호한 항목 선택 거부를 검증한다. */ async () => {
  const driver = new RendererDriver(
    /** 입력 전송은 사용하지 않는다. */ async () => {},
    'win32',
  );
  driver.evaluate = /** 같은 문구를 가진 두 항목을 공급한다. */ async () => [
    { text: 'Twin alpha', x: 10, y: 20, visible: true },
    { text: 'Twin alpha', x: 10, y: 40, visible: true },
  ];
  await assert.rejects(driver.chooseQuickInput('Twin'), /got 2/u);
});

test('text click moves the pointer to the rendered text and presses with real mouse events', /** 문자 범위 클릭 입력을 검증한다. */ async () => {
  const calls = [];
  const driver = new RendererDriver(
    /** 클릭 입력을 수집한다. */ async (method, params) => {
      calls.push({ method, params });
    },
    'win32',
  );
  driver.dismiss = /** 이전 화면 상태를 준비한다. */ async () => {};
  driver.evaluate = /** 표시된 문자 좌표를 공급한다. */ async () => ({
    x: 70,
    y: 80,
  });
  await driver.clickText('Rename Twin');
  assert.deepEqual(
    calls.map((call) => call.params.type),
    ['mouseMoved', 'mousePressed', 'mouseReleased'],
  );
  assert.ok(
    calls.every((call) => call.params.x === 70 && call.params.y === 80),
  );
});
