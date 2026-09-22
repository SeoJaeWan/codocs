import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

const emptyTopSelection = [
  {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
    empty: true,
  },
];

test.describe('미저장 출처와 갱신 중 클릭', /** 편집과 변경 반영의 사용자 경로를 검증한다. */ () => {
  test('미저장 코드 식별자를 바꾸면 새 식별자의 설명을 표시한다', /** 원본 디스크를 보존하며 최신 편집 내용을 호버한다. */ async ({
    ui,
  }) => {
    const edited = 'readySignal();\ndirect();\n';
    await ui.replace(edited);
    const hover = await ui.hover('direct()', 'Direct body');
    await expect(hover).not.toContainText('Zone body');
    expect((await ui.state()).active.dirty).toBe(true);
    expect(await readFile(path.join(ui.root, 'source.java'), 'utf8')).toContain(
      'zoneAuxiliary',
    );
  });

  test('미저장 참조를 일반 문서로 바꾸면 폐기 경고를 제거하고 새 링크를 연다', /** 변경한 본문에 맞는 진단과 실제 링크를 확인한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/old-source.yaml');
    await ui.hover('[[Old]]', 'deprecated_reference');
    await ui.replace(
      'id: old-source\nname: Old Source\ndefinition: Body [[Zone]]\ndomains: [test]\n',
    );
    await expect
      .poll(
        /** 입력과 관측 결과의 계약을 검증한다. */ async () =>
          (await ui.state()).diagnostics.filter(
            (diagnostic) =>
              diagnostic.uri === ui.uri('.codocs/old-source.yaml') &&
              diagnostic.code === 'deprecated_reference',
          ),
      )
      .toEqual([]);
    await expect(ui.page.locator('.view-lines .detected-link')).toHaveCount(1);
    await ui.follow('[[Zone]]');
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/zone.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
  });

  test('변경 반영 중 기존 링크를 클릭해도 오래된 본문이나 다른 문서로 열지 않는다', /** 미확정 클릭의 안전성을 완료 관측 뒤의 이동 성공과 분리한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('zoneAuxiliary', 'Zone body');
    const updated =
      'id: zone\nname: Zone\ndefinition: In flight change\ndomains: [test]\n';
    await writeFile(path.join(ui.root, '.codocs/zone.yaml'), updated);
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    const opened = [];
    const until = Date.now() + 2500;
    await expect
      .poll(
        /** 입력과 관측 결과의 계약을 검증한다. */ async () => {
          const active = (await ui.state()).active;
          if (active.uri !== ui.uri('source.java'))
            opened.push({ uri: active.uri, text: active.text });
          return Date.now() >= until;
        },
        { timeout: 5000, intervals: [100] },
      )
      .toBe(true);
    for (const observation of opened)
      expect(observation).toEqual({
        uri: ui.uri('.codocs/zone.yaml'),
        text: updated,
      });
    await expect(
      ui.page.locator('.notifications-toasts .notification-toast'),
    ).toHaveCount(0);
  });
});

