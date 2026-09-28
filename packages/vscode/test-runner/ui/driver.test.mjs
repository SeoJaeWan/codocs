import assert from 'node:assert/strict';
import { test } from 'node:test';
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
      ['keyDown', 'mouseMoved', 'mousePressed', 'mouseReleased', 'keyUp'],
    );
    assert.ok(
      calls
        .slice(0, 4)
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