test.describe('코드 호버와 관계별 원문 링크', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ () => {
  test('코드에 호버하면 본문·현재 ID·도메인과 세 종류의 연결을 표시한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('zoneAuxiliary', 'Zone body');
    // 한 번 렌더링된 호버의 속성들을 같은 DOM 관측에서 비교한다.
    // 항목마다 별도 대기해 호버가 계속 떠 있어야 한다는 계약을 추가하지 않는다.
    const rendered = await hover.evaluate(
      /** 실제 화면의 본문과 링크 텍스트를 함께 읽는다. */ (element) => ({
        text: element.innerText,
        links: [...element.querySelectorAll('a')].map(
          (link) => link.textContent,
        ),
      }),
    );
    expect(rendered.text).toContain('현재 ID: zone');
    expect(rendered.text).toContain('도메인: test');
    expect(rendered.text).toContain('함께 매칭된 용어');
    expect(rendered.text).toContain('이 문서가 참조');
    expect(rendered.text).toContain('이 문서를 참조');
    expect(rendered.links.filter((name) => name === 'Auxiliary')).toHaveLength(
      1,
    );
    expect(rendered.links.filter((name) => name === 'Direct')).toHaveLength(1);
    expect(rendered.links.filter((name) => name === 'Referrer')).toHaveLength(
      1,
    );
    expect(rendered.text).not.toContain('Auxiliary body');
    expect(rendered.text).not.toContain('Direct body');
  });

  for (const [name, target] of [
    ['원문 열기', 'zone'],
    ['Auxiliary', 'auxiliary'],
    ['Direct', 'direct'],
    ['Referrer', 'referrer'],
  ]) {
    test(`호버의 ${name} 링크를 클릭하면 해당 문서 상단을 연다`, /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
      ui,
    }) => {
      const hover = await ui.hover('zoneAuxiliary', 'Zone body');
      await hover.getByRole('link', { name, exact: true }).click();
      await expect
        .poll(async () => (await ui.state()).active?.uri)
        .toBe(ui.uri(`.codocs/${target}.yaml`));
      await expect
        .poll(async () => (await ui.state()).active?.selections)
        .toEqual(emptyTopSelection);
    });
  }

  test('현재 ID 중복 후보에 호버하면 모든 후보와 정상 보조 링크를 유지한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('duplicateAuxiliary', 'duplicate-a.yaml');
    await expect(hover).toContainText('duplicate-b.yaml');
    await expect(hover).toContainText('test');
    await expect(
      hover.getByRole('link', { name: 'Auxiliary', exact: true }),
    ).toHaveCount(1);
    await expect(hover).not.toContainText('First duplicate body');
    await expect(hover).not.toContainText('Second duplicate body');
  });

  test('이전 ID에 호버하면 현재 ID와 이전 ID 안내를 표시한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('previous()', 'Current body');
    await expect(hover).toContainText('현재 ID: current');
    await expect(hover).toContainText('이전 ID입니다');
  });

  test('같은 식별자의 다른 출현이 이전 ID이면 그 안내를 유지한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('currentPrevious', 'Current body');
    await expect(hover).toContainText('같은 식별자의 다른 위치');
    await expect(hover).toContainText('이전 ID입니다');
  });

  test('필수 필드가 없는 문서에 호버하면 오류와 원문 링크를 유지한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('broken()', 'Broken');
    await expect(hover).toContainText('오류');
    await expect(hover).toContainText('expected string, received undefined');
    await expect(
      hover.getByRole('link', { name: '원문 열기', exact: true }),
    ).toHaveCount(1);
  });

  test('현재 ID 형식이 잘못된 문서도 이전 ID 호버에서 확인한 본문을 유지한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('legacyInvalid', 'Invalid body retained');
    await expect(hover).toContainText('현재 ID를 확인할 수 없습니다');
    await expect(hover).toContainText(
      'ID는 소문자·숫자를 하이픈으로 연결해야 합니다',
    );
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/invalid.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
  });

  test('완전한 관측에서 매칭이 없으면 Codocs 설명이나 링크를 표시하지 않는다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const point = await ui.point('utterlyUnmatched');
    await ui.page.mouse.move(point.x, point.y);
    const until = Date.now() + 1500;
    await expect
      .poll(
        async () => {
          await expect(ui.page.locator('.monaco-hover:visible')).toHaveCount(0);
          return Date.now() >= until;
        },
        { intervals: [100] },
      )
      .toBe(true);
  });
});

test.describe('YAML 본문 참조의 사용자 입력', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ () => {
  for (const occurrence of [0, 1, 2]) {
    test(`본문·예시의 ${occurrence + 1}번째 참조를 Cmd/Ctrl+클릭하면 대상 상단을 연다`, /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
      ui,
    }) => {
      await ui.open('.codocs/source.yaml');
      await expect(ui.page.locator('.view-lines .detected-link')).toHaveCount(
        3,
      );
      await ui.follow('[[Zone]]', occurrence);
      await expect
        .poll(async () => (await ui.state()).active?.uri)
        .toBe(ui.uri('.codocs/zone.yaml'));
      await expect
        .poll(async () => (await ui.state()).active?.selections)
        .toEqual(emptyTopSelection);
    });
  }

  test('메타데이터의 같은 표기를 Cmd/Ctrl+클릭해도 원문을 열지 않는다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/source.yaml');
    await expect(ui.page.locator('.view-lines .detected-link')).toHaveCount(3);
    await ui.follow('[[Zone]]', 3);
    expect(await ui.observeNavigation('.codocs/source.yaml')).toEqual([]);
  });

  test('복수 후보의 본문을 Cmd/Ctrl+클릭해도 파일이나 선택 창을 열지 않는다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/ambiguous.yaml');
    await ui.hover('[[Twin]]', 'twin-a.yaml');
    await ui.page.keyboard.press('Escape');
    await ui.follow('[[Twin]]');
    expect(await ui.observeNavigation('.codocs/ambiguous.yaml')).toEqual([]);
  });

  for (const target of ['a', 'b']) {
    test(`복수 후보 호버에서 ${target}를 선택하면 선택한 원문만 연다`, /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
      ui,
    }) => {
      await ui.open('.codocs/ambiguous.yaml');
      const hover = await ui.hover('[[Twin]]', 'twin-a.yaml');
      await expect(hover).toContainText('alpha');
      await expect(hover).toContainText('beta');
      await hover
        .getByRole('link')
        .filter({ hasText: `twin-${target}.yaml` })
        .click();
      await expect
        .poll(async () => (await ui.state()).active?.uri)
        .toBe(ui.uri(`.codocs/twin-${target}.yaml`));
      await expect
        .poll(async () => (await ui.state()).active?.selections)
        .toEqual(emptyTopSelection);
      expect(
        (await ui.state()).tabs.some(
          (tab) =>
            tab.uri ===
            ui.uri(`.codocs/twin-${target === 'a' ? 'b' : 'a'}.yaml`),
        ),
      ).toBe(false);
    });
  }

  test('현재 ID가 잘못된 대상도 확정한 이름 참조 링크로 연다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/invalid-source.yaml');
    await expect(ui.page.locator('.view-lines .detected-link')).toHaveCount(1);
    await ui.follow('[[Invalid]]');
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/invalid.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
  });

  test('미저장 본문 편집 후에는 새 위치의 참조 링크로 이동한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/source.yaml');
    const edited =
      'id: source\nname: Source\ndefinition: |\n  shifted\n  [[Direct]]\ndomains: [test]\n';
    await ui.replace(edited);
    await expect(ui.page.locator('.view-lines .detected-link')).toHaveCount(1);
    await ui.follow('[[Direct]]');
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/direct.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
    const source = (await ui.state()).documents.find(
      (document) => document.uri === ui.uri('.codocs/source.yaml'),
    );
    expect(source.text).toBe(edited);
    expect(source.dirty).toBe(true);
    expect(
      await readFile(path.join(ui.root, '.codocs/source.yaml'), 'utf8'),
    ).toContain('[[Zone]]');
  });
});

test.describe('변경된 대상과 기존 탭', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ () => {
  test('대상 본문이 변경된 뒤 호버를 다시 열면 새 설명을 표시한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.hover('zoneAuxiliary', 'Zone body');
    await ui.page.keyboard.press('Escape');
    await writeFile(
      path.join(ui.root, '.codocs/zone.yaml'),
      'id: zone\nname: Zone\ndefinition: Updated zone body\ndomains: [test]\n',
    );
    const hover = await ui.hover('zoneAuxiliary', 'Updated zone body');
    await expect(hover).not.toContainText('Zone body');
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/zone.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
  });

  test('본문 변경의 완료 관측 후에도 남은 링크로 최신 원문을 연다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('zoneAuxiliary', 'Zone body');
    const snapshotBefore = await ui.snapshotCount();
    expect(snapshotBefore).toBeGreaterThan(0);
    const updated =
      'id: zone\nname: Zone\ndefinition: Changed after hover\ndomains: [test]\n';
    await writeFile(path.join(ui.root, '.codocs/zone.yaml'), updated);
    await expect.poll(() => ui.snapshotCount()).toBeGreaterThan(snapshotBefore);
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/zone.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
    expect((await ui.state()).active.text).toBe(updated);
  });

  test('대상이 이동한 뒤 새 호버 링크를 누르면 확인한 새 경로를 연다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.hover('zoneAuxiliary', 'Zone body');
    await ui.page.keyboard.press('Escape');
    await rename(
      path.join(ui.root, '.codocs/zone.yaml'),
      path.join(ui.root, '.codocs/moved.yaml'),
    );
    const hover = await ui.hover('zoneAuxiliary', 'Zone body');
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/moved.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
  });

  test('삭제된 대상의 남은 링크를 눌러도 예전 경로의 다른 문서를 열지 않는다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('zoneAuxiliary', 'Zone body');
    await unlink(path.join(ui.root, '.codocs/zone.yaml'));
    await writeFile(
      path.join(ui.root, '.codocs/zone.yaml'),
      'id: replacement\nname: Replacement\ndefinition: Wrong target\ndomains: [test]\n',
    );
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    expect(await ui.observeNavigation('source.java')).toEqual([]);
    expect(
      (await ui.state()).tabs.some(
        (tab) => tab.uri === ui.uri('.codocs/zone.yaml'),
      ),
    ).toBe(false);
  });

  test('대상 삭제를 확인한 새 호버에서는 해당 설명과 원문 링크를 제거한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.hover('zoneAuxiliary', 'Zone body');
    await ui.page.keyboard.press('Escape');
    await unlink(path.join(ui.root, '.codocs/zone.yaml'));
    const hover = await ui.hover('zoneAuxiliary', 'Auxiliary body', 0, 6);
    await expect(hover).not.toContainText('Zone body');
    await expect(
      hover.getByRole('link', { name: 'Zone', exact: true }),
    ).toHaveCount(0);
  });

  test('열린 원문의 미저장 편집과 디스크를 보존하고 기존 탭 상단으로 이동한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/zone.yaml');
    const original = await readFile(
      path.join(ui.root, '.codocs/zone.yaml'),
      'utf8',
    );
    const dirty = original + '# unsaved UI edit\n';
    await ui.replace(dirty);
    const tabsBefore = (await ui.state()).tabs.filter(
      (tab) => tab.uri === ui.uri('.codocs/zone.yaml'),
    ).length;
    await ui.open('source.java');
    const hover = await ui.hover('zoneAuxiliary', 'Zone body');
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/zone.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
    const state = await ui.state();
    expect(state.active.text).toBe(dirty);
    expect(state.active.dirty).toBe(true);
    expect(
      state.tabs.filter((tab) => tab.uri === ui.uri('.codocs/zone.yaml')),
    ).toHaveLength(tabsBefore);
    expect(
      await readFile(path.join(ui.root, '.codocs/zone.yaml'), 'utf8'),
    ).toBe(original);
  });
});

test.describe('부분 관측의 화면과 확인된 원문', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ () => {
  test.use({ partial: true });
  test('부분 탐색이어도 호버의 안내와 확인한 후보 원문 링크를 유지한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    const hover = await ui.hover('zoneAuxiliary', '일부 문서');
    await expect(hover).toContainText('Zone body');
    await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/zone.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
  });
});

test.describe('진단 표시와 링크의 공존', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ () => {
  test('폐기 문서 참조에 호버하면 경고를 표시하면서 링크 이동은 유지한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/old-source.yaml');
    const hover = await ui.hover('[[Old]]', '폐기 상태');
    await expect(hover).toContainText('deprecated_reference');
    await expect
      .poll(
        /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async () =>
          (await ui.state()).diagnostics
            .filter(
              (diagnostic) =>
                diagnostic.uri === ui.uri('.codocs/old-source.yaml') &&
                diagnostic.code === 'deprecated_reference',
            )
            .map((diagnostic) => diagnostic.severity),
      )
      .toEqual([1]);
    await ui.page.keyboard.press('Escape');
    await ui.follow('[[Old]]');
    await expect
      .poll(async () => (await ui.state()).active?.uri)
      .toBe(ui.uri('.codocs/old.yaml'));
    await expect
      .poll(async () => (await ui.state()).active?.selections)
      .toEqual(emptyTopSelection);
  });

  test('대상의 폐기 상태를 해제하면 화면 경고도 갱신한다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/old-source.yaml');
    await ui.hover('[[Old]]', 'deprecated_reference');
    await ui.page.keyboard.press('Escape');
    await writeFile(
      path.join(ui.root, '.codocs/old.yaml'),
      'id: old\nname: Old\ndefinition: Active again\ndomains: [test]\n',
    );
    await expect
      .poll(
        /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async () =>
          (await ui.state()).diagnostics.filter(
            (diagnostic) =>
              diagnostic.uri === ui.uri('.codocs/old-source.yaml') &&
              diagnostic.code === 'deprecated_reference',
          ).length,
      )
      .toBe(0);
    await ui.page.keyboard.press(`${ui.modifier}+Shift+m`);
    await expect(ui.page.locator('.part.panel:visible').first()).toBeVisible();
    await expect(
      ui.page.locator('.part.panel:visible').first(),
    ).not.toContainText('폐기 상태의 문서를 참조');
  });

  test('현재 ID의 중복 이전 ID 등록은 YAML 경고만 표시하고 코드에서는 숨긴다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/current.yaml');
    const hover = await ui.hover('current', '이전 ID가 현재 ID와 같습니다', 1);
    await expect(hover).toContainText('codocs');
    await ui.open('source.java');
    await ui.replace('readySignal();\ncurrent();\n');
    const codeHover = await ui.hover('current()', 'Current body');
    await expect(codeHover).not.toContainText('이전 ID입니다');
  });

  test('없는 이름 참조에는 진단이 표시되고 이동 링크는 없다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('.codocs/missing.yaml');
    const hover = await ui.hover(
      '[[Absent]]',
      '참조 이름에 해당하는 문서가 없습니다',
    );
    await expect(hover).toContainText('reference_not_found');
    await expect(ui.page.locator('.view-lines .detected-link')).toHaveCount(0);
    await ui.page.keyboard.press('Escape');
    await ui.follow('[[Absent]]');
    expect(await ui.observeNavigation('.codocs/missing.yaml')).toEqual([]);
  });
});

test.describe('작업 공간과 언어 기능의 분리', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ () => {
  test.describe('중첩 작업 공간', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ () => {
    test.use({
      nested: true,
      files: {
        'nested/.codocs/nested-zone.yaml':
          'id: zone\nname: Nested Zone\ndefinition: Nested workspace body\ndomains: [nested]\n',
        'nested/nested.java': 'zone();\n',
      },
    });
    test('중첩 코드 호버의 원문을 누르면 가장 가까운 작업 공간의 문서를 연다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
      ui,
    }) => {
      await ui.open('nested/nested.java');
      const hover = await ui.hover('zone()', 'Nested workspace body');
      await expect(hover).not.toContainText('Zone body');
      await hover.getByRole('link', { name: '원문 열기', exact: true }).click();
      await expect
        .poll(async () => (await ui.state()).active?.uri)
        .toBe(ui.uri('nested/.codocs/nested-zone.yaml'));
      await expect
        .poll(async () => (await ui.state()).active?.selections)
        .toEqual(emptyTopSelection);
    });
  });

  test('TypeScript 정의 이동은 Codocs 원문 열기로 바뀌지 않는다', /** 화면 입력과 관측으로 해당 계약을 검증한다. */ async ({
    ui,
  }) => {
    await ui.open('native.ts');
    await ui.hover('nativeFunction', 'function nativeFunction', 1);
    const point = await ui.point('nativeFunction', 1);
    await ui.page.mouse.click(point.x, point.y);
    await ui.page.keyboard.press('F12');
    await expect
      .poll(async () => (await ui.state()).active?.selections[0]?.start.line)
      .toBe(0);
    expect((await ui.state()).active.uri).toBe(ui.uri('native.ts'));
    expect(
      (await ui.state()).tabs.some((tab) => tab.uri?.endsWith('.yaml')),
    ).toBe(false);
  });
});
